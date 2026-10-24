#include <Arduino.h>
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "pm_link.h"
#include "pm_api.h"
#include "pm_mesh.h"
#include "pm_reassembly.h"
#include "pm_show.h"

// Per attempt; a lost chunk costs one attempt, not the request.
#define REMOTE_TIMEOUT_MS 900
#define REMOTE_TRIES 3
#define MAX_PENDING 6
// Spacing between the chunks of one message. Relays rebroadcast each
// chunk 2-10 ms after hearing it (~1 ms of airtime), and a radio that
// is transmitting can't receive: the gap must outlast that, or chunk
// k's relays land on top of chunk k+1. 6 ms lost a chunk in 80 % of
// 9-chunk messages on a 3-board bench (2026-10-05).
#define CHUNK_GAP_MS 15
#define RX_QUEUE_DEPTH 24
#define API_FIXED (sizeof(pm_api_request_t) - PM_API_CHUNK)

struct RxFrame {
  pm_frame_header_t hdr;
  int8_t rssi;
  uint8_t len;
  uint8_t payload[PM_MAX_PAYLOAD];
};

struct Pending {
  bool used;
  uint32_t dst;
  bool waiting_wake;  // queued until the leaf answers its wake burst
  uint16_t req_id;
  uint8_t tries;
  uint32_t sent_ms;
  long long console_id;  // the console's "id", for the timeout reply
  bool has_console_id;
  int8_t client;         // who asked: PM_FROM_SERIAL or a WebSocket slot
  pm_ask_cb_t cb;        // set: this node's own request (pm_link_ask), reply goes here
  void *ctx;
  char *text;
  size_t len;
};

static pm_line_out_t s_out;
static QueueHandle_t s_rx;
static PmReassembly s_reasm;
static Pending s_pending[MAX_PENDING];
static uint16_t s_next_req;
static uint32_t s_highest;

static int8_t s_reply_to = PM_TO_ALL;  // who the line being built is for

// The line buffer is borrowed from the heap for the call: static, it was
// 4.4 KB of a bridge's RAM held for nothing between lines (docs §6j).
static void emit(JsonDocument &doc) {
  char *buf = (char *)malloc(PM_API_MAX_BYTES + 64);
  if (!buf) return;  // no memory: the line is lost; the console asks again
  size_t n = serializeJson(doc, buf, PM_API_MAX_BYTES + 64);
  if (s_out) s_out(buf, n, s_reply_to);
  free(buf);
}

static void node_hex(char out[9], uint32_t id) {
  snprintf(out, 9, "%08lx", (unsigned long)id);
}

// --- sending -------------------------------------------------------------

static bool send_frame(pm_msg_type_t type, const void *p, uint8_t len) {
  // esp_now_send refuses when its TX buffer is full; it drains in ~1 ms.
  for (int i = 0; i < 5; i++) {
    if (pm_send(type, p, len)) return true;
    delay(2);
  }
  return false;
}

static bool send_chunked(pm_msg_type_t type, uint32_t dst, uint16_t req_id,
                         const char *text, size_t len) {
  uint8_t chunks = pm_api_chunk_count(len);
  if (!chunks) return false;
  pm_api_request_t f;  // API_RESP has the identical layout
  bool ok = true;
  for (uint8_t c = 0; c < chunks; c++) {
    size_t off = (size_t)c * PM_API_CHUNK;
    size_t n = len - off < PM_API_CHUNK ? len - off : PM_API_CHUNK;
    f.dst = dst;
    f.req_id = req_id;
    f.chunk = c;
    f.chunks = chunks;
    f.len = (uint8_t)n;
    memcpy(f.data, text + off, n);
    ok &= send_frame(type, &f, API_FIXED + n);
    if (c + 1 < chunks) delay(CHUNK_GAP_MS);
  }
  return ok;
}

static void drop(Pending &p);

static void reply_error(bool has_id, long long id, const char *why) {
  JsonDocument doc;
  if (has_id) doc["id"] = id;
  doc["ok"] = false;
  doc["error"] = why;
  emit(doc);
}

// --- console side ----------------------------------------------------------

// A board listening in windows (docs §6f) is woken before a request:
// one tiny hold_awake request every 100 ms across its interval (fresh
// seqs), sent from pm_link_loop; the moment it answers, it is listening
// continuously for 10 min and the queued request goes out. If it never
// answers, the request goes anyway after the burst (and fails normally).
// The first version sent the request straight after the burst and the
// board hadn't left its window mode yet (2026-10-11).
#define LEAF_AWAKE_MS 540000
#define WAKE_REQ_ID 0xFFFF
#define WAKE_GAP_MS 100
static struct { uint32_t id; uint32_t until_ms; } s_leaf_awake[4];
static struct { uint32_t dst; uint8_t left; uint32_t next_ms; } s_wake;  // one burst at a time

static bool leaf_awake(uint32_t id) {
  for (int i = 0; i < 4; i++)
    if (s_leaf_awake[i].id == id && (int32_t)(s_leaf_awake[i].until_ms - millis()) > 0) return true;
  return false;
}
static void mark_awake(uint32_t id) {
  int slot = 0;
  for (int i = 0; i < 4; i++) { if (s_leaf_awake[i].id == id || !s_leaf_awake[i].id) { slot = i; break; } }
  s_leaf_awake[slot] = { id, millis() + LEAF_AWAKE_MS };
}
static void start_wake(uint32_t dst) {
  if (s_wake.left) return;  // one at a time; the request waits its turn
  uint16_t listen = pm_mesh_leaf_listen_ms();
  s_wake = { dst, (uint8_t)(listen / WAKE_GAP_MS + 2), millis() };
  Serial.printf("link: waking %08lx (%u copies over %u ms)\n", (unsigned long)dst, s_wake.left, listen);
}
static void wake_loop() {
  if (!s_wake.left || (int32_t)(millis() - s_wake.next_ms) < 0) return;
  static const char WAKE[] = "{\"cmd\":\"hold_awake\"}";
  send_chunked(PM_MSG_TYPE_API_REQ, s_wake.dst, WAKE_REQ_ID, WAKE, sizeof(WAKE) - 1);
  s_wake.next_ms += WAKE_GAP_MS;
  if (!--s_wake.left) {
    // Burst over without an answer: send what's waiting anyway.
    for (Pending &p : s_pending) if (p.used && p.waiting_wake && p.dst == s_wake.dst) { p.waiting_wake = false; p.sent_ms = millis(); send_chunked(PM_MSG_TYPE_API_REQ, p.dst, p.req_id, p.text, p.len); }
  }
}
// The leaf answered the wake: it's awake for 10 min — release its queue.
static void on_wake_reply(uint32_t src) {
  mark_awake(src);
  if (s_wake.left && s_wake.dst == src) s_wake.left = 0;
  for (Pending &p : s_pending) if (p.used && p.waiting_wake && p.dst == src) { p.waiting_wake = false; p.sent_ms = millis(); send_chunked(PM_MSG_TYPE_API_REQ, p.dst, p.req_id, p.text, p.len); }
}

static void request_inner(const char *json, size_t len, int8_t from);
void pm_link_request(const char *json, size_t len, int8_t from) {
  s_reply_to = from;
  request_inner(json, len, from);
  s_reply_to = PM_TO_ALL;
}
// Below this much contiguous free heap the bridge turns an OTA chunk away
// ("bridge busy") instead of forwarding it: a chunk in flight costs about
// 25 KB and the router's once-a-minute multicast burst about 40 KB, and
// when both land at once the WiFi driver's own allocations fail and the
// radio wedges (docs §6j, 2026-10-23). The sender retries in a moment.
#define BUSY_BLOCK_BYTES 44000

static void request_inner(const char *json, size_t len, int8_t from) {
  // Routing needs three fields. Parsing the whole request copies its
  // payload — an OTA chunk's 3.6 KB of base64 — for nothing when it is
  // only being forwarded, so the full parse happens only for a request
  // handled here or one the show mirror reads.
  JsonDocument req;
  {
    JsonDocument filter;
    filter["id"] = true; filter["node"] = true; filter["cmd"] = true;
    if (deserializeJson(req, json, len, DeserializationOption::Filter(filter))) return reply_error(false, 0, "not JSON");
  }
  bool has_id = req["id"].is<long long>();
  long long id = req["id"] | 0LL;
  const char *cmd = req["cmd"] | "";

  const char *node = req["node"] | "";
  uint32_t dst = *node ? strtoul(node, nullptr, 16) : pm_node_id();
  if (dst == pm_node_id()) {
    if (deserializeJson(req, json, len)) return reply_error(has_id, id, "not JSON");
    JsonDocument resp;
    pm_api_handle(req.as<JsonObjectConst>(), resp.to<JsonObject>());
    return emit(resp);
  }
  if (!strcmp(cmd, "ota_data") && ESP.getMaxAllocHeap() < BUSY_BLOCK_BYTES)
    return reply_error(has_id, id, "bridge busy — low memory, try again in a moment");
  bool mirrored = !strncmp(cmd, "set_", 4) || !strcmp(cmd, "delete_sequence");
  if (mirrored && deserializeJson(req, json, len)) return reply_error(has_id, id, "not JSON");

  if (!pm_api_chunk_count(len)) return reply_error(has_id, id, "request too large for the mesh");
  // A bridge keeps a copy of every sequence and trigger the console sends
  // to any board, so a board that was asleep or away can pull it later.
  if (mirrored && (pm_role() & PM_NODE_ROLE_BRIDGE)) pm_show_mirror(dst, req.as<JsonObjectConst>());
  Pending *p = nullptr;
  for (Pending &q : s_pending) if (!q.used) { p = &q; break; }
  if (!p) return reply_error(has_id, id, "bridge busy — too many requests in flight");
  p->text = (char *)malloc(len);
  if (!p->text) return reply_error(has_id, id, "out of memory");
  memcpy(p->text, json, len);
  p->len = len;
  p->used = true;
  p->dst = dst;
  p->req_id = ++s_next_req;
  p->tries = 1;
  p->sent_ms = millis();
  p->console_id = id;
  p->has_console_id = has_id;
  p->client = from;
  if (pm_mesh_is_leaf(dst) && !leaf_awake(dst)) {
    p->waiting_wake = true;
    start_wake(dst);
    return;
  }
  send_chunked(PM_MSG_TYPE_API_REQ, dst, p->req_id, p->text, p->len);
}

static void drop(Pending &p) {
  free(p.text);
  p.text = nullptr;
  p.cb = nullptr;
  p.used = false;
}

bool pm_link_ask(uint32_t dst, const char *json, size_t len, pm_ask_cb_t cb, void *ctx) {
  if (!dst || dst == pm_node_id() || !pm_api_chunk_count(len)) return false;
  Pending *p = nullptr;
  for (Pending &q : s_pending) if (!q.used) { p = &q; break; }
  if (!p) return false;
  p->text = (char *)malloc(len);
  if (!p->text) return false;
  memcpy(p->text, json, len);
  p->len = len;
  p->used = true;
  p->dst = dst;
  p->req_id = ++s_next_req;
  p->tries = 1;
  p->sent_ms = millis();
  p->has_console_id = false;
  p->cb = cb;
  p->ctx = ctx;
  p->waiting_wake = false;
  send_chunked(PM_MSG_TYPE_API_REQ, dst, p->req_id, p->text, p->len);
  return true;
}

static void retry_pending() {
  uint32_t now = millis();
  for (Pending &p : s_pending) {
    if (!p.used || p.waiting_wake || (uint32_t)(now - p.sent_ms) < REMOTE_TIMEOUT_MS) continue;
    if (p.tries >= REMOTE_TRIES) {
      if (p.cb) { pm_ask_cb_t cb = p.cb; void *ctx = p.ctx; drop(p); cb(nullptr, 0, ctx); continue; }
      char hex[9], why[48];
      node_hex(hex, p.dst);
      snprintf(why, sizeof(why), "no reply from node %s", hex);
      s_reply_to = p.client;
      reply_error(p.has_console_id, p.console_id, why);
      s_reply_to = PM_TO_ALL;
      drop(p);
      continue;
    }
    p.tries++;
    p.sent_ms = now;
    send_chunked(PM_MSG_TYPE_API_REQ, p.dst, p.req_id, p.text, p.len);
  }
}

// --- mesh side ---------------------------------------------------------------

static void on_frame(const pm_frame_header_t *hdr, const uint8_t *payload,
                     uint8_t len, int8_t rssi) {
  RxFrame f;
  f.hdr = *hdr;
  f.rssi = rssi;
  f.len = len;
  memcpy(f.payload, payload, len);
  xQueueSend(s_rx, &f, 0);  // full queue: drop — flood traffic repeats
}

static void on_heartbeat(const RxFrame &f) {
  // Pre-2026-10-07 boards send one byte less (no channel): still shown.
  if (f.len < sizeof(pm_heartbeat_t) - 1) return;
  pm_heartbeat_t hb = {};
  memcpy(&hb, f.payload, f.len < sizeof(hb) ? f.len : sizeof(hb));
  JsonDocument doc;
  char hex[9];
  node_hex(hex, f.hdr.src_id);
  doc["evt"] = "heartbeat";
  doc["node"] = hex;
  doc["board"] = hb.board;
  doc["role"] = hb.role;
  doc["fw"] = hb.fw_version;
  doc["up"] = hb.uptime_s;
  doc["heap"] = hb.free_heap_kb;
  doc["batt"] = hb.battery_mv;
  doc["hops"] = PM_DEFAULT_TTL - f.hdr.ttl;  // 0 = heard directly
  doc["rssi"] = f.rssi;                      // last hop only
  if (hb.channel) doc["ch"] = hb.channel;
  if (hb.listen_ms) doc["listen"] = hb.listen_ms;  // a battery board listening in windows
  JsonArray nb = doc["nbrs"].to<JsonArray>();
  for (uint8_t i = 0; i < hb.neighbor_count && i < PM_MAX_NEIGHBORS; i++) {
    JsonObject o = nb.add<JsonObject>();
    node_hex(hex, hb.neighbors[i].node_id);
    o["node"] = hex;
    o["rssi"] = hb.neighbors[i].rssi;
  }
  emit(doc);
}

static void on_state(const RxFrame &f) {
  if (f.len < sizeof(pm_state_t)) return;
  pm_state_t st;
  memcpy(&st, f.payload, sizeof(st));
  if (st.kind != PM_STATE_KIND_SENSOR_TRIGGER && st.kind != PM_STATE_KIND_SENSOR_CLEAR) return;
  JsonDocument doc;
  char hex[9];
  node_hex(hex, f.hdr.src_id);
  doc["evt"] = "input";
  doc["node"] = hex;
  doc["kind"] = "DIGITAL_IN";
  doc["index"] = st.source_channel;
  doc["value"] = st.kind == PM_STATE_KIND_SENSOR_TRIGGER ? 1 : 0;
  emit(doc);
}

static void on_api(const RxFrame &f) {
  if (f.len < API_FIXED) return;
  pm_api_request_t a;
  memset(&a, 0, sizeof(a));
  memcpy(&a, f.payload, f.len);
  if (a.dst != pm_node_id() || a.len > f.len - API_FIXED) return;
  size_t n;
  const char *msg = s_reasm.add(f.hdr.src_id, a.req_id, a.chunk, a.chunks,
                                a.data, a.len, millis(), &n);
  if (!msg) return;

  if (f.hdr.msg_type == PM_MSG_TYPE_API_RESP) {
    if (a.req_id == WAKE_REQ_ID) { on_wake_reply(f.hdr.src_id); return; }
    for (Pending &p : s_pending) {
      if (!p.used || p.req_id != a.req_id || p.dst != f.hdr.src_id) continue;
      if (p.cb) { pm_ask_cb_t cb = p.cb; void *ctx = p.ctx; drop(p); cb(msg, n, ctx); return; }
      if (s_out) s_out(msg, n, p.client);  // the target's reply, verbatim, to whoever asked
      drop(p);
      return;
    }
    return;  // a late reply to a request already timed out or answered
  }

  // A request for us: run it exactly as if it had come over USB.
  JsonDocument req, resp;
  if (deserializeJson(req, msg, n)) {
    resp["ok"] = false;
    resp["error"] = "not JSON";
  } else {
    pm_api_handle(req.as<JsonObjectConst>(), resp.to<JsonObject>());
  }
  char *out = (char *)malloc(PM_API_MAX_BYTES);  // for the call; send_chunked copies into frames
  if (!out) return;
  size_t len = serializeJson(resp, out, PM_API_MAX_BYTES);
  send_chunked(PM_MSG_TYPE_API_RESP, f.hdr.src_id, a.req_id, out, len);
  free(out);
}

void pm_link_begin(pm_line_out_t out) {
  s_out = out;
  s_rx = xQueueCreate(RX_QUEUE_DEPTH, sizeof(RxFrame));
  s_highest = pm_node_id();
  pm_on_receive(on_frame);
}

void pm_link_loop() {
  wake_loop();
  RxFrame f;
  while (xQueueReceive(s_rx, &f, 0) == pdTRUE) {
    if (f.hdr.src_id > s_highest) s_highest = f.hdr.src_id;
    switch (f.hdr.msg_type) {
      case PM_MSG_TYPE_HEARTBEAT: on_heartbeat(f); break;
      case PM_MSG_TYPE_STATE: on_state(f); break;
      case PM_MSG_TYPE_CUE:
        if (f.len >= sizeof(pm_cue_t)) {
          pm_cue_t c;
          memcpy(&c, f.payload, sizeof(c));
          pm_show_on_cue(f.hdr.src_id, c);
        }
        break;
      case PM_MSG_TYPE_API_REQ:
      case PM_MSG_TYPE_API_RESP: on_api(f); break;
    }
  }
  retry_pending();
}

void pm_link_input(uint8_t index, bool active) {
  JsonDocument doc;
  char hex[9];
  node_hex(hex, pm_node_id());
  doc["evt"] = "input";
  doc["node"] = hex;
  doc["kind"] = "DIGITAL_IN";
  doc["index"] = index;
  doc["value"] = active ? 1 : 0;
  emit(doc);

  pm_state_t st = {};
  st.kind = active ? PM_STATE_KIND_SENSOR_TRIGGER : PM_STATE_KIND_SENSOR_CLEAR;
  st.source_channel = index;
  st.value = active;
  st.at_us = pm_time_synced() ? pm_mesh_time_us() : 0;
  send_frame(PM_MSG_TYPE_STATE, &st, sizeof(st));
}

void pm_link_forget_client(int8_t client) {
  for (Pending &p : s_pending) if (p.used && !p.cb && p.client == client) drop(p);
}

void pm_link_event(JsonDocument &evt) {
  int8_t was = s_reply_to;  // an event raised while answering a request still goes to everyone
  s_reply_to = PM_TO_ALL;
  emit(evt);
  s_reply_to = was;
}

uint32_t pm_link_highest_seen() { return s_highest; }
void pm_link_reset_highest_seen() { s_highest = pm_node_id(); }

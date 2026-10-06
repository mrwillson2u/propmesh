#include <Arduino.h>
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "pm_link.h"
#include "pm_api.h"
#include "pm_mesh.h"
#include "pm_reassembly.h"

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
  uint16_t req_id;
  uint8_t tries;
  uint32_t sent_ms;
  long long console_id;  // the console's "id", for the timeout reply
  bool has_console_id;
  char *text;
  size_t len;
};

static pm_line_out_t s_out;
static QueueHandle_t s_rx;
static PmReassembly s_reasm;
static Pending s_pending[MAX_PENDING];
static uint16_t s_next_req;
static uint32_t s_highest;

static void emit(JsonDocument &doc) {
  static char buf[PM_API_MAX_BYTES + 64];
  size_t n = serializeJson(doc, buf, sizeof(buf));
  if (s_out) s_out(buf, n);
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

void pm_link_request(const char *json, size_t len) {
  JsonDocument req;
  if (deserializeJson(req, json, len)) return reply_error(false, 0, "not JSON");
  bool has_id = req["id"].is<long long>();
  long long id = req["id"] | 0LL;

  const char *node = req["node"] | "";
  uint32_t dst = *node ? strtoul(node, nullptr, 16) : pm_node_id();
  if (dst == pm_node_id()) {
    JsonDocument resp;
    pm_api_handle(req.as<JsonObjectConst>(), resp.to<JsonObject>());
    return emit(resp);
  }

  if (!pm_api_chunk_count(len)) return reply_error(has_id, id, "request too large for the mesh");
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
  send_chunked(PM_MSG_TYPE_API_REQ, dst, p->req_id, p->text, p->len);
}

static void drop(Pending &p) {
  free(p.text);
  p.text = nullptr;
  p.used = false;
}

static void retry_pending() {
  uint32_t now = millis();
  for (Pending &p : s_pending) {
    if (!p.used || (uint32_t)(now - p.sent_ms) < REMOTE_TIMEOUT_MS) continue;
    if (p.tries >= REMOTE_TRIES) {
      char hex[9], why[48];
      node_hex(hex, p.dst);
      snprintf(why, sizeof(why), "no reply from node %s", hex);
      reply_error(p.has_console_id, p.console_id, why);
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
  if (f.len < sizeof(pm_heartbeat_t)) return;
  pm_heartbeat_t hb;
  memcpy(&hb, f.payload, sizeof(hb));
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
    for (Pending &p : s_pending) {
      if (!p.used || p.req_id != a.req_id || p.dst != f.hdr.src_id) continue;
      if (s_out) s_out(msg, n);  // the target's reply, verbatim
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
  static char out[PM_API_MAX_BYTES];
  size_t len = serializeJson(resp, out, sizeof(out));
  send_chunked(PM_MSG_TYPE_API_RESP, f.hdr.src_id, a.req_id, out, len);
}

void pm_link_begin(pm_line_out_t out) {
  s_out = out;
  s_rx = xQueueCreate(RX_QUEUE_DEPTH, sizeof(RxFrame));
  s_highest = pm_node_id();
  pm_on_receive(on_frame);
}

void pm_link_loop() {
  RxFrame f;
  while (xQueueReceive(s_rx, &f, 0) == pdTRUE) {
    if (f.hdr.src_id > s_highest) s_highest = f.hdr.src_id;
    switch (f.hdr.msg_type) {
      case PM_MSG_TYPE_HEARTBEAT: on_heartbeat(f); break;
      case PM_MSG_TYPE_STATE: on_state(f); break;
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

uint32_t pm_link_highest_seen() { return s_highest; }
void pm_link_reset_highest_seen() { s_highest = pm_node_id(); }

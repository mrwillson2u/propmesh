#include <Arduino.h>
#include <ArduinoJson.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "pm_link.h"
#include "pm_api.h"
#include "pm_mesh.h"
#include "pm_reassembly.h"
#include "pm_show.h"
#include "pm_copies.h"
#include "pm_update_core.h"

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
// A chunk sent straight to the board being updated (TTL 0, no relay
// rebroadcasts to wait out): the gap only paces the send queue, which
// sends one frame at a time as the radio finishes the last (~2.5 ms).
#define DIRECT_GAP_MS 4
// A direct chunk unanswered this long is resent the usual way, through
// the relays. The board answers ~100-200 ms after the first frame (a
// flash sector erase is most of it), so this is generous.
#define DIRECT_TIMEOUT_MS 500
// ota_end: the board checks the whole image and switches its boot
// partition before it answers, which can outlast REMOTE_TIMEOUT_MS. A
// resend then reached a board whose transfer was already closed, and its
// "no update in progress" read as a failure although the board had taken
// the image and booted it (Candles 3 and 6, 2026-10-28).
#define SLOW_TIMEOUT_MS 2500
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
  bool holds;            // a console request that holds a battery board awake (not background polling)
  bool gated;            // a read for another board during an update: one at a time (gate_loop)
  bool queued;           // ...and still waiting its turn: not sent yet; sent_ms is when it arrived
  bool direct;           // this try went straight to the board (TTL 0), not through the relays
  bool slow;             // ota_end: give the board SLOW_TIMEOUT_MS before resending
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

static bool send_frame(pm_msg_type_t type, const void *p, uint8_t len, uint8_t ttl = PM_DEFAULT_TTL) {
  // esp_now_send refuses when its TX buffer is full; it drains in ~1 ms.
  for (int i = 0; i < 5; i++) {
    if (pm_send(type, p, len, ttl)) return true;
    delay(2);
  }
  return false;
}

static bool send_chunked(pm_msg_type_t type, uint32_t dst, uint16_t req_id,
                         const char *text, size_t len, uint8_t ttl = PM_DEFAULT_TTL,
                         uint32_t gap_ms = CHUNK_GAP_MS) {
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
    ok &= send_frame(type, &f, API_FIXED + n, ttl);
    if (c + 1 < chunks) delay(gap_ms);
  }
  return ok;
}

static void drop(Pending &p);
static void send_pending(Pending &p);

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
    for (Pending &p : s_pending) if (p.used && p.waiting_wake && p.dst == s_wake.dst) { p.waiting_wake = false; p.sent_ms = millis(); send_pending(p); }
  }
}
// The leaf answered the wake: it's awake for 10 min — release its queue.
static void on_wake_reply(uint32_t src) {
  mark_awake(src);
  if (s_wake.left && s_wake.dst == src) s_wake.left = 0;
  for (Pending &p : s_pending) if (p.used && p.waiting_wake && p.dst == src) { p.waiting_wake = false; p.sent_ms = millis(); send_pending(p); }
}

// Who a console last worked on, and when (pm_link_console_recent): the
// moment the board ANSWERED a request that holds it, which is when its
// 10-min hold began. Counting at send time also counted requests to a
// sleeping board that never arrived (2026-10-28: a console reload asked
// every board, and the bridge then left boards held after its visits).
static struct { uint32_t id; uint32_t ms; } s_touch[8];
// The same list the firmware counts as background (pm_api): it doesn't hold a board.
static bool holds_board(const char *cmd) {
  return strcmp(cmd, "hello") && strcmp(cmd, "mesh") && strcmp(cmd, "state") && strcmp(cmd, "ota_status") && strcmp(cmd, "ble");
}
static void touch(uint32_t dst) {
  int slot = 0;
  for (int i = 0; i < 8; i++) {
    if (s_touch[i].id == dst) { slot = i; break; }
    if ((int32_t)(s_touch[i].ms - s_touch[slot].ms) < 0) slot = i;  // the oldest
  }
  s_touch[slot] = { dst, millis() ? millis() : 1 };
}
bool pm_link_console_recent(uint32_t dst, uint32_t ms) {
  for (auto &t : s_touch) if (t.id == dst && t.ms && millis() - t.ms < ms) return true;
  return false;
}
bool pm_link_busy_with(uint32_t dst) {
  for (Pending &p : s_pending) if (p.used && p.dst == dst) return true;
  return false;
}

static void request_inner(const char *json, size_t len, int8_t from);
void pm_link_request(const char *json, size_t len, int8_t from) {
  s_reply_to = from;
  request_inner(json, len, from);
  s_reply_to = PM_TO_ALL;
}
// The bridge turns an OTA chunk away ("bridge busy") instead of
// forwarding it when it is short of memory: a chunk in flight costs about
// 25 KB (the socket's buffers, the request's copy, the reply) and the
// router's once-a-minute multicast burst about 40 KB, and when both land
// at once the WiFi driver's own allocations fail and the radio wedges
// (docs §6j, 2026-10-23). The sender retries in a moment.
// Free in all: at 15:50 on 2026-10-28 the bridge had 74 KB free, took
// chunks for Candle 2, and other traffic on top (six candles awake, every
// board surveyed, a console reconnecting, the router's bursts) ran it down
// to 3.9 KB; the radio went mute and a reboot cleared it. That other
// traffic is now held back during an update (the update window, below),
// so the line is a burst plus the rest of a chunk: 56 KB. 64 KB, the first
// figure, refused most chunks with three consoles attached (65-70 KB idle).
// The largest block only guards against a fragmented heap: the chunk's
// pieces are 4 KB each. 44 KB, the first figure, came from when free and
// largest block were the same number; after a radio rebuild the block sat
// at 41 KB with 65 KB free, which refused every chunk (2026-10-29).
#define BUSY_BLOCK_BYTES 16000
#define OTA_FREE_BYTES 56000
// Any other request for a board waits below this, and so do the bridge's
// own heavier replies (show and board copies), rather than piling up
// Pending slots and reassembly buffers.
#define BUSY_FREE_BYTES 40000
// Local commands that read files into large documents.
static bool heavy_local(const char *cmd) {
  return !strncmp(cmd, "pull_", 5) || !strcmp(cmd, "get_copies") || !strcmp(cmd, "get_copy");
}
static const char BUSY_MSG[] = "bridge busy — low memory, try again in a moment";

// --- the update window ---------------------------------------------------------
// While a firmware image streams through the bridge, the rest of the
// mesh's traffic is managed around it instead of the upload being slowed
// for it (Colin, 2026-10-29). From the first chunk until UPDATE_WINDOW_MS
// after the last:
//  - reads for other boards (pm_upd_waits_turn: hello, state, get_*) go
//    one at a time, in the order they came; one that can't start within
//    GATE_WAIT_MS is answered busy (the console gives up at 6 s anyway).
//    A console's survey of every board used to put six requests and
//    their replies on top of the chunks. Actions (a cue, all_off, a pin
//    test, a save) go straight out, as always.
//  - the bridge's own visits wait (pm_copies).
//  - consoles hear {"evt":"updating"} at the start and the end, so they
//    can hold their own reloads; `hello` and `mesh` say so too.
//  - each chunk goes straight to the board when the bridge hears it well
//    (pm_update_core.h): TTL 0, so the relays don't rebroadcast it and
//    the frames need no gap for them — ~85 ms a chunk instead of ~400,
//    and the image doesn't flood the whole mesh. Unanswered, it is resent
//    the usual way, with the same request number, so the board's
//    reassembly keeps what it already got and the flood fills the rest.
#define UPDATE_WINDOW_MS 15000
#define GATE_WAIT_MS 3500
// Reads waiting or in flight at once, of the six request slots: the rest
// stay free for the chunks and for actions. More are answered busy at once.
#define GATE_MAX 3
static const char GATE_MSG[] = "bridge busy — a firmware update is running; reads of other boards go one at a time";
static struct {
  uint32_t dst;  // the board being updated (kept after the window, for `mesh`)
  bool on;
  uint32_t since_ms, last_ms;
  uint32_t chunks, direct, direct_ok, gated, turned_away;
  PmDirect d;
} s_upd;

static void update_event(bool on) {
  JsonDocument e;
  char hex[9];
  node_hex(hex, s_upd.dst);
  e["evt"] = "updating";
  e["node"] = hex;
  e["on"] = on;
  if (!on) {
    e["s"] = (s_upd.last_ms - s_upd.since_ms) / 1000;
    e["chunks"] = s_upd.chunks;
    e["direct"] = s_upd.direct;
    e["direct_ok"] = s_upd.direct_ok;
  }
  pm_link_event(e);
}
// An OTA chunk was taken for `dst`: open the window, or keep it open.
static void note_update(uint32_t dst) {
  uint32_t now = millis() ? millis() : 1;
  if (!s_upd.on || s_upd.dst != dst) {
    if (s_upd.on) update_event(false);  // another board's transfer: the last one's window ends here
    s_upd = {};
    s_upd.dst = dst;
    s_upd.on = true;
    s_upd.since_ms = now;
    update_event(true);
  }
  s_upd.last_ms = now;
}
static bool direct_for(uint32_t dst) {
  pm_neighbor_t nb[PM_MAX_NEIGHBORS];
  uint8_t n = pm_neighbor_snapshot(nb, PM_MAX_NEIGHBORS);
  bool heard = false;
  int8_t rssi = -127;
  for (uint8_t i = 0; i < n; i++) if (nb[i].node_id == dst) { heard = true; rssi = nb[i].rssi; break; }
  bool d = pm_direct_choose(s_upd.d, heard, rssi);
  if (d) s_upd.direct++;
  return d;
}
uint32_t pm_link_updating() { return s_upd.on ? s_upd.dst : 0; }
void pm_link_update_status(JsonObject out) {
  if (!s_upd.dst) return;
  char hex[9];
  node_hex(hex, s_upd.dst);
  JsonObject u = out["update"].to<JsonObject>();
  u["node"] = hex;
  u["on"] = s_upd.on;
  u["s"] = ((s_upd.on ? millis() : s_upd.last_ms) - s_upd.since_ms) / 1000;
  u["chunks"] = s_upd.chunks;
  u["direct"] = s_upd.direct;        // sent straight to the board
  u["direct_ok"] = s_upd.direct_ok;  // ...and answered without the relays
  u["gated"] = s_upd.gated;          // reads for other boards that waited their turn
  u["turned_away"] = s_upd.turned_away;  // ...and were answered busy instead
}

static void send_pending(Pending &p) {
  if (p.direct) send_chunked(PM_MSG_TYPE_API_REQ, p.dst, p.req_id, p.text, p.len, 0, DIRECT_GAP_MS);
  else send_chunked(PM_MSG_TYPE_API_REQ, p.dst, p.req_id, p.text, p.len);
}
static void dispatch(Pending &p) {
  p.queued = false;
  p.sent_ms = millis();
  if (pm_mesh_is_leaf(p.dst) && !leaf_awake(p.dst)) {
    p.waiting_wake = true;
    start_wake(p.dst);
    return;
  }
  send_pending(p);
}
// The reads waiting their turn: the oldest goes when none is in flight;
// one that waited too long is answered busy. When the window closes,
// everything still waiting goes.
static void gate_loop() {
  uint32_t now = millis();
  Pending *next = nullptr;
  bool busy = false;
  for (Pending &p : s_pending) {
    if (!p.used || !p.gated) continue;
    if (!s_upd.on) { p.gated = false; if (p.queued) dispatch(p); continue; }
    if (!p.queued) { busy = true; continue; }
    if ((uint32_t)(now - p.sent_ms) >= GATE_WAIT_MS) {
      s_upd.turned_away++;
      s_reply_to = p.client;
      reply_error(p.has_console_id, p.console_id, GATE_MSG);
      s_reply_to = PM_TO_ALL;
      drop(p);
      continue;
    }
    if (!next || (int32_t)(p.sent_ms - next->sent_ms) < 0) next = &p;
  }
  if (next && !busy) dispatch(*next);
}

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
  uint32_t free_now = ESP.getFreeHeap();
  if (dst == pm_node_id()) {
    if (free_now < BUSY_FREE_BYTES && heavy_local(cmd)) return reply_error(has_id, id, BUSY_MSG);
    if (deserializeJson(req, json, len)) return reply_error(has_id, id, "not JSON");
    JsonDocument resp;
    pm_api_handle(req.as<JsonObjectConst>(), resp.to<JsonObject>());
    return emit(resp);
  }
  bool ota = !strcmp(cmd, "ota_data");
  if (ota) {
    if (ESP.getMaxAllocHeap() < BUSY_BLOCK_BYTES || free_now < OTA_FREE_BYTES) return reply_error(has_id, id, BUSY_MSG);
    note_update(dst);
  } else if (free_now < BUSY_FREE_BYTES) return reply_error(has_id, id, BUSY_MSG);
  bool mirrored = !strncmp(cmd, "set_", 4) || !strcmp(cmd, "delete_sequence");
  if (mirrored && deserializeJson(req, json, len)) return reply_error(has_id, id, "not JSON");

  if (!pm_api_chunk_count(len)) return reply_error(has_id, id, "request too large for the mesh");
  // A bridge keeps a copy of every sequence and trigger the console sends
  // to any board, so a board that was asleep or away can pull it later.
  if (mirrored && (pm_role() & PM_NODE_ROLE_BRIDGE)) pm_show_mirror(dst, req.as<JsonObjectConst>());
  Pending *p = nullptr;
  for (Pending &q : s_pending) if (!q.used) { p = &q; break; }
  if (!p) return reply_error(has_id, id, s_upd.on && !ota ? GATE_MSG : "bridge busy — too many requests in flight");
  p->text = (char *)malloc(len);
  if (!p->text) return reply_error(has_id, id, "out of memory");
  memcpy(p->text, json, len);
  p->len = len;
  p->used = true;
  p->dst = dst;
  p->req_id = ++s_next_req;
  p->tries = 1;
  p->console_id = id;
  p->has_console_id = has_id;
  p->client = from;
  p->cb = nullptr;
  p->holds = holds_board(cmd);
  p->waiting_wake = false;
  p->direct = ota && direct_for(dst);
  if (ota) s_upd.chunks++;
  p->slow = !strcmp(cmd, "ota_end");
  p->gated = !ota && s_upd.on && dst != s_upd.dst && pm_upd_waits_turn(cmd);
  p->queued = p->gated;  // gate_loop sends it when it is its turn
  if (p->gated) {
    uint8_t n = 0;
    for (Pending &q : s_pending) if (q.used && q.gated) n++;
    if (n > GATE_MAX) { s_upd.turned_away++; drop(*p); return reply_error(has_id, id, GATE_MSG); }
    s_upd.gated++;
    p->sent_ms = millis();
    gate_loop();
    return;
  }
  dispatch(*p);
}

static void drop(Pending &p) {
  free(p.text);
  p.text = nullptr;
  p.cb = nullptr;
  p.used = false;
  p.gated = p.queued = p.direct = p.slow = p.waiting_wake = false;
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
  p->holds = false;  // this node's own requests are not a console at work
  p->waiting_wake = false;
  p->gated = p->queued = p->direct = p->slow = false;
  send_pending(*p);
  return true;
}

static void retry_pending() {
  uint32_t now = millis();
  for (Pending &p : s_pending) {
    if (!p.used || p.waiting_wake || p.queued) continue;
    if ((uint32_t)(now - p.sent_ms) < (p.direct ? DIRECT_TIMEOUT_MS : p.slow ? SLOW_TIMEOUT_MS : REMOTE_TIMEOUT_MS)) continue;
    if (p.direct) {
      // Not answered straight: the usual way now, through the relays. The
      // same request number, so the board's reassembly (2 s) merges what
      // it already has with the copy the flood brings. Not counted as one
      // of the three tries.
      p.direct = false;
      pm_direct_missed(s_upd.d);
      p.sent_ms = now;
      send_pending(p);
      continue;
    }
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
    send_pending(p);
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
  // Older boards send fewer fields (channel 2026-10-07, listen_ms
  // 2026-10-11, cfg_at 2026-10-28): still shown, read by field.
  if (f.len < offsetof(pm_heartbeat_t, channel)) return;
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
  bool stamps = f.len >= offsetof(pm_heartbeat_t, cfg_at) + sizeof(uint32_t);
  if (stamps) doc["cfg_at"] = hb.cfg_at;
  JsonArray nb = doc["nbrs"].to<JsonArray>();
  for (uint8_t i = 0; i < hb.neighbor_count && i < PM_MAX_NEIGHBORS; i++) {
    JsonObject o = nb.add<JsonObject>();
    node_hex(hex, hb.neighbors[i].node_id);
    o["node"] = hex;
    o["rssi"] = hb.neighbors[i].rssi;
  }
  emit(doc);
  // The bridge's copies: a board awake at its check-in may have something waiting.
  pm_copies_heard(f.hdr.src_id, stamps, hb.cfg_at, hb.role & PM_NODE_ROLE_SLEEPING);
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
      if (p.direct) { pm_direct_answered(s_upd.d); s_upd.direct_ok++; }
      if (p.holds) touch(p.dst);  // it answered: its 10-min hold for the console runs from now
      if (s_out) s_out(msg, n, p.client);  // the target's reply, verbatim, to whoever asked
      pm_copies_observe(p.dst, p.text, p.len, msg, n);  // the bridge's copy follows (pm_copies)
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
  if (s_upd.on && (uint32_t)(millis() - s_upd.last_ms) > UPDATE_WINDOW_MS) {
    s_upd.on = false;
    update_event(false);
  }
  gate_loop();
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

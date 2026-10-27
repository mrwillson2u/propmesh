#include <stddef.h>
#include "pm_mesh.h"
#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_mac.h>
#include <string.h>
#include "pm_dedup.h"
#include "pm_time.h"

#if !defined(ESP_ARDUINO_VERSION_MAJOR) || ESP_ARDUINO_VERSION_MAJOR < 3
#error "propmesh-core requires arduino-esp32 core 3.x — use the pioarduino platform (see firmware/mesh-node/platformio.ini)"
#endif

static const uint8_t BCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

static uint16_t s_net_id;
static uint8_t s_role;
static uint32_t s_node_id;
static uint16_t s_seq;
static uint16_t s_boot_id;  // random per boot — see FrameHeader.boot_id
static pm_rx_handler_t s_handler;
static pm_stats_t s_stats;
static PmDedup s_dedup;
static PmNeighbors s_neighbors;
static PmClock s_clock;
static PmWallClock s_wall;
// The jump the wall clock took at the first conductor beacon after boot
// (local − conductor, ms): a board waking from deep sleep measures its
// sleep clock's drift from it (pm_sleep, docs §6m).
static bool s_wall_stepped, s_wall_step_ok;
static int64_t s_wall_step_ms;
// Beacons from firmware before 2026-10-09 end at `priority`: still read.
#define TIME_V1_LEN offsetof(pm_time_t, wall_ms)
static int64_t local_ms() { return esp_timer_get_time() / 1000; }
static uint32_t s_last_beacon_ms, s_last_age_ms;

// Channel following (docs §6d). A bridge's heartbeat says which channel
// the mesh is on; 30 s without one and a plain node scans for it.
static uint8_t s_channel;
static uint32_t s_last_bridge_ms;      // 0 = never heard one
static uint32_t s_last_scan_ms;
static uint8_t s_scan_ch;              // 0 = not scanning
static uint8_t s_scan_home;            // where to return if nothing is found
static uint32_t s_scan_step_ms;
static void (*s_channel_cb)(uint8_t);
// Battery boards that listen in windows (heartbeat listen_ms > 0).
#define MAX_LEAVES 4
#define LEAF_FORGET_MS 60000
static struct { uint32_t id; uint16_t listen_ms; uint32_t heard_ms; } s_leaves[MAX_LEAVES];
static uint32_t s_stale_ms = PM_SYNC_STALE_MS;
// pm_mesh_unheard_ms(): when a neighbor last listed us, when a neighbor that
// could have (mains, room in its list) last spoke, and when judging began.
static uint32_t s_echo_ms, s_judge_ms, s_judge_since_ms;
static pm_show_stamps_t s_stamps = {0xFF, 0, 0, 0, 0, 0};
static void (*s_stamps_cb)(uint32_t, const pm_show_stamps_t &);
void pm_mesh_set_stamps(const pm_show_stamps_t &s) { s_stamps = s; }
void pm_mesh_on_stamps(void (*cb)(uint32_t, const pm_show_stamps_t &)) { s_stamps_cb = cb; }

static void note_leaf(uint32_t id, uint16_t listen_ms, uint32_t now_ms) {
  int at = -1, oldest = 0;
  for (int i = 0; i < MAX_LEAVES; i++) {
    if (s_leaves[i].id == id) { at = i; break; }
    if (!s_leaves[i].id) { if (at < 0) at = i; }
    else if ((int32_t)(s_leaves[i].heard_ms - s_leaves[oldest].heard_ms) < 0) oldest = i;
  }
  if (at < 0) at = oldest;
  s_leaves[at] = { id, listen_ms, now_ms ? now_ms : 1 };
}
uint16_t pm_mesh_leaf_listen_ms() {
  uint32_t now = millis();
  uint16_t m = 0;
  for (int i = 0; i < MAX_LEAVES; i++)
    if (s_leaves[i].id && (uint32_t)(now - s_leaves[i].heard_ms) < LEAF_FORGET_MS && s_leaves[i].listen_ms > m) m = s_leaves[i].listen_ms;
  return m;
}
bool pm_mesh_is_leaf(uint32_t id) {
  uint32_t now = millis();
  for (int i = 0; i < MAX_LEAVES; i++)
    if (s_leaves[i].id == id && (uint32_t)(now - s_leaves[i].heard_ms) < LEAF_FORGET_MS) return true;
  return false;
}
void pm_mesh_set_stale_ms(uint32_t ms) { s_stale_ms = ms; }

#define BRIDGE_LOST_MS 30000
#define SCAN_RETRY_MS 120000
#define SCAN_DWELL_MS 1000
// A board that has never heard anyone (fresh out of the installer, on the
// default channel) has nothing to lose by searching properly: a dwell
// longer than a heartbeat period, so one pass is enough, the first frame
// from any PropMesh board ends it, and it sweeps again after a short rest
// instead of two minutes. A 1 s dwell gave a new C6 one chance in three
// per pass of catching the bridge on 11, and it sat on 1 for ten minutes
// as its own conductor (2026-10-21).
// Only a bridge ends a fresh sweep: two fresh boards sweeping together
// heard each other on a channel with no bridge on it, stopped there, and
// showed up in the console once per slow sweep with every request timing
// out (2026-10-21). And "fresh" means never having followed a bridge —
// no stored channel — so a configured board whose bridge is off keeps the
// slow search and its show. A fresh board that finds no bridge in
// FRESH_PASSES sweeps drops to the slow search too.
#define FRESH_DWELL_MS (PM_HEARTBEAT_PERIOD_MS + 1000)
#define FRESH_START_MS 5000
#define FRESH_REST_MS 5000
#define FRESH_PASSES 5
static bool s_fresh;        // never followed a bridge (pm_mesh_set_fresh)
static uint8_t s_fresh_passes;

// Relay queue: frames waiting out their jitter before rebroadcast.
// Small and fixed — under cue/heartbeat load this rarely holds >2 frames.
#define RELAY_QUEUE 6  // was 8; static RAM is full (2026-10-07) and it rarely holds >2
static struct {
  bool used;
  uint32_t due_ms;
  uint8_t len;
  uint8_t frame[sizeof(pm_frame_header_t) + PM_MAX_PAYLOAD];
} s_relay[RELAY_QUEUE];

// Send queue: one frame in flight at a time (docs §6j). esp_now_send
// refused frames with NO_MEM, and some it accepted never completed, when
// a 2.7 KB OTA chunk went out as eighteen frames back to back — with the
// heap fine (2026-10-23). Every send and relay goes through here; the
// next frame leaves when the last one's completion callback arrives, or
// after TX_TIMEOUT_MS if it never does. Time beacons are stamped at the
// moment they actually leave. Heap-allocated in init: static RAM is full.
// Dispatch runs in its own small task, woken by the completion callback,
// so the next frame leaves the moment the radio is free rather than on
// the next pass of the main loop (which parses OTA chunks between passes:
// pumped from the loop, an image took 13.6 min and the queue filled 30
// times; 2026-10-23).
#define TX_QUEUE 16  // task dispatch never needed more than 6; one OTA chunk is 18 but they arrive over a round trip
#define TX_TIMEOUT_MS 60
struct TxFrame { uint8_t len; uint8_t frame[sizeof(pm_frame_header_t) + PM_MAX_PAYLOAD]; };
static TxFrame *s_txq;
static uint8_t s_txq_head, s_txq_count;
static volatile bool s_tx_busy;
static uint32_t s_tx_started_ms;
static uint8_t s_tx_lost_streak;
static portMUX_TYPE s_txq_mux = portMUX_INITIALIZER_UNLOCKED;
static SemaphoreHandle_t s_tx_wake;
static TaskHandle_t s_tx_task;

// Election priority this node would beacon with: bridges outrank all.
static uint8_t priority() { return (s_role & PM_NODE_ROLE_BRIDGE) ? 1 : 0; }

uint8_t pm_mesh_channel();
void pm_mesh_set_channel(uint8_t ch);

static void on_recv(const esp_now_recv_info_t *info, const uint8_t *data,
                    int len) {
  if (len < (int)sizeof(pm_frame_header_t)) { s_stats.dropped_bad++; return; }
  pm_frame_header_t hdr;
  memcpy(&hdr, data, sizeof(hdr));  // avoid unaligned access on the raw buffer

  if (hdr.magic != PM_MAGIC || hdr.net_id != s_net_id ||
      hdr.proto_version != PM_PROTO_VERSION) { s_stats.dropped_bad++; return; }
  // TODO(proto v1): verify hdr.auth_tag (truncated AES-CMAC, network key)
  if (hdr.src_id == s_node_id) return;             // our own flood echoed back

  uint32_t now_ms = millis();
  if (s_dedup.seen(hdr.src_id, hdr.seq, now_ms, hdr.boot_id)) {
    s_stats.dropped_dupe++;
    return;
  }

  const uint8_t *payload = data + sizeof(hdr);
  uint8_t plen = len - sizeof(hdr);
  int8_t rssi = info->rx_ctrl ? info->rx_ctrl->rssi : 0;


  // A heartbeat that has not been relayed came straight off this node's
  // radio, so its source is a direct neighbor. Heartbeats always go out
  // at PM_DEFAULT_TTL, which is what makes the test valid.
  if (hdr.msg_type == PM_MSG_TYPE_HEARTBEAT && hdr.ttl == PM_DEFAULT_TTL)
    s_neighbors.observe(hdr.src_id, rssi, now_ms);

  // Does that neighbor hear us? Its heartbeat lists who it hears. A battery
  // board listening in windows may simply have missed us, and a full list
  // may have dropped us for stronger ones — neither counts against us.
  if (hdr.msg_type == PM_MSG_TYPE_HEARTBEAT && hdr.ttl == PM_DEFAULT_TTL &&
      plen > offsetof(pm_heartbeat_t, neighbors)) {
    pm_heartbeat_t hb = {};
    memcpy(&hb, payload, plen < sizeof(hb) ? plen : sizeof(hb));
    uint8_t n = hb.neighbor_count < PM_MAX_NEIGHBORS ? hb.neighbor_count : PM_MAX_NEIGHBORS;
    bool lists_us = false;
    for (uint8_t i = 0; i < n; i++) lists_us |= hb.neighbors[i].node_id == s_node_id;
    bool leaf = plen > offsetof(pm_heartbeat_t, listen_ms) && hb.listen_ms;
    if (lists_us) s_echo_ms = now_ms;
    else if (!leaf && hb.neighbor_count < PM_MAX_NEIGHBORS) {
      if (!s_judge_since_ms) s_judge_since_ms = now_ms;
      s_judge_ms = now_ms;
    }
  }

  // A battery board tells how often it listens: senders repeat into that.
  if (hdr.msg_type == PM_MSG_TYPE_HEARTBEAT && plen >= sizeof(pm_heartbeat_t)) {
    pm_heartbeat_t hb;
    memcpy(&hb, payload, sizeof(hb));
    if (hb.listen_ms) note_leaf(hdr.src_id, hb.listen_ms, now_ms);
  }

  // A bridge heartbeat: this is where the mesh lives. It says which channel
  // the bridge is on; go there. Hearing it is not enough — neighboring
  // channels overlap, so at bench range a node on 10 heard a bridge on 11,
  // never scanned, and stayed put (2026-10-08). In the yard it would not.
  if (hdr.msg_type == PM_MSG_TYPE_HEARTBEAT && plen >= 8 && (payload[7] & PM_NODE_ROLE_BRIDGE) &&
      !(s_role & PM_NODE_ROLE_BRIDGE)) {
    s_last_bridge_ms = now_ms ? now_ms : 1;
    // Read the field by name: "the last byte" broke the moment another
    // field (listen_ms) was appended after channel (2026-10-11), and
    // nodes stopped following the bridge.
    pm_heartbeat_t hb = {};
    memcpy(&hb, payload, plen < sizeof(hb) ? plen : sizeof(hb));
    uint8_t ch = plen > offsetof(pm_heartbeat_t, channel) ? hb.channel : 0;
    bool moved = false;
    if (ch >= 1 && ch <= 13 && ch != pm_mesh_channel()) {
      pm_mesh_set_channel(ch);
      moved = true;
    }
    if (s_scan_ch || moved) {  // found it mid-scan, or moved to it: stay, remember
      s_scan_ch = 0;
      if (s_channel_cb) s_channel_cb(s_channel);
    }
  }

  if (hdr.msg_type == PM_MSG_TYPE_TIME && plen >= TIME_V1_LEN) {
    pm_time_t t = {};
    memcpy(&t, payload, plen < sizeof(t) ? plen : sizeof(t));
    // A bridge's time beacon is proof of the bridge as good as its
    // heartbeat — and a board listening in windows hears beacons (sent
    // every second for it) far more often than heartbeats (every 5 s).
    // Counting only heartbeats sent the Feather scanning for a bridge
    // that was right there (2026-10-11).
    if (t.priority >= 1 && !(s_role & PM_NODE_ROLE_BRIDGE)) s_last_bridge_ms = now_ms ? now_ms : 1;
    // Two conductors can only coexist until they hear each other; the
    // higher (priority, id) wins, so the loser steps down and follows.
    // A bridge never steps down to a plain node.
    if ((s_role & PM_NODE_ROLE_CONDUCTOR) &&
        PmClock::rank(t.priority, t.conductor_id) >
            PmClock::rank(priority(), s_node_id)) {
      s_role &= ~PM_NODE_ROLE_CONDUCTOR;
      s_clock.resign();
    }
    // A conductor keeps its own clock; everyone else follows the best
    // beacon on offer.
    if (!(s_role & PM_NODE_ROLE_CONDUCTOR) &&
        s_clock.should_adopt(t.conductor_id, t.priority, t.hop, now_ms)) {
      int64_t offset = (int64_t)t.mesh_time_us - (int64_t)esp_timer_get_time();
      s_clock.adopt(t.conductor_id, t.priority, t.hop, offset, now_ms);
    }
    // Wall time comes from the conductor we follow; a beacon without it
    // leaves ours alone (a node the console set directly keeps that).
    if (!(s_role & PM_NODE_ROLE_CONDUCTOR) && t.conductor_id == s_clock.conductor()) {
      if (t.wall_flags & 1) {
        if (!s_wall_stepped) {
          s_wall_stepped = true;
          if (s_wall.utc_ok) { s_wall_step_ms = s_wall.utc_ms(local_ms()) - (int64_t)t.wall_ms; s_wall_step_ok = true; }
        }
        s_wall.set_utc((int64_t)t.wall_ms, local_ms());
      }
      if (t.wall_flags & 2) s_wall.set_tz(t.tz_offset_min, t.tz_next_change_s, t.tz_next_offset_min);
      // The show's stamps: only a full-length beacon carries them.
      if (plen >= sizeof(pm_time_t) && s_stamps_cb) {
        pm_show_stamps_t st = {t.mode_manual, t.mode_at, t.mode_until, t.sched_at, t.show_at, t.floods_at};
        s_stamps_cb(t.conductor_id, st);
      }
    }
  }

  s_stats.rx++;
  if (s_handler) s_handler(&hdr, payload, plen, rssi);

  // An API frame addressed to us has arrived; nobody downstream needs
  // it, and rebroadcasting would put this radio in TX while the next
  // chunk of the same message is in the air (measured 2026-10-05: 80 %
  // of 9-chunk messages lost a chunk until this and the wider chunk gap
  // in pm_link.cpp).
  bool for_us = (hdr.msg_type == PM_MSG_TYPE_API_REQ ||
                 hdr.msg_type == PM_MSG_TYPE_API_RESP) &&
                plen >= 4 && ((uint32_t)payload[0] | (uint32_t)payload[1] << 8 |
                              (uint32_t)payload[2] << 16 | (uint32_t)payload[3] << 24) == s_node_id;

  // Relay: powered backbone nodes rebroadcast once, after 2-10 ms jitter
  // so simultaneous relays don't collide.
  if ((s_role & PM_NODE_ROLE_RELAY) && hdr.ttl > 0 && !for_us) {
    for (int i = 0; i < RELAY_QUEUE; i++) {
      if (s_relay[i].used) continue;
      s_relay[i].used = true;
      s_relay[i].due_ms = now_ms + 2 + (esp_random() % 8);
      s_relay[i].len = len;
      memcpy(s_relay[i].frame, data, len);
      ((pm_frame_header_t *)s_relay[i].frame)->ttl = hdr.ttl - 1;
      // A relayed beacon is one hop further from the conductor. The
      // timestamp itself is rewritten at send time in pm_mesh_loop().
      if (hdr.msg_type == PM_MSG_TYPE_TIME && plen >= TIME_V1_LEN)
        ((pm_time_t *)(s_relay[i].frame + sizeof(pm_frame_header_t)))->hop++;
      return;
    }
    s_stats.relay_overrun++;  // queue full: the flood loses this path
  }
}

// The radio finished with a frame (WiFi task context): count it, and the
// next one may go. A frame that never gets here is counted lost after
// TX_TIMEOUT_MS — see pm_stats_t.
static void on_sent(const esp_now_send_info_t *, esp_now_send_status_t status) {
  s_stats.tx_done++;
  if (status != ESP_NOW_SEND_SUCCESS) s_stats.tx_failed++;
  s_stats.tx_done_ms = millis();
  s_tx_lost_streak = 0;
  s_tx_busy = false;
  if (s_tx_wake) xSemaphoreGive(s_tx_wake);
}

// A time beacon is stamped as it leaves, so the time it sat in a queue
// (relay jitter, the send queue) does not become downstream clock error.
static void restamp_time(uint8_t *frame, uint8_t len, uint32_t now) {
  pm_frame_header_t *h = (pm_frame_header_t *)frame;
  if (h->msg_type != PM_MSG_TYPE_TIME || !s_clock.synced(now) ||
      len < sizeof(pm_frame_header_t) + TIME_V1_LEN) return;
  pm_time_t *t = (pm_time_t *)(frame + sizeof(pm_frame_header_t));
  t->mesh_time_us = (uint64_t)s_clock.mesh_us(esp_timer_get_time());
  if (len >= sizeof(pm_frame_header_t) + sizeof(pm_time_t) && (t->wall_flags & 1) && s_wall.utc_ok)
    t->wall_ms = (uint64_t)s_wall.utc_ms(local_ms());
}

// One step of dispatch: if the radio is free (or has been silent past the
// timeout) and a frame is waiting, send it. Called from the tx task.
static void tx_pump(uint32_t now) {
  if (s_tx_busy) {
    if ((uint32_t)(now - s_tx_started_ms) < TX_TIMEOUT_MS) return;
    s_stats.tx_lost++;  // no completion: the driver dropped it (or wedged — pm_mesh_tx_stuck_ms)
    s_tx_lost_streak++;
    s_tx_busy = false;
  }
  TxFrame f;
  portENTER_CRITICAL(&s_txq_mux);
  if (!s_txq_count) { portEXIT_CRITICAL(&s_txq_mux); return; }
  f = s_txq[s_txq_head];
  s_txq_head = (s_txq_head + 1) % TX_QUEUE;
  s_txq_count--;
  portEXIT_CRITICAL(&s_txq_mux);
  restamp_time(f.frame, f.len, now);
  esp_err_t err = esp_now_send(BCAST, f.frame, f.len);
  if (err != ESP_OK) { s_stats.tx_err++; s_stats.last_tx_err = err; return; }
  s_stats.tx_sent++;
  s_tx_busy = true;
  s_tx_started_ms = now;
}

static void tx_task(void *) {
  for (;;) {
    // Woken by a completion or a new frame; or wake on the timeout to count
    // a lost frame and move on.
    xSemaphoreTake(s_tx_wake, pdMS_TO_TICKS(TX_TIMEOUT_MS));
    tx_pump(millis());
  }
}

// Queue a frame for sending; false if the queue is full (counted).
static bool txq_push(const uint8_t *frame, uint8_t len) {
  if (!s_txq) {  // no queue (allocation failed at init): send directly, as before
    esp_err_t err = esp_now_send(BCAST, frame, len);
    if (err != ESP_OK) { s_stats.tx_err++; s_stats.last_tx_err = err; return false; }
    s_stats.tx_sent++;
    return true;
  }
  portENTER_CRITICAL(&s_txq_mux);
  if (s_txq_count >= TX_QUEUE) { portEXIT_CRITICAL(&s_txq_mux); s_stats.tx_queue_full++; return false; }
  TxFrame &f = s_txq[(s_txq_head + s_txq_count) % TX_QUEUE];
  f.len = len;
  memcpy(f.frame, frame, len);
  s_txq_count++;
  if (s_txq_count > s_stats.tx_queue_max) s_stats.tx_queue_max = s_txq_count;
  portEXIT_CRITICAL(&s_txq_mux);
  if (s_tx_wake) xSemaphoreGive(s_tx_wake);
  return true;
}

uint32_t pm_mesh_tx_inflight() {
  uint32_t sent = s_stats.tx_sent, done = s_stats.tx_done;
  return sent > done ? sent - done : 0;
}

uint32_t pm_mesh_tx_stuck_ms() {
  if (s_tx_lost_streak < 8) return 0;
  return millis() - s_stats.tx_done_ms;
}

// Low radio power (2026-10-26): some C6 SuperMinis (Candle 1, the
// lantern) trip their brownout detector at full transmit power after a
// normal restart — on USB power too. The framework then lowers the power
// after that brownout reset, so the board runs on, but a new image reset
// that way before it confirms is rolled back by the bootloader. The node
// asks for 13 dBm while an image is on probation, and for good once the
// board has browned out (pm_mesh_low_power); the cap is applied each time
// the radio starts.
#define LOW_QDBM 52           // 0.25 dBm units: 13 dBm
static bool s_low;            // wanted
static int8_t s_full_qdbm;    // the driver's own maximum, read before lowering it
static void apply_power() {
  int8_t q = 0;
  if (esp_wifi_get_max_tx_power(&q) != ESP_OK) return;
  if (s_low && q > LOW_QDBM) { s_full_qdbm = q; esp_wifi_set_max_tx_power(LOW_QDBM); }
  else if (!s_low && s_full_qdbm && q < s_full_qdbm) esp_wifi_set_max_tx_power(s_full_qdbm);
}
void pm_mesh_low_power(bool low) { s_low = low; if (WiFi.getMode() != WIFI_OFF) apply_power(); }
bool pm_mesh_is_low_power() { return s_low; }

bool pm_mesh_init(uint8_t channel, uint16_t net_id, uint8_t role) {
  s_net_id = net_id;
  s_role = role;
  do s_boot_id = (uint16_t)esp_random(); while (!s_boot_id);

  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  s_node_id = ((uint32_t)mac[2] << 24) | ((uint32_t)mac[3] << 16) |
              ((uint32_t)mac[4] << 8) | mac[5];

  if (role & PM_NODE_ROLE_CONDUCTOR)
    s_clock.become_conductor(s_node_id, priority(), millis());
  if (!s_txq) s_txq = (TxFrame *)calloc(TX_QUEUE, sizeof(TxFrame));
  if (s_txq && !s_tx_wake) s_tx_wake = xSemaphoreCreateBinary();
  if (s_txq && s_tx_wake && !s_tx_task &&
      xTaskCreate(tx_task, "pm_tx", 2560, nullptr, 5, &s_tx_task) != pdPASS) {
    free(s_txq); s_txq = nullptr;  // no task: frames go straight to the radio, as before
  }

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();  // no AP association yet (a bridge joins WiFi later — pm_wifi)
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  s_channel = channel;
  apply_power();

  if (esp_now_init() != ESP_OK) return false;

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BCAST, 6);
  peer.channel = 0;  // "whatever channel the radio is on" — it follows the bridge / the router
  peer.ifidx = WIFI_IF_STA;
  if (esp_now_add_peer(&peer) != ESP_OK) return false;

  esp_now_register_send_cb(on_sent);
  return esp_now_register_recv_cb(on_recv) == ESP_OK;
}

uint32_t pm_node_id() { return s_node_id; }

uint8_t pm_mesh_channel() {
  uint8_t primary = s_channel;
  wifi_second_chan_t second;
  if (esp_wifi_get_channel(&primary, &second) == ESP_OK && primary) s_channel = primary;
  return s_channel;
}
void pm_mesh_set_channel(uint8_t ch) {
  if (ch < 1 || ch > 13) return;
  esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
  s_channel = ch;
}
void pm_mesh_on_channel(void (*cb)(uint8_t)) { s_channel_cb = cb; }
void pm_mesh_set_fresh(bool fresh) { s_fresh = fresh; }

// The whole WiFi driver down and up, not just ESP-NOW: a driver whose
// transmit allocations have failed keeps its wedged queue through an
// ESP-NOW re-init and only lets go with esp_wifi_deinit — which is what
// WiFi.mode(WIFI_OFF) does in this core (docs §6j, esp-idf #18682). A
// bridge loses its WiFi association here; pm_wifi rejoins.
bool pm_mesh_recover(uint8_t ch) {
  esp_now_deinit();  // harmless if it was already gone
  WiFi.mode(WIFI_OFF);
  delay(50);
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  apply_power();
  if (esp_now_init() != ESP_OK) return false;
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BCAST, 6);
  peer.channel = 0;
  peer.ifidx = WIFI_IF_STA;
  if (esp_now_add_peer(&peer) != ESP_OK) return false;
  if (esp_now_register_recv_cb(on_recv) != ESP_OK) return false;
  esp_now_register_send_cb(on_sent);
  s_stats.tx_done_ms = millis();  // a fresh radio starts a fresh clock on "stuck"
  s_stats.tx_sent = s_stats.tx_done;  // frames in flight when the driver went down never complete: not a leak
  s_tx_busy = false;
  s_tx_lost_streak = 0;
  pm_mesh_set_channel(ch);
  return true;
}
bool pm_wall_first_step(int64_t *ms) { if (s_wall_step_ok) *ms = s_wall_step_ms; return s_wall_step_ok; }
uint32_t pm_mesh_bridge_heard_at_ms() { return s_last_bridge_ms; }
uint16_t pm_mesh_bridge_age_s() {
  return s_last_bridge_ms ? (uint16_t)((millis() - s_last_bridge_ms) / 1000) : 0xFFFF;
}
bool pm_mesh_scanning() { return s_scan_ch != 0; }

// Plain nodes only: lose the bridge for 30 s → hop through the channels,
// a second each, until a bridge heartbeat shows up. None anywhere → back
// where we were (the bridge is simply off), try again in 2 min.
static void follow_bridge(uint32_t now) {
  if (s_role & PM_NODE_ROLE_BRIDGE) return;
  bool fresh = s_fresh && !s_last_bridge_ms && s_fresh_passes < FRESH_PASSES;
  if (s_scan_ch) {
    if ((uint32_t)(now - s_scan_step_ms) < (fresh ? FRESH_DWELL_MS : SCAN_DWELL_MS)) return;
    s_scan_step_ms = now;
    if (s_scan_ch >= 13) {  // nothing on any channel
      s_scan_ch = 0;
      pm_mesh_set_channel(s_scan_home);
      return;
    }
    s_scan_ch++;
    pm_mesh_set_channel(s_scan_ch);
    return;
  }
  uint32_t since = now - (s_last_bridge_ms ? s_last_bridge_ms : 0);
  if (fresh) {
    if (since < FRESH_START_MS) return;
    if (s_last_scan_ms && (uint32_t)(now - s_last_scan_ms) < 13 * FRESH_DWELL_MS + FRESH_REST_MS) return;
    s_fresh_passes++;
  } else {
    // Listening in windows: allow the sync tolerance before calling the bridge gone.
    if (since < (s_stale_ms > BRIDGE_LOST_MS ? s_stale_ms : BRIDGE_LOST_MS)) return;
    if (s_last_scan_ms && (uint32_t)(now - s_last_scan_ms) < SCAN_RETRY_MS) return;
  }
  s_last_scan_ms = now ? now : 1;
  s_scan_home = pm_mesh_channel();
  s_scan_ch = 1;
  s_scan_step_ms = now;
  pm_mesh_set_channel(1);
}

uint8_t pm_role() { return s_role; }

void pm_set_role(uint8_t role) {
  bool was = s_role & PM_NODE_ROLE_CONDUCTOR;
  s_role = role;
  if ((role & PM_NODE_ROLE_CONDUCTOR) && !was)
    s_clock.become_conductor(s_node_id, priority(), millis());
  else if (!(role & PM_NODE_ROLE_CONDUCTOR) && was)
    s_clock.resign();  // follow the next beacon instead of our own clock
}

bool pm_send(pm_msg_type_t type, const void *payload, uint8_t len,
             uint8_t ttl) {
  if (len > PM_MAX_PAYLOAD) return false;
  uint8_t buf[sizeof(pm_frame_header_t) + PM_MAX_PAYLOAD];
  pm_frame_header_t hdr = {};
  hdr.magic = PM_MAGIC;
  hdr.proto_version = PM_PROTO_VERSION;
  hdr.net_id = s_net_id;
  hdr.src_id = s_node_id;
  hdr.seq = ++s_seq;
  hdr.boot_id = s_boot_id;
  hdr.ttl = ttl;
  hdr.msg_type = (uint8_t)type;
  hdr.auth_tag = 0;  // TODO(proto v1): truncated AES-CMAC
  memcpy(buf, &hdr, sizeof(hdr));
  if (len) memcpy(buf + sizeof(hdr), payload, len);
  s_stats.tx++;
  return txq_push(buf, sizeof(hdr) + len);
}

uint32_t pm_mesh_unheard_ms() {
  uint32_t now = millis();
  if (!s_judge_ms || now - s_judge_ms > 20000) return 0;  // nobody to judge by lately
  uint32_t since = s_echo_ms > s_judge_since_ms ? s_echo_ms : s_judge_since_ms;
  return (int32_t)(now - since) > 0 ? now - since : 0;
}
void pm_mesh_unheard_reset() { s_echo_ms = 0; s_judge_ms = 0; s_judge_since_ms = 0; }

void pm_on_receive(pm_rx_handler_t handler) { s_handler = handler; }

void pm_mesh_loop() {
  uint32_t now = millis();

  for (int i = 0; i < RELAY_QUEUE; i++) {
    if (!s_relay[i].used || (int32_t)(now - s_relay[i].due_ms) < 0) continue;
    txq_push(s_relay[i].frame, s_relay[i].len);  // a time beacon is re-stamped as it leaves (tx_pump)
    s_relay[i].used = false;
    s_stats.relayed++;
  }

  if ((uint32_t)(now - s_last_age_ms) >= 1000) {
    s_last_age_ms = now;
    s_neighbors.age(now);
  }
  follow_bridge(now);

  // Beacon oftener while a board listens in windows: it hears one beacon
  // in (interval / window), so a 1 s cadence keeps a 100/1000 leaf synced.
  uint16_t leaf = pm_mesh_leaf_listen_ms();
  uint32_t beacon_ms = leaf && leaf < PM_HEARTBEAT_PERIOD_MS ? leaf : PM_HEARTBEAT_PERIOD_MS;
  if (s_clock.is_conductor() &&
      (uint32_t)(now - s_last_beacon_ms) >= beacon_ms) {
    s_last_beacon_ms = now;
    pm_time_t t = {};
    t.mesh_time_us = (uint64_t)esp_timer_get_time();
    t.hop = 0;
    t.conductor_id = s_node_id;
    t.priority = priority();
    if (s_wall.utc_ok) { t.wall_ms = (uint64_t)s_wall.utc_ms(local_ms()); t.wall_flags |= 1; }
    if (s_wall.tz_ok) {
      t.wall_flags |= 2;
      t.tz_offset_min = s_wall.tz_min;
      t.tz_next_change_s = s_wall.tz_next_s;
      t.tz_next_offset_min = s_wall.tz_next_min;
    }
    t.mode_manual = s_stamps.mode_manual;
    t.mode_at = s_stamps.mode_at;
    t.mode_until = s_stamps.mode_until;
    t.sched_at = s_stamps.sched_at;
    t.show_at = s_stamps.show_at;
    t.floods_at = s_stamps.floods_at;
    pm_send(PM_MSG_TYPE_TIME, &t, sizeof(t));
  }
}

int64_t pm_mesh_time_us() { return s_clock.mesh_us(esp_timer_get_time()); }
int64_t pm_local_time_us(int64_t mesh_time_us) {
  return s_clock.local_us(mesh_time_us);
}
bool pm_time_synced() { return s_clock.synced(millis(), s_stale_ms); }
uint32_t pm_conductor_id() { return s_clock.conductor(); }
uint8_t pm_sync_hop() { return s_clock.hop(); }
PmWallClock &pm_wall() { return s_wall; }
int64_t pm_wall_utc_ms() { return s_wall.utc_ms(local_ms()); }

uint8_t pm_neighbor_snapshot(pm_neighbor_t *out, uint8_t max) {
  return s_neighbors.snapshot(out, max, millis());
}

const pm_stats_t *pm_stats() { return &s_stats; }

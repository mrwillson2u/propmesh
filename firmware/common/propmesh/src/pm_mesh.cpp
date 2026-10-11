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
#define BRIDGE_LOST_MS 30000
#define SCAN_RETRY_MS 120000
#define SCAN_DWELL_MS 1000

// Relay queue: frames waiting out their jitter before rebroadcast.
// Small and fixed — under cue/heartbeat load this rarely holds >2 frames.
#define RELAY_QUEUE 6  // was 8; static RAM is full (2026-10-07) and it rarely holds >2
static struct {
  bool used;
  uint32_t due_ms;
  uint8_t len;
  uint8_t frame[sizeof(pm_frame_header_t) + PM_MAX_PAYLOAD];
} s_relay[RELAY_QUEUE];

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

  // A bridge heartbeat: this is where the mesh lives. It says which channel
  // the bridge is on; go there. Hearing it is not enough — neighboring
  // channels overlap, so at bench range a node on 10 heard a bridge on 11,
  // never scanned, and stayed put (2026-10-08). In the yard it would not.
  if (hdr.msg_type == PM_MSG_TYPE_HEARTBEAT && plen >= 8 && (payload[7] & PM_NODE_ROLE_BRIDGE) &&
      !(s_role & PM_NODE_ROLE_BRIDGE)) {
    s_last_bridge_ms = now_ms ? now_ms : 1;
    uint8_t ch = plen >= sizeof(pm_heartbeat_t) ? payload[sizeof(pm_heartbeat_t) - 1] : 0;
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
      if (t.wall_flags & 1) s_wall.set_utc((int64_t)t.wall_ms, local_ms());
      if (t.wall_flags & 2) s_wall.set_tz(t.tz_offset_min, t.tz_next_change_s, t.tz_next_offset_min);
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

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();  // no AP association yet (a bridge joins WiFi later — pm_wifi)
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
  s_channel = channel;

  if (esp_now_init() != ESP_OK) return false;

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BCAST, 6);
  peer.channel = 0;  // "whatever channel the radio is on" — it follows the bridge / the router
  peer.ifidx = WIFI_IF_STA;
  if (esp_now_add_peer(&peer) != ESP_OK) return false;

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
uint16_t pm_mesh_bridge_age_s() {
  return s_last_bridge_ms ? (uint16_t)((millis() - s_last_bridge_ms) / 1000) : 0xFFFF;
}
bool pm_mesh_scanning() { return s_scan_ch != 0; }

// Plain nodes only: lose the bridge for 30 s → hop through the channels,
// a second each, until a bridge heartbeat shows up. None anywhere → back
// where we were (the bridge is simply off), try again in 2 min.
static void follow_bridge(uint32_t now) {
  if (s_role & PM_NODE_ROLE_BRIDGE) return;
  if (s_scan_ch) {
    if ((uint32_t)(now - s_scan_step_ms) < SCAN_DWELL_MS) return;
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
  if (since < BRIDGE_LOST_MS) return;
  if (s_last_scan_ms && (uint32_t)(now - s_last_scan_ms) < SCAN_RETRY_MS) return;
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
  return esp_now_send(BCAST, buf, sizeof(hdr) + len) == ESP_OK;
}

void pm_on_receive(pm_rx_handler_t handler) { s_handler = handler; }

void pm_mesh_loop() {
  uint32_t now = millis();

  for (int i = 0; i < RELAY_QUEUE; i++) {
    if (!s_relay[i].used || (int32_t)(now - s_relay[i].due_ms) < 0) continue;
    // Re-stamp a time beacon at the moment it actually goes out, so the
    // jitter it just sat through does not become downstream clock error.
    pm_frame_header_t *h = (pm_frame_header_t *)s_relay[i].frame;
    if (h->msg_type == PM_MSG_TYPE_TIME && s_clock.synced(now) &&
        s_relay[i].len >= sizeof(pm_frame_header_t) + TIME_V1_LEN) {
      pm_time_t *t =
          (pm_time_t *)(s_relay[i].frame + sizeof(pm_frame_header_t));
      t->mesh_time_us = (uint64_t)s_clock.mesh_us(esp_timer_get_time());
      if (s_relay[i].len >= sizeof(pm_frame_header_t) + sizeof(pm_time_t) &&
          (t->wall_flags & 1) && s_wall.utc_ok)
        t->wall_ms = (uint64_t)s_wall.utc_ms(local_ms());
    }
    esp_now_send(BCAST, s_relay[i].frame, s_relay[i].len);
    s_relay[i].used = false;
    s_stats.relayed++;
  }

  if ((uint32_t)(now - s_last_age_ms) >= 1000) {
    s_last_age_ms = now;
    s_neighbors.age(now);
  }
  follow_bridge(now);

  if (s_clock.is_conductor() &&
      (uint32_t)(now - s_last_beacon_ms) >= PM_HEARTBEAT_PERIOD_MS) {
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
    pm_send(PM_MSG_TYPE_TIME, &t, sizeof(t));
  }
}

int64_t pm_mesh_time_us() { return s_clock.mesh_us(esp_timer_get_time()); }
int64_t pm_local_time_us(int64_t mesh_time_us) {
  return s_clock.local_us(mesh_time_us);
}
bool pm_time_synced() { return s_clock.synced(millis()); }
uint32_t pm_conductor_id() { return s_clock.conductor(); }
uint8_t pm_sync_hop() { return s_clock.hop(); }
PmWallClock &pm_wall() { return s_wall; }
int64_t pm_wall_utc_ms() { return s_wall.utc_ms(local_ms()); }

uint8_t pm_neighbor_snapshot(pm_neighbor_t *out, uint8_t max) {
  return s_neighbors.snapshot(out, max, millis());
}

const pm_stats_t *pm_stats() { return &s_stats; }

const char *pm_reset_reason();  // main.cpp
#include "pm_sleep.h"
#include "pm_wifi.h"
#include "pm_ota.h"
#include <Arduino.h>
#include <LittleFS.h>
#include "pm_api.h"
#include "pm_mesh.h"
#include "pm_pinrules.h"
#include "pm_config_json.h"
#include "pm_config_store.h"
#include "pm_channels.h"
#include "pm_show.h"
#include "pm_ble_tx.h"
#include "pm_ws.h"
#include "pm_radio.h"
#include <esp_timer.h>
#include <esp_heap_caps.h>
#include "pm_lastwords.h"
#include "pm_sync.h"
#include "pm_copies.h"

static const pm_board_t *board;

void pm_api_begin(const pm_board_t &b) { board = &b; }

// One heap-allocated config for handlers to parse into: PmNodeConfig is
// ~800 bytes, the loop task's stack is small, and static RAM is full.
static PmNodeConfig &scratch() {
  static PmNodeConfig *c;
  if (!c) c = new PmNodeConfig();
  return *c;
}

bool pm_node_apply(const PmNodeConfig &cfg) {
  pm_wifi_apply(cfg);  // a bridge joins (or leaves) its WiFi
  pm_sleep_apply(cfg); // battery: sleep tiers (docs §6f)
  uint8_t role = pm_role();
  bool was_bridge = role & PM_NODE_ROLE_BRIDGE;
  if (cfg.bridge) {
    role |= PM_NODE_ROLE_RELAY | PM_NODE_ROLE_BRIDGE | PM_NODE_ROLE_CONDUCTOR;
  } else if (cfg.battery) {
    // A battery board never keeps the clock and is never the bridge. It is
    // a leaf (never relays) unless it is a battery repeater (docs §6m),
    // which relays while awake — the show tier keeps it awake.
    role = role & ~(PM_NODE_ROLE_RELAY | PM_NODE_ROLE_BRIDGE | PM_NODE_ROLE_CONDUCTOR);
    if (cfg.sleep_relay) role |= PM_NODE_ROLE_RELAY;
  } else {
    role = (role | PM_NODE_ROLE_RELAY) & ~PM_NODE_ROLE_BRIDGE;
    // An elected (non-bridge) conductor keeps the clock; a former
    // bridge hands it back to the mesh.
    if (was_bridge) role &= ~PM_NODE_ROLE_CONDUCTOR;
  }
  // Re-assert BRIDGE before CONDUCTOR so the clock starts at bridge rank.
  if (cfg.bridge && !was_bridge) pm_set_role(role & ~PM_NODE_ROLE_CONDUCTOR);
  pm_set_role(role);
  return pm_channels_apply(cfg);
}

static void fail(JsonObject resp, const char *why) {
  resp["ok"] = false;
  resp["error"] = why;
}

static void put_issues(const PmIssues &issues, JsonObject resp) {
  JsonArray arr = resp["issues"].to<JsonArray>();
  for (uint8_t i = 0; i < issues.count; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["code"] = issues.items[i].code;
    o["error"] = issues.items[i].error;
    o["channel"] = issues.items[i].channel;
    if (issues.items[i].gpio != 0xFF) o["gpio"] = issues.items[i].gpio;
  }
}

static void cmd_hello(JsonObject resp) {
  char id[9];
  snprintf(id, sizeof(id), "%08lx", (unsigned long)pm_node_id());
  resp["node"] = id;
  resp["fw"] = PM_FW_VERSION;
  resp["build"] = PM_BUILD;
  resp["built"] = (uint32_t)PM_BUILT;  // UTC seconds the image was built: orders builds, which commit names can't
  resp["reset"] = pm_reset_reason();
  resp["up_s"] = millis() / 1000;
  if (pm_lastwords_any()) pm_lastwords_to_json(resp["last"].to<JsonObject>());
  pm_sync_status(resp["sync"].to<JsonObject>());  // which edits of the mesh-wide documents it holds (docs §6k)
  resp["board"] = board->id;
  if (pm_channels_config().battery) {
    resp["power"] = "battery";
    resp["checkin_ms"] = pm_channels_config().sleep_checkin_ms;
    if (pm_channels_config().sleep_relay) resp["relay"] = true;  // a battery repeater (docs §6m)
    int32_t ppm;
    if (pm_sleep_drift_ppm(&ppm)) resp["drift_ppm"] = ppm;  // its sleep clock's error, corrected for
    if (pm_sleep_last_awake_ms()) resp["awake_ms"] = pm_sleep_last_awake_ms();  // how long its last wake lasted
    float rate, span;
    if (pm_sleep_battery_rate(&rate, &span)) { resp["batt_mv_per_h"] = rate; resp["batt_span_h"] = span; }  // its own drain measurement (§8)
    resp["awake"] = pm_sleep_holding();  // held awake (console / sensor); else it sleeps when the show is off
    if (pm_sleep_hold_left_ms()) resp["hold_s"] = pm_sleep_hold_left_ms() / 1000;  // the setup window or a console hold, seconds left
    resp["sleeps"] = pm_sleep_supported();  // false: a mains-board build (DevKit) — leaf only, never sleeps
  }
  if (pm_mesh_is_low_power()) resp["radio_low"] = true;  // radio at 13 dBm while a new image is on probation
  resp["ble"] = pm_ble_available();  // false: built without Bluetooth — can't drive floods
  resp["name"] = pm_channels_config().name;
  resp["bridge"] = pm_channels_config().bridge;
  resp["fs_used"] = (uint32_t)LittleFS.usedBytes();   // the flash area copies and show files share
  resp["fs_total"] = (uint32_t)LittleFS.totalBytes();
  if (pm_copies_active()) resp["copies"] = 1;  // keeps every board's settings for the console (pm_copies)
  resp["role"] = pm_role();
  resp["armed"] = pm_show_armed();
  pm_show_put_mode(resp);  // mode, why, next change: the console polls hello for it
}

static void cmd_set_config(JsonObjectConst req, JsonObject resp) {
  // Static: PmNodeConfig is ~700 bytes and the loop task stack is small.
  PmNodeConfig &cfg = scratch();
  const char *err = pm_config_from_json(req["config"], cfg);
  if (err) return fail(resp, err);
  // From the bridge's copy of these settings (pm_copies), which never
  // holds the floods key: keep this board's own key and lights, which the
  // Floods tab owns. Older boards ignore the flag, so the bridge only sets
  // it for boards that report a settings stamp (firmware 2026-10-28 on).
  if (req["keep_floods"] | false) {
    const PmNodeConfig &now = pm_channels_config();
    uint8_t n = 0;
    for (uint8_t i = 0; i < cfg.channel_count; i++)
      if (cfg.channels[i].kind != PM_CHANNEL_KIND_BLE_LIGHT) cfg.channels[n++] = cfg.channels[i];
    for (uint8_t i = 0; i < now.channel_count; i++) {
      if (now.channels[i].kind != PM_CHANNEL_KIND_BLE_LIGHT) continue;
      if (n >= PM_MAX_CHANNELS) return fail(resp, "too many channels with this board's flood lights");
      cfg.channels[n++] = now.channels[i];
    }
    cfg.channel_count = n;
    cfg.has_brmesh_key = now.has_brmesh_key;
    memcpy(cfg.brmesh_key, now.brmesh_key, sizeof(cfg.brmesh_key));
  }
  // The console never sees the WiFi password: no "pass" means keep ours.
  if (cfg.wifi_ssid[0] && !cfg.wifi_pass[0] && !strcmp(cfg.wifi_ssid, pm_channels_config().wifi_ssid))
    pm_copy(cfg.wifi_pass, pm_channels_config().wifi_pass, sizeof(cfg.wifi_pass));
  PmIssues issues = pm_validate(*board, cfg);
  put_issues(issues, resp);
  if (issues.errors) return fail(resp, "invalid config");
  if (!pm_store_save(cfg)) return fail(resp, "could not save to flash");
  if (!pm_node_apply(cfg)) return fail(resp, "saved, but a pin failed to start");
  pm_sync_config_saved(req);
}

static void cmd_set(JsonObjectConst req, JsonObject resp) {
  const pm_function_t *f = pm_function_by_name(req["kind"] | "");
  if (!f) return fail(resp, "unknown channel kind");
  // Servo calibration: {"us": 1500} drives the raw pulse width.
  if (f->kind == PM_CHANNEL_KIND_SERVO && req["us"].is<int32_t>()) {
    if (!pm_servo_set_pulse(req["index"] | 0, req["us"].as<int32_t>()))
      return fail(resp, "no such servo");
    return;
  }
  if (!req["value"].is<int32_t>()) return fail(resp, "value missing");
  if (!pm_channel_set(f->kind, req["index"] | 0, req["value"].as<int32_t>()))
    return fail(resp, "no such output channel");
  // Remembered so it comes back with the show — unless it's the sequence
  // editor posing a step ("preview"), which isn't how the yard should be.
  if (!(req["preview"] | false)) pm_show_hand_set(f->kind, req["index"] | 0, req["value"].as<int32_t>());
}

static void cmd_state(JsonObject resp) {
  const PmNodeConfig &cfg = pm_channels_config();
  JsonArray arr = resp["channels"].to<JsonArray>();
  for (uint8_t i = 0; i < cfg.channel_count; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["kind"] = pm_function(cfg.channels[i].kind)->name;
    o["index"] = cfg.channels[i].index;
    o["value"] = pm_channel_get(cfg.channels[i].kind, cfg.channels[i].index);
  }
}

static void heap_report(JsonObject resp);
static void cmd_mesh(JsonObject resp) {
  resp["synced"] = pm_time_synced();
  resp["role"] = pm_role();
  resp["channel"] = pm_mesh_channel();
  if (pm_mesh_scanning()) resp["scanning"] = true;
  if (pm_mesh_bridge_age_s() != 0xFFFF) resp["bridge_age_s"] = pm_mesh_bridge_age_s();
  if (pm_wifi_configured()) {
    resp["wifi"] = pm_wifi_connected() ? "up" : "joining";
    resp["wifi_ssid"] = pm_wifi_ssid();
    if (pm_wifi_connected()) { resp["ip"] = pm_wifi_ip(); resp["wifi_rssi"] = pm_wifi_rssi(); }
    else if (*pm_wifi_reason()) resp["wifi_reason"] = pm_wifi_reason();
  } else resp["wifi"] = "off";
  if (pm_time_synced()) {
    char id[9];
    snprintf(id, sizeof(id), "%08lx", (unsigned long)pm_conductor_id());
    resp["conductor"] = id;
    resp["hop"] = pm_sync_hop();
  }
  const pm_stats_t *st = pm_stats();
  resp["tx"] = st->tx;
  resp["tx_err"] = st->tx_err;
  if (st->last_tx_err) resp["last_tx_err"] = esp_err_to_name(st->last_tx_err);
  resp["tx_sent"] = st->tx_sent;          // accepted by the radio (ours + relays)
  resp["tx_done"] = st->tx_done;          // completions reported back
  resp["tx_failed"] = st->tx_failed;      // completions that got no air time
  resp["tx_inflight"] = pm_mesh_tx_inflight();  // accepted, never completed: the leak (docs §6j)
  resp["tx_lost"] = st->tx_lost;                // dispatched, no completion within 60 ms
  resp["tx_queue_full"] = st->tx_queue_full;    // frames refused: the send queue was full
  resp["tx_queue_max"] = st->tx_queue_max;      // deepest the send queue has been
  resp["radio_rebuilds"] = pm_radio_rebuilds();
  if (pm_radio_last_rebuild_ms()) resp["radio_rebuilt_s_ago"] = (millis() - pm_radio_last_rebuild_ms()) / 1000;
  if (pm_mesh_tx_stuck_ms()) resp["tx_stuck_s"] = pm_mesh_tx_stuck_ms() / 1000;
  // Heap, because the driver's TX buffers come from it: free now, the
  // largest piece (fragmentation), and the low-water mark since boot.
  resp["heap"] = ESP.getFreeHeap();
  resp["heap_max_block"] = ESP.getMaxAllocHeap();
  resp["heap_min"] = ESP.getMinFreeHeap();
  heap_report(resp);
  if (pm_mesh_unheard_ms()) resp["unheard_s"] = pm_mesh_unheard_ms() / 1000;  // neighbors heard, none hear us
  pm_neighbor_t nb[PM_MAX_NEIGHBORS];
  uint8_t n = pm_neighbor_snapshot(nb, PM_MAX_NEIGHBORS);
  JsonArray arr = resp["neighbors"].to<JsonArray>();
  for (uint8_t i = 0; i < n; i++) {
    char id[9];
    snprintf(id, sizeof(id), "%08lx", (unsigned long)nb[i].node_id);
    JsonObject o = arr.add<JsonObject>();
    o["node"] = id;
    o["rssi"] = nb[i].rssi;
  }
}

// --- BRMesh lights: find + pair -----------------------------------------------

static void hex_addr(char out[18], const uint8_t a[6]) {
  // HCI gives the address little-endian; show it the usual way round.
  snprintf(out, 18, "%02x:%02x:%02x:%02x:%02x:%02x", a[5], a[4], a[3], a[2], a[1], a[0]);
}
// A light's mac as it advertises it (in order) — lights share one placeholder
// Bluetooth address, so this is what the console addresses a light by.
static void hex_mac(char out[18], const uint8_t m[6]) {
  snprintf(out, 18, "%02x:%02x:%02x:%02x:%02x:%02x", m[0], m[1], m[2], m[3], m[4], m[5]);
}

// A confirmed pairing becomes a BLE_LIGHT output on this board straight
// away, so nothing is lost if the console goes away mid-pairing.
static void on_paired(uint8_t number, const char *type) {
  PmNodeConfig &cfg = scratch();
  cfg = pm_channels_config();
  for (uint8_t i = 0; i < cfg.channel_count; i++)
    if (cfg.channels[i].kind == PM_CHANNEL_KIND_BLE_LIGHT && cfg.channels[i].light_id == number) return;
  if (cfg.channel_count >= PM_MAX_CHANNELS) return;
  uint8_t index = 1;
  for (bool clash = true; clash; ) {
    clash = false;
    for (uint8_t i = 0; i < cfg.channel_count; i++)
      if (cfg.channels[i].kind == PM_CHANNEL_KIND_BLE_LIGHT && cfg.channels[i].index == index) { clash = true; index++; }
  }
  PmChannelCfg &c = cfg.channels[cfg.channel_count++];
  c = PmChannelCfg();
  c.kind = PM_CHANNEL_KIND_BLE_LIGHT;
  c.index = index;
  c.light_id = number;
  snprintf(c.label, sizeof(c.label), "flood %u (%s)", number, type);
  if (pm_validate(*board, cfg).errors) return;
  if (pm_store_save(cfg)) { pm_node_apply(cfg); pm_sync_config_changed(0); }
  Serial.printf("ble: paired light %u (%s) as BLE_LIGHT_%u\n", number, type, index);
}

static void cmd_ble_scan(JsonObjectConst req, JsonObject resp) {
  if (pm_channels_config().bridge) return fail(resp, "the bridge drives no outputs — find lights from the board nearest the floods");
  pm_ble_on_paired(on_paired);
  if (req["window_ms"].is<int>()) pm_ble_scan_duty(req["window_ms"] | 20, req["interval_ms"] | 100);
  if (!pm_ble_scan(req["ms"] | 6000)) return fail(resp, "Bluetooth didn't start");
}

static void hex_bytes(char *out, const uint8_t *d, uint8_t n) {
  for (uint8_t i = 0; i < n; i++) sprintf(out + 2 * i, "%02x", d[i]);
  out[2 * n] = 0;
}

static void cmd_ble_found(JsonObject resp) {
  static const char *const MODE[] = {"idle", "scanning", "pairing"};
  static const char *const STATE[] = {"found", "pairing", "paired", "failed", "other"};
  resp["mode"] = MODE[pm_ble_mode() % 3];
  resp["remaining_ms"] = pm_ble_remaining_ms();
  resp["key_set"] = pm_channels_config().has_brmesh_key;
  const PmBleLight *list;
  uint8_t n = pm_ble_found(&list);
  JsonArray arr = resp["lights"].to<JsonArray>();
  for (uint8_t i = 0; i < n; i++) {
    char a[18], k[9], raw[37];
    hex_mac(a, list[i].seen.mac);
    hex_bytes(k, list[i].seen.key, 4);
    hex_bytes(raw, list[i].raw, 18);
    JsonObject o = arr.add<JsonObject>();
    o["addr"] = a;
    o["type"] = pm_brmesh_type_name(list[i].seen);
    o["rssi"] = list[i].rssi;
    o["state"] = STATE[list[i].state % 5];
    o["key"] = k;      // what the light holds (the default key while unpaired)
    o["raw"] = raw;    // its manufacturer data, for working out new light types
    if (list[i].number) o["number"] = list[i].number;
    else if (list[i].state == PM_BLE_OTHER) o["number"] = pm_brmesh_number(list[i].raw, list[i].seen.key);
    if (list[i].state == PM_BLE_PAIRED) o["acked"] = list[i].acked;
  }
  // Everything else heard that wasn't a phone — a light in a format we
  // don't know yet would be here.
  const PmBleRaw *others;
  uint8_t m = pm_ble_others(&others);
  JsonArray oarr = resp["others"].to<JsonArray>();
  for (uint8_t i = 0; i < m; i++) {
    char a[18], hex[63];
    hex_addr(a, others[i].addr);
    hex_bytes(hex, others[i].ad, others[i].len);
    JsonObject o = oarr.add<JsonObject>();
    o["addr"] = a;
    o["rssi"] = others[i].rssi;
    o["adv"] = hex;
  }
}

static void cmd_ble_pair(JsonObjectConst req, JsonObject resp) {
  if (pm_channels_config().bridge) return fail(resp, "the bridge drives no outputs");
  unsigned a[6];
  if (sscanf(req["addr"] | "", "%x:%x:%x:%x:%x:%x", &a[0], &a[1], &a[2], &a[3], &a[4], &a[5]) != 6)
    return fail(resp, "addr must look like aa:bb:cc:dd:ee:ff");
  uint8_t addr[6];
  for (int i = 0; i < 6; i++) addr[i] = (uint8_t)a[i];

  PmNodeConfig &cfg = scratch();
  cfg = pm_channels_config();
  // The board's network key: made once, saved BEFORE any light is given
  // it — a pairing whose key was then lost would orphan the light.
  if (!cfg.has_brmesh_key) {
    uint32_t r;
    do r = esp_random(); while (!r);
    memcpy(cfg.brmesh_key, &r, 4);
    cfg.has_brmesh_key = true;
    if (!pm_store_save(cfg)) return fail(resp, "could not save the new key to flash");
    pm_node_apply(cfg);
    pm_sync_config_changed(0);
  }
  pm_ble_set_key(cfg.brmesh_key);

  // Lowest light number not used on this board, unless one was asked for.
  uint8_t number = req["number"] | 0;
  if (!number) {
    number = 1;
    for (bool used = true; used; ) {
      used = false;
      for (uint8_t i = 0; i < cfg.channel_count; i++)
        if (cfg.channels[i].kind == PM_CHANNEL_KIND_BLE_LIGHT && cfg.channels[i].light_id == number) { used = true; number++; }
    }
  }
  pm_ble_on_paired(on_paired);
  if (!pm_ble_pair(addr, number, req["ms"] | 1500)) return fail(resp, "light not found — scan again with it powered on");
  resp["number"] = number;
}

// Heap forensics (docs §6j): the main loop samples free heap; `mesh`
// reports the lowest value since it was last asked, and the last 16
// commands handled with the heap before and after each — the way to see
// which request, if any, is eating the bridge.
#define HEAP_RING 16
struct HeapMark { uint32_t up_s; uint32_t before, after; char cmd[12]; };
static HeapMark *s_ring;           // heap-allocated in pm_api_begin (static RAM is full)
static uint8_t s_ring_n;           // next slot
static uint32_t s_heap_win_min = 0xFFFFFFFF, s_heap_win_at;
static uint8_t s_heap_win_step;    // which loop step had just run when the window's minimum was seen
// Sudden drops: free heap falling 6 KB+ between two consecutive samples,
// with the loop step that had just run (the step's own allocation, or
// another task's that landed during it). Last 8.
#define DROP_RING 8
struct HeapDrop { uint32_t up_ms; uint32_t from, to; uint8_t step; };
static HeapDrop s_drops[DROP_RING];
static uint8_t s_drop_n;
static uint32_t s_heap_prev;
// Failed allocations (heap_caps hook): the exact moment "no memory"
// becomes real, with the size asked for and the function that asked.
struct AllocFail { uint32_t up_ms; uint32_t size; uint32_t caps; char fn[24]; char task[16]; };
#define FAIL_RING 6
static AllocFail s_fails[FAIL_RING];
static uint8_t s_fail_n;
static volatile uint32_t s_fail_count;
static void on_alloc_failed(size_t size, uint32_t caps, const char *fn) {
  s_fail_count++;
  AllocFail &a = s_fails[s_fail_n];
  s_fail_n = (s_fail_n + 1) % FAIL_RING;
  a.up_ms = millis(); a.size = size; a.caps = caps;
  strlcpy(a.fn, fn ? fn : "?", sizeof(a.fn));
  const char *t = pcTaskGetName(nullptr);  // whose allocation it was: wifi, tcpip_thread, loopTask, mdns...
  strlcpy(a.task, t ? t : "?", sizeof(a.task));
}
void pm_api_heap_tick(uint8_t step) {
  uint32_t f = ESP.getFreeHeap();
  if (f < s_heap_win_min) { s_heap_win_min = f; s_heap_win_at = millis() / 1000; s_heap_win_step = step; }
  if (s_heap_prev && s_heap_prev > f + 6144) {
    HeapDrop &d = s_drops[s_drop_n];
    s_drop_n = (s_drop_n + 1) % DROP_RING;
    d.up_ms = millis(); d.from = s_heap_prev; d.to = f; d.step = step;
  }
  s_heap_prev = f;
}
uint32_t pm_api_alloc_failures() { return s_fail_count; }
static void heap_report(JsonObject resp) {
  resp["heap_win_min"] = s_heap_win_min == 0xFFFFFFFF ? 0 : s_heap_win_min;  // lowest loop sample since the last `mesh`
  resp["heap_win_at_s"] = s_heap_win_at;
  resp["heap_win_step"] = s_heap_win_step;  // main.cpp loop step numbers
  s_heap_win_min = 0xFFFFFFFF;
  resp["alloc_fails"] = s_fail_count;
  JsonArray fa = resp["alloc_fail_ring"].to<JsonArray>();
  for (uint8_t i = 0; i < FAIL_RING; i++) {
    const AllocFail &a = s_fails[(s_fail_n + i) % FAIL_RING];
    if (!a.up_ms) continue;
    JsonArray e = fa.add<JsonArray>(); e.add(a.up_ms / 1000); e.add(a.size); e.add(a.fn); e.add(a.task); e.add(a.caps);
  }
  JsonArray dr = resp["heap_drops"].to<JsonArray>();
  for (uint8_t i = 0; i < DROP_RING; i++) {
    const HeapDrop &d = s_drops[(s_drop_n + i) % DROP_RING];
    if (!d.up_ms) continue;
    JsonArray e = dr.add<JsonArray>(); e.add(d.up_ms); e.add(d.from); e.add(d.to); e.add(d.step);
  }
  resp["ws_clients"] = pm_ws_clients();
  if (!s_ring) return;
  JsonArray a = resp["heap_ring"].to<JsonArray>();
  for (uint8_t i = 0; i < HEAP_RING; i++) {
    const HeapMark &m = s_ring[(s_ring_n + i) % HEAP_RING];
    if (!m.cmd[0]) continue;
    JsonArray e = a.add<JsonArray>();
    e.add(m.up_s); e.add(m.cmd); e.add(m.before); e.add(m.after);
  }
}

static void api_handle_inner(JsonObjectConst req, JsonObject resp);
void pm_api_handle(JsonObjectConst req, JsonObject resp) {
  if (!s_ring) {
    s_ring = (HeapMark *)calloc(HEAP_RING, sizeof(HeapMark));
    heap_caps_register_failed_alloc_callback(on_alloc_failed);
  }
  uint32_t heap_before = ESP.getFreeHeap();
  api_handle_inner(req, resp);
  if (s_ring) {
    HeapMark &m = s_ring[s_ring_n];
    s_ring_n = (s_ring_n + 1) % HEAP_RING;
    m.up_s = millis() / 1000; m.before = heap_before; m.after = ESP.getFreeHeap();
    strlcpy(m.cmd, req["cmd"] | "?", sizeof(m.cmd));
  }
}

static void api_handle_inner(JsonObjectConst req, JsonObject resp) {
  if (!req["id"].isNull()) resp["id"] = req["id"];
  resp["ok"] = true;
  const char *cmd = req["cmd"] | "";
  // Someone is working on this board: stay awake for them (docs §6f) —
  // but not for the console's background polling (hello, mesh, state,
  // ota_status), which would keep a battery board up for as long as a
  // console is open (2026-10-11).
  if (strcmp(cmd, "hello") && strcmp(cmd, "mesh") && strcmp(cmd, "state") && strcmp(cmd, "ota_status") && strcmp(cmd, "ble"))
    pm_sleep_hold(600000);
  if (!strcmp(cmd, "hold_awake")) { pm_sleep_hold((uint32_t)(req["min"] | 10) * 60000UL); resp["hold_s"] = pm_sleep_hold_left_ms() / 1000; return; }  // min 0 = release
  // The console's Power off: outputs off, then off until reset or a power
  // cycle (pm_sleep.h). The console then shows the board as off, not asleep.
  if (!strcmp(cmd, "power_off")) {
    if (!pm_sleep_power_off()) { fail(resp, "this board's build can't switch itself off — unplug it"); return; }
    pm_lastwords_note("power off", req["why"] | "asked over the API");
    resp["off"] = true;
    return;
  }
  // A restart on request: the one cure for a fragmented heap (docs §6j), and
  // the bridge had none when it needed it (2026-10-23). The reply leaves
  // first; pm_lastwords says it was asked for.
  if (!strcmp(cmd, "reboot")) {
    pm_lastwords_note("reboot", req["why"] | "asked over the API");
    resp["rebooting"] = true;
    pm_sleep_hold(0);
    static esp_timer_handle_t t;
    const esp_timer_create_args_t a = { .callback = [](void *) { esp_restart(); }, .arg = nullptr, .dispatch_method = ESP_TIMER_TASK, .name = "pm_reboot", .skip_unhandled_events = false };
    if (!t) esp_timer_create(&a, &t);
    esp_timer_start_once(t, 700000);  // 0.7 s: the reply gets out
    return;
  }
  if (!strcmp(cmd, "hello")) cmd_hello(resp);
  // The Yard's map (console lib/yardMap.ts): a drawing of the yard and
  // where every board sits, kept on the board the console connects to so
  // a phone and a laptop share it. Opaque to the firmware; newest wins.
  else if (!strcmp(cmd, "get_yard")) {
    File f = LittleFS.open("/yard.json", "r");
    if (f) {
      JsonDocument d;
      if (!deserializeJson(d, f)) resp["yard"] = d;
      f.close();
    }
  }
  else if (!strcmp(cmd, "set_yard")) {
    JsonObjectConst y = req["yard"];
    if (y.isNull() || (y["v"] | 0) != 1) return fail(resp, "yard must be an object with v: 1");
    uint32_t at = req["at"] | 0UL;
    File cur = LittleFS.open("/yard.json", "r");
    if (cur) {
      JsonDocument have;
      JsonDocument filter;
      filter["at"] = true;
      uint32_t have_at = deserializeJson(have, cur, DeserializationOption::Filter(filter)) ? 0 : (have["at"] | 0UL);
      cur.close();
      if (at && have_at && at < have_at) { resp["stale"] = true; resp["have_at"] = have_at; return; }
    }
    File f = LittleFS.open("/yard.tmp", "w");
    if (!f) return fail(resp, "could not save to flash");
    bool ok = serializeJson(y, f) > 0;
    f.close();
    if (!ok) return fail(resp, "could not save to flash");
    LittleFS.remove("/yard.json");
    LittleFS.rename("/yard.tmp", "/yard.json");
  }
  else if (!strcmp(cmd, "get_config")) {
    pm_config_to_json(pm_channels_config(), resp["config"].to<JsonObject>());
    resp["at"] = pm_sync_cfg_at();  // the stamp the bridge's copy is checked against (pm_copies)
  }
  else if (!strcmp(cmd, "set_config")) cmd_set_config(req, resp);
  else if (!strcmp(cmd, "set")) cmd_set(req, resp);
  // {"cmd":"candle","index":1,"event":"gust"|"sputter"} — the console's test
  // buttons; "tune" with "chz" (Hz × 100, 0 = stop) and optional "ms" (kick
  // width) kicks steadily at that rate for the swing hunt (docs §6n);
  // "burst": true kicks in sets with rests instead.
  else if (!strcmp(cmd, "candle")) {
    const char *ev = req["event"] | "gust";
    bool ok = !strcmp(ev, "tune") ? pm_candle_tune(req["index"] | 0, (uint16_t)(req["chz"] | 0), (uint8_t)(req["ms"] | 0), req["burst"] | false)
                                  : pm_candle_event(req["index"] | 0, !strcmp(ev, "sputter"));
    if (!ok) fail(resp, "no such candle");
  }
  else if (!strcmp(cmd, "state")) cmd_state(resp);
  else if (!strcmp(cmd, "all_off")) {
    pm_show_stop();
    // STOP ALL sends this right after going off (its outputs are parked
    // already and come back); a plain All off by hand means "off, stay off".
    if (pm_show_mode() != 0) pm_show_hand_clear();
    pm_channels_all_off();
  }
  else if (!strcmp(cmd, "mesh")) {
    if (req["recover"] | false) resp["recovered"] = pm_radio_rebuild("asked over the API");  // docs §6j test hook
    cmd_mesh(resp);
  }
  else if (!strcmp(cmd, "ble_scan")) cmd_ble_scan(req, resp);
  else if (!strcmp(cmd, "ble_found")) cmd_ble_found(resp);
  else if (!strcmp(cmd, "ble_pair")) cmd_ble_pair(req, resp);
  else if (!strcmp(cmd, "ble_raw")) {
    uint8_t d[8] = {};
    JsonArrayConst a = req["data"].as<JsonArrayConst>();
    uint8_t i = 0;
    for (JsonVariantConst v : a) if (i < 8) d[i++] = v.as<int>();
    if (!pm_ble_start()) return fail(resp, "Bluetooth didn't start");
    pm_ble_raw(d, req["hi"] | 0);
  }
  else if (!strcmp(cmd, "mesh_channel")) {
    // Bench: force the channel (a bridge without WiFi) — nodes should follow.
    int ch = req["ch"] | 0;
    if (ch < 1 || ch > 13) return fail(resp, "ch must be 1-13");
    pm_mesh_set_channel((uint8_t)ch);
    pm_store_channel_save((uint8_t)ch);
    resp["channel"] = pm_mesh_channel();
  }
  else if (!strcmp(cmd, "ota")) {
    // Pull new firmware over WiFi (pm_ota.h). The reply goes out first;
    // the node leaves the mesh channel ~1.5 s later and returns on reboot.
    const char *url = req["url"] | "", *ssid = req["ssid"] | "", *pass = req["pass"] | "";
    if (!*url || !*ssid) return fail(resp, "ota needs url and ssid");
    if (!pm_ota_start(url, ssid, pass, PM_CHANNEL)) return fail(resp, "an update is already running (or the URL/name is too long)");
  }
  else if (!strcmp(cmd, "ota_begin")) {
    const char *e = pm_ota_begin(req["size"] | 0UL, req["sha256"] | "");
    if (e) return fail(resp, e);
    resp["chunk"] = 2700;  // bytes of image per ota_data (fits a 4320-byte mesh request as base64)
    resp["written"] = pm_ota_written();  // > 0: the same image was part-received — carry on from here
  }
  else if (!strcmp(cmd, "ota_data")) {
    uint32_t written = 0;
    const char *e = pm_ota_data(req["off"] | 0UL, req["data"] | (const char *)nullptr, &written);
    resp["written"] = written;
    if (e) return fail(resp, e);
  }
  else if (!strcmp(cmd, "ota_end")) {
    const char *e = pm_ota_end();
    if (e) return fail(resp, e);
  }
  else if (!strcmp(cmd, "ota_abort")) pm_ota_abort();
  else if (!strcmp(cmd, "ota_status")) {
    static const char *const ST[] = {"idle", "connecting", "downloading", "rebooting", "failed"};
    resp["state"] = ST[pm_ota_state() % 5];
    resp["progress"] = pm_ota_progress();
    resp["written"] = pm_ota_written();  // mesh transfer: bytes received so far (resumable)
    if (*pm_ota_error()) resp["error"] = pm_ota_error();
    resp["build"] = PM_BUILD;
    resp["pending"] = pm_ota_pending();
  }
  else if (!strcmp(cmd, "ble_tx")) {
    if (req["window_ms"].is<int>()) pm_ble_tx_window(req["window_ms"]);
    resp["window_ms"] = pm_ble_tx_window();
  }
  else if (!strcmp(cmd, "ble")) {
    PmBleStats b = pm_ble_stats();
    resp["adverts_heard"] = b.adverts_heard;
    resp["pair_key_match"] = b.pair_key_match;
    resp["reports"] = b.reports;
    resp["failed_opcode"] = b.failed_opcode;
    resp["failed_status"] = b.failed_status;
    resp["running"] = b.running;
    resp["bursts"] = b.bursts;          // color commands put on air
    resp["cmd_ok"] = b.cmd_ok;          // HCI commands the controller confirmed
    resp["cmd_failed"] = b.cmd_failed;
    resp["last_status"] = b.last_status;
    resp["last_opcode"] = b.last_opcode;
  }
  else if (pm_sync_handle(cmd, req, resp)) {}
  else if (pm_copies_handle(cmd, req, resp)) {}
  else if (!pm_show_handle(cmd, req, resp)) fail(resp, "unknown command");
}

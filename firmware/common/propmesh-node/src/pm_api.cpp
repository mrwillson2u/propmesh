#include <Arduino.h>
#include "pm_api.h"
#include "pm_mesh.h"
#include "pm_pinrules.h"
#include "pm_config_json.h"
#include "pm_config_store.h"
#include "pm_channels.h"
#include "pm_show.h"
#include "pm_ble_tx.h"

static const pm_board_t *board;

void pm_api_begin(const pm_board_t &b) { board = &b; }

bool pm_node_apply(const PmNodeConfig &cfg) {
  uint8_t role = pm_role();
  bool was_bridge = role & PM_NODE_ROLE_BRIDGE;
  if (cfg.bridge) {
    role |= PM_NODE_ROLE_RELAY | PM_NODE_ROLE_BRIDGE | PM_NODE_ROLE_CONDUCTOR;
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
  resp["board"] = board->id;
  resp["name"] = pm_channels_config().name;
  resp["bridge"] = pm_channels_config().bridge;
  resp["role"] = pm_role();
  resp["armed"] = pm_show_armed();
}

static void cmd_set_config(JsonObjectConst req, JsonObject resp) {
  // Static: PmNodeConfig is ~700 bytes and the loop task stack is small.
  static PmNodeConfig cfg;
  const char *err = pm_config_from_json(req["config"], cfg);
  if (err) return fail(resp, err);
  PmIssues issues = pm_validate(*board, cfg);
  put_issues(issues, resp);
  if (issues.errors) return fail(resp, "invalid config");
  if (!pm_store_save(cfg)) return fail(resp, "could not save to flash");
  if (!pm_node_apply(cfg)) return fail(resp, "saved, but a pin failed to start");
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

static void cmd_mesh(JsonObject resp) {
  resp["synced"] = pm_time_synced();
  resp["role"] = pm_role();
  if (pm_time_synced()) {
    char id[9];
    snprintf(id, sizeof(id), "%08lx", (unsigned long)pm_conductor_id());
    resp["conductor"] = id;
    resp["hop"] = pm_sync_hop();
  }
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

// A confirmed pairing becomes a BLE_LIGHT output on this board straight
// away, so nothing is lost if the console goes away mid-pairing.
static void on_paired(uint8_t number, const char *type) {
  static PmNodeConfig cfg;
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
  if (pm_store_save(cfg)) pm_node_apply(cfg);
  Serial.printf("ble: paired light %u (%s) as BLE_LIGHT_%u\n", number, type, index);
}

static void cmd_ble_scan(JsonObjectConst req, JsonObject resp) {
  if (pm_channels_config().bridge) return fail(resp, "the bridge drives no outputs — find lights from the board nearest the floods");
  pm_ble_on_paired(on_paired);
  if (req["window_ms"].is<int>()) pm_ble_scan_duty(req["window_ms"] | 20, req["interval_ms"] | 100);
  if (!pm_ble_scan(req["ms"] | 6000)) return fail(resp, "Bluetooth didn't start");
}

static void cmd_ble_found(JsonObject resp) {
  static const char *const MODE[] = {"idle", "scanning", "pairing"};
  static const char *const STATE[] = {"found", "pairing", "paired", "failed"};
  resp["mode"] = MODE[pm_ble_mode() % 3];
  resp["remaining_ms"] = pm_ble_remaining_ms();
  resp["key_set"] = pm_channels_config().has_brmesh_key;
  const PmBleLight *list;
  uint8_t n = pm_ble_found(&list);
  JsonArray arr = resp["lights"].to<JsonArray>();
  for (uint8_t i = 0; i < n; i++) {
    char a[18];
    hex_addr(a, list[i].addr);
    JsonObject o = arr.add<JsonObject>();
    o["addr"] = a;
    o["type"] = pm_brmesh_type_name(list[i].seen.type);
    o["rssi"] = list[i].rssi;
    o["state"] = STATE[list[i].state % 4];
    if (list[i].number) o["number"] = list[i].number;
  }
}

static void cmd_ble_pair(JsonObjectConst req, JsonObject resp) {
  if (pm_channels_config().bridge) return fail(resp, "the bridge drives no outputs");
  unsigned a[6];
  if (sscanf(req["addr"] | "", "%x:%x:%x:%x:%x:%x", &a[5], &a[4], &a[3], &a[2], &a[1], &a[0]) != 6)
    return fail(resp, "addr must look like aa:bb:cc:dd:ee:ff");
  uint8_t addr[6];
  for (int i = 0; i < 6; i++) addr[i] = (uint8_t)a[i];

  static PmNodeConfig cfg;
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
  if (!pm_ble_pair(addr, number, req["ms"] | 4000)) return fail(resp, "light not found — scan again with it powered on");
  resp["number"] = number;
}

void pm_api_handle(JsonObjectConst req, JsonObject resp) {
  if (!req["id"].isNull()) resp["id"] = req["id"];
  resp["ok"] = true;
  const char *cmd = req["cmd"] | "";
  if (!strcmp(cmd, "hello")) cmd_hello(resp);
  else if (!strcmp(cmd, "get_config"))
    pm_config_to_json(pm_channels_config(), resp["config"].to<JsonObject>());
  else if (!strcmp(cmd, "set_config")) cmd_set_config(req, resp);
  else if (!strcmp(cmd, "set")) cmd_set(req, resp);
  else if (!strcmp(cmd, "state")) cmd_state(resp);
  else if (!strcmp(cmd, "all_off")) { pm_show_stop(); pm_channels_all_off(); }
  else if (!strcmp(cmd, "mesh")) cmd_mesh(resp);
  else if (!strcmp(cmd, "ble_scan")) cmd_ble_scan(req, resp);
  else if (!strcmp(cmd, "ble_found")) cmd_ble_found(resp);
  else if (!strcmp(cmd, "ble_pair")) cmd_ble_pair(req, resp);
  else if (!strcmp(cmd, "ble")) {
    PmBleStats b = pm_ble_stats();
    resp["adverts_heard"] = b.adverts_heard;
    resp["reports"] = b.reports;
    resp["failed_opcode"] = b.failed_opcode;
    resp["failed_status"] = b.failed_status;
    resp["running"] = b.running;
    resp["bursts"] = b.bursts;          // colour commands put on air
    resp["cmd_ok"] = b.cmd_ok;          // HCI commands the controller confirmed
    resp["cmd_failed"] = b.cmd_failed;
    resp["last_status"] = b.last_status;
    resp["last_opcode"] = b.last_opcode;
  }
  else if (!pm_show_handle(cmd, req, resp)) fail(resp, "unknown command");
}

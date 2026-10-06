#include <Arduino.h>
#include "pm_api.h"
#include "pm_mesh.h"
#include "pm_pinrules.h"
#include "pm_config_json.h"
#include "pm_config_store.h"
#include "pm_channels.h"
#include "pm_show.h"

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
  else if (!pm_show_handle(cmd, req, resp)) fail(resp, "unknown command");
}

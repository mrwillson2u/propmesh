// PropMesh node for generic boards. Pins are assigned to functions from
// the console; the assignment lives in flash as /config.json and comes
// back at every boot, so a configured node runs with no laptop attached.
//
// Whichever node is on USB is the console's way into the mesh: requests
// for other nodes are forwarded over ESP-NOW, and the mesh's heartbeats
// and sensor events come back up as {"evt":...} lines. A node saved in
// bridge mode drives no pins and keeps the mesh clock.
// docs/generic-boards.md.
#include "pm_ws.h"
#include "pm_wifi.h"
#include "pm_ota.h"
#include <Arduino.h>
#include <ArduinoJson.h>
#include "pm_mesh.h"
#include "pm_api.h"
#include "pm_channels.h"
#include "pm_config_store.h"
#include "pm_link.h"
#include "pm_pinrules.h"
#include "pm_show.h"

#ifndef PM_CHANNEL
#define PM_CHANNEL 1
#endif
#ifndef PM_NET_ID
#define PM_NET_ID 0xCAFE
#endif

// Longest request is set_config: 16 channels is about 1.5 kB.
#define LINE_MAX_LEN 4096
// With no bridge around, wait for everyone to be heard before the
// highest id claims the conductor role (as in firmware/mesh-node).
#define ELECTION_SETTLE_MS (PM_HEARTBEAT_PERIOD_MS * 3)

static const pm_board_t &BOARD = PM_BOARD_PROFILE;

static char line[LINE_MAX_LEN];
static size_t line_len;
static bool line_overflow;
static uint32_t last_heartbeat;
static uint32_t unsynced_since;
static bool mesh_up;

// A debounced input change: tell the console and the mesh, then let
// this node's triggers decide whether it starts a sequence.
static void on_input(uint8_t index, bool active) {
  pm_link_input(index, active);
  pm_show_on_input(index, active);
}

// Every reply and event goes up the cable and to any console on WiFi.
static void out_line(const char *json, size_t len) {
  Serial.write((const uint8_t *)json, len);
  Serial.println();
  pm_ws_send(json, len);
}

// A bridge on WiFi serves consoles over WebSocket too (docs §6d stage B).
static void ws_loop() {
  static bool started;
  if (!started && pm_wifi_connected()) {
    started = true;
    pm_ws_begin(81, [](char *l, size_t n) { pm_link_request(l, n); });
  }
  pm_ws_loop();
}

static void send(JsonDocument &doc) {
  serializeJson(doc, Serial);
  Serial.println();
}

static void serial_loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (line_overflow) {
        JsonDocument resp;
        resp["ok"] = false;
        resp["error"] = "line too long";
        send(resp);
      } else if (line_len) {
        pm_link_request(line, line_len);
      }
      line_len = 0;
      line_overflow = false;
    } else if (line_len < LINE_MAX_LEN) {
      line[line_len++] = c;
    } else {
      line_overflow = true;
    }
  }
}

static void election() {
  uint32_t now = millis();
  if (pm_time_synced()) {
    unsynced_since = 0;
  } else if (!unsynced_since) {
    unsynced_since = now ? now : 1;
    pm_link_reset_highest_seen();
  } else if ((uint32_t)(now - unsynced_since) > ELECTION_SETTLE_MS &&
             pm_link_highest_seen() == pm_node_id() &&
             !(pm_role() & PM_NODE_ROLE_CONDUCTOR)) {
    pm_set_role(pm_role() | PM_NODE_ROLE_CONDUCTOR);
    Serial.println("elected self conductor");
  }
}

// Boards powered up together would heartbeat in lockstep and collide
// every time; each period is jittered by up to ±10 %.
static uint32_t next_period = PM_HEARTBEAT_PERIOD_MS;

static void heartbeat() {
  uint32_t now = millis();
  if (now - last_heartbeat < next_period) return;
  last_heartbeat = now;
  next_period = PM_HEARTBEAT_PERIOD_MS * 9 / 10 + esp_random() % (PM_HEARTBEAT_PERIOD_MS / 5);
  pm_heartbeat_t hb = {};
  hb.uptime_s = now / 1000;
  hb.board = BOARD.board_type;
  hb.role = pm_role();
  hb.fw_version = PM_FW_VERSION;
  hb.free_heap_kb = ESP.getFreeHeap() / 1024;
  hb.neighbor_count = pm_neighbor_snapshot(hb.neighbors, PM_MAX_NEIGHBORS);
  // Nodes move to the bridge's channel (docs §6d). While the bridge is
  // between WiFi attempts its radio may be mid-scan: say "unknown" then,
  // rather than send the mesh chasing a scan.
  hb.channel = (pm_wifi_configured() && !pm_wifi_connected()) ? 0 : pm_mesh_channel();
  pm_send(PM_MSG_TYPE_HEARTBEAT, &hb, sizeof(hb));
}

void setup() {
  Serial.setRxBufferSize(LINE_MAX_LEN);
  // 921600: the console's link, and the firmware-update pipe — at 115200
  // the cable (1.75 MB of base64 per image) cost more than the mesh did
  // (2026-10-07). The console tries this speed first, then 115200 for
  // boards not yet updated. The CP2102/CH340 on the devkits both do it.
  Serial.begin(PM_SERIAL_BAUD);
  delay(300);

  pm_api_begin(BOARD);

  // Stored config is re-validated against THIS firmware's board table:
  // a file from another board, or from before a rule changed, must not
  // drive pins. An invalid config leaves every pin untouched.
  static PmNodeConfig cfg;
  const char *config_state = "none";
  if (!pm_store_begin()) {
    config_state = "flash error";
  } else if (pm_store_load(cfg)) {
    if (pm_validate(BOARD, cfg).errors) {
      config_state = "rejected";
      cfg = PmNodeConfig();
    } else {
      config_state = "ok";
    }
  }

  // Powered generic nodes relay; pm_node_apply adds bridge + conductor.
  // Start on the channel the mesh was last found on (docs §6d).
  uint8_t ch = pm_store_channel_load();
  mesh_up = pm_mesh_init(ch ? ch : PM_CHANNEL, PM_NET_ID, PM_NODE_ROLE_RELAY);
  pm_mesh_on_channel([](uint8_t c) { pm_store_channel_save(c); Serial.printf("mesh: now on channel %u\n", c); });
  if (!mesh_up) Serial.println("pm_mesh_init FAILED — running without mesh");
  pm_link_begin(out_line);
  pm_on_input(on_input);
  pm_node_apply(cfg);
  pm_show_begin();

  char id[9];
  snprintf(id, sizeof(id), "%08lx", (unsigned long)pm_node_id());
  JsonDocument evt;
  evt["evt"] = "boot";
  evt["node"] = id;
  evt["board"] = BOARD.id;
  evt["fw"] = PM_FW_VERSION;
  evt["build"] = PM_BUILD;
  evt["pending"] = pm_ota_pending();  // a fresh OTA image, not yet proven
  evt["config"] = config_state;
  evt["bridge"] = cfg.bridge;
  evt["channels"] = cfg.channel_count;
  send(evt);
}

// A freshly updated image proves itself by running with the mesh up for
// 20 s; until then a crash or reset lets the bootloader fall back.
static void confirm_image() {
  static bool done;
  if (done || millis() < 20000) return;
  done = true;
  pm_ota_mark_valid();
}

void loop() {
  serial_loop();
  pm_channels_loop();
  pm_show_loop();
  if (!mesh_up) return;
  confirm_image();
  pm_ota_loop();
  pm_wifi_loop();
  ws_loop();
  pm_mesh_loop();
  pm_link_loop();
  election();
  heartbeat();
}

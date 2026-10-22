// PropMesh node for generic boards. Pins are assigned to functions from
// the console; the assignment lives in flash as /config.json and comes
// back at every boot, so a configured node runs with no laptop attached.
//
// Whichever node is on USB is the console's way into the mesh: requests
// for other nodes are forwarded over ESP-NOW, and the mesh's heartbeats
// and sensor events come back up as {"evt":...} lines. A node saved in
// bridge mode drives no pins and keeps the mesh clock.
// docs/generic-boards.md.
#include "pm_sleep.h"
#include <esp_task_wdt.h>
#include <esp_system.h>
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
#include "pm_lastwords.h"
#include "pm_radio.h"
#include "pm_sync.h"

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
// A reply goes to whoever asked (the USB console or one WebSocket client);
// an event goes to everyone.
static void out_line(const char *json, size_t len, int8_t to) {
  if (to == PM_TO_ALL || to == PM_FROM_SERIAL) {
    Serial.write((const uint8_t *)json, len);
    Serial.println();
  }
  if (to == PM_TO_ALL) pm_ws_send(json, len);
  else if (to >= 0) pm_ws_send_to((uint8_t)to, json, len);
}

// A bridge on WiFi serves consoles over WebSocket too (docs §6d stage B).
static void ws_loop() {
  static bool started;
  if (!started && pm_wifi_connected()) {
    started = true;
    pm_ws_begin(81, [](char *l, size_t n, uint8_t c) { pm_link_request(l, n, (int8_t)c); });
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
        pm_link_request(line, line_len, PM_FROM_SERIAL);
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

// Battery voltage on a board whose profile has a sense pin (the HUZZAH32:
// VBAT through 2:1 on GPIO 35). 0 = this board has none.
static uint16_t battery_mv() {
  if (!BOARD.battery_gpio) return pm_channels_battery_mv();  // a divider assigned in the console, or 0
  uint32_t sum = 0;
  for (int i = 0; i < 8; i++) sum += analogReadMilliVolts(BOARD.battery_gpio);
  return (uint16_t)(sum / 8 * BOARD.battery_divider);
}

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
  hb.battery_mv = battery_mv();  // 0 on a board with no battery sense
  hb.neighbor_count = pm_neighbor_snapshot(hb.neighbors, PM_MAX_NEIGHBORS);
  // Nodes move to the bridge's channel (docs §6d). While the bridge is
  // between WiFi attempts its radio may be mid-scan: say "unknown" then,
  // rather than send the mesh chasing a scan.
  hb.channel = (pm_wifi_configured() && !pm_wifi_connected()) ? 0 : pm_mesh_channel();
  hb.listen_ms = pm_sleep_listen_ms();  // a sleepy leaf: senders repeat into its window (docs §6f)
  pm_send(PM_MSG_TYPE_HEARTBEAT, &hb, sizeof(hb));
}

// Why the board last reset, for the boot event and the console: a
// watchdog or a panic says "the firmware hung/crashed", a brownout says
// "the supply sagged" — the difference between a software bug and a
// wiring problem (2026-10-08: a bridge went silent during servo moves on
// another board and nothing recorded why).
const char *pm_reset_reason() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: return "power on";
    case ESP_RST_SW: return "software (update or restart)";
    case ESP_RST_PANIC: return "crash";
    case ESP_RST_INT_WDT: return "interrupt watchdog";
    case ESP_RST_TASK_WDT: return "task watchdog (the firmware hung)";
    case ESP_RST_WDT: return "watchdog";
    case ESP_RST_BROWNOUT: return "brownout (supply sagged)";
    case ESP_RST_DEEPSLEEP: return "deep sleep";
    case ESP_RST_EXT: return "reset pin";
    default: return "unknown";
  }
}

void setup() {
  Serial.setRxBufferSize(LINE_MAX_LEN);
  // 921600: the console's link, and the firmware-update pipe — at 115200
  // the cable (1.75 MB of base64 per image) cost more than the mesh did
  // (2026-10-07). The console tries this speed first, then 115200 for
  // boards not yet updated. The CP2102/CH340 on the devkits both do it.
#if ARDUINO_USB_MODE && ARDUINO_USB_CDC_ON_BOOT
  // Native USB (C3, C6): Serial is the chip's own USB port. Plugged into a
  // computer that isn't reading it, each write waited up to 20 × 100 ms
  // for the host, and a few dozen log lines hung the loop past the 30 s
  // watchdog — a C6 on a laptop rebooted every few minutes (2026-10-15).
  // Never wait: drop output nobody reads. A 4 KB buffer keeps a console
  // that IS reading from losing the end of a long reply.
  Serial.setTxBufferSize(4096);
#endif
  Serial.begin(PM_SERIAL_BAUD);
#if ARDUINO_USB_MODE && ARDUINO_USB_CDC_ON_BOOT
  Serial.setTxTimeoutMs(0);
#endif
  delay(300);

  pm_api_begin(BOARD);
  pm_sleep_begin();  // wake cause; the wall clock after a deep sleep
  // Back from deep sleep: say so at once instead of 5 s in. A check-in
  // ends as soon as its heartbeat is out and the bridge is heard (§6m).
  if (strcmp(pm_sleep_wake_cause(), "timer") == 0 || strcmp(pm_sleep_wake_cause(), "sensor") == 0) next_period = 500;

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
  pm_lastwords_begin();  // what went wrong before this boot, if anything

  // Powered generic nodes relay; pm_node_apply adds bridge + conductor.
  // Start on the channel the mesh was last found on (docs §6d).
  uint8_t ch = pm_store_channel_load();
  mesh_up = pm_mesh_init(ch ? ch : PM_CHANNEL, PM_NET_ID, PM_NODE_ROLE_RELAY);
  pm_mesh_set_fresh(ch == 0);  // never followed a bridge: search for one properly (docs §6d)
  pm_mesh_on_channel([](uint8_t c) { pm_store_channel_save(c); Serial.printf("mesh: now on channel %u\n", c); });
  if (!mesh_up) Serial.println("pm_mesh_init FAILED — running without mesh");
  pm_link_begin(out_line);
  pm_on_input(on_input);
  pm_node_apply(cfg);
  pm_show_begin();
  pm_sync_begin();
  pm_sleep_after_boot(cfg);  // a sensor woke us: run its triggers

  char id[9];
  snprintf(id, sizeof(id), "%08lx", (unsigned long)pm_node_id());
  JsonDocument evt;
  evt["evt"] = "boot";
  evt["node"] = id;
  evt["board"] = BOARD.id;
  evt["fw"] = PM_FW_VERSION;
  evt["build"] = PM_BUILD;
  evt["pending"] = pm_ota_pending();  // a fresh OTA image, not yet proven
  evt["reset"] = pm_reset_reason();
  evt["wake"] = pm_sleep_wake_cause();
  if (pm_lastwords_any()) pm_lastwords_to_json(evt["last"].to<JsonObject>());
  evt["config"] = config_state;
  evt["bridge"] = cfg.bridge;
  evt["channels"] = cfg.channel_count;
  send(evt);

  // A hung loop() used to leave a board silent until someone walked over
  // to it. The task watchdog turns that into a reboot after 30 s, with the
  // hung task named on the serial log and the reason in the next boot
  // event; the board then rejoins the mesh on its own. Nothing in loop()
  // legitimately takes 30 s (a mesh request is retried for 2.7 s at most).
  esp_task_wdt_config_t wdt = { .timeout_ms = 30000, .idle_core_mask = 0, .trigger_panic = true };
  // The Arduino core has usually started the watchdog already ("TWDT
  // already initialized" on the log is expected): reconfigure it, then
  // subscribe this task. Say whether that worked — a bridge hung at 43 %
  // of a self-update on 2026-10-11 and never rebooted itself, and the log
  // also showed "esp_task_wdt_reset: task not found".
  if (esp_task_wdt_init(&wdt) != ESP_OK) esp_task_wdt_reconfigure(&wdt);
  esp_err_t wdt_err = esp_task_wdt_add(nullptr);
  if (wdt_err == ESP_OK || esp_task_wdt_status(nullptr) == ESP_OK) Serial.println("wdt: watching the main loop (30 s)");
  else Serial.printf("wdt: NOT watching the main loop (%s) — a hang won't reboot\n", esp_err_to_name(wdt_err));
}

// "Nobody hears me" (pm_mesh_unheard_ms): neighbors' heartbeats keep
// arriving but none lists this node, so its own frames aren't getting out
// — the radio can receive but not send. Seen on Prop 2026-10-12 after
// hours idle: every request to and from it timed out, nothing on the log.
// First restart ESP-NOW; if two more minutes go by still unheard, reboot.
// At most 3 such reboots in a row (an honestly one-way link at the edge
// of range mustn't reboot forever); being heard for 10 min resets that.
// With evidence, sooner: unheard for 15 s while the heap has refused the
// driver an allocation or esp_now_send has failed since we were last
// heard — the wedge of docs §6j — rebuilds the radio at once instead of
// after two minutes. The rebuild is the whole driver (pm_radio).
#define MUTE_MS 120000
#define MUTE_EVIDENCE_MS 15000
RTC_NOINIT_ATTR static uint32_t rtc_mute_magic, rtc_mute_reboots;
static void mute_watch() {
  static uint8_t stage;  // 0 fine, 1 radio rebuilt
  static uint32_t heard_since_ms = millis();
  static uint32_t last_check_ms;
  static uint32_t fails_when_heard, txerr_when_heard;
  uint32_t now = millis();
  if (now - last_check_ms < 1000) return;
  last_check_ms = now;
  if (rtc_mute_magic != 0x4D555445) { rtc_mute_magic = 0x4D555445; rtc_mute_reboots = 0; }
  uint32_t unheard = pm_mesh_unheard_ms();
  const pm_stats_t *st = pm_stats();
  if (unheard == 0) { fails_when_heard = pm_api_alloc_failures(); txerr_when_heard = st->tx_err; }
  bool evidence = pm_api_alloc_failures() != fails_when_heard || st->tx_err != txerr_when_heard;
  if (unheard < MUTE_MS && !(stage == 0 && unheard >= MUTE_EVIDENCE_MS && evidence)) {
    if (unheard == 0 && stage) { Serial.println("mesh: heard again"); stage = 0; }
    if (unheard == 0 && now - heard_since_ms > 600000) rtc_mute_reboots = 0;
    if (unheard) heard_since_ms = now;
    return;
  }
  heard_since_ms = now;
  char detail[160];
  // With what the radio and the heap looked like at that moment (docs §6j):
  // frames accepted but never completed, and free heap / largest block.
  snprintf(detail, sizeof(detail), "neighbors heard but none hear us for %lu s; send errors %lu (last %s); inflight %lu; heap %lu/%lu; alloc fails %lu",
           (unsigned long)(unheard / 1000), (unsigned long)st->tx_err,
           st->last_tx_err ? esp_err_to_name(st->last_tx_err) : "none",
           (unsigned long)pm_mesh_tx_inflight(), (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getMaxAllocHeap(),
           (unsigned long)pm_api_alloc_failures());
  if (stage == 0) {
    char why[64];
    snprintf(why, sizeof(why), "mute: none hear us for %lu s%s", (unsigned long)(unheard / 1000), evidence ? " with the heap or sends failing" : "");
    pm_radio_rebuild(why);
    stage = 1;
  } else if (rtc_mute_reboots < 3) {
    rtc_mute_reboots++;
    pm_lastwords_note("mute: rebooted", detail);
    Serial.printf("mesh: still MUTE after a radio restart — rebooting (%lu of 3)\n", (unsigned long)rtc_mute_reboots);
    Serial.flush();
    delay(100);
    esp_restart();
  } else {
    pm_mesh_unheard_reset();  // gave up rebooting; keep listening, check again later
  }
}

// A freshly updated image proves itself by running with the mesh up for
// 20 s; until then a crash or reset lets the bootloader fall back.
static void confirm_image() {
  static bool done;
  if (done || millis() < 20000) return;
  done = true;
  pm_ota_mark_valid();
}

// Heap forensics (docs §6j): a sample after every step, numbered so a
// drop can be laid at a step's door. 1 serial, 2 channels, 3 show,
// 4 sync, 5 ota, 6 wifi, 7 ws, 8 mesh, 9 sleep, 10 link, 11 election,
// 12 heartbeat, 13 mute watch, 0 top of loop.
void loop() {
  esp_task_wdt_reset();
  pm_api_heap_tick(0);
  serial_loop();        pm_api_heap_tick(1);
  pm_channels_loop();   pm_api_heap_tick(2);
  pm_show_loop();       pm_api_heap_tick(3);
  if (!mesh_up) return;
  pm_sync_loop();       pm_api_heap_tick(4);
  confirm_image();
  pm_ota_loop();        pm_api_heap_tick(5);
  pm_wifi_loop();       pm_api_heap_tick(6);
  ws_loop();            pm_api_heap_tick(7);
  pm_mesh_loop();       pm_api_heap_tick(8);
  pm_sleep_loop();      pm_api_heap_tick(9);
  pm_link_loop();       pm_api_heap_tick(10);
  election();           pm_api_heap_tick(11);
  heartbeat();          pm_api_heap_tick(12);
  mute_watch();         pm_api_heap_tick(13);
}

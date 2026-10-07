#include <Arduino.h>
#include <esp_bt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "pm_ble_tx.h"

// Keep the Bluetooth controller's memory. The Arduino core frees it at
// boot unless btInUse() says otherwise, after which the controller can
// never start — and BLE lights can be added from the console at any time.
extern "C" bool btInUse() { return true; }

#define TX_WINDOW_MS 200   // one command's advertising burst (20 ms interval -> ~10 adverts)
#define TX_GAP_MS 15       // between bursts, so a light sees distinct frames
#define MAX_LIGHTS 16
#define MAX_FOUND 16

static bool started, failed;
static uint8_t key[4];
static uint8_t seq;
static bool advertising;
static uint32_t until_ms;
static uint8_t rr;

static struct { bool used, dirty; uint8_t light; uint32_t rgb; } q[MAX_LIGHTS];

static uint8_t mode = PM_BLE_IDLE;
static uint32_t mode_until;
static PmBleLight found[MAX_FOUND];
static uint8_t found_n;
static int pair_target = -1;
static void (*paired_cb)(uint8_t, const char *);

static volatile uint32_t cmd_ok, cmd_failed, bursts, heard, reports;
static volatile uint8_t last_status;
static volatile uint16_t last_opcode, failed_opcode;
static volatile uint8_t failed_status;

// --- HCI over VHCI -----------------------------------------------------------

// A light advertisement heard while scanning, handed from the controller
// task to the loop.
struct Heard { uint8_t addr[6]; int8_t rssi; uint8_t mdata[18]; };
static QueueHandle_t rxq;

static void on_send_available() {}

// Runs on the controller's task: count Command Complete events, and pass
// on 18-byte manufacturer-data adverts (what a BRMesh light sends) while
// finding or pairing.
static int on_receive(uint8_t *d, uint16_t len) {
  if (len >= 7 && d[0] == 0x04 && d[1] == 0x0E) {
    last_opcode = d[4] | d[5] << 8;
    last_status = d[6];
    if (d[6] == 0) cmd_ok++;
    else { cmd_failed++; failed_opcode = last_opcode; failed_status = d[6]; }
    return 0;
  }
  // LE Meta (0x3E) / Advertising Report (0x02), one report per event
  if (mode == PM_BLE_IDLE || len < 15 || d[0] != 0x04 || d[1] != 0x3E || d[3] != 0x02 || d[4] < 1) return 0;
  reports++;
  const uint8_t *addr = d + 7;
  uint8_t dlen = d[13];
  if (14 + dlen + 1 > len) return 0;
  const uint8_t *ad = d + 14;
  int8_t rssi = (int8_t)d[14 + dlen];
  for (uint8_t i = 0; i + 1 < dlen;) {
    uint8_t flen = ad[i];
    if (!flen || i + 1 + flen > dlen) break;
    if (ad[i + 1] == 0xFF && flen - 1 == 18) {
      Heard h;
      memcpy(h.addr, addr, 6);
      h.rssi = rssi;
      memcpy(h.mdata, ad + i + 2, 18);
      heard++;
      if (rxq) xQueueSend(rxq, &h, 0);
    }
    i += 1 + flen;
  }
  return 0;
}
static esp_vhci_host_callback_t callbacks = {on_send_available, on_receive};

static bool hci(uint16_t opcode, const uint8_t *params, uint8_t len) {
  uint8_t buf[4 + 40];
  buf[0] = 0x01;  // HCI command packet
  buf[1] = opcode & 0xff;
  buf[2] = opcode >> 8;
  buf[3] = len;
  if (len) memcpy(buf + 4, params, len);
  for (int i = 0; i < 20 && !esp_vhci_host_check_send_available(); i++) delay(1);
  if (!esp_vhci_host_check_send_available()) return false;
  esp_vhci_host_send_packet(buf, 4 + len);
  return true;
}

#define HCI_RESET 0x0C03
#define HCI_SET_EVENT_MASK 0x0C01
#define LE_SET_ADV_PARAMS 0x2006
#define LE_SET_ADV_DATA 0x2008
#define LE_SET_ADV_ENABLE 0x200A
#define LE_SET_SCAN_PARAMS 0x200B
#define LE_SET_SCAN_ENABLE 0x200C

static bool adv_data(const uint8_t adv[PM_BRMESH_ADV_LEN]) {
  uint8_t data[1 + PM_BRMESH_ADV_LEN];
  data[0] = PM_BRMESH_ADV_LEN;
  memcpy(data + 1, adv, PM_BRMESH_ADV_LEN);
  return hci(LE_SET_ADV_DATA, data, sizeof(data));
}
static bool adv_enable(bool on) { const uint8_t v = on; return hci(LE_SET_ADV_ENABLE, &v, 1); }
static bool scanning;
// Only send real changes: the controller refuses "stop" when not scanning.
static bool scan_enable(bool on) {
  if (on == scanning) return true;
  const uint8_t v[2] = {(uint8_t)on, 0};
  bool ok = hci(LE_SET_SCAN_ENABLE, v, 2);
  if (ok) scanning = on;
  return ok;
}

bool pm_ble_start() {
  if (started) return true;
  if (failed) return false;
  esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);  // BLE only: frees the classic-BT RAM
  esp_bt_controller_config_t cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
  // The framework's default is dual mode; enable() must match init's mode.
  cfg.mode = ESP_BT_MODE_BLE;
  if (esp_bt_controller_get_status() == ESP_BT_CONTROLLER_STATUS_IDLE &&
      esp_bt_controller_init(&cfg) != ESP_OK) { failed = true; return false; }
  if (esp_bt_controller_get_status() == ESP_BT_CONTROLLER_STATUS_INITED &&
      esp_bt_controller_enable(ESP_BT_MODE_BLE) != ESP_OK) { failed = true; return false; }
  rxq = xQueueCreate(16, sizeof(Heard));
  esp_vhci_host_register_callback(&callbacks);
  // Reset, and wait for it to finish: commands sent mid-reset are refused.
  uint32_t before = cmd_ok + cmd_failed;
  hci(HCI_RESET, nullptr, 0);
  for (int i = 0; i < 200 && cmd_ok + cmd_failed == before; i++) delay(1);
  // After a reset the controller doesn't forward LE Meta events (which is
  // how advertisements heard while scanning arrive) — bit 61 is off by
  // default. Everything else stays at its default.
  const uint8_t mask[8] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x1F, 0x00, 0x20};
  hci(HCI_SET_EVENT_MASK, mask, 8);
  // 20 ms interval (32 x 0.625 ms), ADV_NONCONN_IND, all three channels.
  const uint8_t p[15] = {0x20, 0x00, 0x20, 0x00, 0x03, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0x07, 0x00};
  // Active scan, listening 20 ms of every 100 ms. Listening all the time
  // starved ESP-NOW (one radio): the node stopped answering the mesh for
  // the whole search (measured 2026-10-06). Lights repeat their adverts,
  // so slices still catch them.
  const uint8_t sp[7] = {0x01, 0xA0, 0x00, 0x20, 0x00, 0x00, 0x00};
  started = hci(LE_SET_ADV_PARAMS, p, sizeof(p)) && hci(LE_SET_SCAN_PARAMS, sp, sizeof(sp));
  failed = !started;
  return started;
}

bool pm_ble_running() { return started; }
void pm_ble_set_key(const uint8_t k[4]) { memcpy(key, k, 4); }

void pm_ble_light(uint8_t light, uint32_t rgb) {
  int free_slot = -1;
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (q[i].used && q[i].light == light) { q[i].rgb = rgb; q[i].dirty = true; return; }
    if (!q[i].used && free_slot < 0) free_slot = i;
  }
  if (free_slot < 0) return;
  q[free_slot] = {true, true, light, rgb};
}

// --- finding and pairing -----------------------------------------------------

static void stop_radio() {
  scan_enable(false);
  adv_enable(false);
  advertising = false;
}

// Scan duty cycle: listen `window_ms` of every `interval_ms`. Bluetooth
// and ESP-NOW share one radio, so this trades finding lights against
// staying on the mesh — see pm_ble_scan's caller for the chosen values.
// 50 % chosen from a sweep (2026-10-06): 100 % heard 28 adverts/s but the node
// answered 2 of 4 mesh requests; 50 % heard 6/s and answered 10 of 11;
// 20 % answered everything but heard nothing.
static uint16_t scan_window_ms = 50, scan_interval_ms = 100;
void pm_ble_scan_duty(uint16_t window_ms, uint16_t interval_ms) {
  if (window_ms < 3) window_ms = 3;
  if (interval_ms < window_ms) interval_ms = window_ms;
  scan_window_ms = window_ms;
  scan_interval_ms = interval_ms;
}
static bool apply_scan_params() {
  uint16_t iv = scan_interval_ms * 1000 / 625, wn = scan_window_ms * 1000 / 625;  // 0.625 ms units
  const uint8_t sp[7] = {0x01, (uint8_t)iv, (uint8_t)(iv >> 8), (uint8_t)wn, (uint8_t)(wn >> 8), 0x00, 0x00};
  return hci(LE_SET_SCAN_PARAMS, sp, sizeof(sp));
}

bool pm_ble_scan(uint32_t ms) {
  if (!pm_ble_start()) return false;
  stop_radio();
  apply_scan_params();
  // Forget lights not paired in this session; keep the paired ones listed.
  uint8_t keep = 0;
  for (uint8_t i = 0; i < found_n; i++) if (found[i].state == PM_BLE_PAIRED) found[keep++] = found[i];
  found_n = keep;
  uint8_t adv[PM_BRMESH_ADV_LEN];
  pm_brmesh_wake(++seq, adv);
  if (!adv_data(adv) || !adv_enable(true) || !scan_enable(true)) return false;
  mode = PM_BLE_SCANNING;
  mode_until = millis() + ms;
  return true;
}

bool pm_ble_pair(const uint8_t addr[6], uint8_t number, uint32_t ms) {
  if (!pm_ble_start() || mode == PM_BLE_PAIRING) return false;
  int t = -1;
  for (uint8_t i = 0; i < found_n; i++) if (!memcmp(found[i].addr, addr, 6)) t = i;
  if (t < 0) return false;
  stop_radio();
  apply_scan_params();
  found[t].state = PM_BLE_PAIR_WAIT;
  found[t].number = number;
  pair_target = t;
  uint8_t adv[PM_BRMESH_ADV_LEN];
  pm_brmesh_add(found[t].seen.mac, number, key, ++seq, adv);
  if (!adv_data(adv) || !adv_enable(true) || !scan_enable(true)) return false;
  mode = PM_BLE_PAIRING;
  mode_until = millis() + ms;
  return true;
}

uint8_t pm_ble_mode() { return mode; }
uint32_t pm_ble_remaining_ms() {
  int32_t left = (int32_t)(mode_until - millis());
  return mode == PM_BLE_IDLE || left < 0 ? 0 : (uint32_t)left;
}
uint8_t pm_ble_found(const PmBleLight **list) { *list = found; return found_n; }
void pm_ble_on_paired(void (*cb)(uint8_t, const char *)) { paired_cb = cb; }

static void handle_heard(const Heard &h) {
  PmBrmeshSeen s;
  if (!pm_brmesh_parse(h.mdata, 18, s)) return;
  int at = -1;
  for (uint8_t i = 0; i < found_n; i++) if (!memcmp(found[i].addr, h.addr, 6)) at = i;
  if (mode == PM_BLE_SCANNING) {
    if (!pm_brmesh_unpaired(s)) return;  // paired to someone else's key: not ours to take
    if (at < 0) {
      if (found_n >= MAX_FOUND) return;
      at = found_n++;
      memcpy(found[at].addr, h.addr, 6);
      found[at].state = PM_BLE_FOUND;
      found[at].number = 0;
    }
    found[at].seen = s;
    found[at].rssi = h.rssi;
  } else if (mode == PM_BLE_PAIRING && at == pair_target && !pm_brmesh_unpaired(s)) {
    // It came back advertising a key that isn't the default: ours.
    found[at].state = PM_BLE_PAIRED;
    found[at].rssi = h.rssi;
    uint8_t n = pm_brmesh_number(h.mdata, key);
    if (n) found[at].number = n;
    stop_radio();
    mode = PM_BLE_IDLE;
    if (paired_cb) paired_cb(found[at].number, pm_brmesh_type_name(found[at].seen.type));
  }
}

// --- loop --------------------------------------------------------------------

void pm_ble_loop() {
  if (!started) return;
  uint32_t now = millis();

  if (mode != PM_BLE_IDLE) {
    Heard h;
    while (rxq && xQueueReceive(rxq, &h, 0) == pdTRUE) handle_heard(h);
    if (mode != PM_BLE_IDLE && (int32_t)(now - mode_until) >= 0) {
      if (mode == PM_BLE_PAIRING && pair_target >= 0) found[pair_target].state = PM_BLE_PAIR_FAILED;
      stop_radio();
      mode = PM_BLE_IDLE;
      until_ms = now + TX_GAP_MS;
    }
    return;  // colours wait while finding/pairing
  }

  if (advertising) {
    if ((int32_t)(now - until_ms) < 0) return;
    adv_enable(false);
    advertising = false;
    until_ms = now + TX_GAP_MS;
    return;
  }
  if ((int32_t)(now - until_ms) < 0) return;
  for (int n = 0; n < MAX_LIGHTS; n++) {
    int i = (rr + n) % MAX_LIGHTS;
    if (!q[i].used || !q[i].dirty) continue;
    rr = (i + 1) % MAX_LIGHTS;
    q[i].dirty = false;
    uint8_t cmd[6], adv[PM_BRMESH_ADV_LEN];
    pm_brmesh_command(q[i].light, q[i].rgb, cmd);
    pm_brmesh_adv(key, ++seq, cmd, adv);
    if (adv_data(adv) && adv_enable(true)) {
      bursts++;
      advertising = true;
      until_ms = now + TX_WINDOW_MS;
    } else {
      q[i].dirty = true;  // radio busy: try again next loop
    }
    return;
  }
}

PmBleStats pm_ble_stats() {
  return {started, bursts, cmd_ok, cmd_failed, last_status, last_opcode, failed_opcode, failed_status, heard, reports};
}

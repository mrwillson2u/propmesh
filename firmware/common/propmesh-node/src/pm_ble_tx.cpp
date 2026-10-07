#include <Arduino.h>
#include <esp_bt.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include "pm_ble_tx.h"

// Keep the Bluetooth controller's memory. The Arduino core frees it at
// boot unless btInUse() says otherwise, after which the controller can
// never start — and BLE lights can be added from the console at any time.
extern "C" bool btInUse() { return true; }

// One command's advertising burst (20 ms interval -> ~5 adverts at 100 ms).
// Bench 2026-10-07 (Melpo floods, `ble_tx` sweep): 200 and 100 ms caught
// every change, 60 ms dropped some. It bounds how fast a fade can step.
static uint16_t tx_window_ms = 100;
#define TX_GAP_MS 15       // between bursts, so a light sees distinct frames
#define MAX_LIGHTS 16
#define MAX_FOUND 16
#define MAX_RAW 8

static bool started, failed;
static uint8_t key[4];
static bool key_set;
static uint8_t seq;
static bool advertising;
static uint32_t until_ms;
static uint8_t rr;

static struct { bool used, dirty; uint8_t light; uint32_t rgb; } q[MAX_LIGHTS];
static uint8_t raw_cmd[8], raw_hi;
static bool raw_dirty;

static uint8_t mode = PM_BLE_IDLE;
static uint32_t mode_until;
static PmBleLight found[MAX_FOUND];
static uint8_t found_n;
static int pair_target = -1;
static void (*paired_cb)(uint8_t, const char *);

static volatile uint32_t cmd_ok, cmd_failed, bursts, heard, reports;
static uint8_t pair_key_match;
static PmBleRaw raws[MAX_RAW];
static volatile uint8_t raw_n;
static volatile uint8_t last_status;
static volatile uint16_t last_opcode, failed_opcode;
static volatile uint8_t failed_status;

// --- HCI over VHCI -----------------------------------------------------------

// A light advertisement heard while scanning, handed from the controller
// task to the loop.
struct Heard { uint8_t addr[6]; int8_t rssi; uint8_t mdata[18]; };
static QueueHandle_t rxq;

static void on_send_available() {}

// Phone and laptop chatter, left out of the "others" list: Apple,
// Microsoft, Samsung, Google company ids (little-endian).
static bool noisy_company(const uint8_t *id) {
  return id[1] == 0 && (id[0] == 0x4C || id[0] == 0x06 || id[0] == 0x75 || id[0] == 0xE0);
}

// Runs on the controller's task: count Command Complete events, and pass
// on 18-byte manufacturer-data adverts (what a BRMesh light sends) while
// finding or pairing. While searching, anything else that isn't phone
// chatter is kept (last MAX_RAW addresses) so an unrecognised light still
// shows up somewhere.
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
  bool light = false, noise = false;
  for (uint8_t i = 0; i + 1 < dlen;) {
    uint8_t flen = ad[i];
    if (!flen || i + 1 + flen > dlen) break;
    if (ad[i + 1] == 0xFF && flen - 1 == 18) {
      Heard h;
      memcpy(h.addr, addr, 6);
      h.rssi = rssi;
      memcpy(h.mdata, ad + i + 2, 18);
      heard++;
      light = true;
      if (rxq) xQueueSend(rxq, &h, 0);
    } else if (ad[i + 1] == 0xFF && flen >= 3 && noisy_company(ad + i + 2)) {
      noise = true;
    }
    i += 1 + flen;
  }
  if (light || noise || mode != PM_BLE_SCANNING || !dlen) return 0;
  uint8_t at = raw_n;
  for (uint8_t i = 0; i < raw_n; i++) if (!memcmp(raws[i].addr, addr, 6)) at = i;
  if (at == raw_n) {
    if (raw_n >= MAX_RAW) return 0;
    raw_n++;
  }
  memcpy(raws[at].addr, addr, 6);
  raws[at].rssi = rssi;
  raws[at].len = dlen > 31 ? 31 : dlen;
  memcpy(raws[at].ad, ad, raws[at].len);
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
void pm_ble_raw(const uint8_t cmd[8], uint8_t hi) { memcpy(raw_cmd, cmd, 8); raw_hi = hi; raw_dirty = true; }
void pm_ble_tx_window(uint16_t ms) { tx_window_ms = ms < 20 ? 20 : ms; }
uint16_t pm_ble_tx_window() { return tx_window_ms; }
void pm_ble_set_key(const uint8_t k[4]) {
  memcpy(key, k, 4);
  key_set = k[0] || k[1] || k[2] || k[3];
}

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
// `full`: listen all the time — for the few seconds of a pairing, where the
// light's one confirmation matters more than answering the mesh.
static bool apply_scan_params(bool full = false) {
  uint16_t iv = scan_interval_ms * 1000 / 625, wn = scan_window_ms * 1000 / 625;  // 0.625 ms units
  if (full) wn = iv;
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
  raw_n = 0;
  uint8_t adv[PM_BRMESH_ADV_LEN];
  pm_brmesh_wake(++seq, adv);
  if (!adv_data(adv) || !adv_enable(true) || !scan_enable(true)) return false;
  mode = PM_BLE_SCANNING;
  mode_until = millis() + ms;
  return true;
}

bool pm_ble_pair(const uint8_t mac[6], uint8_t number, uint32_t ms) {
  if (!pm_ble_start() || mode == PM_BLE_PAIRING) return false;
  int t = -1;
  for (uint8_t i = 0; i < found_n; i++) if (!memcmp(found[i].seen.mac, mac, 6)) t = i;
  if (t < 0) return false;
  stop_radio();
  apply_scan_params(true);
  found[t].state = PM_BLE_PAIR_WAIT;
  found[t].number = number;
  found[t].acked = false;
  pair_target = t;
  uint8_t adv[PM_BRMESH_ADV_LEN];
  // Encoded with the key the light holds now: the default if unpaired,
  // otherwise the one it advertised — that's how a take-over works.
  pm_brmesh_add(found[t].seen.mac, number, key, ++seq, adv, found[t].seen.key);
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
uint8_t pm_ble_others(const PmBleRaw **list) { *list = raws; return raw_n; }
void pm_ble_on_paired(void (*cb)(uint8_t, const char *)) { paired_cb = cb; }

// Lights share one placeholder Bluetooth address, so match on the
// key-independent identity in the data — or on the raw mac field, in case
// the identity turns out not to survive a key change.
static int find_light(const uint8_t id[8], const uint8_t mac[6]) {
  for (uint8_t i = 0; i < found_n; i++)
    if (!memcmp(found[i].id, id, 8) || !memcmp(found[i].seen.mac, mac, 6)) return i;
  return -1;
}

static void handle_heard(const Heard &h) {
  PmBrmeshSeen s;
  if (!pm_brmesh_parse(h.mdata, 18, s)) return;
  uint8_t id[8];
  pm_brmesh_id(h.mdata, s.key, id);
  int at = find_light(id, s.mac);
  if (mode == PM_BLE_SCANNING) {
    if (at < 0) {
      if (found_n >= MAX_FOUND) return;
      at = found_n++;
      memcpy(found[at].addr, h.addr, 6);
      memcpy(found[at].id, id, 8);
      found[at].number = 0;
      found[at].acked = false;
    } else if (found[at].state == PM_BLE_PAIRED) {
      found[at].rssi = h.rssi;
      memcpy(found[at].raw, h.mdata, 18);
      return;
    }
    found[at].seen = s;
    found[at].rssi = h.rssi;
    memcpy(found[at].raw, h.mdata, 18);
    if (pm_brmesh_unpaired(s)) {
      found[at].state = PM_BLE_FOUND;
    } else if (key_set && !memcmp(s.key, key, 4)) {
      // Already on our key: a pairing whose confirmation we missed. Adopt it.
      found[at].state = PM_BLE_PAIRED;
      found[at].acked = true;
      found[at].number = pm_brmesh_number(h.mdata, key);
      if (paired_cb && found[at].number) paired_cb(found[at].number, pm_brmesh_type_name(s));
    } else {
      found[at].state = PM_BLE_OTHER;
    }
  } else if (mode == PM_BLE_PAIRING && pair_target >= 0) {
    // Only the light we're pairing, and only once its key has changed from
    // the one it held when found — another light already on our key must
    // not confirm for it.
    PmBleLight &t = found[pair_target];
    if (at != pair_target && memcmp(s.mac, t.seen.mac, 6)) {
      uint8_t ours[8];
      pm_brmesh_id(h.mdata, key, ours);
      if (memcmp(ours, t.id, 8)) return;
    }
    if (!memcmp(s.key, t.seen.key, 4)) return;
    pair_key_match = !memcmp(s.key, key, 4) ? 1 : 2;
    t.state = PM_BLE_PAIRED;
    t.acked = true;
    t.rssi = h.rssi;
    memcpy(t.raw, h.mdata, 18);
    const char *type = pm_brmesh_type_name(t.seen);
    memcpy(t.seen.key, s.key, 4);
    uint8_t n = pm_brmesh_number(h.mdata, key);
    if (n) t.number = n;
    stop_radio();
    mode = PM_BLE_IDLE;
    if (paired_cb) paired_cb(t.number, type);
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
      stop_radio();
      mode = PM_BLE_IDLE;
      until_ms = now + TX_GAP_MS;
      if (pair_target >= 0 && found[pair_target].state == PM_BLE_PAIR_WAIT) {
        // The burst went out; lights don't answer. Count it as paired.
        PmBleLight &t = found[pair_target];
        t.state = PM_BLE_PAIRED;
        const char *type = pm_brmesh_type_name(t.seen);  // before the key it's decoded with changes
        memcpy(t.seen.key, key, 4);
        if (paired_cb) paired_cb(t.number, type);
      }
      pair_target = -1;
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
  if (raw_dirty) {  // bench: arbitrary command bytes (`ble_raw`)
    uint8_t adv[PM_BRMESH_ADV_LEN];
    pm_brmesh_frame(5, true, key, ++seq, raw_cmd, 8, adv, raw_hi);
    if (adv_data(adv) && adv_enable(true)) {
      raw_dirty = false;
      bursts++;
      advertising = true;
      until_ms = now + tx_window_ms;
    }
    return;
  }
  for (int n = 0; n < MAX_LIGHTS; n++) {
    int i = (rr + n) % MAX_LIGHTS;
    if (!q[i].used || !q[i].dirty) continue;
    rr = (i + 1) % MAX_LIGHTS;
    q[i].dirty = false;
    uint8_t cmd[8], adv[PM_BRMESH_ADV_LEN];
    pm_brmesh_command(q[i].light, q[i].rgb, cmd);
    pm_brmesh_adv(key, ++seq, cmd, adv);
    if (adv_data(adv) && adv_enable(true)) {
      bursts++;
      advertising = true;
      until_ms = now + tx_window_ms;
    } else {
      q[i].dirty = true;  // radio busy: try again next loop
    }
    return;
  }
}

PmBleStats pm_ble_stats() {
  return {started, bursts, cmd_ok, cmd_failed, last_status, last_opcode, failed_opcode, failed_status, heard, reports, pair_key_match};
}

#include <Arduino.h>
#include <esp_bt.h>
#include "pm_ble_tx.h"
#include "pm_brmesh.h"

// Keep the Bluetooth controller's memory. The Arduino core frees it at
// boot unless btInUse() says otherwise, after which the controller can
// never start — and BLE lights can be added from the console at any time.
extern "C" bool btInUse() { return true; }

#define TX_WINDOW_MS 200   // one command's advertising burst (20 ms interval -> ~10 adverts)
#define TX_GAP_MS 15       // between bursts, so a light sees distinct frames
#define MAX_LIGHTS 16

static bool started, failed;
static uint8_t key[4];
static uint8_t seq;
static bool advertising;
static uint32_t until_ms;
static uint8_t rr;  // round-robin position

static struct { bool used, dirty; uint8_t light; uint32_t rgb; } q[MAX_LIGHTS];

// --- HCI over VHCI -----------------------------------------------------------

static volatile uint32_t cmd_ok, cmd_failed, bursts;
static volatile uint8_t last_status;
static volatile uint16_t last_opcode;

static void on_send_available() {}
// Runs on the controller's task. Only counts Command Complete events
// (04 0E len n op_lo op_hi status) — proof the controller took a command.
static int on_receive(uint8_t *d, uint16_t len) {
  if (len >= 7 && d[0] == 0x04 && d[1] == 0x0E) {
    last_opcode = d[4] | d[5] << 8;
    last_status = d[6];
    if (d[6] == 0) cmd_ok++; else cmd_failed++;
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
  memcpy(buf + 4, params, len);
  for (int i = 0; i < 20 && !esp_vhci_host_check_send_available(); i++) delay(1);
  if (!esp_vhci_host_check_send_available()) return false;
  esp_vhci_host_send_packet(buf, 4 + len);
  return true;
}

#define HCI_RESET 0x0C03
#define LE_SET_ADV_PARAMS 0x2006
#define LE_SET_ADV_DATA 0x2008
#define LE_SET_ADV_ENABLE 0x200A

bool pm_ble_begin(const uint8_t k[4]) {
  memcpy(key, k, 4);
  if (started) return true;
  if (failed) return false;
  esp_err_t err = esp_bt_controller_mem_release(ESP_BT_MODE_CLASSIC_BT);  // BLE only: frees the classic-BT RAM
  Serial.printf("ble: mem_release classic -> %s\n", esp_err_to_name(err));
  esp_bt_controller_config_t cfg = BT_CONTROLLER_INIT_CONFIG_DEFAULT();
  // The framework's default is dual mode; enable() must match init's mode.
  cfg.mode = ESP_BT_MODE_BLE;
  if (esp_bt_controller_get_status() == ESP_BT_CONTROLLER_STATUS_IDLE) {
    err = esp_bt_controller_init(&cfg);
    Serial.printf("ble: controller_init -> %s\n", esp_err_to_name(err));
    if (err != ESP_OK) { failed = true; return false; }
  }
  if (esp_bt_controller_get_status() == ESP_BT_CONTROLLER_STATUS_INITED) {
    err = esp_bt_controller_enable(ESP_BT_MODE_BLE);
    Serial.printf("ble: controller_enable -> %s\n", esp_err_to_name(err));
    if (err != ESP_OK) { failed = true; return false; }
  }
  esp_vhci_host_register_callback(&callbacks);
  hci(HCI_RESET, nullptr, 0);
  delay(5);
  // 20 ms interval (32 x 0.625 ms), ADV_NONCONN_IND, all three channels.
  const uint8_t p[15] = {0x20, 0x00, 0x20, 0x00, 0x03, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0x07, 0x00};
  started = hci(LE_SET_ADV_PARAMS, p, sizeof(p));
  failed = !started;
  return started;
}

bool pm_ble_running() { return started; }

PmBleStats pm_ble_stats() {
  return {started, bursts, cmd_ok, cmd_failed, last_status, last_opcode};
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

void pm_ble_loop() {
  if (!started) return;
  uint32_t now = millis();
  if (advertising) {
    if ((int32_t)(now - until_ms) < 0) return;
    const uint8_t off = 0;
    hci(LE_SET_ADV_ENABLE, &off, 1);
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
    uint8_t cmd[6], data[1 + PM_BRMESH_ADV_LEN];
    pm_brmesh_command(q[i].light, q[i].rgb, cmd);
    data[0] = PM_BRMESH_ADV_LEN;
    pm_brmesh_adv(key, ++seq, cmd, data + 1);
    const uint8_t on = 1;
    if (hci(LE_SET_ADV_DATA, data, sizeof(data)) && hci(LE_SET_ADV_ENABLE, &on, 1)) {
      bursts++;
      advertising = true;
      until_ms = now + TX_WINDOW_MS;
    } else {
      q[i].dirty = true;  // radio busy: try again next loop
    }
    return;
  }
}

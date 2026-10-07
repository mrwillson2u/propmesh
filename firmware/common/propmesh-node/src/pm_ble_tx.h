// Bluetooth for BRMesh flood lights (BLE_LIGHT channels): sending
// colours, and finding + pairing lights without the BRMesh app.
//
// No Bluetooth host stack: the lights only use raw advertisements, so
// this drives the ESP32's BLE controller directly over VHCI with a
// handful of HCI commands (advertising parameters/data/enable, scan
// parameters/enable) and reads LE Advertising Report events back. That
// keeps it far smaller than the Arduino BLE library, and the controller
// time-shares the radio with ESP-NOW (coexistence is built in).
//
// Sending is non-blocking: each light's newest colour is queued and goes
// out as a ~200 ms advertising burst; a colour that changes again before
// it went out replaces the queued one.
//
// Pairing (protocol from dsclee1/BRmesh-esp32-mqtt): broadcast "wake",
// listen for lights advertising themselves — the DEFAULT key means
// unpaired, any other key is the one the light holds — then send "add
// device" (encoded with the light's current key) carrying our key and a
// light number, and listen for it to come back advertising our key.
// Unlike that library, the key is the node's, saved in its config —
// pairings survive a reset — and a light paired elsewhere can be taken
// over. A light heard already advertising our key is adopted on the spot.
#pragma once
#include <stdint.h>
#include "pm_brmesh.h"

// Start the controller (once). False if Bluetooth couldn't start.
bool pm_ble_start();
bool pm_ble_running();
void pm_ble_set_key(const uint8_t key[4]);

// Queue light `light` (BRMesh number) to show `wrgb` (0xWWRRGGBB, W 0–127
// white; 0 = off).
void pm_ble_light(uint8_t light, uint32_t wrgb);
// Bench only: send these 8 command bytes as one control frame.
void pm_ble_raw(const uint8_t cmd[8], uint8_t hi = 0);
// Length of one colour's advertising burst (default 200 ms).
void pm_ble_tx_window(uint16_t ms);
uint16_t pm_ble_tx_window();

void pm_ble_loop();

// --- finding and pairing ---------------------------------------------------

enum { PM_BLE_IDLE = 0, PM_BLE_SCANNING = 1, PM_BLE_PAIRING = 2 };
// FOUND: unpaired (default key). OTHER: holds another controller's key —
// pairing it is a take-over. PAIRED: we sent it our key. Lights don't
// acknowledge: once paired they stop announcing themselves (observed
// 2026-10-07 — 3 of 3 lights took the key and answered colours while the
// board saw nothing back), so a pairing counts once its burst has gone out;
// `acked` records the rare light that does come back with our key.
// PAIR_FAILED is only for a burst the radio couldn't send.
enum { PM_BLE_FOUND = 0, PM_BLE_PAIR_WAIT = 1, PM_BLE_PAIRED = 2, PM_BLE_PAIR_FAILED = 3, PM_BLE_OTHER = 4 };

struct PmBleLight {
  uint8_t addr[6];     // its Bluetooth address (a placeholder shared by all lights — not an identity)
  uint8_t id[8];       // pm_brmesh_id of what it advertised: survives a key change
  PmBrmeshSeen seen;   // what it advertised when found (key = what it held then)
  uint8_t raw[18];     // its latest manufacturer data, for diagnosis
  int8_t rssi;
  uint8_t state;       // PM_BLE_FOUND ...
  uint8_t number;      // assigned light number (when pairing / paired)
  bool acked;          // it came back advertising our key (unusual)
};

// Anything else heard while searching that isn't phone chatter — in case a
// light speaks a format we don't recognise yet.
struct PmBleRaw { uint8_t addr[6]; int8_t rssi; uint8_t len; uint8_t ad[31]; };
uint8_t pm_ble_others(const PmBleRaw **list);

// Wake lights and listen for unpaired ones for `ms`.
bool pm_ble_scan(uint32_t ms);
// Listening duty while finding/pairing (radio shared with ESP-NOW).
void pm_ble_scan_duty(uint16_t window_ms, uint16_t interval_ms);
// Pair the found light whose advertised mac (PmBrmeshSeen::mac) is `mac`
// as `number`, using the key set with pm_ble_set_key: an add-device burst
// of `ms` (the reference library's is 1 s), after which it counts as paired.
bool pm_ble_pair(const uint8_t mac[6], uint8_t number, uint32_t ms);
uint8_t pm_ble_mode();
uint32_t pm_ble_remaining_ms();  // left in the current search / pairing
uint8_t pm_ble_found(const PmBleLight **list);
// Called (from pm_ble_loop) when a light confirms our key.
void pm_ble_on_paired(void (*cb)(uint8_t number, const char *type));

// What the controller has confirmed: HCI Command Complete events.
struct PmBleStats {
  bool running;
  uint32_t bursts;
  uint32_t cmd_ok;
  uint32_t cmd_failed;
  uint8_t last_status;   // 0 = success
  uint16_t last_opcode;
  uint16_t failed_opcode;   // the last command the controller refused (0 = none)
  uint8_t failed_status;
  uint32_t adverts_heard;   // light-shaped adverts (18-byte manufacturer data) while finding
  uint32_t reports;         // every advert the scanner reported — proof it's listening
  uint8_t pair_key_match;   // last pairing confirm: 0 none, 1 light advertises exactly our key, 2 some other new key
};
PmBleStats pm_ble_stats();

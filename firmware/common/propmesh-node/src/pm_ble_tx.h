// Bluetooth output for BRMesh flood lights (BLE_LIGHT channels).
//
// No Bluetooth host stack: the lights only need raw, non-connectable
// advertisements, so this drives the ESP32's BLE controller directly
// over VHCI with three HCI commands (set advertising parameters, set
// advertising data, enable/disable). That keeps it ~100 KB smaller than
// the Arduino BLE library the reference used, and the controller
// time-shares the radio with ESP-NOW (WiFi/BT coexistence is built in).
//
// Non-blocking: each light's newest colour is queued; the loop sends one
// at a time as a ~200 ms advertising burst (the lights miss single
// adverts — the reference repeated each command 5x). A colour that
// changes again before it went out just replaces the queued one.
#pragma once
#include <stdint.h>

// Start the controller (once). False if Bluetooth couldn't start.
bool pm_ble_begin(const uint8_t key[4]);
bool pm_ble_running();

// Queue light `light` (BRMesh number) to show `rgb` (0xRRGGBB, 0 = off).
void pm_ble_light(uint8_t light, uint32_t rgb);

void pm_ble_loop();

// What the controller has confirmed: HCI Command Complete events, by
// outcome. `bursts` = colour commands put on air.
struct PmBleStats {
  bool running;
  uint32_t bursts;
  uint32_t cmd_ok;
  uint32_t cmd_failed;
  uint8_t last_status;   // 0 = success
  uint16_t last_opcode;
};
PmBleStats pm_ble_stats();

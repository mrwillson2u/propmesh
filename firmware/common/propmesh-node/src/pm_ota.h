// Firmware update over WiFi, asked for over the mesh (docs/generic-boards.md
// §6c). The console sends `ota {url, ssid, pass}`; the node joins that
// WiFi, pulls the image from the URL (the laptop runs tools/ota_serve.py)
// into the spare app slot, reboots, and the mesh comes back on its own
// channel. Credentials are used once and never stored. The new image must
// prove itself (pm_ota_mark_valid, once the mesh is up) or the bootloader
// rolls back to the previous one.
#pragma once
#include <stdint.h>

enum { PM_OTA_IDLE = 0, PM_OTA_CONNECTING, PM_OTA_DOWNLOADING, PM_OTA_REBOOTING, PM_OTA_FAILED };

// Starts the update in its own task; false if one is already running or
// the arguments don't fit. `mesh_channel` is restored after a failure.
bool pm_ota_start(const char *url, const char *ssid, const char *pass, uint8_t mesh_channel);
uint8_t pm_ota_state();
uint8_t pm_ota_progress();      // percent downloaded
const char *pm_ota_error();     // last failure, "" if none
// The running image works: keep it (cancels the bootloader's rollback).
void pm_ota_mark_valid();
// Whether this boot is a fresh image still waiting to be proven.
bool pm_ota_pending();

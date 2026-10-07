// Firmware updates (docs/generic-boards.md §6c). Two ways in, one way out:
//
//  * OVER THE MESH (the real one — nodes live in props out of WiFi reach):
//    the console streams the image through the USB bridge as base64
//    chunks: ota_begin {size, sha256} → ota_data {off, data}… → ota_end.
//    Each chunk is acknowledged with the bytes written, so a lost request
//    resumes where it stopped. ~2.7 kB per request, ~6 min per board at
//    115200 baud.
//  * OVER WIFI (a bonus when the laptop's WiFi reaches): `ota {url, ssid,
//    pass}` — the node joins that WiFi, pulls the image from the URL
//    (tools/ota_serve.py) and credentials are used once, never stored.
//
// Either way the image lands in the spare app slot, the node reboots, and
// the new image must prove itself (pm_ota_mark_valid, once the mesh is up)
// or the bootloader rolls back to the previous one.
#pragma once
#include <stdint.h>

enum { PM_OTA_IDLE = 0, PM_OTA_CONNECTING, PM_OTA_DOWNLOADING, PM_OTA_REBOOTING, PM_OTA_FAILED };

// Starts the update in its own task; false if one is already running or
// the arguments don't fit. `mesh_channel` is restored after a failure.
bool pm_ota_start(const char *url, const char *ssid, const char *pass, uint8_t mesh_channel);
uint8_t pm_ota_state();
uint8_t pm_ota_progress();      // percent downloaded
const char *pm_ota_error();     // last failure, "" if none
// --- over the mesh -----------------------------------------------------------
// Start receiving an image of `size` bytes whose SHA-256 is `sha256_hex`.
// Returns nullptr, or why not.
const char *pm_ota_begin(uint32_t size, const char *sha256_hex);
// Append base64 `data` at offset `off`; sets *written to the bytes held
// (the console resumes from there if `off` didn't match). nullptr = ok.
const char *pm_ota_data(uint32_t off, const char *data, uint32_t *written);
// All bytes in: verify the hash, commit the image. nullptr = ok, and the
// node reboots ~1 s later (after the reply has gone out).
const char *pm_ota_end();
void pm_ota_abort();
uint32_t pm_ota_written();
void pm_ota_loop();  // performs the deferred reboot after ota_end

// The running image works: keep it (cancels the bootloader's rollback).
void pm_ota_mark_valid();
// Whether this boot is a fresh image still waiting to be proven.
bool pm_ota_pending();

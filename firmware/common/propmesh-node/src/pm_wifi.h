// The bridge on home WiFi (docs §6d): joins as a station so the console
// can reach it over the network; ESP-NOW keeps running on whatever
// channel the router puts it on, and the mesh follows (pm_mesh.h).
// Plain nodes never join WiFi.
#pragma once
#include <stdint.h>
#include "pm_config.h"

// Join (or leave) WiFi according to the config: bridge + ssid = join.
void pm_wifi_apply(const PmNodeConfig &cfg);
void pm_wifi_loop();
bool pm_wifi_configured();
bool pm_wifi_connected();
const char *pm_wifi_ip();     // "" when not connected
int8_t pm_wifi_rssi();        // dBm, 0 when not connected
const char *pm_wifi_ssid();
const char *pm_wifi_reason();  // why the last attempt failed, "" if none

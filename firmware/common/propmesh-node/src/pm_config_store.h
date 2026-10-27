// The node's config, as /config.json in LittleFS. Human-readable on
// purpose: `pio run -t uploadfs` with a hand-written data/config.json is
// the no-console fallback (docs/generic-boards.md).
#pragma once
#include "pm_config.h"

bool pm_store_begin();

// False if there is no file or it does not parse — `out` is then an
// empty config (no channels, every pin left alone).
bool pm_store_load(PmNodeConfig &out);

// Written to a temp file and renamed, so losing power mid-save leaves
// the previous config intact.
bool pm_store_save(const PmNodeConfig &cfg);
// The WiFi channel the mesh was last found on (docs §6d); 0 = none saved.
uint8_t pm_store_channel_load();
void pm_store_channel_save(uint8_t ch);
bool pm_store_radio_low();       // browned out at full radio power: run at 13 dBm
void pm_store_radio_low_save();

// The color last sent to each flood light, by BRMesh light number
// (docs §6a). The lights can't be asked and keep their color through a
// power cut, so this is the system's only memory of them across reboots.
// /lights.json; a few bytes per light.
uint8_t pm_store_lights_load(uint8_t ids[], int32_t vals[], uint8_t max);
bool pm_store_lights_save(const uint8_t ids[], const int32_t vals[], uint8_t n);

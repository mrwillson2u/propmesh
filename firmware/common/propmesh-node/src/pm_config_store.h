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

#pragma once
#include <stdint.h>
// Rebuild the radio: the whole WiFi driver down and up, ESP-NOW back,
// power mode re-applied, the router rejoined (docs §6j). `why` goes into
// the last-words record and the log. Returns false if ESP-NOW did not
// come back (the caller may then reboot).
bool pm_radio_rebuild(const char *why);
uint32_t pm_radio_rebuilds();        // since boot
uint32_t pm_radio_last_rebuild_ms();  // millis() of the last one, 0 = none

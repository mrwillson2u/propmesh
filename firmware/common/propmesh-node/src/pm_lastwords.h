// "Last words": the most recent thing that went wrong (WiFi lost, the
// radio gone mute, a self-reboot), kept in flash so it survives the
// reboot that usually follows — and the reboot someone does to fix it.
// 2026-10-12: the bridge dropped off WiFi overnight, and opening its USB
// port to ask why rebooted it and erased the answer.
//
// The record from before this boot is reported in the boot event and in
// hello ("last"); notes made during this run overwrite the file for the
// next boot to report.
#pragma once
#include <ArduinoJson.h>

void pm_lastwords_begin();  // after LittleFS is up: read the previous record
// Record `what` (short, e.g. "wifi lost") and `detail`. At most one write
// every 10 s — a flapping link can't wear the flash.
void pm_lastwords_note(const char *what, const char *detail);
// The previous boot's record into `out` (nothing if there was none).
void pm_lastwords_to_json(JsonObject out);
bool pm_lastwords_any();

// The show follows the conductor (docs/generic-boards.md §6k, 2026-10-12).
//
// Mesh-wide documents — the schedule, the mode held by hand (STOP ALL),
// each board's part of the sequences and triggers, the floods key and
// light list — carry the UTC second they were edited. The conductor
// beacons its stamps every second (schema Time). A board whose copy is
// older pulls the newer one from the conductor; a board whose copy is
// NEWER (the bridge was replaced, or missed the console's write) pushes
// it to the conductor. Newest wins, everywhere. So a board that joins,
// wakes, reboots or was out of range catches up by itself, and nothing
// has to be online when the console saves.
//
// The schedule and mode live on every board, so any conductor serves
// them. Sequences, triggers and floods are kept for every board only by
// a bridge (pm_show_mirror): a mesh without one keeps working on what
// each board holds, it just can't heal those.
#pragma once
#include <ArduinoJson.h>

void pm_sync_begin();
void pm_sync_loop();
// pull_index / pull_seq / pull_rules / pull_floods (served by a bridge).
bool pm_sync_handle(const char *cmd, JsonObjectConst req, JsonObject resp);
// set_config succeeded with this request: note the floods stamp.
void pm_sync_config_saved(JsonObjectConst req);
// This board's pin settings changed: `at` is the stamp the console sent
// with them (0 = none: now). Reported in every heartbeat (cfg_at), so the
// bridge knows whether its copy is current (pm_copies).
void pm_sync_config_changed(uint32_t at);
uint32_t pm_sync_cfg_at();
// For hello: what this board has synced.
void pm_sync_status(JsonObject out);

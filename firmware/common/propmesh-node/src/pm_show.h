// This node's show: its part of each sequence, the triggers on its
// sensors, the player, and arming. Stored as /show.json; survives power
// cycles, so the show runs with no laptop or bridge attached.
// docs/generic-boards.md §"Sequences and triggers".
#pragma once
#include <ArduinoJson.h>
#include "proto_gen.h"

void pm_show_begin();
void pm_show_loop();

// A DIGITAL_IN changed (debounced): run this node's triggers.
void pm_show_on_input(uint8_t index, bool active);

// A CUE frame from the mesh.
void pm_show_on_cue(uint32_t src, const pm_cue_t &cue);

// Fire a sequence show-wide from this node: broadcast the cue and play
// this node's own part at the same mesh time.
void pm_show_fire(uint16_t sequence, uint32_t offset_ms = 0);

// Mode (software-plan §4.1): off / ambient / armed, from the show
// schedule when there is one and a wall clock, else as last set. A
// manual mode holds until the schedule's next change (capped when it is
// more active than the schedule's). arm(on) = armed / off.
void pm_show_set_mode(uint8_t mode);  // PmMode
uint8_t pm_show_mode();
bool pm_show_clock_pending();  // off only for want of a clock — don't sleep on it
// An output set by hand from the console (not a sequence preview): it
// comes back on when the show returns from off. All off by hand clears.
void pm_show_hand_set(uint8_t kind, uint8_t index, int32_t value);
void pm_show_hand_clear();
// Adds the mode block (mode, reason, clock, next_s, …) to a reply.
void pm_show_put_mode(JsonObject resp);
// UTC seconds of the schedule's next mode change; 0 if no schedule/clock.
uint32_t pm_show_next_change_s();
void pm_show_arm(bool armed);
bool pm_show_armed();

// Stop whatever is playing (all_off).
void pm_show_stop();

// Console API for the show; false if `cmd` isn't a show command.
bool pm_show_handle(const char *cmd, JsonObjectConst req, JsonObject resp);

// --- following the conductor (docs §6k) ------------------------------------
#include "pm_mesh.h"  // pm_show_stamps_t
// This board's mode and schedule stamps (show_at / floods_at: pm_sync).
void pm_show_stamps(pm_show_stamps_t &out);
// Take the conductor's hold (0xFF = none) if its stamp is newer than ours.
void pm_show_follow_mode(uint8_t manual, uint32_t at, uint32_t until);
int64_t pm_show_seq_at(uint16_t id);  // -1 = this board has no part of it
uint32_t pm_show_rules_at();
// Bridge only: keep a copy of what the console sends another board
// (set_sequence / delete_sequence / set_rules / set_config's floods), so
// that board can pull it later. pm_sync.cpp.
void pm_show_mirror(uint32_t dst, JsonObjectConst req);

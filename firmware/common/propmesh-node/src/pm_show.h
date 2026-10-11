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

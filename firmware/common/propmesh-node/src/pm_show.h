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

// Disarmed: cues and triggers are ignored and nothing plays. Boots
// armed, so a power cut never leaves the show dead.
void pm_show_arm(bool armed);
bool pm_show_armed();

// Stop whatever is playing (all_off).
void pm_show_stop();

// Console API for the show; false if `cmd` isn't a show command.
bool pm_show_handle(const char *cmd, JsonObjectConst req, JsonObject resp);

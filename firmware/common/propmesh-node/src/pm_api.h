// The node's console API: one JSON request in, one JSON response out.
// Transport-independent — USB serial frames it as lines today
// (firmware/node), the mesh and the bridge WebSocket carry the same
// documents later. Commands: docs/generic-boards.md §"Serial protocol".
#pragma once
#include <ArduinoJson.h>
#include "boards_gen.h"
#include "pm_config.h"

#define PM_FW_VERSION 4

void pm_api_begin(const pm_board_t &board);

// Make `cfg` live: pins, and the node's mesh role. A bridge relays,
// is the conductor, and outranks plain nodes in the election; leaving
// bridge mode gives the clock up. `cfg` must have passed pm_validate().
// Returns false if a pin failed to start.
bool pm_node_apply(const PmNodeConfig &cfg);

// Fills `resp` (always sets "ok"; echoes "id" when the request has one).
void pm_api_handle(JsonObjectConst req, JsonObject resp);
// Call from the main loop: samples free heap for `mesh`'s heap_win_min.
void pm_api_heap_tick();

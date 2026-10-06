// Everything between the console and the mesh, on every generic node:
//
//  - Console requests (one JSON object per call, from USB serial today)
//    are answered locally, or — when they carry a "node" that is not
//    this one — forwarded over the mesh as chunked API_REQ frames, with
//    retries, and the target's API_RESP is passed back up unchanged.
//  - API_REQ frames addressed to this node are executed here.
//  - Heartbeats and sensor events heard on the mesh are reported up as
//    {"evt":...} lines, so whichever node is on USB can show the yard.
//
// Radio callbacks run on the WiFi task; frames are queued and handled
// in pm_link_loop() on the Arduino loop, where pins and Serial are safe.
#pragma once
#include <stddef.h>
#include <stdint.h>
#include "pm_config.h"

// Where JSON lines for the console go (USB serial in firmware/node).
typedef void (*pm_line_out_t)(const char *json, size_t len);

void pm_link_begin(pm_line_out_t out);

// One request line from the console.
void pm_link_request(const char *json, size_t len);

void pm_link_loop();

// Tell the mesh (and the local console) that an input changed.
void pm_link_input(uint8_t index, bool active);

// Send an {"evt":...} document up to the console.
#include <ArduinoJson.h>
void pm_link_event(JsonDocument &evt);

// Highest node id heard since the last call to reset — the election in
// firmware/node uses it to decide who becomes conductor when no bridge
// is around.
uint32_t pm_link_highest_seen();
void pm_link_reset_highest_seen();

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
// Where a line goes: a reply to the client that asked, an event to everyone.
#define PM_TO_ALL (-2)       // events: every console and the serial port
#define PM_FROM_SERIAL (-1)  // the USB console
typedef void (*pm_line_out_t)(const char *json, size_t len, int8_t to);

void pm_link_begin(pm_line_out_t out);

// One request line from the console.
// `from`: PM_FROM_SERIAL, or the WebSocket client slot the line came in on.
// The reply goes back there and nowhere else: every console used to get
// every reply and match by request number, so two consoles' numbers
// colliding handed one the other's reply or timeout (2026-10-21).
void pm_link_request(const char *json, size_t len, int8_t from);
// A console left: forget its unanswered requests, so a new console in the
// same slot can never receive a reply meant for the old one.
void pm_link_forget_client(int8_t client);
// This node's own request to another node (a follower pulling the show
// from the conductor, docs §6k). `cb` gets the reply JSON, or nullptr
// after 3 tries with no answer. One in flight per caller is plenty.
typedef void (*pm_ask_cb_t)(const char *json, size_t len, void *ctx);
bool pm_link_ask(uint32_t dst, const char *json, size_t len, pm_ask_cb_t cb, void *ctx);

void pm_link_loop();

// A request to `dst` is in flight (a console's, or this node's own).
bool pm_link_busy_with(uint32_t dst);
// `dst` answered a console request that holds a battery board awake (not
// background polling) within the last `ms` (pm_copies leaves it awake).
bool pm_link_console_recent(uint32_t dst, uint32_t ms);

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

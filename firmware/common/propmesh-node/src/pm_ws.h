// A small WebSocket server for the bridge (docs §6d stage B): the console
// reaches the mesh over WiFi with exactly the JSON lines it sends over
// USB — one text message per request, every reply and event broadcast to
// each connected console. Hand-rolled (RFC 6455 text frames, ping/pong,
// close) rather than a library: two clients, 4 kB messages, and static
// RAM on this board is already full.
#pragma once
#include <stddef.h>
#include <stdint.h>

// Start listening (call once WiFi is up). `on_line` gets each complete
// text message as a NUL-terminated, writable buffer.
// `client` is the slot the line arrived on, for pm_ws_send_to.
void pm_ws_begin(uint16_t port, void (*on_line)(char *line, size_t len, uint8_t client));
// Called when a client's slot closes (dropped, or evicted for a newcomer).
void pm_ws_on_close(void (*on_close)(uint8_t client));
void pm_ws_loop();
// Send one line to every connected console (no trailing newline needed).
void pm_ws_send(const char *json, size_t len);
// Send one line to one console (its reply); a slot that has since closed is ignored.
void pm_ws_send_to(uint8_t client, const char *json, size_t len);
uint8_t pm_ws_clients();

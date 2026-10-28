// The bridge keeps every board's last hello and pin settings, and a change
// saved for a board that is asleep, until its next check-in delivers it
// (Colin, 2026-10-28). Any console that connects reads the same list and
// settings, and nothing waits on a browser tab.
//
// The copy follows the console's own traffic as it passes (a hello, a
// get_config, a set_config that was accepted). Boards since 2026-10-28
// stamp their settings and report the stamp in every heartbeat (cfg_at),
// so the bridge knows its copy is current without asking; an older board
// is read once, and again only to deliver a change.
//
// At a check-in — a board's first heartbeat after a wake — the bridge
// visits only a board that needs it: a change waiting, "stay awake next
// time", no copy yet, or a stamp that no longer matches. Then it lets a
// battery board sleep again, unless a console is working on it or it is
// in its setup window. docs/console-nodes-list.md §9.
#pragma once
#include <ArduinoJson.h>
#include <stdint.h>

void pm_copies_begin();
bool pm_copies_active();  // this board is a bridge: it keeps the copies
// A heartbeat heard. `stamps`: the frame carries cfg_at (firmware from 2026-10-28).
void pm_copies_heard(uint32_t node, bool stamps, uint32_t cfg_at, bool sleeping);
// A console's request to `node` and the board's reply, as they pass.
void pm_copies_observe(uint32_t node, const char *req, size_t req_len, const char *reply, size_t reply_len);
// get_copies / get_copy / queue_config / cancel_config / stay_awake / forget_copy.
bool pm_copies_handle(const char *cmd, JsonObjectConst req, JsonObject resp);

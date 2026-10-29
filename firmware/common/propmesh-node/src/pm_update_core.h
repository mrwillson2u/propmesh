// The bridge while a firmware image streams through it (pm_link.cpp):
// which requests wait their turn, and when a chunk goes straight to the
// board instead of through the relays. Pure, no Arduino: host-tested
// (firmware/test/test/test_update). docs/generic-boards.md §6c.
#pragma once
#include <stdint.h>
#include <string.h>

// A read for another board: during an update these go one at a time.
// Everything else (a cue, all_off, a pin test, a save) is someone at the
// console doing something, and goes straight out.
inline bool pm_upd_waits_turn(const char *cmd) {
  return !strcmp(cmd, "hello") || !strcmp(cmd, "state") || !strcmp(cmd, "mesh") ||
         !strcmp(cmd, "ota_status") || !strcmp(cmd, "ble") || !strncmp(cmd, "get_", 4);
}

// Straight to the board: a chunk sent single-hop (TTL 0) to a board that
// hears the bridge well. The relays stay quiet, so the frames need no
// gap for their rebroadcasts and the image doesn't flood the whole mesh.
// A direct try that goes unanswered is resent the usual way (flood); two
// in a row and the next PM_DIRECT_BACKOFF chunks go by flood before
// direct is tried again.
#define PM_DIRECT_MIN_RSSI (-86)  // the bridge hears the board at least this well (smoothed)
#define PM_DIRECT_MISSES 2
#define PM_DIRECT_BACKOFF 30

struct PmDirect {
  uint8_t misses;  // direct tries in a row that went unanswered
  uint16_t skip;   // chunks still to go by flood before trying direct again
};

// For the next chunk: send it direct? `heard`: the bridge hears the board
// directly (its neighbor table), at `rssi`.
inline bool pm_direct_choose(PmDirect &d, bool heard, int8_t rssi) {
  if (d.skip) { d.skip--; return false; }
  return heard && rssi >= PM_DIRECT_MIN_RSSI;
}
inline void pm_direct_answered(PmDirect &d) { d.misses = 0; }
inline void pm_direct_missed(PmDirect &d) {
  if (++d.misses >= PM_DIRECT_MISSES) { d.skip = PM_DIRECT_BACKOFF; d.misses = 0; }
}

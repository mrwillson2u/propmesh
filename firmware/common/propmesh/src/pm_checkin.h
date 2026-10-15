// When a sleeping battery board checks in (docs/generic-boards.md §6m,
// "Synchronized check-ins"). Header-only and pure, so it is host-tested.
//
// Boards wake on a UTC grid — the next whole multiple of their check-in
// period — instead of "period after I fell asleep", so every board with the
// same period is awake at the same moment and a chain of battery repeaters
// passes messages end to end. The deep-sleep timer runs from the chip's
// internal RC oscillator (about 1 % off, no 32 kHz crystal on these
// boards), so a board wakes `guard_s` early and stays `guard_s` past the
// slot; with every clock inside its guard, all of them overlap at the slot.
#pragma once
#include <stdint.h>

struct PmCheckinPlan {
  uint32_t sleep_s;  // how long to deep-sleep from now
  uint32_t guard_s;  // woken this early; stay awake this long past the slot
  uint64_t slot_s;   // the grid slot, UTC seconds
};

// now_s: UTC seconds. period_s: the check-in period (> 0). A slot closer
// than min_sleep_s (plus the guard) is skipped for the next one — sleeping
// for less isn't worth it, and the board is awake now anyway.
inline PmCheckinPlan pm_checkin_plan(uint64_t now_s, uint32_t period_s, uint32_t min_sleep_s) {
  if (period_s == 0) period_s = 1;
  uint32_t guard = period_s / 100 + 1;
  uint64_t slot = (now_s / period_s + 1) * period_s;
  while (slot < now_s + min_sleep_s + guard) slot += period_s;
  return { (uint32_t)(slot - guard - now_s), guard, slot };
}

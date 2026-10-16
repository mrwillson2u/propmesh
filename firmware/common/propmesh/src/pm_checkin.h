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

// The guard: how far the sleep clock may be off. Uncorrected, the RC
// oscillator is about 1 % out; once the board has measured its own drift
// against the conductor's beacon (pm_drift_ppm) only temperature changes
// are left, so 0.3 % covers it.
inline uint32_t pm_checkin_guard(uint32_t period_s, bool corrected) {
  return corrected ? 1 + period_s * 3 / 1000 : 1 + period_s / 100;
}

// now_s: UTC seconds. period_s: the check-in period (> 0). A slot closer
// than min_sleep_s (plus the guard) is skipped for the next one — sleeping
// for less isn't worth it, and the board is awake now anyway.
inline PmCheckinPlan pm_checkin_plan(uint64_t now_s, uint32_t period_s, uint32_t min_sleep_s, uint32_t guard) {
  if (period_s == 0) period_s = 1;
  uint64_t slot = (now_s / period_s + 1) * period_s;
  while (slot < now_s + min_sleep_s + guard) slot += period_s;
  return { (uint32_t)(slot - guard - now_s), guard, slot };
}

// ---- Drift self-correction ------------------------------------------------
// The board's clock rides through deep sleep on the same RC oscillator as
// the wake timer, so both are off by the same factor. At the first beacon
// after a wake, the jump the wall clock takes (local − conductor, ms) over
// how long the RTC thought it slept gives that factor in parts per million:
// positive = the RTC runs fast, so the board wakes early and must ask for a
// longer sleep. Sleeps under a minute are too short to measure well, and a
// jump beyond ±5 % is something else (a console clock change, a new
// conductor), never drift.
inline bool pm_drift_ppm(int64_t step_ms, int64_t slept_ms, int32_t *ppm) {
  if (slept_ms < 60000) return false;
  int64_t p = step_ms * 1000000 / slept_ms;
  if (p > 50000 || p < -50000) return false;
  *ppm = (int32_t)p;
  return true;
}

// Several measurements, so one noisy wake doesn't swing the next sleep.
inline int32_t pm_drift_blend(int32_t old_ppm, bool have_old, int32_t new_ppm) {
  return have_old ? (int32_t)(((int64_t)old_ppm * 3 + new_ppm) / 4) : new_ppm;
}

// How long to ask the timer for, to sleep `real_ms` of real time.
inline uint64_t pm_drift_correct_ms(uint64_t real_ms, int32_t ppm) {
  int64_t adj = (int64_t)real_ms * ppm / 1000000;
  return (uint64_t)((int64_t)real_ms + adj);
}

// A ramp: move an output from one value to another over a fixed time,
// anchored to the sequence clock — "arrive at `to` at time T". This is
// the Timeline's line between two keyframes (software-plan §6, decided
// 2026-09-05: ramps are a native node action, interpolated here at
// ~50 Hz, never 50 keyframes over the mesh).
//
// Unlike pm_motion.h (a velocity follower for live slider moves), a
// ramp is time-parametrised: a late start just lands further along the
// curve, so every node is on the same point of the line at the same
// mesh time. Header-only, no Arduino/ESP includes: tested host-native.
#pragma once
#include <math.h>
#include <stdint.h>

enum { PM_EASE_LINEAR = 0, PM_EASE_IN = 1, PM_EASE_OUT = 2, PM_EASE_INOUT = 3 };
#define PM_EASE_COUNT 4

// Progress 0..1 -> eased 0..1. Quadratic: gentle enough for props,
// cheap enough for 50 Hz on every channel.
inline float pm_ease(uint8_t ease, float p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  switch (ease) {
    case PM_EASE_IN: return p * p;
    case PM_EASE_OUT: return 1 - (1 - p) * (1 - p);
    case PM_EASE_INOUT: return p < 0.5f ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
    default: return p;
  }
}

struct PmRamp {
  bool active = false;
  int32_t from = 0, to = 0;
  int64_t start_us = 0;
  uint32_t dur_us = 0;
  uint8_t ease = PM_EASE_LINEAR;

  void begin(int32_t f, int32_t t, int64_t start, uint32_t dur_ms, uint8_t e) {
    from = f;
    to = t;
    start_us = start;
    dur_us = dur_ms * 1000u;
    ease = e;
    active = true;
  }

  // Value at `now_us`; clears `active` once the end is reached.
  int32_t at(int64_t now_us) {
    if (!dur_us || now_us >= start_us + (int64_t)dur_us) {
      active = false;
      return to;
    }
    float p = now_us <= start_us ? 0.0f : (float)(now_us - start_us) / (float)dur_us;
    return from + (int32_t)lroundf((float)(to - from) * pm_ease(ease, p));
  }
};

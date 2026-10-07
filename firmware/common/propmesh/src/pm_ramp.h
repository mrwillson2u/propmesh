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

// Easing is set by two amounts (2026-10-06): the share of the ramp spent
// speeding up (`in`, %) and slowing down (`out`, %), cruising in
// between — a trapezoidal velocity profile. in + out <= 100.
//   0/0 = linear · 50/50 = the old quadratic "ease in & out"
//   100/0 = old "ease in" · 0/100 = old "ease out" — the same curves,
// so sequences stored with the old named presets keep their shape.
#define PM_EASE_PRESET_LINEAR 0, 0
#define PM_EASE_PRESET_INOUT 50, 50
#define PM_EASE_PRESET_IN 100, 0
#define PM_EASE_PRESET_OUT 0, 100

// Progress 0..1 -> eased 0..1 for in/out given in percent.
inline float pm_ease(uint8_t in_pct, uint8_t out_pct, float p) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  float a = in_pct / 100.0f, b = out_pct / 100.0f;
  if (a + b > 1) { float k = 1 / (a + b); a *= k; b *= k; }  // defensive; validated elsewhere
  float v = 1 / (1 - a / 2 - b / 2);  // cruise speed so the total distance is 1
  if (p < a) return v * p * p / (2 * a);
  if (p <= 1 - b) return v * (a / 2 + (p - a));
  float q = 1 - p;
  return 1 - v * q * q / (2 * b);
}

// A colour value 0xWWRRGGBB faded per component. A fade between a colour
// and a white level passes through "both set" — the light shows white as
// soon as W > 0 (the floods can't mix), so such a fade snaps to white early.
inline int32_t pm_lerp_colour(int32_t a, int32_t b, float e) {
  int32_t out = 0;
  for (int shift = 0; shift < 32; shift += 8) {
    int32_t ca = (a >> shift) & 0xFF, cb = (b >> shift) & 0xFF;
    int32_t c = ca + (int32_t)lroundf((float)(cb - ca) * e);
    out |= (c < 0 ? 0 : c > 0xFF ? 0xFF : c) << shift;
  }
  return out & 0x7FFFFFFF;
}

struct PmRamp {
  bool active = false;
  bool colour = false;  // per-component (0xWWRRGGBB) instead of one level
  int32_t from = 0, to = 0;
  int64_t start_us = 0;
  uint32_t dur_us = 0;
  uint8_t ease_in = 0, ease_out = 0;  // percent

  void begin(int32_t f, int32_t t, int64_t start, uint32_t dur_ms, uint8_t ein, uint8_t eout, bool col = false) {
    from = f;
    to = t;
    start_us = start;
    dur_us = dur_ms * 1000u;
    ease_in = ein;
    ease_out = eout;
    colour = col;
    active = true;
  }

  // Value at `now_us`; clears `active` once the end is reached.
  int32_t at(int64_t now_us) {
    if (!dur_us || now_us >= start_us + (int64_t)dur_us) {
      active = false;
      return to;
    }
    float p = now_us <= start_us ? 0.0f : (float)(now_us - start_us) / (float)dur_us;
    float e = pm_ease(ease_in, ease_out, p);
    if (colour) return pm_lerp_colour(from, to, e);
    return from + (int32_t)lroundf((float)(to - from) * e);
  }
};

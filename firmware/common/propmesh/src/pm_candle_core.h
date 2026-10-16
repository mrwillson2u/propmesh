// The electric candle's flicker and flame swing, as a pure model: no pins,
// no clock, no Arduino. pm_candle.cpp drives the LED and coil from it;
// the host tests run it for simulated hours. docs/generic-boards.md §6n.
//
// Ported from reference/candle_esp32.ino (the candle prop's own sketch):
//  - LED: a slow wander, a fast shimmer, random gusts (fast dips at
//    8-12 Hz under an envelope) and rare sputters (a near-blowout with
//    stutters, then an overshoot) — gaps between events are exponential,
//    so it never feels periodic.
//  - Coil: kicks near the flame's own swing frequency. At rest, bursts of
//    3-5 kicks then 0.5-1.5 s of rest (the stock board's pattern); during
//    a gust, continuous longer kicks in phase so the swing builds.
// Dropped from the sketch: its auto-off timer and mode switch (the show
// schedule does that), battery compensation (a board-wide battery sense
// will do it for every output), the IR input and the serial tuning keys
// (console settings instead).
#pragma once
#include <math.h>
#include <stdint.h>
#include "pm_config.h"

#define PM_CANDLE_TICK_MS 5  // the sketch's 200 Hz flicker update

class PmCandleCore {
 public:
  void begin(const PmCandleCfg &cfg, uint32_t now_ms, uint32_t seed) {
    c = cfg;
    rng = seed ? seed : 0x9E3779B9u;
    wander = wander_to = 0.85f;
    shimmer = shimmer_to = 0;
    next_wander = next_shimmer = now_ms;
    gust_on = sputter_on = false;
    next_gust = now_ms + (uint32_t)(exp_rand((float)c.gust_s) * 1000);
    next_sputter = c.sputter_s ? now_ms + (uint32_t)(exp_rand((float)c.sputter_s) * 1000) : 0;
    next_kick = now_ms;
    kicks_left = 0;
  }

  // Brightness 0..1 for the LED at `now`, before gamma. Call every tick
  // (dt_ms since the last call).
  float led(uint32_t now, uint32_t dt_ms) {
    float d = c.drama10 / 10.0f;
    if (due(now, next_wander)) {
      wander_to = range(0.76f, 0.92f);
      next_wander = now + (uint32_t)range(300, 1500);
    }
    wander += (wander_to - wander) * clampf(dt_ms / 600.0f, 0, 1);
    if (due(now, next_shimmer)) {
      shimmer_to = range(-0.05f, 0.05f) * d;
      next_shimmer = now + (uint32_t)range(40, 120);
    }
    shimmer += (shimmer_to - shimmer) * 0.25f;

    if (!gust_on && !sputter_on && due(now, next_gust)) {
      gust(now);
      next_gust = now + (uint32_t)(exp_rand((float)c.gust_s) * 1000);
    }
    if (c.sputter_s && !sputter_on && due(now, next_sputter)) {
      sputter(now);
      next_sputter = now + (uint32_t)(exp_rand((float)c.sputter_s) * 1000);
    }

    float env = envelope(now), g = 1.0f;
    if (env > 0) {
      gust_phase += (dt_ms / 1000.0f) * gust_hz * range(0.85f, 1.15f);
      g = 1.0f - gust_depth * env * dip(gust_phase);
    }
    float b = (wander + shimmer) * g * sputter_mult(now);
    return clampf(b, c.floor / 100.0f, 1.0f);
  }

  // Width of a coil kick that starts at `now` (ms), or 0 for none.
  uint16_t kick(uint32_t now) {
    if (!due(now, next_kick)) return 0;
    float period = 100000.0f / (c.swing_chz ? c.swing_chz : 1);
    if (gust_on || sputter_on) {
      // Pump in phase for the whole gust: the swing builds.
      next_kick = now + (uint32_t)(period * (1.0f + 0.02f * range(-1, 1)));
      kicks_left = 0;
      return c.coil ? (uint16_t)(c.kick_ms * 1.4f) : 0;
    }
    if (kicks_left <= 0) {
      kicks_left = irange(3, 5);
      next_kick = now + (uint32_t)irange(500, 1500);
      return 0;
    }
    kicks_left--;
    next_kick = now + (uint32_t)(period * (1.0f + 0.05f * range(-1, 1)));
    return c.coil ? c.kick_ms : 0;
  }

  void gust(uint32_t now) {
    gust_on = true;
    gust_start = now;
    gust_dur = (uint32_t)range(600, 2200);
    gust_depth = clampf(range(0.5f, 0.8f) * c.drama10 / 10.0f, 0, 0.92f);
    gust_hz = range(8.0f, 12.0f);
  }
  void sputter(uint32_t now) {
    sputter_on = true;
    sputter_start = now;
    next_stutter = now;
    gust(now);
    gust_dur = 1600;
  }
  bool gusting() const { return gust_on || sputter_on; }

 private:
  static float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
  static float lerpf(float a, float b, float t) { return a + (b - a) * clampf(t, 0, 1); }
  static bool due(uint32_t now, uint32_t at) { return (int32_t)(now - at) >= 0; }
  float rand01() {  // xorshift32
    rng ^= rng << 13; rng ^= rng >> 17; rng ^= rng << 5;
    return (rng >> 8) * (1.0f / 16777216.0f);
  }
  float range(float a, float b) { return a + (b - a) * rand01(); }
  int irange(int a, int b) { return a + (int)(rand01() * (b - a + 1)); }
  float exp_rand(float mean) { return -logf(1.0f - rand01() * 0.9999f) * mean; }

  float envelope(uint32_t now) {
    if (!gust_on) return 0;
    float t = (float)(now - gust_start), d = (float)gust_dur;
    if (t >= d) { gust_on = false; return 0; }
    if (t < 150) return t / 150.0f;
    if (t < 0.6f * d) return 1.0f;
    float x = 1.0f - (t - 0.6f * d) / (0.4f * d);
    return x * x;
  }
  static float dip(float phase) {  // falls fast, recovers slow
    float p = phase - floorf(phase);
    return p < 0.3f ? p / 0.3f : 1.0f - (p - 0.3f) / 0.7f;
  }
  float sputter_mult(uint32_t now) {
    if (!sputter_on) return 1.0f;
    uint32_t t = now - sputter_start;
    if (t < 80) return lerpf(1.0f, 0.05f, t / 80.0f);
    if (t < 700) {
      if (due(now, next_stutter)) {
        stutter = range(0.03f, 0.45f);
        next_stutter = now + (uint32_t)range(30, 70);
      }
      return stutter;
    }
    if (t < 1100) return lerpf(0.45f, 1.18f, (t - 700) / 400.0f);  // overshoot
    if (t < 1500) return lerpf(1.18f, 1.0f, (t - 1100) / 400.0f);
    sputter_on = false;
    return 1.0f;
  }

  PmCandleCfg c;
  uint32_t rng = 1;
  float wander = 0.85f, wander_to = 0.85f, shimmer = 0, shimmer_to = 0;
  uint32_t next_wander = 0, next_shimmer = 0;
  bool gust_on = false, sputter_on = false;
  uint32_t gust_start = 0, gust_dur = 0, next_gust = 0;
  float gust_depth = 0, gust_hz = 10, gust_phase = 0;
  uint32_t sputter_start = 0, next_sputter = 0, next_stutter = 0;
  float stutter = 0.05f;
  uint32_t next_kick = 0;
  int kicks_left = 0;
};

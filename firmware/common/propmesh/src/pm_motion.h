// Smooth motion for an output: a position that follows a target with a
// speed limit and an acceleration limit (a trapezoidal profile), stepped
// at ~50 Hz. Retargeting mid-move keeps the current velocity, so a
// stream of targets (a dragged slider, live scrub later) becomes one
// fluid motion rather than a stutter of restarts — the reason this is a
// follower and not a fixed per-move easing curve.
//
// Units are the channel's value units (servo 0..1000). Header-only, no
// Arduino/ESP includes: tested host-native.
#pragma once
#include <math.h>
#include <stdint.h>

struct PmMotion {
  float pos = 0;      // current value
  float vel = 0;      // value units per ms, signed
  float target = 0;
  // Hard travel limits. Reversing mid-move carries the position on a
  // little while it brakes; near an end that would pass the end stop.
  float lo = 0, hi = 1000;

  // `travel_ms`: time for a full 0..1000 sweep at cruise speed (0 = jump).
  // `ease_ms`: time to reach cruise speed from rest (0 = no ramp-up).
  // Returns true while still moving.
  bool step(float dt_ms, uint16_t travel_ms, uint16_t ease_ms) {
    if (!travel_ms) {
      pos = target;
      vel = 0;
      return false;
    }
    float vmax = 1000.0f / travel_ms;
    float accel = ease_ms ? vmax / ease_ms : 1e9f;
    float d = target - pos;
    float dist = fabsf(d);
    if (dist < 0.5f && fabsf(vel) < accel * dt_ms) {  // arrived
      pos = target;
      vel = 0;
      return false;
    }
    // Fastest speed from which we can still stop at the target, capped
    // at cruise; then move the velocity toward it by at most accel*dt.
    float want = sqrtf(2.0f * accel * dist);
    if (want > vmax) want = vmax;
    if (d < 0) want = -want;
    float dv = want - vel, lim = accel * dt_ms;
    vel += dv > lim ? lim : dv < -lim ? -lim : dv;
    float nxt = pos + vel * dt_ms;
    // Never overshoot: a servo past its end stop is a crashed prop.
    if ((d > 0 && nxt > target) || (d < 0 && nxt < target)) {
      pos = target;
      vel = 0;
      return false;
    }
    if (nxt < lo || nxt > hi) {  // braking carried it to an end: stop there
      pos = nxt < lo ? lo : hi;
      vel = 0;
      return pos != target;
    }
    pos = nxt;
    return true;
  }

  // Put the follower at a known position, at rest (first command to a
  // limp servo, or a calibration pulse).
  void jump(float to) { pos = target = to; vel = 0; }
};

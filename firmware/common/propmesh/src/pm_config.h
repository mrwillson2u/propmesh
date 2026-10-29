// Node configuration for generic boards: which pins the user assigned to
// which function. Each assignment creates a logical channel — (kind,
// index), e.g. SERVO_2 — and that is all the mesh ever addresses; GPIO
// numbers stay inside the node. docs/generic-boards.md.
//
// Header-only and free of Arduino/ESP includes so it runs in the
// host-native tests.
#pragma once
#include <stdint.h>
#include <string.h>
#include "boards_gen.h"

#define PM_MAX_CHANNELS 16
#define PM_LABEL_LEN 24
#define PM_NAME_LEN 32

#define PM_SERVO_MIN_US 400
#define PM_SERVO_MAX_US 2600
// The two ends must be at least this far apart — a guard against
// saving a calibration with both ends captured at the same spot.
#define PM_SERVO_MIN_TRAVEL_US 50
// Smoothing limits (pm_motion.h): a full sweep slower than 10 s, or a
// ramp-up over 5 s, is a misconfiguration, not a prop.
#define PM_MAX_TRAVEL_MS 10000
#define PM_MAX_EASE_MS 5000
#define PM_STRIP_MAX_PIXELS 300

enum { PM_PULL_NONE = 0, PM_PULL_UP = 1, PM_PULL_DOWN = 2 };
// Color order on the wire (LED_STRIP / SPI_STRIP). WS2812 is GRB, SK9822 BGR.
enum { PM_ORDER_GRB = 0, PM_ORDER_RGB = 1, PM_ORDER_BGR = 2 };
// What a strip shows: the color it is set to, or a running effect that
// the set value only switches on (any color) and off (0).
enum { PM_EFFECT_SOLID = 0, PM_EFFECT_FIRE = 1 };

// Fire2023 (pm_fire.h) on a strip laid out as a w × h matrix of vertical
// columns — the lantern prop's values are the defaults.
struct PmFireCfg {
  uint8_t w = 2, h = 4;
  bool zigzag = true;         // each column runs back the other way (serpentine)
  uint8_t brightness = 128;   // output scale 0-255
  uint8_t speed = 2;          // how fast the flame noise moves
  uint8_t flame10 = 30;       // flame height × 10 (3.0): higher = taller flames
  uint8_t noise = 0;          // flame noise scale: small = soft, big = blinky
  uint8_t smoke_speed = 25;
  uint8_t smoke_dim = 250;    // smoke thickness: lower = brighter flames
  uint8_t smoke_scale = 125;
  bool from_top = false;      // the strip starts at the top (its data comes in from above)
};

// Column x, row y (0 = top, h-1 = bottom, where the fire is seeded) ->
// pixel. The first column starts at the bottom, or with from_top at the
// top; with zigzag each column runs back the other way (the lantern, rows
// top to bottom: {3,4, 2,5, 1,6, 0,7}).
inline uint16_t pm_fire_pixel(const PmFireCfg &f, uint8_t x, uint8_t y) {
  bool down = (f.zigzag && (x & 1)) != f.from_top;
  return (uint16_t)x * f.h + (down ? y : (f.h - 1 - y));
}

// CANDLE (pm_candle_core.h): an electric candle's LED and the coil that
// swings its flame, from the candle sketch in reference/ (docs §6n).
// Every field is a console knob; the defaults are the sketch's.
struct PmCandleCfg {
  uint8_t drama10 = 10;       // scales every effect × 10: 0 = calm, 10 = normal, 15 = wild
  uint8_t floor = 3;          // dimmest the flame ever gets, % (0-30)
  uint8_t gust_s = 18;        // mean seconds between gusts (2-255)
  uint16_t sputter_s = 150;   // mean seconds between near-blowouts; 0 = never (max 3600)
  uint16_t swing_chz = 270;   // flame swing frequency, Hz × 100 (50-800): match the flame's own
  uint8_t kick_ms = 25;       // coil pulse width (4-80)
  bool coil = true;           // swing the flame at all
  // Draft (docs §6n): candles with the same draft (1-8) gust and sputter
  // together, decided from the shared mesh clock — no messages. 0 = alone.
  uint8_t draft = 0;
};
#define PM_CANDLE_MAX_SPUTTER_S 3600

struct PmChannelCfg {
  uint8_t kind = 0;   // pm_channel_kind_t
  uint8_t index = 0;  // 1-based: SERVO_1, SERVO_2…
  uint8_t pin_count = 0;
  uint8_t pins[PM_FN_MAX_PINS] = {};
  char label[PM_LABEL_LEN] = {};  // "coffin lid"
  bool active_low = false;        // RELAY, DIGITAL_IN
  uint8_t pull = PM_PULL_NONE;    // DIGITAL_IN
  // SERVO ends of travel: the pulse at value 0 and at value 1000.
  // min_us > max_us is allowed and is what "reverse" means — the
  // console's Reverse box swaps the two (decided 2026-10-05).
  uint16_t min_us = 500;
  uint16_t max_us = 2500;
  // SERVO smoothing (pm_motion.h): time for a full 0-100 % sweep at
  // cruise speed, and time to reach that speed. 0/0 = snap (default).
  uint16_t travel_ms = 0;
  uint16_t ease_ms = 0;
  uint8_t light_id = 1;           // BLE_LIGHT: the light's number in the BRMesh app
  uint16_t pixels = 30;           // LED_STRIP / SPI_STRIP
  uint8_t order = PM_ORDER_GRB;   // strips: color order on the wire
  uint8_t effect = PM_EFFECT_SOLID;
  PmFireCfg fire;                 // when effect == PM_EFFECT_FIRE
  PmCandleCfg candle;             // CANDLE (active_low: the LED is on when its pin is LOW)
  // BATTERY: the divider's ratio × 100 — (R_top + R_bottom) / R_bottom; 100k / 100k = 200.
  uint16_t batt_div100 = 200;
};

inline bool pm_kind_is_strip(uint8_t kind) {
  return kind == PM_CHANNEL_KIND_LED_STRIP || kind == PM_CHANNEL_KIND_SPI_STRIP;
}

struct PmNodeConfig {
  char name[PM_NAME_LEN] = {};
  // A bridge drives no pins: it is the console's way into the mesh and
  // the mesh's clock (it outranks every plain node in the conductor
  // election). docs/generic-boards.md §1.
  bool bridge = false;
  // BRMesh BLE lights (BLE_LIGHT channels): the 4-byte key from the
  // BRMesh app. A secret of sorts — kept only here, never in the repo.
  bool has_brmesh_key = false;
  uint8_t brmesh_key[4] = {};
  // Bridge only: the home WiFi it joins so the console can reach it over
  // the network (docs §6d). The mesh follows whatever channel the router
  // puts the bridge on. The password is written, never read back.
  char wifi_ssid[33] = {};
  char wifi_pass[65] = {};
  // Power: a board on a battery is a LEAF — it never relays, so the mesh
  // never depends on it (software-plan: "powered nodes relay; battery
  // nodes never relay"). Deep sleep between triggers comes next (docs
  // §6f). false = mains/USB, the default.
  bool battery = false;
  // Sleep on battery (docs §6f). Show tier: the radio listens `sleep_window_ms`
  // of every `sleep_interval_ms` while the show runs. Off tier: deep sleep,
  // waking every `sleep_checkin_min` minutes (and on the sensor pins).
  uint16_t sleep_interval_ms = 1000;
  uint16_t sleep_window_ms = 100;
  uint32_t sleep_checkin_ms = 300000;  // 5 min
  // Battery repeater (docs §6m): while the show runs, stay fully awake and
  // relay for other boards instead of listening in windows; the off tier
  // is unchanged. Ignored unless `battery`.
  bool sleep_relay = false;
  uint8_t channel_count = 0;
  PmChannelCfg channels[PM_MAX_CHANNELS];
};

// strlcpy is not in every host libc; this is, and always terminates.
inline void pm_copy(char *dst, const char *src, size_t cap) {
  size_t n = src ? strlen(src) : 0;
  if (n >= cap) n = cap - 1;
  memcpy(dst, src, n);
  dst[n] = 0;
}

inline const pm_function_t *pm_function(uint8_t kind) {
  for (uint8_t i = 0; i < PM_FUNCTION_COUNT; i++)
    if (PM_FUNCTIONS[i].kind == kind) return &PM_FUNCTIONS[i];
  return nullptr;
}

inline const pm_function_t *pm_function_by_name(const char *name) {
  for (uint8_t i = 0; i < PM_FUNCTION_COUNT; i++)
    if (name && !strcmp(PM_FUNCTIONS[i].name, name)) return &PM_FUNCTIONS[i];
  return nullptr;
}

inline const pm_board_pin_t *pm_board_pin(const pm_board_t &b, uint8_t gpio) {
  for (uint8_t i = 0; i < b.pin_count; i++)
    if (b.pins[i].gpio == gpio) return &b.pins[i];
  return nullptr;
}

inline const PmChannelCfg *pm_find_channel(const PmNodeConfig &c, uint8_t kind,
                                           uint8_t index) {
  for (uint8_t i = 0; i < c.channel_count; i++)
    if (c.channels[i].kind == kind && c.channels[i].index == index)
      return &c.channels[i];
  return nullptr;
}

inline int32_t pm_clamp_value(const pm_function_t &f, int32_t v) {
  return v < f.value_min ? f.value_min : v > f.value_max ? f.value_max : v;
}

// Servo value 0..1000 -> pulse width between the channel's end stops
// (min_us at 0, max_us at 1000 — either way round).
inline uint32_t pm_servo_pulse_us(const PmChannelCfg &c, int32_t value) {
  if (value < 0) value = 0;
  if (value > 1000) value = 1000;
  return (uint32_t)((int32_t)c.min_us + ((int32_t)c.max_us - (int32_t)c.min_us) * value / 1000);
}

// Raw pulse for calibration, kept inside the absolute safe range.
inline uint32_t pm_servo_clamp_us(int32_t us) {
  return us < PM_SERVO_MIN_US ? PM_SERVO_MIN_US : us > PM_SERVO_MAX_US ? PM_SERVO_MAX_US : (uint32_t)us;
}

// Where a raw pulse falls between the end stops, as a 0..1000 value
// (clamped) — so the normal slider can show a calibration position.
inline int32_t pm_servo_value_of(const PmChannelCfg &c, uint32_t us) {
  int32_t span = (int32_t)c.max_us - (int32_t)c.min_us;
  if (!span) return 0;
  int32_t v = ((int32_t)us - (int32_t)c.min_us) * 1000 / span;
  return v < 0 ? 0 : v > 1000 ? 1000 : v;
}

// Fraction (0..1000) of full scale -> LEDC duty at `bits` resolution.
inline uint32_t pm_duty(int32_t permille, uint8_t bits) {
  if (permille < 0) permille = 0;
  if (permille > 1000) permille = 1000;
  return (uint32_t)(((uint64_t)permille * ((1u << bits) - 1) + 500) / 1000);
}

// Pulse width -> LEDC duty for a PWM of `hz` at `bits` resolution.
inline uint32_t pm_pulse_duty(uint32_t us, uint32_t hz, uint8_t bits) {
  return (uint32_t)(((uint64_t)us * hz * (1u << bits)) / 1000000);
}

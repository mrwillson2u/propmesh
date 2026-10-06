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
#define PM_STRIP_MAX_PIXELS 300

enum { PM_PULL_NONE = 0, PM_PULL_UP = 1, PM_PULL_DOWN = 2 };

struct PmChannelCfg {
  uint8_t kind = 0;   // pm_channel_kind_t
  uint8_t index = 0;  // 1-based: SERVO_1, SERVO_2…
  uint8_t pin_count = 0;
  uint8_t pins[PM_FN_MAX_PINS] = {};
  char label[PM_LABEL_LEN] = {};  // "coffin lid"
  bool active_low = false;        // RELAY, DIGITAL_IN
  uint8_t pull = PM_PULL_NONE;    // DIGITAL_IN
  uint16_t min_us = 500;          // SERVO: pulse at value 0
  uint16_t max_us = 2500;         // SERVO: pulse at value 1000
  uint16_t pixels = 30;           // LED_STRIP
};

struct PmNodeConfig {
  char name[PM_NAME_LEN] = {};
  // A bridge drives no pins: it is the console's way into the mesh and
  // the mesh's clock (it outranks every plain node in the conductor
  // election). docs/generic-boards.md §1.
  bool bridge = false;
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

// Servo value 0..1000 -> pulse width between the channel's end stops.
inline uint32_t pm_servo_pulse_us(const PmChannelCfg &c, int32_t value) {
  if (value < 0) value = 0;
  if (value > 1000) value = 1000;
  return c.min_us + (uint32_t)(c.max_us - c.min_us) * (uint32_t)value / 1000;
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

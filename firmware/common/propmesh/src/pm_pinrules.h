// Is this pin assignment safe on this board? The one place the answer
// lives on the node; console/src/lib/pinRules.ts mirrors it over the
// same generated tables (boards_gen.*) and uses the same issue codes,
// so the UI never offers what the node will refuse. A config with any
// error is rejected whole — the node keeps its previous config.
//
// Header-only, no Arduino/ESP includes: tested host-native.
#pragma once
#include "pm_config.h"

#define PM_MAX_ISSUES 24

struct PmIssue {
  const char *code;  // stable identifier, shared with the console
  bool error;        // false = warning: allowed, but tell the user
  int8_t channel;    // index into config.channels, -1 = whole config
  uint8_t gpio;      // 0xFF = not about one pin
};

struct PmIssues {
  PmIssue items[PM_MAX_ISSUES];
  uint8_t count = 0;
  uint8_t errors = 0;

  void add(const char *code, bool error, int8_t channel, uint8_t gpio = 0xFF) {
    if (error) errors++;  // counted even when the list is full
    if (count < PM_MAX_ISSUES) items[count++] = {code, error, channel, gpio};
  }
  bool has(const char *code) const {
    for (uint8_t i = 0; i < count; i++)
      if (!strcmp(items[i].code, code)) return true;
    return false;
  }
};

inline PmIssues pm_validate(const pm_board_t &board, const PmNodeConfig &cfg) {
  PmIssues out;
  if (cfg.channel_count > PM_MAX_CHANNELS) {
    out.add("too_many_channels", true, -1);
    return out;
  }

  if (cfg.bridge && cfg.channel_count) out.add("bridge_has_pins", true, -1);

  uint16_t ledc = 0, rmt = 0;
  for (uint8_t i = 0; i < cfg.channel_count; i++) {
    const PmChannelCfg &c = cfg.channels[i];
    const pm_function_t *f = pm_function(c.kind);
    if (!f) {
      out.add("unknown_kind", true, i);
      continue;
    }
    if (c.index == 0) out.add("bad_index", true, i);
    for (uint8_t j = 0; j < i; j++)
      if (cfg.channels[j].kind == c.kind && cfg.channels[j].index == c.index)
        out.add("duplicate_channel", true, i);
    if (c.pin_count != f->pin_count) {
      out.add("pin_count", true, i);
      continue;
    }

    for (uint8_t p = 0; p < c.pin_count; p++) {
      uint8_t gpio = c.pins[p];
      const pm_board_pin_t *bp = pm_board_pin(board, gpio);
      if (!bp) {
        out.add("no_such_pin", true, i, gpio);
        continue;
      }
      if (bp->tier == PM_TIER_RESERVED) {
        out.add("pin_reserved", true, i, gpio);
        continue;
      }
      if ((bp->caps & f->need[p]) != f->need[p])
        out.add("pin_cannot", true, i, gpio);
      else if (bp->tier == PM_TIER_CAUTION)
        out.add("pin_caution", false, i, gpio);

      // One pin, one job — across channels and within a 2-pin function.
      bool taken = false;
      for (uint8_t q = 0; q < p; q++) taken |= c.pins[q] == gpio;
      for (uint8_t j = 0; j < i && !taken; j++)
        for (uint8_t q = 0; q < cfg.channels[j].pin_count && q < PM_FN_MAX_PINS; q++)
          taken |= cfg.channels[j].pins[q] == gpio;
      if (taken) out.add("pin_taken", true, i, gpio);

      if (c.kind == PM_CHANNEL_KIND_DIGITAL_IN) {
        if (c.pull == PM_PULL_UP && !(bp->caps & PM_CAP_PULLUP))
          out.add("no_pull", true, i, gpio);
        if (c.pull == PM_PULL_DOWN && !(bp->caps & PM_CAP_PULLDOWN))
          out.add("no_pull", true, i, gpio);
      }
    }

    if (c.kind == PM_CHANNEL_KIND_DIGITAL_IN && c.pull > PM_PULL_DOWN)
      out.add("no_pull", true, i);
    if (c.kind == PM_CHANNEL_KIND_SERVO &&
        (c.min_us < PM_SERVO_MIN_US || c.min_us > PM_SERVO_MAX_US ||
         c.max_us < PM_SERVO_MIN_US || c.max_us > PM_SERVO_MAX_US ||
         (c.min_us > c.max_us ? c.min_us - c.max_us : c.max_us - c.min_us) < PM_SERVO_MIN_TRAVEL_US))
      out.add("servo_range", true, i);
    if (c.kind == PM_CHANNEL_KIND_SERVO &&
        (c.travel_ms > PM_MAX_TRAVEL_MS || c.ease_ms > PM_MAX_EASE_MS))
      out.add("servo_motion", true, i);
    if (c.kind == PM_CHANNEL_KIND_LED_STRIP &&
        (c.pixels == 0 || c.pixels > PM_STRIP_MAX_PIXELS))
      out.add("pixel_count", true, i);

    ledc += f->ledc;
    rmt += f->rmt;
  }
  if (ledc > board.ledc_channels) out.add("pwm_budget", true, -1);
  if (rmt > board.rmt_tx_channels) out.add("strip_budget", true, -1);
  return out;
}

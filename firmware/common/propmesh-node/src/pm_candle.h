// CANDLE output: drives an electric candle's LED (LEDC PWM, gamma 2.2) and
// flame coil from PmCandleCore (pm_candle_core.h). docs §6n.
#pragma once
#include <stdint.h>
#include "pm_config.h"
#include "pm_candle_core.h"

#define PM_CANDLE_TUNE_MAX_MS 120000

class PmCandle {
 public:
  bool begin(const PmCandleCfg &cfg, uint8_t led_pin, uint8_t coil_pin, bool active_low);
  void end();
  // One tick at `now` (ms) with brightness `level` 0..1000; 0 = out.
  void update(uint32_t now, int32_t level);
  void off();  // LED dark, coil released at once
  void gust(uint32_t now) { core.gust(now); }
  void sputter(uint32_t now) { core.sputter(now); }
  // Steady kicks at chz (Hz × 100) for the swing hunt; 0 stops. Stops by
  // itself after PM_CANDLE_TUNE_MAX_MS: the coil warms under steady kicks.
  void tune(uint16_t chz, uint8_t kick_ms, uint32_t now);

 private:
  void led(float duty);
  PmCandleCore core;
  uint8_t led_pin = 0, coil_pin = 0;
  bool active_low = false, lit = false;
  uint32_t last_ms = 0, tune_until_ms = 0;
  void *timer = nullptr;  // esp_timer_handle_t: ends each coil pulse on time
};

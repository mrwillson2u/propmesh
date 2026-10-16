#include "pm_candle.h"
#include <Arduino.h>
#include <esp_timer.h>
#include <math.h>

#define CANDLE_BITS 12
#define CANDLE_MAX ((1 << CANDLE_BITS) - 1)
#define CANDLE_GAMMA 2.2f

// The coil must never stay energized: every pulse is ended by a one-shot
// timer, not by the main loop, so a stalled loop can't leave it on. Pin
// in `arg`.
static void coil_release(void *arg) { digitalWrite((int)(intptr_t)arg, LOW); }

bool PmCandle::begin(const PmCandleCfg &cfg, uint8_t led_p, uint8_t coil_p, bool low) {
  led_pin = led_p;
  coil_pin = coil_p;
  active_low = low;
  digitalWrite(coil_pin, LOW);  // level first, then direction: never a stray kick
  pinMode(coil_pin, OUTPUT);
  esp_timer_create_args_t a = {};
  a.callback = coil_release;
  a.arg = (void *)(intptr_t)coil_pin;
  a.name = "coil";
  esp_timer_handle_t t = nullptr;
  if (esp_timer_create(&a, &t) != ESP_OK) return false;
  timer = t;
  if (!ledcAttach(led_pin, 1000, CANDLE_BITS)) return false;  // LED_PWM_HZ
  led(0);
  core.begin(cfg, millis(), esp_random());
  return true;
}

void PmCandle::end() {
  off();
  if (timer) { esp_timer_stop((esp_timer_handle_t)timer); esp_timer_delete((esp_timer_handle_t)timer); timer = nullptr; }
  ledcDetach(led_pin);
}

void PmCandle::led(float duty) {
  uint32_t v = (uint32_t)(duty * CANDLE_MAX + 0.5f);
  if (v > CANDLE_MAX) v = CANDLE_MAX;
  ledcWrite(led_pin, active_low ? CANDLE_MAX - v : v);
}

void PmCandle::off() {
  if (core.tuning()) tune(0, 0, millis());
  if (timer) esp_timer_stop((esp_timer_handle_t)timer);
  digitalWrite(coil_pin, LOW);
  led(0);
  lit = false;
}

void PmCandle::tune(uint16_t chz, uint8_t kick_ms, uint32_t now) {
  if (kick_ms && (kick_ms < 4 || kick_ms > 80)) kick_ms = 0;  // the config's limits
  core.tune(chz, kick_ms);
  tune_until_ms = chz ? now + PM_CANDLE_TUNE_MAX_MS : 0;
  if (chz) Serial.printf("candle: tuning — steady %u ms kicks at %u.%02u Hz for up to %d s\n", kick_ms, chz / 100, chz % 100, PM_CANDLE_TUNE_MAX_MS / 1000);
  else Serial.println("candle: tuning off");
}

void PmCandle::update(uint32_t now, int32_t level) {
  if (core.tuning() && (int32_t)(now - tune_until_ms) >= 0) tune(0, 0, now);
  if (level <= 0) { if (lit) off(); return; }
  uint32_t dt = lit ? now - last_ms : PM_CANDLE_TICK_MS;
  if (dt > 100) dt = 100;  // after a stall, don't leap
  last_ms = now;
  lit = true;
  float b = core.led(now, dt);
  led(powf(b, CANDLE_GAMMA) * (level / 1000.0f));
  uint16_t w = core.kick(now);
  if (w && timer) {
    esp_timer_stop((esp_timer_handle_t)timer);
    digitalWrite(coil_pin, HIGH);
    esp_timer_start_once((esp_timer_handle_t)timer, (uint64_t)w * 1000);
  }
}

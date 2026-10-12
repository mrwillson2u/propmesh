#include "pm_config_store.h"
#include <Arduino.h>
#include "pm_ws2812.h"
#include "pm_channels.h"
#include "pm_motion.h"
#include "pm_ramp.h"
#include "pm_show_core.h"  // pm_kind_ramps
#include "pm_ble_tx.h"

// LEDC resolutions. The core shares one timer between channels with the
// same (frequency, resolution), so three PWM classes cost three timers
// however many channels use them. 14 bits is the C3's ceiling and gives
// 1.2 us servo steps; 10 bits is the most 25 kHz allows from 80 MHz.
#define LED_BITS 12
#define SERVO_BITS 14
#define MOTOR_BITS 10
#define DEBOUNCE_MS 30
// Smoothed servos are re-positioned at 50 Hz — the servo's own frame
// rate, so every new pulse width is actually used.
#define MOTION_TICK_MS 20

struct Runtime {
  int32_t value;        // last commanded value (a smoothed servo's target)
  PmMotion motion;      // SERVO with smoothing: where it actually is now
  bool moving;
  PmRamp ramp;          // a sequence ramp in progress (SERVO / LED / MOTOR)
  PmStrip *strip;
  bool raw;             // last sampled input level (active = true)
  uint32_t changed_ms;  // when `raw` last differed from `value`
};

static PmNodeConfig active;
static Runtime rt[PM_MAX_CHANNELS];

// Flood colors survive a reboot (docs §6a): any change marks them dirty,
// and they're saved at most every 10 s — a fade doesn't hammer the flash.
// On boot they're only remembered for the console, never re-sent: the
// lights keep their own color through a power cut.
#define LIGHTS_SAVE_MS 10000
static bool lights_dirty;
static uint32_t lights_saved_ms;

static void save_lights() {
  uint8_t ids[PM_MAX_CHANNELS];
  int32_t vals[PM_MAX_CHANNELS];
  uint8_t n = 0;
  for (uint8_t i = 0; i < active.channel_count; i++)
    if (active.channels[i].kind == PM_CHANNEL_KIND_BLE_LIGHT) { ids[n] = active.channels[i].light_id; vals[n] = rt[i].value; n++; }
  pm_store_lights_save(ids, vals, n);
  lights_dirty = false;
  lights_saved_ms = millis();
}

static void restore_lights() {
  uint8_t ids[PM_MAX_CHANNELS];
  int32_t vals[PM_MAX_CHANNELS];
  uint8_t n = pm_store_lights_load(ids, vals, PM_MAX_CHANNELS);
  for (uint8_t i = 0; i < active.channel_count; i++) {
    if (active.channels[i].kind != PM_CHANNEL_KIND_BLE_LIGHT) continue;
    for (uint8_t k = 0; k < n; k++)
      if (ids[k] == active.channels[i].light_id) rt[i].value = vals[k];  // remembered, not sent
  }
}
static pm_input_handler_t input_handler;

static uint32_t pwm_hz(uint8_t kind) { return pm_function(kind)->pwm_hz; }
static uint32_t last_motion_ms;

static void servo_out(const PmChannelCfg &c, int32_t v) {
  ledcWrite(c.pins[0], pm_pulse_duty(pm_servo_pulse_us(c, v), pwm_hz(c.kind), SERVO_BITS));
}

static bool read_input(const PmChannelCfg &c) {
  return (digitalRead(c.pins[0]) == HIGH) != c.active_low;
}

static void release(const PmChannelCfg &c, Runtime &r) {
  switch (c.kind) {
    case PM_CHANNEL_KIND_LED:
    case PM_CHANNEL_KIND_SERVO:
    case PM_CHANNEL_KIND_MOTOR:
      for (uint8_t p = 0; p < c.pin_count; p++) ledcDetach(c.pins[p]);
      break;
    case PM_CHANNEL_KIND_LED_STRIP:
      if (r.strip) {
        r.strip->end();  // all off, channel released
        delete r.strip;
      }
      break;
  }
  for (uint8_t p = 0; p < c.pin_count; p++) pinMode(c.pins[p], INPUT);
  r = Runtime();
}

static bool attach(const PmChannelCfg &c, Runtime &r) {
  bool ok = true;
  r = Runtime();
  switch (c.kind) {
    case PM_CHANNEL_KIND_RELAY:
      // Level first, direction second: the pin must never drive the
      // "on" level, even for the instant between the two calls.
      digitalWrite(c.pins[0], c.active_low ? HIGH : LOW);
      pinMode(c.pins[0], OUTPUT);
      break;
    case PM_CHANNEL_KIND_LED:
      ok = ledcAttach(c.pins[0], pwm_hz(c.kind), LED_BITS);
      ledcWrite(c.pins[0], 0);
      break;
    case PM_CHANNEL_KIND_SERVO:
      ok = ledcAttach(c.pins[0], pwm_hz(c.kind), SERVO_BITS);
      ledcWrite(c.pins[0], 0);  // no pulses: limp until commanded
      r.value = -1;
      break;
    case PM_CHANNEL_KIND_MOTOR:
      for (uint8_t p = 0; p < 2; p++) {
        ok &= ledcAttach(c.pins[p], pwm_hz(c.kind), MOTOR_BITS);
        ledcWrite(c.pins[p], 0);
      }
      break;
    case PM_CHANNEL_KIND_LED_STRIP:
      r.strip = new PmStrip();
      ok = r.strip->begin(c.pins[0], c.pixels);  // starts all off
      if (!ok) { delete r.strip; r.strip = nullptr; }
      break;
    case PM_CHANNEL_KIND_BLE_LIGHT:
      // No pin. The light keeps whatever it was showing until commanded.
      ok = pm_ble_start();
      pm_ble_set_key(active.brmesh_key);
      break;
    case PM_CHANNEL_KIND_DIGITAL_IN:
      pinMode(c.pins[0], c.pull == PM_PULL_UP ? INPUT_PULLUP
                       : c.pull == PM_PULL_DOWN ? INPUT_PULLDOWN : INPUT);
      r.raw = read_input(c);
      r.value = r.raw;
      break;
  }
  return ok;
}

// Put a level on the pins with no smoothing — a ramp's own interpolation
// is the motion.
static void raw_out(const PmChannelCfg &c, Runtime &r, int32_t v) {
  switch (c.kind) {
    case PM_CHANNEL_KIND_SERVO:
      servo_out(c, v);
      r.motion.jump(v);
      r.moving = false;
      break;
    case PM_CHANNEL_KIND_LED:
      ledcWrite(c.pins[0], pm_duty(v, LED_BITS));
      break;
    case PM_CHANNEL_KIND_MOTOR:
      ledcWrite(c.pins[0], v > 0 ? pm_duty(v, MOTOR_BITS) : 0);
      ledcWrite(c.pins[1], v < 0 ? pm_duty(-v, MOTOR_BITS) : 0);
      break;
    // Color fades (2026-10-07: a flood fade computed perfectly here and
    // sent nothing — these two cases were missing).
    case PM_CHANNEL_KIND_LED_STRIP:
      r.strip->fill((uint32_t)v & 0xFFFFFF);
      r.strip->show();
      break;
    case PM_CHANNEL_KIND_BLE_LIGHT:
      pm_ble_light(c.light_id, (uint32_t)v & 0x7FFFFFFF);
      if (v != r.value) lights_dirty = true;
      break;
  }
  r.value = v;
}

static void write(const PmChannelCfg &c, Runtime &r, int32_t v) {
  r.ramp.active = false;  // a direct set (console slider, all_off) wins over a ramp
  switch (c.kind) {
    case PM_CHANNEL_KIND_RELAY:
      digitalWrite(c.pins[0], (v != 0) != c.active_low ? HIGH : LOW);
      break;
    case PM_CHANNEL_KIND_LED:
      ledcWrite(c.pins[0], pm_duty(v, LED_BITS));
      break;
    case PM_CHANNEL_KIND_SERVO:
      if (v < 0) {  // limp
        ledcWrite(c.pins[0], 0);
        r.moving = false;
      } else if (!c.travel_ms || r.value < 0) {
        // Snap: smoothing off, or the servo was limp — its real position
        // is unknown, so the first move can only be a jump.
        r.motion.jump(v);
        r.moving = false;
        servo_out(c, v);
      } else {
        r.motion.target = v;  // pm_channels_loop() walks it there
        r.moving = true;
      }
      break;
    case PM_CHANNEL_KIND_MOTOR:
      // Drive one input, hold the other low: coasts at 0.
      ledcWrite(c.pins[0], v > 0 ? pm_duty(v, MOTOR_BITS) : 0);
      ledcWrite(c.pins[1], v < 0 ? pm_duty(-v, MOTOR_BITS) : 0);
      break;
    case PM_CHANNEL_KIND_LED_STRIP:
      r.strip->fill((uint32_t)v & 0xFFFFFF);
      r.strip->show();
      break;
    case PM_CHANNEL_KIND_BLE_LIGHT:
      pm_ble_light(c.light_id, (uint32_t)v & 0x7FFFFFFF);  // 0xWWRRGGBB, W 0–127
      if (v != r.value) lights_dirty = true;
      break;
  }
  r.value = v;
}

static int find(uint8_t kind, uint8_t index) {
  for (uint8_t i = 0; i < active.channel_count; i++)
    if (active.channels[i].kind == kind && active.channels[i].index == index)
      return i;
  return -1;
}

bool pm_channels_apply(const PmNodeConfig &cfg) {
  if (lights_dirty) save_lights();  // attach() clears the values below; keep what's pending
  for (uint8_t i = 0; i < active.channel_count; i++)
    release(active.channels[i], rt[i]);
  active = cfg;
  bool ok = true;
  for (uint8_t i = 0; i < active.channel_count; i++)
    ok &= attach(active.channels[i], rt[i]);
  restore_lights();
  return ok;
}

const PmNodeConfig &pm_channels_config() { return active; }

bool pm_channel_set(uint8_t kind, uint8_t index, int32_t value) {
  int i = find(kind, index);
  if (i < 0 || kind == PM_CHANNEL_KIND_DIGITAL_IN) return false;
  write(active.channels[i], rt[i], pm_clamp_value(*pm_function(kind), value));
  return true;
}

bool pm_servo_set_pulse(uint8_t index, uint32_t us) {
  int i = find(PM_CHANNEL_KIND_SERVO, index);
  if (i < 0) return false;
  const PmChannelCfg &c = active.channels[i];
  us = pm_servo_clamp_us((int32_t)us);
  ledcWrite(c.pins[0], pm_pulse_duty(us, pwm_hz(c.kind), SERVO_BITS));
  rt[i].value = pm_servo_value_of(c, us);
  rt[i].motion.jump(rt[i].value);  // smoothing resumes from here
  rt[i].moving = false;
  return true;
}

bool pm_channel_ramp(uint8_t kind, uint8_t index, int32_t to, int64_t start_us,
                     uint32_t dur_ms, uint8_t ease_in, uint8_t ease_out) {
  int i = find(kind, index);
  if (i < 0 || !pm_kind_ramps(kind)) return false;
  const PmChannelCfg &c = active.channels[i];
  Runtime &r = rt[i];
  to = pm_clamp_value(*pm_function(kind), to);
  // A limp servo's position is unknown: nothing to ramp from, so it
  // takes the end value at once.
  int32_t from = (kind == PM_CHANNEL_KIND_SERVO && r.value < 0) ? to : r.value;
  if (kind == PM_CHANNEL_KIND_SERVO && r.moving) from = (int32_t)(r.motion.pos + 0.5f);
  r.moving = false;
  r.ramp.begin(from, to, start_us, dur_ms, ease_in, ease_out, pm_kind_color(kind));
  raw_out(c, r, r.ramp.at(esp_timer_get_time()));
  return true;
}

void pm_channels_freeze() {
  for (uint8_t i = 0; i < active.channel_count; i++) rt[i].ramp.active = false;
}

int32_t pm_channel_get(uint8_t kind, uint8_t index) {
  int i = find(kind, index);
  return i < 0 ? 0 : rt[i].value;
}

void pm_channels_all_off() {
  for (uint8_t i = 0; i < active.channel_count; i++) {
    const PmChannelCfg &c = active.channels[i];
    if (c.kind == PM_CHANNEL_KIND_DIGITAL_IN) continue;
    write(c, rt[i], c.kind == PM_CHANNEL_KIND_SERVO ? -1 : 0);
  }
}

void pm_on_input(pm_input_handler_t handler) { input_handler = handler; }

void pm_channels_loop() {
  uint32_t now = millis();
  pm_ble_loop();
  if (lights_dirty && (uint32_t)(now - lights_saved_ms) >= LIGHTS_SAVE_MS) save_lights();
  uint32_t dt = now - last_motion_ms;
  if (dt >= MOTION_TICK_MS) {
    last_motion_ms = now;
    if (dt > 100) dt = 100;  // after a stall, don't leap
    int64_t now_us = esp_timer_get_time();
    for (uint8_t i = 0; i < active.channel_count; i++) {
      const PmChannelCfg &c = active.channels[i];
      Runtime &r = rt[i];
      if (r.ramp.active) {
        raw_out(c, r, r.ramp.at(now_us));
        continue;
      }
      if (c.kind != PM_CHANNEL_KIND_SERVO || !r.moving) continue;
      r.moving = r.motion.step((float)dt, c.travel_ms, c.ease_ms);
      servo_out(c, (int32_t)(r.motion.pos + 0.5f));
    }
  }
  for (uint8_t i = 0; i < active.channel_count; i++) {
    const PmChannelCfg &c = active.channels[i];
    if (c.kind != PM_CHANNEL_KIND_DIGITAL_IN) continue;
    Runtime &r = rt[i];
    bool level = read_input(c);
    if (level != r.raw) {
      r.raw = level;
      r.changed_ms = now;
    }
    if ((int32_t)level != r.value && (uint32_t)(now - r.changed_ms) >= DEBOUNCE_MS) {
      r.value = level;
      if (input_handler) input_handler(c.index, level);
    }
  }
}

// Channel drivers for generic boards — turns a validated PmNodeConfig
// into live pins and gives every output one entry point,
// pm_channel_set(kind, index, value). Value ranges per kind are in
// boards/functions.yaml:
//   RELAY 0/1 · LED 0..1000 · SERVO 0..1000 (between its end stops)
//   MOTOR -1000..1000 · LED_STRIP 0xRRGGBB · DIGITAL_IN read-only
//   CANDLE 0..1000 (brightness of its flicker; 0 = out)
#pragma once
#include "pm_config.h"

// Called from pm_channels_loop() when a debounced input changes.
typedef void (*pm_input_handler_t)(uint8_t index, bool active);

// Release every pin the old config held, then bring up the new one with
// all outputs off. `cfg` must already have passed pm_validate().
// Returns false if a peripheral refused a pin (config stays applied for
// the channels that did come up).
bool pm_channels_apply(const PmNodeConfig &cfg);

// The config the pins are currently running.
const PmNodeConfig &pm_channels_config();

bool pm_channel_set(uint8_t kind, uint8_t index, int32_t value);

// Ramp a SERVO, LED or MOTOR from its current value to `to`, arriving
// dur_ms after `start_us` (local clock; may be in the past — the output
// then lands on the line, not at its start). Takes over from the
// servo's smoothing until it ends. False for other kinds / no channel.
bool pm_channel_ramp(uint8_t kind, uint8_t index, int32_t to, int64_t start_us,
                     uint32_t dur_ms, uint8_t ease_in, uint8_t ease_out);

// Cancel every running ramp, leaving outputs where they are.
void pm_channels_freeze();

// Calibration: drive a SERVO with a raw pulse width (µs, clamped to
// 400-2600) regardless of its end stops, so a new end can be found
// beyond the current ones.
bool pm_servo_set_pulse(uint8_t index, uint32_t us);

// Last value set (outputs) or current debounced state (inputs).
// Servos report -1 until first commanded: they are left limp, not
// snapped to a position the config can't know is safe.
int32_t pm_channel_get(uint8_t kind, uint8_t index);

// Every output to its off state; servos stop being driven.
void pm_channels_all_off();

// A candle's gust or near-blowout, now (the console's test buttons).
bool pm_candle_event(uint8_t index, bool sputter);
// Steady coil kicks at chz (Hz × 100) to find the flame's own swing; 0 stops.
// kick_ms 0 = the configured width.
bool pm_candle_tune(uint8_t index, uint16_t chz, uint8_t kick_ms);

void pm_on_input(pm_input_handler_t handler);
void pm_channels_loop();

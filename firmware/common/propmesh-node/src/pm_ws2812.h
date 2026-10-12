// WS2812 strips on the RMT peripheral, straight on the IDF driver.
//
// Why not Adafruit_NeoPixel: on the ESP32 it goes through the Arduino
// core's esp32-hal-rmt.c, which links the RMT *receive* driver, a copy
// encoder and carrier code a strip never uses — about 1 KB of IRAM, the
// 128 KB region the WiFi, Bluetooth and flash drivers also live in. With
// those three plus deep sleep the Feather build was 104 bytes over
// (2026-10-11); this driver keeps hardware timing (no bit-banging, no
// interrupts off) and leaves room for Bluetooth and deep sleep on every
// ESP32 build. (FastLED's driver would cost the same and bakes the pin
// in at compile time — pins here come from the console.)
#pragma once
#include "pm_pixels.h"

class PmStrip : public PmPixels {
 public:
  // Claim an RMT channel for `pixels` pixels on `gpio`. False if the
  // chip is out of RMT channels (the profile's strip budget stops this
  // earlier) or memory.
  bool begin(uint8_t gpio, uint16_t pixels, uint8_t order = PM_ORDER_GRB);
  void end() override;  // all off, release the channel and pin
  void show() override;  // send the buffer; returns at once, the hardware clocks it out

 private:
  void *chan = nullptr;  // rmt_channel_handle_t
  void *enc = nullptr;   // rmt_encoder_handle_t
  uint8_t pin = 0;
};

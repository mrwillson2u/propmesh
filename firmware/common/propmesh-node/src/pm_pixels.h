// One face for every addressable strip the node can drive, so the
// channel code and the effects (pm_fire) never care which chip it is:
//   PmStrip   — WS2812 family, one data pin, hardware RMT (pm_ws2812.h)
//   PmApa102  — SK9822 / APA102, data + clock, bit-banged (pm_apa102.h)
#pragma once
#include <stdint.h>
#include "pm_config.h"  // PM_ORDER_*

class PmPixels {
 public:
  virtual ~PmPixels() {}
  virtual void end() = 0;  // all off, release the pins
  virtual void show() = 0;
  uint16_t pixels() const { return n; }
  void fill(uint32_t rgb) {
    for (uint16_t i = 0; i < n; i++) set(i, rgb >> 16, rgb >> 8, rgb);
  }
  // Pixel i = (r, g, b), stored in the wire's color order.
  void set(uint16_t i, uint8_t r, uint8_t g, uint8_t b) {
    if (!buf || i >= n) return;
    uint8_t *p = buf + (size_t)i * 3;
    switch (order) {
      case PM_ORDER_RGB: p[0] = r; p[1] = g; p[2] = b; break;
      case PM_ORDER_BGR: p[0] = b; p[1] = g; p[2] = r; break;
      default:           p[0] = g; p[1] = r; p[2] = b; break;  // GRB
    }
  }

 protected:
  uint8_t *buf = nullptr;  // n * 3 bytes in wire order
  uint16_t n = 0;
  uint8_t order = PM_ORDER_GRB;
};

// SK9822 / APA102 strips: a clocked protocol, so no timing to meet —
// bit-banged on any two output pins, no peripheral, no IRAM, interrupts
// left on. 100 pixels clock out in about a millisecond.
#pragma once
#include "pm_pixels.h"

class PmApa102 : public PmPixels {
 public:
  bool begin(uint8_t data, uint8_t clock, uint16_t pixels, uint8_t order);
  void end() override;
  void show() override;

 private:
  void byte(uint8_t b);
  uint8_t dpin = 0, cpin = 0;
};

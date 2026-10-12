// Fire2023 (Anderas2, via Colin's lantern prop) as a strip effect: two
// layers of Perlin noise — flame and smoke — over a heat map that rises
// through a w × h matrix of vertical columns. The math is FastLED's
// (inoise16, scale8, gradient palette); the output is any PmPixels.
// Every parameter is a console field (PmFireCfg); the defaults are the
// lantern's. docs/generic-boards.md §6h.
#pragma once
#include <stdint.h>
#include "pm_config.h"
#include "pm_pixels.h"

class PmFire {
 public:
  bool begin(const PmFireCfg &cfg, uint16_t pixels);
  void end();
  // Advance the simulation to `now` (ms) and paint the strip. Call every
  // PM_FIRE_TICK_MS; the strip's show() is the caller's.
  void update(uint32_t now, PmPixels &out);

 private:
  uint16_t xy(uint8_t x, uint8_t y) const;
  PmFireCfg c;
  uint16_t n = 0;
  uint8_t *heat = nullptr;   // per pixel
  uint8_t *noise = nullptr;  // 2 layers × w × h
  void *pal = nullptr;       // CRGBPalette32 (FastLED types stay out of this header)
};

#define PM_FIRE_TICK_MS 8  // the lantern's EVERY_N_MILLISECONDS(8)

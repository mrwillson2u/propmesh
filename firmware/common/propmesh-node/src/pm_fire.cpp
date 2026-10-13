#include "pm_fire.h"
#include <string.h>
#include <FastLED.h>  // math only: inoise16, scale8, palettes — no addLeds, no FastLED global

// Roughly matlab's "hot" colormap — the part that most makes it read as
// fire (Fire2023's note). Position, r, g, b.
DEFINE_GRADIENT_PALETTE(pm_fire_hot_gp) {
    27, 0, 0, 0,          // black
    28, 140, 40, 0,       // red
    30, 205, 80, 0,       // orange
    155, 255, 100, 0,
    210, 255, 200, 0,     // yellow
    255, 255, 255, 255    // white
};

enum { FLAME = 0, SMOKE = 1 };

bool PmFire::begin(const PmFireCfg &cfg, uint16_t pixels) {
  end();
  c = cfg;
  n = pixels;
  size_t cells = (size_t)c.w * c.h;
  heat = (uint8_t *)calloc(n, 1);
  noise = (uint8_t *)calloc(2 * cells, 1);
  CRGBPalette32 *p = new (std::nothrow) CRGBPalette32(pm_fire_hot_gp);
  if (!heat || !noise || !p) { end(); return false; }
  pal = p;
  return true;
}

void PmFire::end() {
  free(heat); heat = nullptr;
  free(noise); noise = nullptr;
  delete (CRGBPalette32 *)pal; pal = nullptr;
  n = 0;
}

// Column x, row y (0 = top, h-1 = bottom, where the fire is seeded) ->
// pixel. Columns start at the bottom; with zigzag, odd columns run back
// down (the lantern: {3,4, 2,5, 1,6, 0,7}).
uint16_t PmFire::xy(uint8_t x, uint8_t y) const {
  if (x >= c.w || y >= c.h) return n;  // off the matrix: a guard pixel the caller ignores
  bool down = c.zigzag && (x & 1);
  return (uint16_t)x * c.h + (down ? y : (c.h - 1 - y));
}

void PmFire::update(uint32_t now, PmPixels &out) {
  if (!heat) return;
  const uint8_t W = c.w, H = c.h;
  const uint8_t cx = W / 2, cy = H / 2;
  // Slowly drifting controls so the flame never repeats.
  uint16_t ctrl1 = inoise16(11 * now, 0, 0);
  uint16_t ctrl2 = inoise16(13 * now, 100000, 100000);
  uint16_t ctrl = (ctrl1 + ctrl2) >> 1;

  for (uint8_t layer = 0; layer < 2; layer++) {
    uint32_t speed = layer == FLAME ? c.speed : c.smoke_speed;
    uint32_t nx = 3 * ctrl * speed, ny = 20 * now * speed, nz = 5 * now * speed;
    uint8_t sc = layer == FLAME ? c.noise : c.smoke_scale;
    uint32_t sx = scale8(ctrl1, sc), sy = scale8(ctrl2, sc);
    for (uint8_t x = 0; x < W; x++) {
      uint32_t xo = sx * (uint32_t)(x - cx);
      for (uint8_t y = 0; y < H; y++) {
        uint32_t yo = sy * (uint32_t)(y - cy);
        uint16_t d = inoise16(nx + xo, ny + yo, nz) + 1;
        uint8_t *cell = noise + ((size_t)layer * W + x) * H + y;
        // The lantern's exact arithmetic, truncation included (the look
        // is tuned to it): flame = high byte; smoke = d / dimmer.
        *cell = layer == FLAME ? (uint8_t)(d >> 8) : (uint8_t)(d / (c.smoke_dim ? c.smoke_dim : 1));
      }
    }
  }
  const uint8_t *flame = noise, *smoke = noise + (size_t)W * H;
  auto cellf = [&](uint8_t x, uint8_t y) { return flame[(size_t)x * H + y]; };
  auto cells = [&](uint8_t x, uint8_t y) { return smoke[(size_t)x * H + y]; };

  // Heat rises one row; the bottom row is re-seeded from the flame noise.
  for (uint8_t y = 0; y + 1 < H; y++)
    for (uint8_t x = 0; x < W; x++) {
      uint16_t a = xy(x, y), b = xy(x, y + 1);
      if (a < n && b < n) heat[a] = heat[b];
    }
  for (uint8_t x = 0; x < W; x++) {
    uint16_t i = xy(x, H - 1);
    if (i < n) heat[i] = cellf(x, cy);
  }
  // Cool each cell by the flame noise (taller flames = less cooling),
  // color it from the palette, then veil it with the smoke layer.
  const uint16_t flame10 = c.flame10 ? c.flame10 : 10;
  for (uint8_t y = 0; y < H; y++)
    for (uint8_t x = 0; x < W; x++) {
      uint16_t i = xy(x, y);
      if (i >= n) continue;
      uint8_t dim = (uint8_t)(cellf(x, y) * 10 / flame10);
      dim = 255 - dim;
      heat[i] = scale8(heat[i], dim);
      CRGB px = ColorFromPalette(*(CRGBPalette32 *)pal, heat[i], heat[i], LINEARBLEND);
      px.nscale8(cells(x, y));
      px.nscale8(c.brightness);
      out.set(i, px.r, px.g, px.b);
    }
}

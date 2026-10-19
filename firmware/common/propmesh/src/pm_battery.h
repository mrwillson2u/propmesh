// Battery percentage from voltage, for a 1S lithium cell at rest (open-
// circuit voltage). Under load the voltage sags, so a board that has just
// pulsed a coil or lit a strip reads a little low; the heartbeat's reading
// is an 8-sample average, which smooths the worst of it. Pure, host-tested.
#pragma once
#include <stdint.h>

inline uint8_t pm_lipo_pct(uint16_t mv) {
  // Typical LiPo / Li-ion discharge curve, 5 % steps, resting voltage.
  static const uint16_t v[] = {3270, 3610, 3690, 3710, 3730, 3750, 3770, 3790, 3800, 3820, 3840,
                               3850, 3870, 3910, 3950, 3980, 4020, 4080, 4110, 4150, 4200};
  if (mv <= v[0]) return 0;
  if (mv >= v[20]) return 100;
  for (int i = 1; i <= 20; i++)
    if (mv <= v[i]) return (uint8_t)((i - 1) * 5 + (mv - v[i - 1]) * 5 / (v[i] - v[i - 1]));
  return 100;
}

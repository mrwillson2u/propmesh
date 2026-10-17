// Battery percentage from voltage for a 1S lithium cell at rest — the
// firmware's pm_battery.h table, mirrored so the console can show a
// percent next to the millivolts a board reports. Under load the voltage
// sags, so a board that just pulsed a coil reads a little low.
const V = [3270, 3610, 3690, 3710, 3730, 3750, 3770, 3790, 3800, 3820, 3840,
           3850, 3870, 3910, 3950, 3980, 4020, 4080, 4110, 4150, 4200];
export function lipoPct(mv: number): number {
  if (mv <= V[0]) return 0;
  if (mv >= V[20]) return 100;
  for (let i = 1; i <= 20; i++) if (mv <= V[i]) return Math.floor((i - 1) * 5 + ((mv - V[i - 1]) * 5) / (V[i] - V[i - 1]));
  return 100;
}
// "3.87 V · 62 %"
export const battText = (mv: number) => `${(mv / 1000).toFixed(2)} V · ${lipoPct(mv)} %`;

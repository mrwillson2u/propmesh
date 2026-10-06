// Kept in its own module: the timeline, the step editor and the
// simulated mesh all draw / play the same curve.
// The firmware's curve (pm_ramp.h pm_ease), so the drawn line is the
// line the servo follows: speed up over the first `in` %, cruise, slow
// down over the last `out` %.
export function ease(inPct: number | undefined, outPct: number | undefined, p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let a = (inPct ?? 50) / 100, b = (outPct ?? 50) / 100;
  if (a + b > 1) { const k = 1 / (a + b); a *= k; b *= k; }
  const v = 1 / (1 - a / 2 - b / 2);
  if (p < a) return (v * p * p) / (2 * a);
  if (p <= 1 - b) return v * (a / 2 + (p - a));
  const q = 1 - p;
  return 1 - (v * q * q) / (2 * b);
}


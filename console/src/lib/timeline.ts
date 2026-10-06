// The Timeline's model over a sequence's steps. A track is one output
// (node, kind, index); its steps are keyframes "arrive at value at t",
// and a step's dur_ms/ease is the line leading INTO it (firmware
// pm_ramp.h). Pure functions — the editor calls these and the step
// list sees the same steps.
import type { ChannelKindName } from "./boards_gen";
import { canRamp, newUid, type Sequence, type Step } from "./show";
import { ease } from "./ease";

export { ease };

export interface Track {
  key: string; // "node/KIND_index"
  node: string;
  kind: ChannelKindName;
  index: number;
  steps: number[]; // indexes into sequence.steps, by time
}

export const trackKey = (s: { node: string; kind: string; index: number }) => `${s.node}/${s.kind}_${s.index}`;

export function tracks(seq: Sequence): Track[] {
  const out = new Map<string, Track>();
  seq.steps.forEach((s, i) => {
    const k = trackKey(s);
    if (!out.has(k)) out.set(k, { key: k, node: s.node, kind: s.kind, index: s.index, steps: [] });
    out.get(k)!.steps.push(i);
  });
  for (const t of out.values()) t.steps.sort((a, b) => seq.steps[a].t_ms - seq.steps[b].t_ms || a - b);
  return [...out.values()];
}

// Value range per kind, for the y axis.
export function range(kind: ChannelKindName): [number, number] {
  return kind === "MOTOR" ? [-1000, 1000] : kind === "RELAY" ? [0, 1] : kind === "LED_STRIP" ? [0, 0xffffff] : [0, 1000];
}

// The track's value at time t, or null before anything has set it
// (the output is wherever it was when the sequence started).
export function valueAt(seq: Sequence, track: Track, t: number): number | null {
  let v: number | null = null;
  for (const i of track.steps) {
    const s = seq.steps[i];
    const dur = s.dur_ms ?? 0;
    const start = s.t_ms - dur;
    if (t < start) break;
    if (t >= s.t_ms || dur === 0) { v = s.value; continue; }
    const from = v ?? s.value;
    return from + (s.value - from) * ease(s.ease_in, s.ease_out, (t - start) / dur);
  }
  return v;
}

// Gap from a keyframe back to the previous one on its track (or to the
// sequence start) — the most a ramp into it can last.
export function maxDur(seq: Sequence, track: Track, stepIdx: number): number {
  const at = track.steps.indexOf(stepIdx);
  const s = seq.steps[stepIdx];
  return at > 0 ? s.t_ms - seq.steps[track.steps[at - 1]].t_ms : s.t_ms;
}

const isFull = (seq: Sequence, track: Track, stepIdx: number) =>
  (seq.steps[stepIdx].dur_ms ?? 0) > 0 && (seq.steps[stepIdx].dur_ms ?? 0) >= maxDur(seq, track, stepIdx);

// Move a keyframe. Ramps that spanned the whole gap keep spanning it;
// shorter ones keep their length but never exceed the new gap. The
// next keyframe on the track is adjusted the same way.
export function moveKey(seq: Sequence, stepIdx: number, t_ms: number, value: number): Sequence {
  const before = tracks(seq).find((tr) => tr.steps.includes(stepIdx))!;
  const at = before.steps.indexOf(stepIdx);
  const nextIdx = before.steps[at + 1];
  const selfFull = isFull(seq, before, stepIdx);
  const nextFull = nextIdx !== undefined && isFull(seq, before, nextIdx);

  const steps = seq.steps.map((s, i) => (i === stepIdx ? { ...s, t_ms: Math.max(0, t_ms), value } : { ...s }));
  const out = { ...seq, steps };
  const after = tracks(out).find((tr) => tr.steps.includes(stepIdx))!;
  const fix = (idx: number, full: boolean) => {
    const s = out.steps[idx];
    if (!(s.dur_ms ?? 0)) return;
    const gap = maxDur(out, after, idx);
    s.dur_ms = full ? gap : Math.min(s.dur_ms!, gap);
    if (!s.dur_ms) delete s.dur_ms;
  };
  fix(stepIdx, selfFull);
  if (nextIdx !== undefined) fix(nextIdx, nextFull);
  // Re-sort so the list reads in time order.
  return out;
}

// Add a keyframe on a track at (t, value). On a rampable track the line
// leads into it from the previous keyframe (or from wherever the output
// is, for the first one); switches just jump.
export function addKey(seq: Sequence, track: Omit<Track, "steps" | "key">, t_ms: number, value: number): { seq: Sequence; uid: number } {
  const step: Step = { uid: newUid(), t_ms: Math.max(0, t_ms), node: track.node, kind: track.kind, index: track.index, value };
  const steps = [...seq.steps, step];
  const out = { ...seq, steps };
  const index = steps.length - 1;
  if (canRamp(track.kind)) {
    const tr = tracks(out).find((x) => x.key === trackKey(step))!;
    const gap = maxDur(out, tr, index);
    if (gap > 0) { step.dur_ms = gap; step.ease_in = 50; step.ease_out = 50; }
    // The next key's ramp (if full) now only reaches back to this one.
    const at = tr.steps.indexOf(index);
    const nextIdx = tr.steps[at + 1];
    if (nextIdx !== undefined && (out.steps[nextIdx].dur_ms ?? 0) > 0)
      out.steps[nextIdx] = { ...out.steps[nextIdx], dur_ms: Math.min(out.steps[nextIdx].dur_ms!, maxDur(out, tr, nextIdx)) };
  }
  return { seq: out, uid: step.uid! };
}

// Toggle the line into a keyframe: jump <-> ramp over the whole gap.
// The ease amounts are kept while it's a jump, so toggling back restores
// the shape the user set.
export function toggleRamp(seq: Sequence, stepIdx: number): Sequence {
  const s = seq.steps[stepIdx];
  if (!canRamp(s.kind)) return seq;
  const tr = tracks(seq).find((x) => x.steps.includes(stepIdx))!;
  const gap = maxDur(seq, tr, stepIdx);
  const steps = seq.steps.map((x, i) => {
    if (i !== stepIdx) return x;
    const { dur_ms: _d, ...rest } = x;
    return (x.dur_ms ?? 0) > 0 || gap === 0 ? rest : { ...rest, dur_ms: gap, ease_in: x.ease_in ?? 50, ease_out: x.ease_out ?? 50 };
  });
  return { ...seq, steps };
}

export const snapT = (t: number, grid = 50) => Math.round(t / grid) * grid;
export const snapV = (v: number, kind: ChannelKindName) => {
  const [lo, hi] = range(kind);
  const grid = kind === "RELAY" ? 1 : (hi - lo) / 100; // 1 %
  return Math.max(lo, Math.min(hi, Math.round(v / grid) * grid));
};

// Points along the line into keyframe `stepIdx` for drawing: from the
// previous value (held) through the eased ramp to the key.
export function segmentPoints(seq: Sequence, track: Track, stepIdx: number, n = 24): { t: number; v: number }[] {
  const at = track.steps.indexOf(stepIdx);
  const s = seq.steps[stepIdx];
  const prev = at > 0 ? seq.steps[track.steps[at - 1]] : null;
  const dur = s.dur_ms ?? 0;
  const start = s.t_ms - dur;
  const from = prev ? prev.value : s.value;
  const pts: { t: number; v: number }[] = [];
  if (prev) pts.push({ t: prev.t_ms, v: from });
  if (dur > 0) {
    pts.push({ t: start, v: from });
    for (let i = 1; i <= n; i++) {
      const p = i / n;
      pts.push({ t: start + dur * p, v: from + (s.value - from) * ease(s.ease_in, s.ease_out, p) });
    }
  } else {
    if (prev) pts.push({ t: s.t_ms, v: from }); // hold, then jump
    pts.push({ t: s.t_ms, v: s.value });
  }
  return pts;
}

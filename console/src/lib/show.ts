// The show as the console edits it: show-wide sequences (steps on any
// node) and triggers. There is no show file anywhere but on the nodes —
// each holds its own part of each sequence and the triggers on its own
// sensors (firmware pm_show.*) — so loading reads every node and merges,
// and saving splits a sequence back into per-node parts. A dead bridge
// costs the console, never the show. docs/generic-boards.md.
import { target, type NodeLink, type Reply } from "./transport";
import type { ChannelKindName } from "./boards_gen";
import type { NodeConfig } from "./nodeConfig";
import type { Entry } from "./connection";

// Easing = how much of a ramp is spent speeding up (ease_in %) and
// slowing down (ease_out %), cruising in between (firmware pm_ramp.h).
// The presets are points on that scale; 50/50, 100/0, 0/100 and 0/0
// are exactly the old named curves.
export const EASE_PRESETS: { id: string; label: string; in: number; out: number }[] = [
  { id: "inout", label: "ease in & out", in: 50, out: 50 },
  { id: "gentle", label: "gentle start & stop", in: 30, out: 30 },
  { id: "linear", label: "linear", in: 0, out: 0 },
  { id: "in", label: "ease in", in: 100, out: 0 },
  { id: "out", label: "ease out", in: 0, out: 100 },
  { id: "land", label: "soft landing", in: 15, out: 70 },
];
const LEGACY: Record<string, [number, number]> = { linear: [0, 0], in: [100, 0], out: [0, 100], inout: [50, 50] };

// "Arrive at `value` at t_ms." With dur_ms > 0 it's a ramp from the
// channel's previous value, starting dur_ms earlier — the Timeline's
// line into a keyframe. Only servos, LED dimmers and motors ramp.
export interface Step {
  // Console-only identity: steps are re-sorted as they're edited, so
  // selection and row identity must not ride on array position (adding
  // a key between two others used to retarget edits to the wrong step).
  // Never sent to a board.
  uid?: number;
  t_ms: number;
  node: string; // which node's channel
  kind: ChannelKindName;
  index: number;
  value: number;
  dur_ms?: number;
  ease_in?: number; // % of the ramp spent speeding up
  ease_out?: number; // % spent slowing down; in + out <= 100
}

let uidSeq = 1;
export const newUid = () => uidSeq++;

// Steps in time order (stable: equal times keep their order), with
// every ramp no longer than the gap back to the previous key on its
// output — otherwise two ramps on one servo overlap and the earlier
// key is never reached. The list and the timeline always see this.
// Same sequence content? Ignores the console-only uids (a reload hands
// out new ones) and step order.
export function sameSequence(a: Sequence | null | undefined, b: Sequence | null | undefined): boolean {
  if (!a || !b) return a === b;
  // Explicit fields in a fixed order: JSON.stringify follows property
  // insertion order, which differs between a new and a loaded sequence.
  const norm = (s: Sequence) => JSON.stringify([s.id, s.name, sortSteps(s).steps.map((x) => [
    x.t_ms, x.node, x.kind, x.index, x.value,
    (x.dur_ms ?? 0) > 0 ? x.dur_ms : 0,
    (x.dur_ms ?? 0) > 0 ? x.ease_in ?? 50 : 0,
    (x.dur_ms ?? 0) > 0 ? x.ease_out ?? 50 : 0,
  ])]);
  return norm(a) === norm(b);
}

export function sortSteps(seq: Sequence): Sequence {
  const steps = [...seq.steps].sort((a, b) => a.t_ms - b.t_ms).map((s) => ({ ...s }));
  const prevT = new Map<string, number>();
  for (const s of steps) {
    const k = `${s.node}/${s.kind}_${s.index}`;
    const gap = s.t_ms - (prevT.get(k) ?? 0);
    if ((s.dur_ms ?? 0) > gap) s.dur_ms = gap > 0 ? gap : undefined;
    if (s.dur_ms === undefined) delete s.dur_ms;
    prevT.set(k, s.t_ms);
  }
  return { ...seq, steps };
}

export const RAMP_KINDS: ChannelKindName[] = ["SERVO", "LED", "MOTOR", "LED_STRIP", "BLE_LIGHT"];
export const canRamp = (kind: ChannelKindName) => RAMP_KINDS.includes(kind);

export interface Sequence {
  id: number;
  name: string;
  steps: Step[];
  // Nodes that held a part when loaded — a save must delete the part
  // from any that no longer have steps.
  loadedOn: string[];
  problems: string[]; // per-node problems reported on load
}

export type Edge = "active" | "clear";

export interface Rule {
  node: string; // the sensor's node — where the trigger is stored
  input: number; // DIGITAL_IN index
  on: Edge;
  seq: number;
  cooldown_ms: number;
  enabled: boolean;
}

export interface Show {
  sequences: Sequence[];
  rules: Rule[];
  configs: Record<string, NodeConfig>; // each node's channels, for the pickers
  armed: Record<string, boolean>;
  unreachable: string[]; // nodes that didn't answer during load
}

const ask = (link: NodeLink, en: Entry, cmd: string, body: Record<string, unknown> = {}): Promise<Reply> =>
  target(link, en.usb ? null : en.node).request(cmd, body);

type Wire =
  | [number, ChannelKindName, number, number]
  | [number, ChannelKindName, number, number, number, number, number]
  | [number, ChannelKindName, number, number, number, string]; // named preset, before 2026-10-06

export async function loadShow(link: NodeLink, entries: Entry[]): Promise<Show> {
  const show: Show = { sequences: [], rules: [], configs: {}, armed: {}, unreachable: [] };
  const byId = new Map<number, Sequence>();
  await Promise.all(entries.map(async (en) => {
    try {
      const cfg = await ask(link, en, "get_config");
      const sh = await ask(link, en, "get_show");
      if (!cfg.ok || !sh.ok) throw new Error(cfg.error ?? sh.error);
      show.configs[en.node] = cfg.config as NodeConfig;
      show.armed[en.node] = !!sh.armed;
      for (const r of (sh.rules as Omit<Rule, "node">[]) ?? []) show.rules.push({ ...r, node: en.node });
      // Parts one at a time: each can be up to ~4 kB over the mesh.
      for (const sum of (sh.sequences as { id: number; name: string; problem?: string }[]) ?? []) {
        const part = await ask(link, en, "get_sequence", { seq: sum.id });
        if (!part.ok) continue;
        const p = part.sequence as { id: number; name: string; steps: Wire[] };
        const seq = byId.get(p.id) ?? { id: p.id, name: p.name, steps: [], loadedOn: [], problems: [] };
        if (!seq.name && p.name) seq.name = p.name;
        seq.loadedOn.push(en.node);
        if (sum.problem) seq.problems.push(`${en.hello?.name || en.node}: ${sum.problem}`);
        for (const w of p.steps) {
          const [t_ms, kind, index, value] = w;
          const st: Step = { uid: newUid(), t_ms, node: en.node, kind, index, value };
          if (w.length === 7 && w[4] > 0) { st.dur_ms = w[4]; st.ease_in = w[5]; st.ease_out = w[6]; }
          if (w.length === 6 && w[4] > 0) { st.dur_ms = w[4]; [st.ease_in, st.ease_out] = LEGACY[w[5]] ?? [50, 50]; }
          seq.steps.push(st);
        }
        byId.set(p.id, seq);
      }
    } catch {
      show.unreachable.push(en.node);
    }
  }));
  show.sequences = [...byId.values()].sort((a, b) => a.id - b.id);
  show.sequences.forEach((s) => s.steps.sort((a, b) => a.t_ms - b.t_ms));
  show.rules.sort((a, b) => a.node.localeCompare(b.node) || a.input - b.input);
  return show;
}

export interface SaveResult { failed: { node: string; error: string }[] }

// Push one sequence: each node gets the steps for its own channels;
// nodes that had a part and now have none get it deleted.
export async function saveSequence(link: NodeLink, entries: Record<string, Entry>, seq: Sequence): Promise<SaveResult> {
  const parts = new Map<string, Wire[]>();
  for (const st of [...seq.steps].sort((a, b) => a.t_ms - b.t_ms)) {
    if (!parts.has(st.node)) parts.set(st.node, []);
    const dur = canRamp(st.kind) ? Math.round(st.dur_ms ?? 0) : 0;
    parts.get(st.node)!.push(dur > 0
      ? [Math.round(st.t_ms), st.kind, st.index, Math.round(st.value), Math.min(dur, Math.round(st.t_ms)), st.ease_in ?? 50, st.ease_out ?? 50]
      : [Math.round(st.t_ms), st.kind, st.index, Math.round(st.value)]);
  }
  const failed: SaveResult["failed"] = [];
  const nodes = new Set([...parts.keys(), ...seq.loadedOn]);
  await Promise.all([...nodes].map(async (node) => {
    const en = entries[node];
    if (!en) { failed.push({ node, error: "not on the mesh right now" }); return; }
    const steps = parts.get(node);
    try {
      const r = steps
        ? await ask(link, en, "set_sequence", { sequence: { id: seq.id, name: seq.name, steps } })
        : await ask(link, en, "delete_sequence", { seq: seq.id });
      if (!r.ok) failed.push({ node, error: r.error ?? "refused" });
    } catch (e) {
      failed.push({ node, error: (e as Error).message });
    }
  }));
  return { failed };
}

export async function deleteSequence(link: NodeLink, entries: Record<string, Entry>, seq: Sequence): Promise<SaveResult> {
  return saveSequence(link, entries, { ...seq, steps: [] });
}

// Triggers live on their sensor's node: one set_rules per node,
// including nodes whose last trigger was removed.
export async function saveRules(link: NodeLink, entries: Record<string, Entry>, rules: Rule[], before: Rule[]): Promise<SaveResult> {
  const nodes = new Set([...rules.map((r) => r.node), ...before.map((r) => r.node)]);
  const failed: SaveResult["failed"] = [];
  await Promise.all([...nodes].map(async (node) => {
    const en = entries[node];
    if (!en) { failed.push({ node, error: "not on the mesh right now" }); return; }
    const mine = rules.filter((r) => r.node === node).map(({ node: _n, ...r }) => r);
    try {
      const r = await ask(link, en, "set_rules", { rules: mine });
      if (!r.ok) failed.push({ node, error: r.error ?? "refused" });
    } catch (e) {
      failed.push({ node, error: (e as Error).message });
    }
  }));
  return { failed };
}

export const nextSequenceId = (show: Show) => Math.max(0, ...show.sequences.map((s) => s.id)) + 1;

export const lengthMs = (s: Sequence) => Math.max(0, ...s.steps.map((x) => x.t_ms));

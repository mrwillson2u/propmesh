// The show as the console edits it: show-wide sequences (steps on any
// node) and triggers. There is no show file anywhere but on the nodes —
// each holds its own part of each sequence and the triggers on its own
// sensors (firmware pm_show.*) — so loading reads every node and merges,
// and saving splits a sequence back into per-node parts. A dead bridge
// costs the console, never the show. docs/generic-boards.md.
import { FLOODS, deriveFloods, floodsConfig, readFloodsCopy, type FloodsState } from "./floods";
import { editStamp, target, type NodeLink, type Reply } from "./transport";
import type { ChannelKindName } from "./boards_gen";
import type { NodeConfig } from "./nodeConfig";
import type { Entry } from "./connection";
import type { ModeStatus } from "./schedule";
import { surveyAsk, surveyBegin, surveyEnd } from "./survey";

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
  const norm = (s: Sequence) => JSON.stringify([s.id, s.name, !!s.ambient, s.ambient ? s.loop_ms ?? 0 : 0, sortSteps(s).steps.map((x) => [
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

export const RAMP_KINDS: ChannelKindName[] = ["SERVO", "LED", "CANDLE", "MOTOR", "LED_STRIP", "SPI_STRIP", "BLE_LIGHT"];
export const canRamp = (kind: ChannelKindName) => RAMP_KINDS.includes(kind);

export interface Sequence {
  id: number;
  name: string;
  // Loops by itself while the show is ambient or armed (porch lights, a
  // fog burst every ten minutes), every loop_ms on the mesh clock — the
  // same period on every board, so their parts stay in step.
  ambient?: boolean;
  loop_ms?: number; // 0/absent = the sequence's own length
  steps: Step[];
  // Boards whose part came from the bridge's copy, not the board itself:
  // the board was away and has not confirmed it holds this edit yet.
  unconfirmed: string[];
  // Nodes that held a part when loaded — a save must delete the part
  // from any that no longer have steps.
  loadedOn: string[];
  problems: string[]; // per-node problems reported on load
}

export type Edge = "active" | "clear";

// A trigger rule (firmware PmRule, software-plan "Console sections"):
// trigger → logic → actions, evaluated on the board that holds it. The
// Show section's rows and the Show Graph edit the same thing.
export interface Rule {
  node: string; // the board the rule is stored on: the sensor's, or (for "after") any board — it hears every cue
  trigger: "sensor" | "after";
  input: number; // sensor: DIGITAL_IN index
  on: Edge; // sensor: fire when it becomes active / clear
  after: number; // after: the sequence whose start triggers this
  delay_ms: number; // wait before the actions ("when X ends" = X's length)
  cooldown_ms: number; // ignore triggers this long after firing
  limit?: { fires: number; window_min: number }; // at most `fires` per window; absent = no limit
  pick: "all" | "random"; // every sequence in seqs, or one at random
  seqs: number[]; // 1–4 sequence ids
  enabled: boolean;
}
export const RULE_MAX_SEQS = 4;

// A rule as a board (or the old simulator) reports it: the full form, or
// the one-sequence form from before 2026-10-12 (input / on / seq).
export function normalizeRule(node: string, raw: Record<string, unknown>): Rule {
  const seqs = Array.isArray(raw.seqs) && raw.seqs.length ? (raw.seqs as number[]) : raw.seq ? [raw.seq as number] : [];
  const lim = raw.limit as { fires?: number; window_min?: number } | undefined;
  return {
    node,
    trigger: raw.trigger === "after" ? "after" : "sensor",
    input: (raw.input as number) ?? 0,
    on: raw.on === "clear" ? "clear" : "active",
    after: (raw.after as number) ?? 0,
    delay_ms: (raw.delay_ms as number) ?? 0,
    cooldown_ms: (raw.cooldown_ms as number) ?? 0,
    limit: lim?.fires && lim.window_min ? { fires: lim.fires, window_min: lim.window_min } : undefined,
    pick: raw.pick === "random" ? "random" : "all",
    seqs,
    enabled: raw.enabled !== false,
  };
}
// What goes to the board: the rule without its node, limit only when set.
export function ruleWire(r: Rule): Record<string, unknown> {
  const { node: _n, limit, ...rest } = r;
  return limit ? { ...rest, limit } : rest;
}

export interface Show {
  sequences: Sequence[];
  rules: Rule[];
  configs: Record<string, NodeConfig>; // each node's channels, for the pickers (floods under FLOODS)
  floods: FloodsState; // the mesh-wide flood lights and which boards send to them
  armed: Record<string, boolean>;
  modes: Record<string, ModeStatus>; // per board: mode, why, what the schedule does next
  unreachable: string[]; // nodes that didn't answer during load, and nothing is known for
  fromBridge: string[]; // nodes that didn't answer; their part shown from the bridge's copy (docs §6k)
  fromLast: string[]; // nodes that didn't answer; their pins and part shown as last read from them
}

const ask = (link: NodeLink, en: Entry, cmd: string, body: Record<string, unknown> = {}): Promise<Reply> =>
  target(link, en.usb ? null : en.node).request(cmd, body);

type Wire =
  | [number, ChannelKindName, number, number]
  | [number, ChannelKindName, number, number, number, number, number]
  | [number, ChannelKindName, number, number, number, string]; // named preset, before 2026-10-06

// `prev`: the last load, for a board that doesn't answer this time — its
// channels are kept for the pickers. `viaBridge`: the console is on a
// bridge, which holds a copy of every board's part; a board that doesn't
// answer is shown from that copy instead of vanishing from the show.
export async function loadShow(link: NodeLink, entries: Entry[], prev: Show | null = null, viaBridge = false): Promise<Show> {
  const show: Show = { sequences: [], rules: [], configs: {}, floods: deriveFloods({}), armed: {}, modes: {}, unreachable: [], fromBridge: [], fromLast: [] };
  const byId = new Map<number, Sequence>();
  const addPart = (node: string, p: { id: number; name: string; ambient?: boolean; loop_ms?: number; steps: Wire[] }, problem?: string, fromCopy = false) => {
    const seq = byId.get(p.id) ?? { id: p.id, name: p.name, steps: [], loadedOn: [], unconfirmed: [], problems: [] };
    if (!seq.name && p.name) seq.name = p.name;
    if (p.ambient) { seq.ambient = true; seq.loop_ms = Math.max(seq.loop_ms ?? 0, p.loop_ms ?? 0) || undefined; }
    seq.loadedOn.push(node);
    if (fromCopy) seq.unconfirmed.push(node);
    if (problem) seq.problems.push(problem);
    for (const w of p.steps) {
      const [t_ms, kind, index, value] = w;
      // Flood steps are the same on every sender: they belong to the Floods pseudo-node.
      const st: Step = { uid: newUid(), t_ms, node: kind === "BLE_LIGHT" ? FLOODS : node, kind, index, value };
      if (w.length === 7 && w[4] > 0) { st.dur_ms = w[4]; st.ease_in = w[5]; st.ease_out = w[6]; }
      if (w.length === 6 && w[4] > 0) { st.dur_ms = w[4]; [st.ease_in, st.ease_out] = LEGACY[w[5]] ?? [50, 50]; }
      seq.steps.push(st);
    }
    byId.set(p.id, seq);
  };
  // The bridge's copy of a board's part: what the console last saved for it.
  const fromBridge = async (node: string) => {
    const idx = await link.request("pull_index", { for: node });
    if (!idx.ok) return false;
    const seqs = (idx.seqs ?? {}) as Record<string, { at: number; del?: boolean }>;
    for (const [id, e] of Object.entries(seqs)) {
      if (e.del) continue;
      const r = await link.request("pull_seq", { for: node, seq: Number(id) });
      if (r.ok && r.sequence) addPart(node, r.sequence as Parameters<typeof addPart>[1], undefined, true);
    }
    const rules = await link.request("pull_rules", { for: node });
    if (rules.ok) for (const r of (rules.rules as Record<string, unknown>[]) ?? []) show.rules.push(normalizeRule(node, r));
    return true;
  };
  await Promise.all(entries.map(async (en) => {
    const sv = await surveyBegin(link, en);  // a free battery board on old firmware sleeps again after
    try {
      const cfg = await surveyAsk(link, sv, "get_config");
      const sh = await surveyAsk(link, sv, "get_show");
      if (!cfg.ok || !sh.ok) throw new Error(cfg.error ?? sh.error);
      show.configs[en.node] = cfg.config as NodeConfig;
      show.armed[en.node] = !!sh.armed;
      // Firmware before the schedule (2026-10-09) reports only armed.
      show.modes[en.node] = sh.mode ? (sh as unknown as ModeStatus)
        : { mode: sh.armed ? "armed" : "off", reason: "old firmware", clock: false, scheduled: false };
      for (const r of (sh.rules as Record<string, unknown>[]) ?? []) show.rules.push(normalizeRule(en.node, r));
      // Parts one at a time: each can be up to ~4 kB over the mesh.
      for (const sum of (sh.sequences as { id: number; name: string; problem?: string }[]) ?? []) {
        const part = await surveyAsk(link, sv, "get_sequence", { seq: sum.id });
        if (!part.ok) continue;
        addPart(en.node, part.sequence as Parameters<typeof addPart>[1], sum.problem ? `${en.hello?.name || en.node}: ${sum.problem}` : undefined);
      }
    } catch {
      // Off the mesh. Its channels from last time (its pins don't change
      // because it is asleep), its part from the bridge's copy, or failing
      // that from the last read — a board going to sleep must not make its
      // steps vanish from a saved sequence (seen in the simulator,
      // 2026-10-24: a reload at the sleep transition showed one step where
      // two were saved, and a save then would have dropped its part).
      const kept = prev?.configs[en.node];
      if (kept) show.configs[en.node] = kept;
      let shown = false;
      if (viaBridge) {
        try { shown = await fromBridge(en.node); } catch { /* the bridge itself didn't answer */ }
      }
      if (shown) {
        show.fromBridge.push(en.node);
        if (prev?.modes[en.node]) show.modes[en.node] = prev.modes[en.node];
      } else {
        let fromLast = false;
        for (const q of prev?.sequences ?? []) {
          const mine = q.steps.filter((st) => st.node === en.node);
          if (!mine.length && !q.loadedOn.includes(en.node)) continue;
          addPart(en.node, { id: q.id, name: q.name, ambient: q.ambient, loop_ms: q.loop_ms, steps: mine.map(toWire) });
          fromLast = true;
        }
        for (const r of prev?.rules ?? []) if (r.node === en.node) { show.rules.push(r); fromLast = true; }
        if (fromLast || kept) { show.fromLast.push(en.node); if (prev?.modes[en.node]) show.modes[en.node] = prev.modes[en.node]; }
        else show.unreachable.push(en.node);
      }
    } finally {
      surveyEnd(link, sv);
    }
  }));
  // The floods: one pseudo-node in the pickers, and each sender's copy of a
  // flood step collapses to one.
  show.floods = deriveFloods(show.configs, viaBridge ? await readFloodsCopy(link) : null);
  for (const [node, cfg] of Object.entries(show.configs))
    show.configs[node] = { ...cfg, channels: (cfg.channels ?? []).filter((c) => c.kind !== "BLE_LIGHT") };
  if (show.floods.lights.length || show.floods.senders.length) show.configs[FLOODS] = floodsConfig(show.floods);
  for (const seq of byId.values()) {
    const seen = new Set<string>();
    seq.steps = seq.steps.filter((s) => {
      if (s.node !== FLOODS) return true;
      const k = [s.t_ms, s.index, s.value, s.dur_ms ?? 0, s.ease_in ?? 50, s.ease_out ?? 50].join("|");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  show.sequences = [...byId.values()].sort((a, b) => a.id - b.id);
  show.sequences.forEach((s) => s.steps.sort((a, b) => a.t_ms - b.t_ms));
  show.rules.sort((a, b) => a.node.localeCompare(b.node) || a.input - b.input);
  return show;
}

// failed: refused, or unreachable with nobody keeping a copy. queued: the
// board didn't answer, but the console is on a bridge, which kept the edit;
// the board pulls it when it's back (firmware pm_sync, docs §6k).
export interface SaveResult { failed: { node: string; error: string }[]; queued: string[]; at: number }
export const isAway = (error: string) => /no reply|not on the mesh|timed out|timeout/i.test(error);

// Push one sequence: each node gets the steps for its own channels;
// nodes that had a part and now have none get it deleted. Flood steps
// (node FLOODS) go into every sender's part — each transmits them, so a
// missing board costs nothing.
// `only`: resend to these boards alone (a board that was away for the
// save and is back), leaving the rest untouched.
// A step as it goes to a board.
function toWire(st: Step): Wire {
  const dur = canRamp(st.kind) ? Math.round(st.dur_ms ?? 0) : 0;
  return dur > 0
    ? [Math.round(st.t_ms), st.kind, st.index, Math.round(st.value), Math.min(dur, Math.round(st.t_ms)), st.ease_in ?? 50, st.ease_out ?? 50]
    : [Math.round(st.t_ms), st.kind, st.index, Math.round(st.value)];
}

export async function saveSequence(link: NodeLink, entries: Record<string, Entry>, seq: Sequence, senders: string[] = [], viaBridge = false, only?: string[]): Promise<SaveResult> {
  const parts = new Map<string, Wire[]>();
  const failed: SaveResult["failed"] = [];
  const queued: string[] = [];
  for (const st of [...seq.steps].sort((a, b) => a.t_ms - b.t_ms)) {
    const w = toWire(st);
    const to = st.node === FLOODS ? senders : [st.node];
    if (st.node === FLOODS && !senders.length && !failed.some((f) => f.node === FLOODS))
      failed.push({ node: FLOODS, error: "no board holds the floods key — tick a sending board in the Floods tab" });
    for (const node of to) {
      if (!parts.has(node)) parts.set(node, []);
      parts.get(node)!.push(w);
    }
  }
  const nodes = new Set([...parts.keys(), ...seq.loadedOn].filter((n) => !only || only.includes(n)));
  const at = editStamp();  // one edit, one stamp on every part
  await Promise.all([...nodes].map(async (node) => {
    const en = entries[node];
    // Through a bridge even a board that's gone gets the write: the bridge
    // keeps the copy for it.
    if (!en && !viaBridge) { failed.push({ node, error: "not on the mesh right now" }); return; }
    const to = en ?? ({ node, usb: false } as Entry);  // addressed through the bridge
    const steps = parts.get(node);
    const away = (error: string) => { if (viaBridge && isAway(error)) queued.push(node); else failed.push({ node, error }); };
    try {
      const r = steps
        ? await ask(link, to, "set_sequence", { at, sequence: {
            id: seq.id, name: seq.name, steps,
            // One period for every board: each part's own length differs.
            ...(seq.ambient ? { ambient: true, loop_ms: Math.max(seq.loop_ms ?? 0, lengthMs(seq), 1000) } : {}),
          } })
        : await ask(link, to, "delete_sequence", { seq: seq.id, at });
      if (!r.ok) away(r.error ?? "refused");
      // Stamped older than what the board holds: it kept its own copy. A
      // console whose clock is behind the board's, or an edit from another
      // console in between. Not saved, and the reload shows what won.
      else if (r.stale) failed.push({ node, error: `it holds a newer edit (${new Date(((r.have_at as number) || 0) * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}) — reload and try again` });
    } catch (e) {
      away((e as Error).message);
    }
  }));
  return { failed, queued, at };
}

export async function deleteSequence(link: NodeLink, entries: Record<string, Entry>, seq: Sequence, viaBridge = false): Promise<SaveResult> {
  return saveSequence(link, entries, { ...seq, steps: [] }, [], viaBridge);
}

// Triggers live on their sensor's node: one set_rules per node,
// including nodes whose last trigger was removed.
export async function saveRules(link: NodeLink, entries: Record<string, Entry>, rules: Rule[], before: Rule[], viaBridge = false): Promise<SaveResult> {
  const nodes = new Set([...rules.map((r) => r.node), ...before.map((r) => r.node)]);
  const failed: SaveResult["failed"] = [];
  const queued: string[] = [];
  const at = editStamp();
  await Promise.all([...nodes].map(async (node) => {
    const en = entries[node];
    if (!en && !viaBridge) { failed.push({ node, error: "not on the mesh right now" }); return; }
    const to = en ?? ({ node, usb: false } as Entry);
    const away = (error: string) => { if (viaBridge && isAway(error)) queued.push(node); else failed.push({ node, error }); };
    const mine = rules.filter((r) => r.node === node).map(ruleWire);
    try {
      const r = await ask(link, to, "set_rules", { rules: mine, at });
      if (!r.ok) away(r.error ?? "refused");
    } catch (e) {
      away((e as Error).message);
    }
  }));
  return { failed, queued, at };
}

export const nextSequenceId = (show: Show) => Math.max(0, ...show.sequences.map((s) => s.id)) + 1;

export const lengthMs = (s: Sequence) => Math.max(0, ...s.steps.map((x) => x.t_ms));

// The Show Graph's model — our own types, independent of the renderer
// (React Flow today; software-plan "Console sections", 2026-10-12). A
// chain of blocks trigger → logic → actions COMPILES to one trigger rule
// (lib/show.ts Rule, firmware PmRule), and a set of rules DECOMPILES to
// chains, so the graph and the Show section's rows are two views of the
// same thing. Positions are the only graph-only state; they're kept in
// the browser, never on the boards.
import type { Edge, Rule, Sequence, Show } from "./show";
import { lengthMs } from "./show";

export type BlockKind = "sensor" | "after" | "delay" | "cooldown" | "lockout" | "pick" | "action";
export const TRIGGER_KINDS: BlockKind[] = ["sensor", "after"];
export const LOGIC_KINDS: BlockKind[] = ["delay", "cooldown", "lockout", "pick"];

// Indexable, as React Flow wants node data to be.
export interface BlockData {
  [key: string]: unknown;
  kind: BlockKind;
  // sensor
  node?: string; input?: number; on?: Edge;
  // after (seq, atEnd = "when it ends": delay of its length), action (seq)
  seq?: number; atEnd?: boolean;
  // after: the board that holds the rule (any — it hears every cue)
  board?: string;
  // delay / cooldown
  ms?: number;
  // lockout
  fires?: number; window_min?: number;
  // pick
  pick?: "all" | "random";
}
export interface Block { id: string; data: BlockData; x: number; y: number }
export interface Wire { id: string; source: string; target: string }
export interface Graph { blocks: Block[]; wires: Wire[] }

export const CATEGORY: Record<BlockKind, "TRIGGER" | "LOGIC" | "ACTION"> = {
  sensor: "TRIGGER", after: "TRIGGER", delay: "LOGIC", cooldown: "LOGIC", lockout: "LOGIC", pick: "LOGIC", action: "ACTION",
};
export const BLOCK_LABEL: Record<BlockKind, string> = {
  sensor: "⊙ Sensor", after: "≡ After a sequence", delay: "⏱ Delay", cooldown: "❄ Cooldown",
  lockout: "⛔ Lockout", pick: "⚄ Random pick", action: "⚡ Play sequence",
};
export const BLOCK_HELP: Record<BlockKind, string> = {
  sensor: "A sensor on a board becomes active (or clear).",
  after: "Another sequence starts — or ends — anywhere on the mesh.",
  delay: "Wait before what follows.",
  cooldown: "After firing, ignore this trigger for a while.",
  lockout: "At most N fires per window — a scare that can't run all night.",
  pick: "Play one of the connected sequences at random, not all of them.",
  action: "Play a sequence.",
};

let uid = 0;
export const newId = (kind: BlockKind) => `${kind}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

// --- compile: chains → rules ---------------------------------------------------

export interface Compiled { rules: Rule[]; unwired: string[] }  // unwired: block ids that are part of no complete chain

export function compile(g: Graph, show: Show): Compiled {
  const byId = new Map(g.blocks.map((b) => [b.id, b]));
  const out = new Map(g.blocks.map((b) => [b.id, [] as string[]]));
  for (const w of g.wires) out.get(w.source)?.push(w.target);
  const used = new Set<string>();
  const rules: Rule[] = [];

  for (const trig of g.blocks.filter((b) => TRIGGER_KINDS.includes(b.data.kind))) {
    // Every path trigger → … → action; paths that share their logic
    // collapse into one rule with several sequences (fan-out).
    type Path = { logic: Block[]; action: Block };
    const paths: Path[] = [];
    const walk = (id: string, logic: Block[], seen: Set<string>) => {
      for (const next of out.get(id) ?? []) {
        const b = byId.get(next);
        if (!b || seen.has(next)) continue;
        if (b.data.kind === "action") paths.push({ logic, action: b });
        else if (LOGIC_KINDS.includes(b.data.kind)) walk(next, [...logic, b], new Set([...seen, next]));
      }
    };
    walk(trig.id, [], new Set([trig.id]));
    if (!paths.length) continue;
    const groups = new Map<string, Path[]>();
    for (const p of paths) {
      const key = p.logic.map((b) => b.id).sort().join("|");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    for (const ps of groups.values()) {
      const logic = ps[0].logic;
      const d = trig.data;
      const afterSeq = show.sequences.find((s) => s.id === d.seq);
      let delay = d.kind === "after" && d.atEnd && afterSeq ? lengthMs(afterSeq) : 0;
      let cooldown = 0, pick: Rule["pick"] = "all", limit: Rule["limit"];
      for (const b of logic) {
        if (b.data.kind === "delay") delay += b.data.ms ?? 0;
        if (b.data.kind === "cooldown") cooldown = Math.max(cooldown, b.data.ms ?? 0);
        if (b.data.kind === "lockout" && b.data.fires) limit = { fires: b.data.fires, window_min: b.data.window_min || 60 };
        if (b.data.kind === "pick" && (b.data.pick ?? "random") === "random") pick = "random";
      }
      const seqs = [...new Set(ps.map((p) => p.action.data.seq ?? 0).filter(Boolean))].slice(0, 4);
      if (!seqs.length) continue;
      rules.push({
        node: d.kind === "sensor" ? d.node ?? "" : d.board || afterSeq?.loadedOn[0] || "",
        trigger: d.kind === "sensor" ? "sensor" : "after",
        input: d.kind === "sensor" ? d.input ?? 0 : 0,
        on: d.on ?? "active",
        after: d.kind === "after" ? d.seq ?? 0 : 0,
        delay_ms: delay, cooldown_ms: cooldown, limit, pick, seqs, enabled: true,
      });
      used.add(trig.id);
      for (const b of logic) used.add(b.id);
      for (const p of ps) used.add(p.action.id);
    }
  }
  return { rules, unwired: g.blocks.filter((b) => !used.has(b.id)).map((b) => b.id) };
}

// --- decompile: rules → chains ---------------------------------------------------

const COL = 250, ROW = 150;

// Stable ids per rule row, so a reload keeps the layout the browser saved.
export function decompile(rules: Rule[], show: Show, saved: Record<string, { x: number; y: number }> = {}): Graph {
  const blocks: Block[] = [];
  const wires: Wire[] = [];
  const at = (id: string, col: number, row: number) => saved[id] ?? { x: 40 + col * COL, y: 40 + row * ROW };
  rules.forEach((r, i) => {
    const seq = (id: number): Sequence | undefined => show.sequences.find((s) => s.id === id);
    const chain: Block[] = [];
    let col = 0;
    const push = (id: string, data: BlockData) => { const p = at(id, col++, i); chain.push({ id, data, ...p }); };
    if (r.trigger === "sensor") push(`r${i}-trig`, { kind: "sensor", node: r.node, input: r.input, on: r.on });
    else {
      const len = seq(r.after) ? lengthMs(seq(r.after)!) : 0;
      const atEnd = len > 0 && r.delay_ms >= len;
      push(`r${i}-trig`, { kind: "after", seq: r.after, atEnd, board: r.node });
      if (atEnd && r.delay_ms > len) push(`r${i}-delay`, { kind: "delay", ms: r.delay_ms - len });
      else if (!atEnd && r.delay_ms) push(`r${i}-delay`, { kind: "delay", ms: r.delay_ms });
    }
    if (r.trigger === "sensor" && r.delay_ms) push(`r${i}-delay`, { kind: "delay", ms: r.delay_ms });
    if (r.cooldown_ms) push(`r${i}-cool`, { kind: "cooldown", ms: r.cooldown_ms });
    if (r.limit) push(`r${i}-lock`, { kind: "lockout", fires: r.limit.fires, window_min: r.limit.window_min });
    if (r.pick === "random") push(`r${i}-pick`, { kind: "pick", pick: "random" });
    for (let k = 1; k < chain.length; k++) wires.push({ id: `w-${chain[k - 1].id}-${chain[k].id}`, source: chain[k - 1].id, target: chain[k].id });
    const last = chain[chain.length - 1];
    r.seqs.forEach((s, k) => {
      const id = `r${i}-act${s}`;
      const p = saved[id] ?? { x: 40 + col * COL, y: 40 + i * ROW + (k - (r.seqs.length - 1) / 2) * 70 };
      blocks.push({ id, data: { kind: "action", seq: s }, ...p });
      wires.push({ id: `w-${last.id}-${id}`, source: last.id, target: id });
    });
    blocks.push(...chain);
  });
  return { blocks, wires };
}

// Rules compare by what the boards store (the order of rules doesn't matter).
export const sameRules = (a: Rule[], b: Rule[]) => {
  const key = (r: Rule) => JSON.stringify({ ...r, seqs: [...r.seqs].sort() });
  return a.length === b.length && a.map(key).sort().join("\n") === b.map(key).sort().join("\n");
};

export const POS_KEY = "propmesh.graph.positions";
export function loadPositions(): Record<string, { x: number; y: number }> {
  try { return JSON.parse(localStorage.getItem(POS_KEY) ?? "{}"); } catch { return {}; }
}
export function savePositions(p: Record<string, { x: number; y: number }>) {
  try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}

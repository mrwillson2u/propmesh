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

export interface Step {
  t_ms: number;
  node: string; // which node's channel
  kind: ChannelKindName;
  index: number;
  value: number;
}

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

type Wire = [number, ChannelKindName, number, number];

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
        const part = await ask(link, en, "get_sequence", { id: sum.id });
        if (!part.ok) continue;
        const p = part.sequence as { id: number; name: string; steps: Wire[] };
        const seq = byId.get(p.id) ?? { id: p.id, name: p.name, steps: [], loadedOn: [], problems: [] };
        if (!seq.name && p.name) seq.name = p.name;
        seq.loadedOn.push(en.node);
        if (sum.problem) seq.problems.push(`${en.hello?.name || en.node}: ${sum.problem}`);
        for (const [t_ms, kind, index, value] of p.steps) seq.steps.push({ t_ms, node: en.node, kind, index, value });
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
    parts.get(st.node)!.push([Math.round(st.t_ms), st.kind, st.index, Math.round(st.value)]);
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
        : await ask(link, en, "delete_sequence", { id: seq.id });
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

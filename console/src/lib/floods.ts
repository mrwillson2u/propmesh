// Flood lights (BRMesh) belong to the whole mesh, not to one board. Every
// board Colin ticks as a *sender* holds the same key and the same light
// list (one BLE_LIGHT channel per light, index = light number), so a cue's
// flood steps go into every sender's part and each of them transmits —
// lose a board, keep the lights. In the console the floods are one
// pseudo-node, FLOODS, next to the real boards. docs/generic-boards.md §6a-ii.
import type { Entry } from "./connection";
import { EMPTY_CONFIG, type ChannelCfg, type NodeConfig } from "./nodeConfig";
import { editStamp, target, type NodeLink } from "./transport";

export const FLOODS = "floods";
export const FLOODS_NAME = "Floods";

export interface Flood { number: number; label: string }

export interface FloodsState {
  key?: string;                 // the mesh-wide key (what most senders hold)
  keys: Record<string, string>; // each sender's key — a difference is a mismatch to resolve
  lights: Flood[];
  senders: string[];            // boards holding a key (never the bridge)
  // Where the key and lights came from: the sending boards, or the
  // bridge's copy because no board on the mesh holds them right now.
  held: "boards" | "bridge" | "none";
}

// The bridge's copy of the floods (pm_sync `/m/floods.json`): the key and
// light list from the last sender that saved them, kept so a mesh whose
// senders are all off still knows its lights (2026-10-24: the DevKit
// senders were unplugged and the Floods tab read as if nothing had ever
// been paired). Null when the connected board isn't a bridge or has none.
export interface FloodsCopy { key: string; lights: Flood[]; at: number }
export async function readFloodsCopy(link: NodeLink): Promise<FloodsCopy | null> {
  try {
    const r = await link.request("pull_floods");
    if (!r.ok || !r.key) return null;
    const lights = ((r.lights as { light: number; label?: string }[]) ?? []).map((l) => ({ number: l.light, label: l.label ?? "" }));
    return { key: String(r.key).toLowerCase(), lights: lights.sort((a, b) => a.number - b.number), at: (r.at as number) ?? 0 };
  } catch { return null; }
}

// What the boards hold now, read off their configs; the bridge's copy
// stands in when no board holds a key.
export function deriveFloods(configs: Record<string, NodeConfig>, copy: FloodsCopy | null = null): FloodsState {
  const keys: Record<string, string> = {};
  const lights = new Map<number, Flood>();
  for (const [node, cfg] of Object.entries(configs)) {
    if (node === FLOODS || cfg.bridge) continue;
    if (cfg.brmesh_key) keys[node] = cfg.brmesh_key.toLowerCase();
    for (const c of cfg.channels ?? []) {
      if (c.kind !== "BLE_LIGHT" || !c.light) continue;
      const have = lights.get(c.light);
      if (!have) lights.set(c.light, { number: c.light, label: c.label });
      else if (!have.label && c.label) have.label = c.label;
    }
  }
  const tally = new Map<string, number>();
  for (const k of Object.values(keys)) tally.set(k, (tally.get(k) ?? 0) + 1);
  const key = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!key && copy) return { key: copy.key, keys, lights: copy.lights.map((l) => ({ ...l })), senders: [], held: "bridge" };
  return { key, keys, lights: [...lights.values()].sort((a, b) => a.number - b.number), senders: Object.keys(keys).sort(), held: key ? "boards" : "none" };
}

export const mismatched = (st: FloodsState) => st.senders.filter((n) => st.keys[n] !== st.key);

const channelFor = (l: Flood): ChannelCfg => ({ kind: "BLE_LIGHT", index: l.number, pins: [], light: l.number, label: l.label });

// The pseudo-node as a config: what the show editor's pickers read.
export function floodsConfig(st: FloodsState): NodeConfig {
  return { ...EMPTY_CONFIG, name: FLOODS_NAME, brmesh_key: st.key, channels: st.lights.map(channelFor) };
}

export interface SyncResult { failed: { node: string; error: string }[] }

// Write the floods set to every sender (same key, same lights) and strip
// it from boards that stopped sending. `keyFrom` resolves a mismatch by
// spreading that board's key.
export async function syncFloods(
  link: NodeLink, entries: Record<string, Entry>, st: FloodsState, senders: string[], keyFrom?: string,
): Promise<SyncResult> {
  const key = keyFrom ? st.keys[keyFrom] : st.key;
  const failed: SyncResult["failed"] = [];
  const nodes = new Set([...senders, ...st.senders]);
  const at = editStamp();  // one edit, one stamp on every sender's copy
  await Promise.all([...nodes].map(async (node) => {
    const en = entries[node];
    if (!en) { failed.push({ node, error: "not on the mesh right now" }); return; }
    const t = target(link, en.usb ? null : node);
    try {
      const r = await t.request("get_config");
      if (!r.ok) throw new Error(r.error ?? "no config");
      const cfg = r.config as NodeConfig;
      const channels = (cfg.channels ?? []).filter((c) => c.kind !== "BLE_LIGHT");
      const next: NodeConfig = { ...cfg, channels };
      if (senders.includes(node)) {
        if (!key) throw new Error("no key yet — pair a light first");
        next.brmesh_key = key;
        next.channels = [...channels, ...st.lights.map(channelFor)];
      } else {
        delete next.brmesh_key;
      }
      const w = await t.request("set_config", { config: next, at });
      if (!w.ok) throw new Error(w.error ?? "refused");
    } catch (e) {
      failed.push({ node, error: (e as Error).message });
    }
  }));
  return { failed };
}

// Pin settings for boards that are asleep (Colin, 2026-10-26 and
// 2026-10-28): this browser keeps a copy of each board's settings, so a
// sleeping board's page shows them and can be edited. A change saved while
// the board is asleep waits here and goes out at its next check-in — the
// first heartbeat after a wake, when it is awake for a few seconds. Like
// "Update when awake", it needs a console tab open; nothing is stored on
// the bridge. docs/console-nodes-list.md §9.
//
// Kept out of the copy: the floods key (brmesh_key) — it lives only on
// the boards — and the WiFi password, which the board never sends.
import { useSyncExternalStore } from "react";
import { getConnection, onHeartbeat, refreshHello, wantsAwake } from "./connection";
import { otaBusy, otaJobs } from "./otaJobs";
import { EMPTY_CONFIG, type NodeConfig } from "./nodeConfig";
import { target } from "./transport";

export interface Waiting {
  config: NodeConfig;   // what to send (no floods key; the board's own is kept)
  base: NodeConfig;     // the copy it was edited from — if the board's differs at delivery, it isn't sent
  at: number;           // when it was saved here, ms
  error?: string;       // the last delivery's problem; a refusal or a clash stops retries until saved again
  stuck?: boolean;      // true: not retried at check-ins (refused, or the board changed underneath)
}
export interface Cached { config: NodeConfig; at: number } // the board's settings as last read, and when
interface Store { cached: Record<string, Cached>; waiting: Record<string, Waiting> }

const KEY = "propmesh.configs.";
let store: Store = { cached: {}, waiting: {} };
let storeFor: string | null = null; // the bridge whose boards these are
let version = 0;
const listeners = new Set<() => void>();
const busy = new Set<string>(); // a check-in visit in progress

function ensure() {
  const bridge = getConnection()?.hello.node ?? null;
  if (bridge === storeFor) return;
  storeFor = bridge;
  store = { cached: {}, waiting: {} };
  if (!bridge) return;
  try {
    const s = JSON.parse(localStorage.getItem(KEY + bridge) ?? "null") as Partial<Store> | null;
    store = { cached: s?.cached ?? {}, waiting: s?.waiting ?? {} };
  } catch { /* private mode or junk: start empty */ }
}
function save() {
  version++;
  listeners.forEach((l) => l());
  if (!storeFor) return;
  try { localStorage.setItem(KEY + storeFor, JSON.stringify(store)); } catch { /* private mode */ }
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
// Re-renders when a copy or a waiting change moves.
export function useConfigCache() {
  useSyncExternalStore(subscribe, () => version);
  ensure();
  return store;
}

// What the copy keeps: everything the editor shows, without the key.
function clean(cfg: NodeConfig): NodeConfig {
  const { brmesh_key: _key, ...rest } = { ...EMPTY_CONFIG, ...cfg };
  if (rest.wifi) rest.wifi = { ssid: rest.wifi.ssid, pass_set: rest.wifi.pass_set };
  return structuredClone(rest);
}
// Same settings, ignoring key order and what the Floods tab owns (the
// lights and the key arrive by sync on their own).
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const sameSettings = (a: NodeConfig, b: NodeConfig) => {
  const strip = (c: NodeConfig) => ({ ...clean(c), channels: c.channels.filter((x) => x.kind !== "BLE_LIGHT") });
  return canon(strip(a)) === canon(strip(b));
};

export function cachedConfig(node: string): Cached | undefined { ensure(); return store.cached[node]; }
export function waitingConfig(node: string): Waiting | undefined { ensure(); return store.waiting[node]; }

// The board's settings were just read from it or saved to it.
export function noteConfig(node: string, cfg: NodeConfig) {
  ensure();
  store = { ...store, cached: { ...store.cached, [node]: { config: clean(cfg), at: Date.now() } } };
  save();
}

// Save for the next check-in. `base` is the copy the edit started from.
export function queueConfig(node: string, config: NodeConfig, base: NodeConfig) {
  ensure();
  store = { ...store, waiting: { ...store.waiting, [node]: { config: clean(config), base: clean(base), at: Date.now() } } };
  save();
  listen();
}
export function dropWaiting(node: string) {
  ensure();
  if (!store.waiting[node]) return;
  const { [node]: _, ...rest } = store.waiting;
  store = { ...store, waiting: rest };
  save();
}
function setWaiting(node: string, p: Partial<Waiting>) {
  const w = store.waiting[node];
  if (!w) return;
  store = { ...store, waiting: { ...store.waiting, [node]: { ...w, ...p } } };
  save();
}

// ---- at a check-in ------------------------------------------------------------
// A board heard awake with a change waiting, or with no copy here yet, is
// visited once: read its settings (the copy), send the waiting change if
// the board still has what the change was made from, then let it sleep
// again. A console request holds a battery board awake 10 min (firmware
// pm_api), so the visit releases it — unless something else wants it up:
// its setup window after a power-on, "stay awake next time", or an update.
let unsub: (() => void) | null = null;
function listen() {
  if (!unsub) unsub = onHeartbeat((node) => void visit(node));
}
// Start listening as soon as a console connects (the first copy of each board).
export function startConfigCache() { ensure(); listen(); }

async function visit(node: string) {
  ensure();
  const c = getConnection();
  const en = c?.entries[node];
  if (!c || !en || en.usb || busy.has(node)) return;
  const w = store.waiting[node];
  if (store.cached[node] && (!w || w.stuck)) return; // nothing to do: don't keep it awake
  busy.add(node);
  const battery = en.hello?.power === "battery";
  // Decided now, before those flows clear their own flags.
  let keep = !battery || wantsAwake(node) || otaBusy(otaJobs()[node]);
  const t = target(c.link, node);
  try {
    if (battery && !keep) {
      const h = await t.request("hello"); // background: holds nothing
      if (h.ok && ((h.hold_s as number | undefined) ?? 0) > 0) keep = true; // switched on by hand, or already held
    }
    const r = await t.request("get_config");
    if (!r.ok) throw new Error(r.error ?? "get_config failed");
    const have = r.config as NodeConfig;
    noteConfig(node, have);
    const now = store.waiting[node];
    if (now && !now.stuck) {
      if (sameSettings(have, now.config)) {
        dropWaiting(node); // it has them already (a save whose reply was lost)
      } else if (!sameSettings(have, now.base)) {
        setWaiting(node, { stuck: true, error: "its settings changed since this edit (another console, or the board) — check them and save again" });
      } else {
        // The floods part is the board's own: keep its key and lights.
        const send: NodeConfig = { ...now.config, channels: [...now.config.channels.filter((x) => x.kind !== "BLE_LIGHT"), ...have.channels.filter((x) => x.kind === "BLE_LIGHT")] };
        if (have.brmesh_key) send.brmesh_key = have.brmesh_key;
        const s = await t.request("set_config", { config: send });
        if (!s.ok) setWaiting(node, { stuck: true, error: `the board refused it: ${s.error ?? "no reason given"}` });
        else {
          noteConfig(node, send);
          if (store.waiting[node]?.at === now.at) dropWaiting(node);
          refreshHello(node); // a new name shows in the list
        }
      }
    }
  } catch (e) {
    // Missed this wake (it went back to sleep first): tried again at the next.
    if (store.waiting[node]) setWaiting(node, { error: `not delivered yet: ${(e as Error).message}` });
  } finally {
    busy.delete(node);
    if (battery && !keep) void t.request("hold_awake", { min: 0 }).catch(() => undefined);
  }
}

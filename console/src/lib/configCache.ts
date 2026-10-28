// Pin settings for boards that are asleep (Colin, 2026-10-26 and
// 2026-10-28). A sleeping board's page shows its settings as last read
// and can be edited; a change saved then goes out at its next check-in —
// the first heartbeat after a wake, when it is awake for a few seconds.
//
// Two places keep the copies (docs/console-nodes-list.md §9):
// - the bridge (firmware pm_copies, hello `copies`): every console sees
//   the same list and settings, and the bridge delivers at the check-in
//   with no console open. This module then only reads and asks it.
// - this browser, for a bridge without it: the copy is per browser and a
//   console tab has to stay open for a delivery.
//
// Kept out of the copy: the floods key (brmesh_key) — it lives only on
// the boards — and the WiFi password, which the board never sends.
import { useSyncExternalStore } from "react";
import { adoptFromBridge, bridgeKeepsCopies, getConnection, onCopyEvent, onHeartbeat, refreshHello, wantsAwake, type CopyEvent } from "./connection";
import { otaBusy, otaJobs } from "./otaJobs";
import { EMPTY_CONFIG, type NodeConfig } from "./nodeConfig";
import { editStamp, target, type NodeHello } from "./transport";
import { setSurveyKeep } from "./survey";

// A survey must not let a board sleep that these want awake (lib/survey).
setSurveyKeep((node) => wantsAwake(node) || otaBusy(otaJobs()[node]) || getConnection()?.selected === node);

export interface Waiting {
  config: NodeConfig;   // what to send (no floods key; the board's own is kept)
  base: NodeConfig;     // the copy it was edited from — if the board's differs at delivery, it isn't sent
  at: number;           // when it was saved here, ms
  error?: string;       // the last delivery's problem; a refusal or a clash stops retries until saved again
  stuck?: boolean;      // true: not retried at check-ins (refused, or the board changed underneath)
}
export interface Cached { config: NodeConfig; at: number; rev?: number } // the board's settings as last read, and when; rev: the bridge's copy
// What the bridge says it holds for a board (get_copies), whether or not
// its settings have been fetched here yet.
interface Summary { rev: number; config: boolean; waiting?: { at: number; stuck?: boolean; error?: string } }
interface Store { cached: Record<string, Cached>; waiting: Record<string, Waiting>; bridge?: boolean; summary?: Record<string, Summary> }

const KEY = "propmesh.configs.";
let store: Store = { cached: {}, waiting: {} };
let storeFor: string | null = null; // the bridge whose boards these are
let version = 0;
const listeners = new Set<() => void>();
const busy = new Set<string>(); // a check-in visit in progress
const notBefore = new Map<string, number>(); // held by something else at its last check-in: not before then (ms)
// Holds a board reports in hello (`hold_s`), as firmware pm_copies_core.h
// reads them: up to the 6 s dwell after a reset is a plain wake; more is
// a sensor wake, a sync pull, the setup window or a console at work.
export const HOLD_DWELL_S = 6;
export const inSetupWindow = (holdS: number) => holdS > 60 && holdS <= 185;

function ensure() {
  const bridge = getConnection()?.hello.node ?? null;
  const onBridge = bridgeKeepsCopies();
  if (bridge === storeFor && !!store.bridge === onBridge) return;
  storeFor = bridge;
  store = { cached: {}, waiting: {} };
  if (!bridge) return;
  if (onBridge) { store = { cached: {}, waiting: {}, bridge: true, summary: {} }; return; }
  try {
    const s = JSON.parse(localStorage.getItem(KEY + bridge) ?? "null") as Partial<Store> | null;
    store = { cached: s?.cached ?? {}, waiting: s?.waiting ?? {} };
  } catch { /* private mode or junk: start empty */ }
}
function save() {
  version++;
  listeners.forEach((l) => l());
  if (!storeFor || store.bridge) return;  // the bridge's copies live on the bridge
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

export const copiesOnBridge = () => { ensure(); return !!store.bridge; };

// The board's settings were just read from it or saved to it. On a bridge
// that keeps copies, the bridge saw the same reply pass and updates its own.
export function noteConfig(node: string, cfg: NodeConfig) {
  ensure();
  if (store.bridge) return;
  store = { ...store, cached: { ...store.cached, [node]: { config: clean(cfg), at: Date.now() } } };
  save();
}

// Save for the next check-in. `base` is the copy the edit started from.
// Resolves to an error to show, or null.
export async function queueConfig(node: string, config: NodeConfig, base: NodeConfig): Promise<string | null> {
  ensure();
  if (store.bridge) {
    const c = getConnection();
    if (!c) return "not connected";
    try {
      const r = await target(c.link, null).request("queue_config", { for: node, config: clean(config), rev: store.cached[node]?.rev, at: editStamp() });
      if (!r.ok) { if (r.rev !== undefined) void fetchCopy(node); return r.error ?? "the bridge refused it"; }
      await fetchWaiting(node);
      return null;
    } catch (e) { return (e as Error).message; }
  }
  store = { ...store, waiting: { ...store.waiting, [node]: { config: clean(config), base: clean(base), at: Date.now() } } };
  save();
  listen();
  return null;
}
export function dropWaiting(node: string) {
  ensure();
  if (store.bridge) {
    const c = getConnection();
    if (c && store.summary?.[node]?.waiting) void target(c.link, null).request("cancel_config", { for: node }).catch(() => undefined);
  }
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
// Start as soon as a console connects: on a bridge with copies, read its
// list (boards this browser hasn't met join the list as remembered);
// otherwise listen for check-ins to take this browser's first copy of each.
let unsubCopy: (() => void) | null = null;
export function startConfigCache() {
  ensure();
  if (!store.bridge) { listen(); return; }
  if (!unsubCopy) unsubCopy = onCopyEvent(onCopy);
  void loadSummaries();
}

// ---- on a bridge that keeps copies --------------------------------------------

function setSummary(node: string, sm: Summary) {
  store = { ...store, summary: { ...store.summary, [node]: sm } };
  if (!sm.waiting && store.waiting[node]) { const { [node]: _, ...rest } = store.waiting; store = { ...store, waiting: rest }; }
}
async function loadSummaries() {
  const c = getConnection();
  if (!c) return;
  let from = 0;
  for (let page = 0; page < 8; page++) {
    let r;
    try { r = await target(c.link, null).request("get_copies", { from }); } catch { return; }
    if (!r.ok) return;
    for (const x of (r.copies as { node: string; hello?: NodeHello; read?: number; seen?: number; rev: number; config: boolean; wake?: boolean; waiting?: Summary["waiting"] }[]) ?? []) {
      adoptFromBridge(x.node, x.hello, ((x.seen ?? x.read ?? 0) * 1000) || 0, !!x.wake);
      setSummary(x.node, { rev: x.rev, config: x.config, waiting: x.waiting });
      if (x.waiting) void fetchWaiting(x.node);
    }
    save();
    if (r.more === undefined) return;
    from = r.more as number;
  }
}
const fetching = new Set<string>();
// The copy of one board's settings, fetched when its page wants it.
async function fetchCopy(node: string) {
  const c = getConnection();
  if (!c || fetching.has(node)) return;
  fetching.add(node);
  try {
    const r = await target(c.link, null).request("get_copy", { for: node });
    if (r.ok && r.config) {
      store = { ...store, cached: { ...store.cached, [node]: { config: { ...EMPTY_CONFIG, ...(r.config as NodeConfig) }, at: ((r.read as number | undefined) ?? 0) * 1000 || Date.now(), rev: r.rev as number } } };
      save();
    }
  } catch { /* asked again when the page or the bridge says so */ } finally { fetching.delete(node); }
}
async function fetchWaiting(node: string) {
  const c = getConnection();
  if (!c) return;
  try {
    const r = await target(c.link, null).request("get_copy", { for: node, waiting: true });
    const w = r.waiting as { config: NodeConfig; at: number; saved?: number; stuck?: boolean; error?: string } | undefined;
    const sm = store.summary?.[node] ?? { rev: 0, config: true };
    if (!r.ok || !w) { setSummary(node, { ...sm, waiting: undefined }); save(); return; }
    setSummary(node, { ...sm, waiting: { at: w.at, stuck: w.stuck, error: w.error } });
    store = { ...store, waiting: { ...store.waiting, [node]: { config: { ...EMPTY_CONFIG, ...w.config }, base: w.config, at: ((w.saved ?? w.at) * 1000) || Date.now(), stuck: w.stuck, error: w.error } } };
    save();
  } catch { /* the next event or page open asks again */ }
}
// A board's page wants its copy: fetch it if this browser has none, or an older one.
export function wantCopy(node: string) {
  ensure();
  if (!store.bridge) return;
  const sm = store.summary?.[node];
  const have = store.cached[node];
  if ((!have && (!sm || sm.config)) || (have && sm && have.rev !== sm.rev)) void fetchCopy(node);
}
function onCopy(e: CopyEvent) {
  ensure();
  if (!store.bridge) return;
  const prev = store.summary?.[e.node];
  setSummary(e.node, { rev: e.rev, config: prev?.config || e.what === "copy" || e.what === "delivered", waiting: e.waiting ? { at: prev?.waiting?.at ?? 0, stuck: e.stuck, error: e.error } : undefined });
  if (e.waiting && (e.what === "waiting" || e.what === "stuck")) void fetchWaiting(e.node);
  if (e.what === "delivered") refreshHello(e.node);  // a new name shows in the list
  if (store.cached[e.node] && store.cached[e.node].rev !== e.rev) void fetchCopy(e.node);
  save();
}

// ---- in this browser (a bridge without copies) -----------------------------------

async function visit(node: string) {
  ensure();
  if (store.bridge) return;  // the bridge visits
  const c = getConnection();
  const en = c?.entries[node];
  if (!c || !en || en.usb || busy.has(node)) return;
  const w = store.waiting[node];
  if (store.cached[node] && (!w || w.stuck)) return; // nothing to do: don't keep it awake
  if ((notBefore.get(node) ?? 0) > Date.now()) return;
  busy.add(node);
  const battery = en.hello?.power === "battery";
  // A board from 2026-10-28 on reports a settings stamp, and takes a
  // request marked "bg" as background: 3 s, not the 10 min any other
  // request holds it. An older battery board has to be let sleep after.
  const honorsBg = en.hb?.cfg_at !== undefined;
  // Decided now, before those flows clear their own flags.
  const keep = honorsBg || !battery || wantsAwake(node) || otaBusy(otaJobs()[node]);
  let release = !keep;
  const t = target(c.link, node);
  try {
    if (!keep) {
      // Held by something else (a sensor wake, a sync pull, the setup
      // window, another console): a release would cut it short, and not
      // releasing would stretch it to 10 min. A later check-in, then.
      const h = await t.request("hello", { bg: true }); // background: holds nothing
      const hold = h.ok ? ((h.hold_s as number | undefined) ?? 0) : 0;
      if (hold > HOLD_DWELL_S) { release = false; notBefore.set(node, Date.now() + (hold + 5) * 1000); return; }
    }
    const r = await t.request("get_config", { bg: true });
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
        const s = await t.request("set_config", { config: send, bg: true });
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
    if (release) void t.request("hold_awake", { min: 0 }).catch(() => undefined);
  }
}

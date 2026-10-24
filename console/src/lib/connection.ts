// The live connection to the mesh: the open USB link plus everything
// the console has learned through it — which nodes exist, who they
// are, who hears whom. It lives here, not in a component, so it keeps
// listening whichever view is open (Yard and Nodes & Channels read the
// same list), and so a view switch or a dev hot reload can't close the
// port. Only Disconnect, an unplug, or leaving the page ends it.
import { useSyncExternalStore } from "react";
import { target, type Heartbeat, type NodeHello, type NodeLink, editStamp } from "./transport";
import { clockBody, type Mode } from "./schedule";

// A node not heard for three heartbeats is shown as missing.
export const MISSING_MS = 16000;
// A hello can be lost like any frame; ask again soon, not after a
// pause long enough to look like nothing is happening.
const HELLO_RETRY_MS = 3000;
// The USB node's own view of the mesh (it doesn't hear its own
// heartbeats): its neighbors and sync state, via the `mesh` command.
const LOCAL_MESH_MS = 5000;
// Every board's hello is asked again this often: it carries the board's
// mode (off / ambient / armed, and why), which the schedule changes with
// nobody pressing anything. The console shows what the boards say, never
// what it last told them (2026-10-09: a page refresh after STOP ALL showed
// the show as running).
const REFRESH_HELLO_MS = 15000;

export interface Entry {
  node: string;
  usb: boolean; // the node on the cable
  hello?: NodeHello;
  hb?: Heartbeat;
  seen: number; // ms timestamp of the last heartbeat / hello
  firstSeen: number; // when the console first heard it
  helloTries: number; // hellos sent and not answered
  // From the roster, not heard yet this session: shown (asleep or not
  // heard) but not polled — a request to a sleeping board only times
  // out on the bridge. Cleared by its first heartbeat.
  remembered?: boolean;
  lastBatt?: number; // the last cell voltage heard, mV — from the roster when remembered
}

// ---- the roster ---------------------------------------------------------
// Boards this console has met on this mesh, kept in this browser so they
// are on the list the moment it connects — a battery board asleep since
// last night is otherwise invisible until its next check-in (Colin,
// 2026-10-24: the candles "weren't visible" in the morning). Keyed by the
// bridge's id: a mesh is its bridge. Also the user's choices about the
// list: hidden boards (dead ones, taken off the list until they speak
// again) and a hand order, for when the list is arranged by hand.
export interface RosterEntry {
  node: string;
  hello: NodeHello;
  lastSeen: number; // ms timestamp of the last heartbeat heard by any session here
  batt?: number; // last cell voltage heard, mV (battery boards)
}
export interface Roster {
  boards: Record<string, RosterEntry>;
  hidden: string[];
  order: string[]; // node ids, first to last; ids not listed follow in name order
}
const ROSTER_KEY = "propmesh.roster.";
const EMPTY_ROSTER: Roster = { boards: {}, hidden: [], order: [] };
let roster: Roster = EMPTY_ROSTER;
let rosterKey: string | null = null;
let rosterDirty = 0;

function loadRoster(bridgeId: string): Roster {
  rosterKey = ROSTER_KEY + bridgeId;
  try {
    const r = JSON.parse(localStorage.getItem(rosterKey) ?? "null") as Partial<Roster> | null;
    roster = { boards: r?.boards ?? {}, hidden: r?.hidden ?? [], order: r?.order ?? [] };
  } catch { roster = { ...EMPTY_ROSTER }; }
  return roster;
}
function saveRoster() {
  if (!rosterKey) return;
  try { localStorage.setItem(rosterKey, JSON.stringify(roster)); } catch { /* private mode */ }
}
// Writes are batched: a heartbeat every 5 s from every board would
// otherwise rewrite the store constantly.
function remember(node: string, hello: NodeHello | undefined, seen: number, batt?: number) {
  if (!rosterKey) return;
  const prev = roster.boards[node];
  if (!hello && !prev) return;
  roster = { ...roster, boards: { ...roster.boards, [node]: { node, hello: hello ?? prev!.hello, lastSeen: Math.max(seen, prev?.lastSeen ?? 0), batt: batt || prev?.batt } } };
  if (!rosterDirty) rosterDirty = window.setTimeout(() => { rosterDirty = 0; saveRoster(); }, 2000);
}
export const getRoster = () => roster;
export const isHidden = (node: string) => roster.hidden.includes(node);
export function hideNode(node: string, hide: boolean) {
  roster = { ...roster, hidden: hide ? [...new Set([...roster.hidden, node])] : roster.hidden.filter((n) => n !== node) };
  saveRoster(); changed();
}
// Forget a board for good: off the roster and the list. It comes back
// on its next heartbeat, as any new board would.
export function forgetNode(node: string) {
  const boards = { ...roster.boards }; delete boards[node];
  roster = { boards, hidden: roster.hidden.filter((n) => n !== node), order: roster.order.filter((n) => n !== node) };
  saveRoster();
  if (current && current.entries[node]?.remembered) {
    const entries = { ...current.entries }; delete entries[node];
    current = { ...current, entries, selected: current.selected === node ? null : current.selected };
  }
  changed();
}
export function setOrder(order: string[]) { roster = { ...roster, order }; saveRoster(); changed(); }

// The list as the views show it: the bridge (the board on the cable)
// first, then the hand order if there is one, then by name — the same
// order every time the console opens, not the order boards were heard
// (2026-10-24). Hidden boards are left out unless asked for.
export function orderedEntries(c: Connection, withHidden = false): Entry[] {
  const pos = new Map(roster.order.map((n, i) => [n, i]));
  const name = (e: Entry) => (e.hello?.name || "").toLowerCase();
  return Object.values(c.entries)
    .filter((e) => withHidden || !roster.hidden.includes(e.node))
    .sort((a, b) => Number(b.usb) - Number(a.usb)
      || (pos.get(a.node) ?? 1e9) - (pos.get(b.node) ?? 1e9)
      || (name(a) && name(b) ? name(a).localeCompare(name(b)) : Number(!name(a)) - Number(!name(b)))
      || a.node.localeCompare(b.node));
}

export interface LocalMesh {
  // Set when the USB node just rebooted (its boot event) or stopped
  // answering status: what's shown is no longer known to be true.
  stale?: "rebooted" | "no answer";
  synced: boolean;
  conductor?: string;
  hop?: number;
  neighbors: { node: string; rssi: number }[];
  channel?: number; // the mesh's WiFi channel (follows the bridge's router)
  ip?: string; // the USB node's WiFi address, when it's a bridge on WiFi
  wifi?: "off" | "joining" | "up";
  wifi_ssid?: string;
  wifi_rssi?: number;
  wifi_reason?: string; // why the bridge isn't on WiFi, in plain words
}

// What the mesh did, newest first — sensor changes and cues as the USB
// node heard them. The Cues view shows it as the activity log.
export interface Activity {
  at: number; // ms timestamp
  kind: "input" | "cue" | "mode";
  node: string; // whose sensor / who fired
  index?: number; // DIGITAL_IN index
  value?: number; // input: 1 active, 0 clear
  seq?: number; // cue: sequence id
  armed?: boolean; // cue: was the USB node armed when it heard it
  mode?: Mode; // mode: what the USB node switched to
  reason?: string; // mode: why ("schedule", "manual", …)
}
const ACTIVITY_MAX = 60;

export interface Connection {
  link: NodeLink;
  // The WiFi link is reconnecting by itself (the bridge restarted): what's
  // shown is from before, and requests fail until it's back.
  reconnecting?: boolean;
  hello: NodeHello; // the USB node's, at connect time
  entries: Record<string, Entry>;
  selected: string | null; // the node open in Nodes & Channels
  selectedAt: number; // when select() last chose it; 0 = the connect-time default (a phone shows the list, not a page)
  local?: LocalMesh;
  lastEvent: number; // ms timestamp of the last heartbeat heard
  activity: Activity[];
}

type InputCb = (kind: string, index: number, value: number) => void;

let current: Connection | null = null;
let lastError: string | null = null;
let version = 0;
const listeners = new Set<() => void>();
const inputSubs = new Map<string, Set<InputCb>>();
let teardown: (() => void) | null = null;

function changed() {
  version++;
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

// Re-renders on every change, and once a second while connected (so
// ages and "missing" stay current).
export function useConnection(): Connection | null {
  useSyncExternalStore(subscribe, () => version);
  return current;
}

export const getConnection = () => current;
export const connectionError = () => lastError;

export const isMissing = (en: Entry, now = Date.now()) => !en.usb && now - en.seen > MISSING_MS;
// A battery board that has gone quiet is asleep, not lost (docs §6f).
export const isAsleep = (en: Entry, now = Date.now()) => en.hello?.power === "battery" && isMissing(en, now);

// Up / asleep / missing, hidden boards left out. A quiet battery board
// is asleep, not missing (docs/console-nodes-list.md §3).
export function counts(c: Connection, now = Date.now()) {
  const all = Object.values(c.entries).filter((e) => !roster.hidden.includes(e.node));
  const asleep = all.filter((e) => isAsleep(e, now)).length;
  const missing = all.filter((e) => isMissing(e, now) && !isAsleep(e, now)).length;
  return { total: all.length, online: all.length - missing - asleep, asleep, missing };
}

function patch(node: string, p: Partial<Entry>) {
  if (!current) return;
  const prev = current.entries[node] ?? { node, usb: false, seen: 0, firstSeen: Date.now(), helloTries: 0 };
  current = { ...current, entries: { ...current.entries, [node]: { ...prev, ...p } } };
  changed();
}

export function select(node: string | null) {
  if (!current) return;
  current = { ...current, selected: node, selectedAt: node ? Date.now() : 0 };
  changed();
}

// Input events for one node; returns the unsubscribe.
export function onInput(node: string, cb: InputCb) {
  if (!inputSubs.has(node)) inputSubs.set(node, new Set());
  inputSubs.get(node)!.add(cb);
  return () => { inputSubs.get(node)?.delete(cb); };
}

export function openConnection(link: NodeLink, hello: NodeHello) {
  teardown?.();
  const t = Date.now();
  lastError = null;
  current = {
    link, hello, selected: hello.node, selectedAt: 0, lastEvent: t, activity: [],
    entries: { [hello.node]: { node: hello.node, usb: true, hello, seen: t, firstSeen: t, helloTries: 0 } },
  };
  // Everyone this browser has met on this mesh, from the roster, before
  // any of them has spoken: asleep (battery) or not heard yet (mains).
  for (const r of Object.values(loadRoster(hello.node).boards)) {
    if (r.node === hello.node) continue;
    current.entries[r.node] = { node: r.node, usb: false, hello: r.hello, seen: r.lastSeen, firstSeen: t, helloTries: 0, remembered: true, lastBatt: r.batt };
  }
  const helloAt = new Map<string, number>([[hello.node, t]]);
  let meshAt = 0;

  const off = link.onEvent((e) => {
    if (!current) return;
    if (e.evt === "reconnecting") {
      current = { ...current, reconnecting: true, local: current.local && { ...current.local, stale: "no answer" } };
      changed();
    } else if (e.evt === "reconnected") {
      current = { ...current, reconnecting: false };
      helloAt.clear();  // ask everyone again: the bridge restarted, maybe into new firmware
      meshAt = 0;
      changed();
    } else if (e.evt === "disconnected") {
      lastError = "USB connection lost";
      end();
    } else if (e.evt === "heartbeat") {
      const hb = e as unknown as Heartbeat;
      current = { ...current, lastEvent: Date.now() };
      if (hb.node !== hello.node) {
        // Uptime went backwards: it rebooted (a firmware update, a power
        // blip) — ask again who it is, since its build or role may differ.
        const prev = current.entries[hb.node]?.hb;
        const was = current.entries[hb.node];
        patch(hb.node, { hb, seen: Date.now(), remembered: false, ...(hb.batt ? { lastBatt: hb.batt } : {}) });
        remember(hb.node, was?.hello, Date.now(), hb.batt);
        // A hidden board that speaks again is back on the list.
        if (roster.hidden.includes(hb.node)) hideNode(hb.node, false);
        if (prev && hb.up < prev.up) refreshHello(hb.node);
      } else changed();
    } else if (e.evt === "input") {
      const node = (e.node as string | undefined) ?? hello.node;
      inputSubs.get(node)?.forEach((cb) => cb(e.kind as string, e.index as number, e.value as number));
      log({ at: Date.now(), kind: "input", node, index: e.index as number, value: e.value as number });
    } else if (e.evt === "mode") {
      log({ at: Date.now(), kind: "mode", node: e.node as string, mode: e.mode as Mode, reason: e.reason as string });
    } else if (e.evt === "cue") {
      log({ at: Date.now(), kind: "cue", node: e.node as string, seq: e.seq as number, armed: e.armed as boolean });
    } else if (e.evt === "boot" && e.node === hello.node) {
      helloAt.delete(hello.node); // it rebooted: re-read its role
      // Its WiFi, channel and clock start again from scratch: say so until
      // a fresh status arrives, and ask for one now.
      current = { ...current, local: current.local && { ...current.local, stale: "rebooted", ip: undefined, wifi: current.local.wifi === "off" ? "off" : "joining" } };
      meshAt = 0;
      changed();
    }
  });

  const iv = setInterval(() => {
    if (!current) return;
    const now = Date.now();
    for (const en of Object.values(current.entries)) {
      if (en.remembered) continue; // not heard yet this session: nothing to ask
      const last = helloAt.get(en.node);
      const due = en.usb ? last === undefined || now - last > 5000
        : last === undefined || now - last > (en.hello ? REFRESH_HELLO_MS : HELLO_RETRY_MS);
      if (!due) continue;
      helloAt.set(en.node, now);
      if (!en.usb && !en.hello) patch(en.node, { helloTries: en.helloTries + 1 });
      const first = !en.hello;
      target(link, en.usb ? null : en.node).request("hello").then((r) => {
        if (!r.ok) return;
        patch(en.node, { hello: r as unknown as NodeHello, seen: Date.now(), helloTries: 0 });
        remember(en.node, r as unknown as NodeHello, Date.now());
        // The show schedule runs on the boards' wall clock: give each board
        // this device's time the first time it introduces itself (and the
        // USB board on every re-hello, cheap and keeps it fresh).
        if (first || en.usb) void target(link, en.usb ? null : en.node).request("set_clock", clockBody()).catch(() => {});
      }).catch(() => { /* retried on a later tick */ });
    }
    if (now - meshAt > LOCAL_MESH_MS) {
      meshAt = now;
      link.request("mesh").then((r) => {
        if (!r.ok || !current) return;
        current = { ...current, local: r as unknown as LocalMesh };
        changed();
      }).catch(() => {
        // Didn't answer: don't keep showing the last good state as if current.
        if (!current?.local || current.local.stale) return;
        current = { ...current, local: { ...current.local, stale: "no answer" } };
        changed();
      });
    }
    changed(); // ages, "missing"
  }, 1000);

  teardown = () => { off(); clearInterval(iv); teardown = null; };
  changed();
}

function log(a: Activity) {
  if (!current) return;
  current = { ...current, activity: [a, ...current.activity].slice(0, ACTIVITY_MAX) };
  changed();
}

function end() {
  teardown?.();
  if (rosterDirty) { clearTimeout(rosterDirty); rosterDirty = 0; saveRoster(); }
  current = null;
  changed();
}

// Disconnect button.
export async function closeConnection() {
  const link = current?.link;
  lastError = null;
  end();
  await link?.close();
}

// Ask a node again for its name/board/role now (after a save).
export function refreshHello(node: string) {
  const c = current;
  if (!c) return;
  const en = c.entries[node];
  if (en?.remembered) return;
  target(c.link, en?.usb ? null : node).request("hello").then((r) => {
    if (r.ok) { patch(node, { hello: r as unknown as NodeHello, seen: Date.now() }); remember(node, r as unknown as NodeHello, Date.now()); }
  }).catch(() => { /* the poll will catch up */ });
}

// Ask every known board for its hello now (after STOP ALL / a mode
// change), so what's shown is what they report.
export function refreshAll() {
  const c = current;
  if (!c) return;
  for (const n of Object.keys(c.entries)) refreshHello(n);
}

// The show's state as the boards report it (their hellos). `stopped` =
// every board that reports a mode is off BY HAND — STOP ALL in effect —
// as opposed to off because the schedule says it's daytime.
export function showState(c: Connection | null) {
  // Firmware before 2026-10-09 reports only `armed`; there, false can only
  // mean disarmed by hand (STOP ALL / Disarm), so it counts as stopped.
  // Leaving those boards out showed the show as running after STOP ALL.
  const hs = Object.values(c?.entries ?? {}).map((e) => e.hello).filter((h): h is NodeHello => !!h)
    .map((h): NodeHello => h.mode ? h
      : typeof h.armed === "boolean" ? { ...h, mode: h.armed ? "armed" : "off", reason: h.armed ? "old firmware" : "manual" }
      : h)
    .filter((h) => !!h.mode);
  const modes = new Set(hs.map((h) => h.mode));
  return {
    known: hs.length > 0,
    mode: modes.size === 1 ? hs[0].mode! : null, // null = boards disagree (or none known)
    stopped: hs.length > 0 && hs.every((h) => h.mode === "off" && h.reason === "manual"),
    boards: hs,
  };
}

// Ask every known node; resolves with the ids that did not confirm.
// Each is asked independently so one that doesn't answer can't hold up
// the rest.
async function everyNode(cmd: string, body: Record<string, unknown> = {}): Promise<string[]> {
  const c = current;
  if (!c) return [];
  body = { at: editStamp(), ...body };  // one stamp for every board's copy
  // A board from the roster that hasn't spoken this session is asleep or
  // gone: asking it only ties up the bridge until the request times out.
  const results = await Promise.all(Object.values(c.entries).filter((n) => !n.remembered).map((n) =>
    target(c.link, n.usb ? null : n.node).request(cmd, body)
      .then((r) => (r.ok ? null : n.node))
      .catch(() => n.node)));
  return results.filter((x): x is string => !!x);
}

// STOP ALL: disarm first (so no trigger fires mid-stop), then every
// output off, on every node the console knows about.
export async function stopAll(): Promise<string[]> {
  const a = await everyNode("arm", { on: false });
  const b = await everyNode("all_off");
  refreshAll();
  return [...new Set([...a, ...b])];
}

// Arm or disarm every node's triggers and cues.
export const armAll = async (on: boolean) => { const r = await everyNode("arm", { on }); refreshAll(); return r; };

// Off / ambient / armed on every node — held until the schedule's next
// change (firmware PmModeKeeper).
export const setModeAll = async (mode: Mode) => { const r = await everyNode("set_mode", { mode }); refreshAll(); return r; };

// When a sleeping battery board next checks in. Boards wake on a UTC grid,
// the next whole multiple of their check-in period (firmware pm_checkin.h,
// docs §6m), so every board with the same period checks in together.
export function nextCheckin(checkinMs: number | undefined, now = Date.now()): Date | null {
  if (!checkinMs || checkinMs <= 0) return null;
  return new Date(Math.floor(now / checkinMs) * checkinMs + checkinMs);
}
export const checkinText = (checkinMs: number | undefined, now = Date.now()) => {
  const t = nextCheckin(checkinMs, now);
  return t ? `next check-in ${t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "checks in on its own schedule";
};

// ---- battery ---------------------------------------------------------------
// What a battery board's cell is doing, from what the console can know
// (docs/console-nodes-list.md §8): the voltage in its heartbeats, why it
// last restarted, and whether it has missed its check-ins.
export const BATT_LOW_MV = 3550;      // ~20 % on the resting curve
export const BATT_CRITICAL_MV = 3450; // ~10 %
export const BATT_OUT_MV = 3400;      // below this and quiet: it died
export type BatteryLevel = "ok" | "low" | "critical" | "overdue" | "out";
export interface BatteryState { level: BatteryLevel; mv?: number; text: string; alarm: boolean }

export function batteryState(en: Entry, now = Date.now()): BatteryState | null {
  if (en.hello?.power !== "battery") return null;
  const mv = en.hb?.batt || en.lastBatt;
  const period = en.hello.checkin_ms ?? 0;
  const quiet = now - en.seen;
  const overdue = period > 0 ? quiet > 3 * period + MISSING_MS : quiet > 6 * 3600000;
  const brownout = !!en.hello.reset && /brownout/i.test(en.hello.reset);
  if ((overdue && mv !== undefined && mv < BATT_OUT_MV) || (overdue && brownout) || quiet > 36 * 3600000)
    return { level: "out", mv, text: "ran out?", alarm: true };
  if (overdue) return { level: "overdue", mv, text: "overdue", alarm: false };
  if (mv === undefined) return { level: "ok", text: "", alarm: false };
  if (mv < BATT_CRITICAL_MV) return { level: "critical", mv, text: "battery critical", alarm: true };
  if (mv < BATT_LOW_MV) return { level: "low", mv, text: "battery low", alarm: true };
  return { level: "ok", mv, text: "", alarm: false };
}

// "Will it last tonight?" — from the board's own drain rate (hello
// batt_mv_per_h, measured over days in its RTC log) and the voltage it
// has left above the cutoff, against the end of the next show window.
// Null until the board has a rate. docs/console-nodes-list.md §8.
export interface BatteryForecast { hoursLeft: number; spanH: number; text: string; lastsTonight: boolean | null }
export function batteryForecast(en: Entry, nextShowEndMs: number | null, now = Date.now()): BatteryForecast | null {
  const rate = en.hello?.batt_mv_per_h, span = en.hello?.batt_span_h;
  const mv = en.hb?.batt || en.lastBatt;
  if (rate === undefined || span === undefined || !mv) return null;
  const basis = `from ${span >= 48 ? `${Math.round(span / 24)} days` : `${Math.round(span)} h`} of readings`;
  if (rate <= 0.5) return { hoursLeft: Infinity, spanH: span, lastsTonight: true, text: `barely draining (${basis})` };
  const hoursLeft = Math.max(0, (mv - BATT_OUT_MV) / rate) - (now - en.seen) / 3600000; // less the time since that reading
  const nights = Math.floor(hoursLeft / 24);
  let lastsTonight: boolean | null = null, text: string;
  if (nextShowEndMs) {
    const toEnd = (nextShowEndMs - now) / 3600000;
    lastsTonight = hoursLeft > toEnd + 2;
    text = lastsTonight ? (nights >= 2 ? `about ${nights} nights left` : "should last tonight") : "not likely to last the next show";
  } else text = nights >= 1 ? `about ${nights} day${nights > 1 ? "s" : ""} left` : `about ${Math.max(1, Math.round(hoursLeft))} h left`;
  return { hoursLeft, spanH: span, lastsTonight, text: `${text} (${basis})` };
}

// Every board that needs attention for its battery, for the alarm badge.
export function batteryAlarms(c: Connection | null, now = Date.now()): { entry: Entry; state: BatteryState }[] {
  if (!c) return [];
  const showEnd = nextShowEnd(c, now);
  return orderedEntries(c).map((entry) => {
    const state = batteryState(entry, now);
    if (!state) return null;
    if (!state.alarm) {
      const f = batteryForecast(entry, showEnd, now);
      if (f && f.lastsTonight === false) return { entry, state: { ...state, alarm: true, text: "may not last the show" } };
    }
    return state.alarm ? { entry, state } : null;
  }).filter((x): x is { entry: Entry; state: BatteryState } => !!x);
}

// When tonight's (or the next) show window ends, on this device's clock,
// from the boards' own mode block: a board that is in a window says
// when it changes next; one that is off says when the next window starts
// but not its end, so the end is taken as start + 4 h. Null if no board
// has a schedule.
export function nextShowEnd(c: Connection, now = Date.now()): number | null {
  let best: number | null = null;
  for (const e of Object.values(c.entries)) {
    const h = e.hello;
    if (!h?.scheduled || !h.next_s) continue;
    const t = h.next_s * 1000;
    const end = h.mode && h.mode !== "off" ? t : t + 4 * 3600000;
    if (end > now && (best === null || end < best)) best = end;
  }
  return best;
}

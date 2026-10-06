// The live connection to the mesh: the open USB link plus everything
// the console has learned through it — which nodes exist, who they
// are, who hears whom. It lives here, not in a component, so it keeps
// listening whichever view is open (Yard and Nodes & Channels read the
// same list), and so a view switch or a dev hot reload can't close the
// port. Only Disconnect, an unplug, or leaving the page ends it.
import { useSyncExternalStore } from "react";
import { target, type Heartbeat, type NodeHello, type NodeLink } from "./transport";

// A node not heard for three heartbeats is shown as missing.
export const MISSING_MS = 16000;
// A hello can be lost like any frame; ask again soon, not after a
// pause long enough to look like nothing is happening.
const HELLO_RETRY_MS = 3000;
// The USB node's own view of the mesh (it doesn't hear its own
// heartbeats): its neighbors and sync state, via the `mesh` command.
const LOCAL_MESH_MS = 5000;

export interface Entry {
  node: string;
  usb: boolean; // the node on the cable
  hello?: NodeHello;
  hb?: Heartbeat;
  seen: number; // ms timestamp of the last heartbeat / hello
  firstSeen: number; // when the console first heard it
  helloTries: number; // hellos sent and not answered
}

export interface LocalMesh {
  synced: boolean;
  conductor?: string;
  hop?: number;
  neighbors: { node: string; rssi: number }[];
}

// What the mesh did, newest first — sensor changes and cues as the USB
// node heard them. The Cues view shows it as the activity log.
export interface Activity {
  at: number; // ms timestamp
  kind: "input" | "cue";
  node: string; // whose sensor / who fired
  index?: number; // DIGITAL_IN index
  value?: number; // input: 1 active, 0 clear
  seq?: number; // cue: sequence id
  armed?: boolean; // cue: was the USB node armed when it heard it
}
const ACTIVITY_MAX = 60;

export interface Connection {
  link: NodeLink;
  hello: NodeHello; // the USB node's, at connect time
  entries: Record<string, Entry>;
  selected: string | null; // the node open in Nodes & Channels
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

export function counts(c: Connection, now = Date.now()) {
  const all = Object.values(c.entries);
  const missing = all.filter((e) => isMissing(e, now)).length;
  return { total: all.length, online: all.length - missing, missing };
}

function patch(node: string, p: Partial<Entry>) {
  if (!current) return;
  const prev = current.entries[node] ?? { node, usb: false, seen: 0, firstSeen: Date.now(), helloTries: 0 };
  current = { ...current, entries: { ...current.entries, [node]: { ...prev, ...p } } };
  changed();
}

export function select(node: string | null) {
  if (!current) return;
  current = { ...current, selected: node };
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
    link, hello, selected: hello.node, lastEvent: t, activity: [],
    entries: { [hello.node]: { node: hello.node, usb: true, hello, seen: t, firstSeen: t, helloTries: 0 } },
  };
  const helloAt = new Map<string, number>([[hello.node, t]]);
  let meshAt = 0;

  const off = link.onEvent((e) => {
    if (!current) return;
    if (e.evt === "disconnected") {
      lastError = "USB connection lost";
      end();
    } else if (e.evt === "heartbeat") {
      const hb = e as unknown as Heartbeat;
      current = { ...current, lastEvent: Date.now() };
      if (hb.node !== hello.node) patch(hb.node, { hb, seen: Date.now() });
      else changed();
    } else if (e.evt === "input") {
      const node = (e.node as string | undefined) ?? hello.node;
      inputSubs.get(node)?.forEach((cb) => cb(e.kind as string, e.index as number, e.value as number));
      log({ at: Date.now(), kind: "input", node, index: e.index as number, value: e.value as number });
    } else if (e.evt === "cue") {
      log({ at: Date.now(), kind: "cue", node: e.node as string, seq: e.seq as number, armed: e.armed as boolean });
    } else if (e.evt === "boot" && e.node === hello.node) {
      helloAt.delete(hello.node); // it rebooted: re-read its role
    }
  });

  const iv = setInterval(() => {
    if (!current) return;
    const now = Date.now();
    for (const en of Object.values(current.entries)) {
      const last = helloAt.get(en.node);
      const due = en.usb ? last === undefined || now - last > 5000
        : !en.hello && (last === undefined || now - last > HELLO_RETRY_MS);
      if (!due) continue;
      helloAt.set(en.node, now);
      if (!en.usb) patch(en.node, { helloTries: en.helloTries + 1 });
      target(link, en.usb ? null : en.node).request("hello").then((r) => {
        if (r.ok) patch(en.node, { hello: r as unknown as NodeHello, seen: Date.now(), helloTries: 0 });
      }).catch(() => { /* retried on a later tick */ });
    }
    if (now - meshAt > LOCAL_MESH_MS) {
      meshAt = now;
      link.request("mesh").then((r) => {
        if (!r.ok || !current) return;
        current = { ...current, local: r as unknown as LocalMesh };
        changed();
      }).catch(() => { /* next tick */ });
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
  target(c.link, en?.usb ? null : node).request("hello").then((r) => {
    if (r.ok) patch(node, { hello: r as unknown as NodeHello, seen: Date.now() });
  }).catch(() => { /* the poll will catch up */ });
}

// Ask every known node; resolves with the ids that did not confirm.
// Each is asked independently so one that doesn't answer can't hold up
// the rest.
async function everyNode(cmd: string, body: Record<string, unknown> = {}): Promise<string[]> {
  const c = current;
  if (!c) return [];
  const results = await Promise.all(Object.values(c.entries).map((n) =>
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
  return [...new Set([...a, ...b])];
}

// Arm or disarm every node's triggers and cues.
export const armAll = (on: boolean) => everyNode("arm", { on });

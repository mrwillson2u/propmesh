// How the console reaches a node. One request/response + event shape,
// several carriers: USB serial today (Web Serial — Chrome / Edge), the
// mesh via the USB node next, the bridge WebSocket after that
// (software-plan §5.1 "transport abstraction"). The documents are the
// node's console API — docs/generic-boards.md §"Serial protocol".
import { BOARDS } from "./boards_gen";
import { EMPTY_CONFIG, isColor, type NodeConfig } from "./nodeConfig";
import { lerpColor } from "./timeline";
import { validate } from "./pinRules";
import { ease } from "./ease";

export interface NodeHello {
  node: string; // 8 hex digits
  fw: number;
  build?: string; // git commit the firmware was built from; "+hash" = uncommitted edits, "@branch" = not the published branch
  built?: number; // UTC seconds the image was built (firmware from 2026-10-24); orders builds, which commit names can't
  power?: "battery"; // on battery (a leaf; sleeps if its build can)
  sleeps?: boolean; // false: a mains-board build — "On battery" only stops it relaying
  ble?: boolean; // false: built without Bluetooth (the HUZZAH32) — can't drive floods. Absent on firmware before 2026-10-11
  awake?: boolean; // held awake (console or sensor) rather than free to sleep
  checkin_ms?: number;
  relay?: boolean; // a battery repeater: relays while the show runs (docs §6m)
  drift_ppm?: number; // its sleep clock's measured error, corrected for (§6m)
  awake_ms?: number; // how long its last wake lasted
  batt_mv_per_h?: number; // the board's own drain measurement, mV per hour, positive = draining (firmware 2026-10-24+)
  batt_span_h?: number; // hours of readings behind it
  pending?: boolean; // a fresh OTA image not yet proven
  board: string; // key into BOARDS
  name: string;
  bridge?: boolean;
  role?: number; // NodeRole flags
  armed?: boolean; // show triggers and cues active
  // The mode block (firmware 2026-10-09+): mode, why, what's next.
  mode?: "off" | "ambient" | "armed";
  reason?: string;
  clock?: boolean;
  scheduled?: boolean;
  next_s?: number;
  next_mode?: "off" | "ambient" | "armed";
  hold_until_s?: number;
  tz_min?: number;
  sunset_s?: number;
  outputs_on?: number; // outputs on right now (firmware 2026-10-11+)
  reset?: string; // why the board last restarted ("power on", "task watchdog (the firmware hung)", …)
  up_s?: number; // seconds since that restart
  // What went wrong before that restart, saved to flash (firmware 2026-10-12+).
  last?: { what: string; detail?: string; up_s?: number; utc_s?: number };
  // Which edits of the mesh-wide documents this board holds (firmware pm_sync, docs §6k).
  sync?: { sched_at: number; mode_at: number; show_synced: number; floods_at: number };
}

// A heartbeat heard on the mesh, as the USB node reports it.
export interface Heartbeat {
  node: string;
  board: number; // BoardType
  role: number; // NodeRole flags
  fw: number;
  up: number; // s
  heap: number; // KB
  batt: number; // mV, 0 = mains
  hops: number; // 0 = heard directly by the USB node
  rssi: number; // last hop, dBm
  ch?: number; // WiFi channel the sender is on (missing on old firmware)
  listen?: number; // a battery board listening in windows: its interval (ms)
  nbrs: { node: string; rssi: number }[];
}

export interface NodeEvent {
  evt: string;
  [k: string]: unknown;
}

export interface Reply {
  ok: boolean;
  error?: string;
  [k: string]: unknown;
}

// Anything that can answer console API requests for one node.
export interface NodeTarget {
  // Resolves with the node's reply even when ok is false; rejects only
  // when the link itself fails (timeout, unplugged).
  request(cmd: string, body?: Record<string, unknown>): Promise<Reply>;
}

export interface NodeLink extends NodeTarget {
  readonly via: "usb" | "wifi" | "sim";
  // `body.node` (8 hex digits) sends the request to that node over the
  // mesh; without it the USB node answers itself.
  onEvent(cb: (e: NodeEvent) => void): () => void;
  onLog(cb: (line: string) => void): () => void;
  close(): Promise<void>;
}

// Requests for `node` through `link`; null = the USB node itself.
// Writes of mesh-wide documents carry the moment they were made ("at", UTC
// seconds): every board keeps the newest and the conductor's beacon brings
// the rest up to date (firmware pm_sync, docs §6k). Callers that write the
// same thing to several boards stamp it ONCE (editStamp) so the copies match;
// this is the fallback for a single write.
const STAMPED = new Set(["set_schedule", "set_mode", "arm", "set_sequence", "delete_sequence", "set_rules", "set_config"]);
export const editStamp = () => Math.floor(Date.now() / 1000);
export function target(link: NodeLink, node: string | null): NodeTarget {
  return {
    request: (cmd, body = {}) => {
      const b = STAMPED.has(cmd) && body.at === undefined ? { ...body, at: editStamp() } : body;
      return link.request(cmd, node ? { ...b, node } : b);
    },
  };
}

class Listeners<T> {
  private set = new Set<(v: T) => void>();
  add(cb: (v: T) => void) { this.set.add(cb); return () => { this.set.delete(cb); }; }
  emit(v: T) { this.set.forEach((cb) => cb(v)); }
}

// ---- USB serial -------------------------------------------------------

// Web Serial is not in TypeScript's DOM lib; this is the part we use.
interface SerialPortLike {
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

export const webSerialSupported = () => typeof navigator !== "undefined" && "serial" in navigator;

const REQUEST_TIMEOUT_MS = 3000;
// The USB node retries a mesh request 3 × 0.9 s and then answers with
// an error itself, so this only fires if the USB node went away.
const REMOTE_TIMEOUT_MS = 6000;

// The JSON-lines protocol the node speaks, over whatever carries it:
// USB serial (SerialLink) or the bridge's WebSocket (WsLink). Requests
// get an `id`; a reply with that id resolves them; `evt` objects are
// events; anything else is log text.
abstract class LineLink implements NodeLink {
  abstract readonly via: "usb" | "wifi" | "sim";
  protected abstract readonly lostMessage: string;
  protected abstract writeLine(line: string): Promise<void>;
  abstract close(): Promise<void>;

  // Request numbers are random, not a counter: two consoles on one bridge
  // used to collide once a counter had climbed into the other's range, and
  // the bridge handed each the other's reply (2026-10-21). The bridge now
  // routes replies to the asking client, and a random 52-bit number means
  // a collision stays impossible even if that routing changes some day.
  private newId(): number {
    const r = new Uint32Array(2);
    crypto.getRandomValues(r);
    let id = r[0] * 0x100000 + (r[1] & 0xFFFFF);  // 52 bits, a safe integer
    while (id === 0 || this.pending.has(id)) id = (id + 1) % 0x10000000000000;
    return id;
  }
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  protected events = new Listeners<NodeEvent>();
  private logs = new Listeners<string>();
  protected closed = false;

  // The carrier is gone: fail what's in flight, tell the panel, go dead.
  protected lost() {
    this.failAll(new Error(this.lostMessage));
    if (!this.closed) this.events.emit({ evt: "disconnected" });
    this.closed = true;
  }

  // JSON lines are protocol; anything else (boot ROM chatter, mesh
  // prints) is log text.
  protected onLine(line: string) {
    if (!line) return;
    if (line[0] === "{") {
      try {
        const msg = JSON.parse(line);
        if (typeof msg.evt === "string") return this.events.emit(msg);
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          return p.resolve(msg);
        }
      } catch { /* a torn line — treat as log */ }
    }
    this.logs.emit(line);
  }

  // In-flight requests fail, but the link stays usable (a carrier that
  // reconnects by itself).
  protected failAll(e: Error) {
    this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(e); });
    this.pending.clear();
  }

  request(cmd: string, body: Record<string, unknown> = {}): Promise<Reply> {
    if (this.closed) return Promise.reject(new Error(this.lostMessage));
    // "id" is the request number that pairs a reply with its request. A
    // body field of the same name silently replaced it (get_sequence
    // {id} did, 2026-10-05) and the reply never matched — refuse loudly.
    if ("id" in body) return Promise.reject(new Error(`"${cmd}": "id" is reserved for the request number — name the field something else`));
    const id = this.newId();
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no reply to "${cmd}"`));
      }, body.node ? REMOTE_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.writeLine(JSON.stringify({ id, cmd, ...body })).catch(reject);
    });
  }

  onEvent(cb: (e: NodeEvent) => void) { return this.events.add(cb); }
  onLog(cb: (line: string) => void) { return this.logs.add(cb); }
}

class SerialLink extends LineLink {
  readonly via = "usb" as const;
  protected readonly lostMessage = "USB connection lost — reconnect the node";
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(private port: SerialPortLike) {
    super();
    this.writer = port.writable.getWriter();
    this.reader = port.readable.getReader();
    void this.readLoop();
  }

  protected writeLine(line: string) { return this.writer.write(new TextEncoder().encode(line + "\n")); }

  private async readLoop() {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          this.onLine(buf.slice(0, nl).replace(/\r$/, ""));
          buf = buf.slice(nl + 1);
        }
      }
    } catch {
      // unplugged — fall through
    }
    this.lost();
  }

  // Chrome only closes a port whose streams are both unlocked. The reader
  // used to be cancelled but left locked, so port.close() failed quietly,
  // the port stayed open, and Connect said "busy" until a page reload
  // (2026-10-08). Cancel the read, then let go of both locks, then close.
  async close() {
    this.closed = true;
    try { await this.reader.cancel(); } catch { /* already gone */ }
    try { this.reader.releaseLock(); } catch { /* already gone */ }
    try { this.writer.releaseLock(); } catch { /* already gone */ }
    try { await this.port.close(); } catch { /* already gone */ }
    if (openPort === this.port) openPort = null;
  }
}

// The port this page has open, so a second Connect can close a leftover
// one instead of failing with "already open".
let openPort: SerialPortLike | null = null;

// The bridge over WiFi: one JSON line per WebSocket text message. Same
// protocol, no cable (docs §6d stage B).
// A bridge restart (an update, a power blip, a WiFi drop) closes the
// socket: the link keeps the same connection and reconnects by itself,
// so the console doesn't have to be reconnected by hand (2026-10-11).
// Only after RECONNECT_FOR_MS without the bridge does it give up.
const RECONNECT_FOR_MS = 180000;
const RECONNECT_EVERY_MS = 2000;

class WsLink extends LineLink {
  readonly via = "wifi" as const;
  protected readonly lostMessage = "lost the bridge over WiFi — reconnecting…";
  private down = 0;  // ms timestamp the socket closed; 0 = up
  constructor(private ws: WebSocket, private url: string) {
    super();
    this.attach(ws);
  }
  private attach(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e) => { if (typeof e.data === "string") this.onLine(e.data.replace(/\r?\n$/, "")); };
    ws.onclose = () => this.dropped();
    ws.onerror = () => { try { ws.close(); } catch { /* closing */ } };
  }
  private dropped() {
    if (this.closed || this.down) return;
    this.down = Date.now();
    this.failAll(new Error(this.lostMessage));
    this.events.emit({ evt: "reconnecting" });
    void this.retry();
  }
  private async retry() {
    while (!this.closed && Date.now() - this.down < RECONNECT_FOR_MS) {
      await new Promise((r) => setTimeout(r, RECONNECT_EVERY_MS));
      if (this.closed) return;
      const ws = await new Promise<WebSocket | null>((resolve) => {
        const s = new WebSocket(this.url);
        const t = setTimeout(() => { s.close(); resolve(null); }, 4000);
        s.onopen = () => { clearTimeout(t); resolve(s); };
        s.onerror = () => { clearTimeout(t); resolve(null); };
      });
      if (!ws) continue;
      this.attach(ws);
      this.down = 0;
      this.events.emit({ evt: "reconnected" });
      return;
    }
    if (!this.closed) this.lost();  // gave up: the panel offers Connect again
  }
  protected writeLine(line: string) {
    if (this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(this.lostMessage));
    this.ws.send(line);
    return Promise.resolve();
  }
  async close() {
    this.closed = true;
    try { this.ws.close(); } catch { /* already gone */ }
  }
}

export const DEFAULT_WIFI_URL = "ws://propmesh.local:81";

// The bridge's LAN address, as its `mesh` status last reported it. An
// mDNS name (propmesh.local) resolves only on the home network; from a
// phone on Tailscale (the server routes the LAN) the name fails and the
// IP works — so a .local address that fails is retried at the last IP.
const IP_KEY = "propmesh.bridge.ip";
export function rememberBridgeIp(ip: string | undefined) {
  if (!ip) return;
  try { localStorage.setItem(IP_KEY, ip); } catch { /* private mode */ }
}
export function bridgeIp(): string | null {
  try { return localStorage.getItem(IP_KEY); } catch { return null; }
}

// Connect to a bridge on WiFi. `address` may be a host, host:port, or a ws:// URL.
export async function connectWifi(address: string): Promise<{ link: NodeLink; hello: NodeHello }> {
  try {
    return await connectWifiOnce(address);
  } catch (e) {
    // A name that didn't resolve or answer: the bridge's last known IP,
    // if there is one and the address wasn't already an IP.
    const ip = bridgeIp();
    if (!ip || /^\d+\.\d+\.\d+\.\d+/.test(address.replace(/^wss?:\/\//, "")) || address.includes(ip)) throw e;
    try {
      const r = await connectWifiOnce(`ws://${ip}:81`);
      return r;
    } catch { throw e; }  // the original error names the address the user typed
  }
}
async function connectWifiOnce(address: string): Promise<{ link: NodeLink; hello: NodeHello }> {
  let url = address.trim() || DEFAULT_WIFI_URL;
  if (!/^wss?:\/\//.test(url)) url = "ws://" + url;
  if (!/:\d+$/.test(url.replace(/\/$/, ""))) url = url.replace(/\/$/, "") + ":81";
  const ws = await new Promise<WebSocket>((resolve, reject) => {
    const s = new WebSocket(url);
    const t = setTimeout(() => { s.close(); reject(new Error(`no bridge answered at ${url} — is it on WiFi, and are you on the same network?`)); }, 6000);
    s.onopen = () => { clearTimeout(t); resolve(s); };
    s.onerror = () => { clearTimeout(t); reject(new Error(`couldn't reach ${url} — is the bridge on WiFi, and are you on the same network?`)); };
  });
  const link = new WsLink(ws, url);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await link.request("hello");
      if (r.ok) return { link, hello: r as unknown as NodeHello };
    } catch { /* retry */ }
  }
  await link.close();
  throw new Error("The bridge answered the connection but not the hello.");
}

// Ask the user for a port and wait for the node to answer. Opening the
// port resets a classic devkit (DTR/RTS drive EN through the auto-
// program transistors), so the first hello is retried through the boot.
// Speeds to try, newest first: firmware since 2026-10-07 talks at 921600
// (an update image is 1.75 MB of base64 — the cable was the bottleneck);
// older boards still answer at 115200.
export const SERIAL_BAUDS = [921600, 115200];

// `known`: a port this browser was already given (navigator.serial
// .getPorts()) — no chooser, which is how a reloaded page reconnects.
export async function connectUsb(known?: SerialPortLike): Promise<{ link: NodeLink; hello: NodeHello }> {
  const serial = (navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }).serial;
  const port = known ?? await serial.requestPort();
  if (port === openPort) { try { await port.close(); } catch { /* locked by a dead link — open() will say */ } openPort = null; }
  for (const baudRate of SERIAL_BAUDS) {
    await port.open({ baudRate, bufferSize: 8192 });
    openPort = port;
    try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch { /* not all adapters */ }
    const link = new SerialLink(port);
    // The first open resets a classic devkit (DTR/RTS drive EN): allow for the boot.
    for (let attempt = 0; attempt < (baudRate === SERIAL_BAUDS[0] ? 4 : 2); attempt++) {
      try {
        const r = await link.request("hello");
        if (r.ok) return { link, hello: r as unknown as NodeHello };
      } catch { /* still booting, or the wrong speed */ }
    }
    await link.close();  // closes the port; reopened at the next speed
  }
  throw new Error("The board did not answer at 921600 or 115200 baud. Is it flashed with firmware/node, and is the serial monitor closed?");
}

// ---- Simulated mesh ---------------------------------------------------

// Behaves like firmware/node on USB with two more nodes behind it on
// the mesh, for UI work with no hardware: same validator, configs kept
// in localStorage, heartbeats every 5 s, and each node's first input
// toggles every few seconds so input rows show life.
const SIM_KEY = "propmesh.sim.";
const SIM_LOCAL_ID = "51a0beef";
const SIM_LOCAL = SIM_LOCAL_ID;
// A small chain: the USB node hears 5c0ffee1 directly; 5c0ffee2 is out
// of its range and reached through 5c0ffee1 — enough to see hops and a
// weak link on the Yard.
const SIM_REMOTES = [
  { node: "5c0ffee1", hops: 0, rssi: -54, nbrs: [{ node: SIM_LOCAL_ID, rssi: -55 }, { node: "5c0ffee2", rssi: -77 }] },
  { node: "5c0ffee2", hops: 1, rssi: -77, nbrs: [{ node: "5c0ffee1", rssi: -79 }] },
  // A battery board: awake for 25 s after the page loads, then asleep
  // (no heartbeats) until its next check-in, 2 min later, for 20 s —
  // the real sleep pattern at a small scale, so the list's asleep /
  // remembered states can be seen without hardware.
  { node: "5c0ffee3", hops: 0, rssi: -61, nbrs: [{ node: SIM_LOCAL_ID, rssi: -62 }], sleeps: true },
];
const SIM_SLEEP_CYCLE_MS = 120000, SIM_SLEEP_CHECKIN_MS = 20000;

// A step on the wire: [t, kind, index, value] or [..., dur, ease_in, ease_out].
type SimStep = [number, string, number, number] | [number, string, number, number, number, number, number];
interface SimSeq { id: number; name: string; steps: SimStep[] }
interface SimRule {
  trigger?: "sensor" | "after";
  input?: number; on?: "active" | "clear"; after?: number;
  delay_ms?: number; cooldown_ms: number; limit?: { fires: number; window_min: number };
  pick?: "all" | "random"; seqs?: number[]; seq?: number; enabled: boolean;
}

interface SimNode {
  cfg: NodeConfig;
  values: Map<string, number>;
  seqs: Map<number, SimSeq>;
  rules: SimRule[];
  armed: boolean; // mode === "armed"
  // The simulator keeps a mode and a schedule but doesn't run the
  // schedule — the firmware's evaluation is host-tested (test_schedule).
  mode: "off" | "ambient" | "armed";
  reason?: string;
  schedule?: unknown;
  parked?: Map<string, number>; // by-hand outputs that were on when the show went off
  hand?: Map<string, number>; // last value set by hand (not a sequence preview), per output
  lastFired: Map<number, number>; // rule index -> ms
  lockout: Map<number, { start: number; count: number }>; // rule index -> fires in the current window
}

interface SimBleLight { addr: string; type: string; rssi: number; state: "found" | "pairing" | "paired" | "failed" | "other"; number?: number; key?: string; at: number }

// NodeRole as the firmware sets it (pm_node_apply): a bridge relays and keeps
// the clock; a battery board is a leaf unless it is a repeater (docs §6m).
const simRole = (cfg: NodeConfig) => cfg.bridge ? 7 : cfg.power === "battery" && !cfg.sleep?.relay ? 0 : 1;

class SimLink implements NodeLink {
  readonly via = "sim" as const;
  private nodes = new Map<string, SimNode>();
  private events = new Listeners<NodeEvent>();
  private timers: ReturnType<typeof setInterval>[] = [];
  // Simulated BRMesh search/pair (firmware pm_ble_tx): two lights answer
  // ~2 s into a search; pairing confirms after ~1.5 s.
  private ble = new Map<string, { mode: "idle" | "scanning" | "pairing"; until: number; lights: SimBleLight[] }>();
  // Simulated firmware builds: an `ota` "downloads" for a few seconds, then
  // the node reports the build the URL named (its last path segment).
  private builds = new Map<string, string>();
  private ota = new Map<string, { until: number; build: string }>();
  private resets = new Map<string, string>(); // why a node last restarted, for its hello
  private bootAt = new Map<string, number>(); // uptime restarts after a simulated update
  private rx = new Map<string, { size: number; written: number }>(); // an image arriving over the mesh

  constructor(private boardId: string) {
    for (const id of [SIM_LOCAL, ...SIM_REMOTES.map((r) => r.node)]) {
      let cfg: NodeConfig | null = null;
      try { cfg = JSON.parse(localStorage.getItem(SIM_KEY + id) ?? "null"); } catch { /* ignore */ }
      let show: { seqs: SimSeq[]; rules: SimRule[] } | null = null;
      try { show = JSON.parse(localStorage.getItem(SIM_KEY + "show." + id) ?? "null"); } catch { /* ignore */ }
      this.nodes.set(id, {
        cfg: cfg ?? EMPTY_CONFIG, values: new Map(), armed: true, mode: "armed", lastFired: new Map(), lockout: new Map(),
        seqs: new Map((show?.seqs ?? []).map((q) => [q.id, q])), rules: show?.rules ?? [],
      });
    }
    this.timers.push(setInterval(() => {
      this.nodes.forEach((n, node) => {
        const input = n.cfg.channels.find((c) => c.kind === "DIGITAL_IN");
        if (!input) return;
        const k = `DIGITAL_IN_${input.index}`;
        const v = n.values.get(k) ? 0 : 1;
        n.values.set(k, v);
        this.events.emit({ evt: "input", node, kind: "DIGITAL_IN", index: input.index, value: v });
        // This node's sensor triggers, as the firmware runs them.
        n.rules.forEach((r, i) => {
          if (!n.armed || !r.enabled || (r.trigger ?? "sensor") !== "sensor" || r.input !== input.index || (r.on ?? "active") === "active" !== (v === 1)) return;
          this.arm(node, n, r, i);
        });
      });
    }, 4000));
    const beat = () => SIM_REMOTES.forEach((r, i) => {
      const n = this.nodes.get(r.node)!;
      const o = this.ota.get(r.node);
      if (o && Date.now() >= o.until) { this.builds.set(r.node, o.build); this.ota.delete(r.node); this.bootAt.set(r.node, Date.now()); }
      if (o) return; // off the mesh while it downloads and reboots
      if (r.sleeps) {
        // On the wall clock, like a real board's check-in grid: awake for
        // the first 20 s of every 2 min, so a page opened mid-cycle meets
        // it asleep (and, once remembered, on the list anyway).
        if (Date.now() % SIM_SLEEP_CYCLE_MS > SIM_SLEEP_CHECKIN_MS) return; // asleep
      }
      const hb: Heartbeat = {
        node: r.node, board: 0, role: simRole(n.cfg), fw: 3,
        up: Math.round((Date.now() - (this.bootAt.get(r.node) ?? Date.now() - 600000 * (i + 1))) / 1000), heap: 190 - 7 * i,
        batt: r.sleeps || n.cfg.channels.some((c) => c.kind === "BATTERY") ? 3870 : 0, hops: r.hops, rssi: r.rssi + Math.round(Math.random() * 4 - 2),
        nbrs: r.nbrs.map((x) => ({ ...x, rssi: x.rssi + Math.round(Math.random() * 4 - 2) })),
      };
      this.events.emit({ evt: "heartbeat", ...hb });
    });
    setTimeout(beat, 300);
    this.timers.push(setInterval(beat, 5000));
  }

  async request(cmd: string, body: Record<string, unknown> = {}): Promise<Reply> {
    const node = (body.node as string | undefined) ?? SIM_LOCAL;
    const n = this.nodes.get(node);
    // A sleeping board hears nothing: the request times out, as on the mesh.
    if (SIM_REMOTES.find((r) => r.node === node)?.sleeps && Date.now() % SIM_SLEEP_CYCLE_MS > SIM_SLEEP_CHECKIN_MS) {
      await new Promise((r) => setTimeout(r, 1500));
      return { ok: false, error: `no reply from node ${node}` };
    }
    if (node !== SIM_LOCAL) await new Promise((r) => setTimeout(r, 120)); // mesh round trip
    if (!n) return { ok: false, error: `no reply from node ${node}` };
    switch (cmd) {
      case "hello": {
        const o = this.ota.get(node);
        if (o && Date.now() >= o.until) { this.builds.set(node, o.build); this.ota.delete(node); this.bootAt.set(node, Date.now()); }
        return { ok: true, node, fw: 4, build: this.builds.get(node) ?? "sim0001", board: this.boardId, ble: true, name: n.cfg.name, reset: this.resets.get(node) ?? "power on", bridge: !!n.cfg.bridge, role: simRole(n.cfg), ...(n.cfg.power === "battery" || SIM_REMOTES.find((r) => r.node === node)?.sleeps ? { power: "battery" as const, checkin_ms: n.cfg.sleep?.checkin_ms ?? SIM_SLEEP_CYCLE_MS, sleeps: true, batt_mv_per_h: 4.2, batt_span_h: 51, ...(n.cfg.sleep?.relay ? { relay: true } : {}) } : {}), armed: n.armed, ...this.modeStatus(n) };
      }
      case "ota": {
        if (!body.url || !body.ssid) return { ok: false, error: "ota needs url and ssid" };
        if (this.ota.has(node)) return { ok: false, error: "an update is already running" };
        const build = String(body.url).replace(/\/firmware\.bin$/, "").split("/").pop() || "simnew";
        this.ota.set(node, { until: Date.now() + 6000, build: build.slice(0, 12) });
        return { ok: true };
      }
      case "ota_begin": {
        if (!(body.size as number) || String(body.sha256 ?? "").length !== 64) return { ok: false, error: "ota_begin needs size and a 64-digit sha256" };
        this.rx.set(node, { size: body.size as number, written: 0 });
        return { ok: true, chunk: 2700 };
      }
      case "ota_data": {
        const r = this.rx.get(node);
        if (!r) return { ok: false, error: "no update in progress — ota_begin first", written: 0 };
        if (body.off !== r.written) return { ok: false, error: "offset mismatch — resume from `written`", written: r.written };
        const n = Math.ceil(String(body.data ?? "").length * 3 / 4);
        r.written = Math.min(r.size, r.written + n);
        return { ok: true, written: r.written };
      }
      case "ota_end": {
        const r = this.rx.get(node);
        this.rx.delete(node);
        if (!r) return { ok: false, error: "no update in progress" };
        if (r.written !== r.size) return { ok: false, error: "image incomplete" };
        const sent = String(body.build ?? "meshnew").slice(0, 12);
        // A test hook: an image named "rollback…" runs, browns out and the
        // board comes back on the build it had — what a weak supply does.
        const back = /^rollback/.test(sent) ? this.builds.get(node) ?? "sim0001" : sent;
        if (back !== sent) this.resets.set(node, "brownout (supply sagged)");
        this.ota.set(node, { until: Date.now() + 2500, build: back });
        return { ok: true };
      }
      case "ota_abort":
        this.rx.delete(node);
        return { ok: true };
      case "ota_status": {
        const o = this.ota.get(node);
        const left = o ? o.until - Date.now() : 0;
        return { ok: true, state: !o ? "idle" : left > 1500 ? "downloading" : "rebooting", progress: o ? Math.min(100, Math.round((6000 - left) / 45)) : 0, build: this.builds.get(node) ?? "sim0001", pending: false };
      }
      case "get_config": {
        // Like the board: the WiFi password is never sent back, only pass_set.
        const { wifi, ...rest } = n.cfg;
        return { ok: true, config: wifi ? { ...rest, wifi: { ssid: wifi.ssid, pass_set: !!wifi.pass } } : rest };
      }
      case "set_config": {
        const cfg = structuredClone(body.config as NodeConfig);
        // No password sent for the same network = keep the stored one (as the board does).
        if (cfg.wifi && !cfg.wifi.pass && cfg.wifi.ssid === n.cfg.wifi?.ssid) cfg.wifi.pass = n.cfg.wifi?.pass;
        if (cfg.wifi) delete cfg.wifi.pass_set;
        const issues = validate(BOARDS[this.boardId], cfg);
        if (issues.some((i) => i.error)) return { ok: false, error: "invalid config", issues };
        n.cfg = cfg;
        n.values.clear();
        try { localStorage.setItem(SIM_KEY + node, JSON.stringify(cfg)); } catch { /* private mode */ }
        return { ok: true, issues };
      }
      case "candle": {  // gust / sputter / tune: nothing to show in the simulator
        const c = n.cfg.channels.find((x) => x.kind === "CANDLE" && x.index === body.index);
        return c ? { ok: true } : { ok: false, error: "no such candle" };
      }
      case "set": {
        const c = n.cfg.channels.find((x) => x.kind === body.kind && x.index === body.index);
        if (!c || c.kind === "DIGITAL_IN") return { ok: false, error: "no such output channel" };
        if (c.kind === "SERVO" && typeof body.us === "number") {
          const lo = c.min_us ?? 500, hi = c.max_us ?? 2500;
          const v = Math.round(((body.us as number) - lo) * 1000 / (hi - lo));
          n.values.set(`SERVO_${c.index}`, Math.max(0, Math.min(1000, v)));
          return { ok: true };
        }
        n.values.set(`${c.kind}_${c.index}`, body.value as number);
        if (!body.preview) (n.hand ??= new Map()).set(`${c.kind}_${c.index}`, body.value as number);
        return { ok: true };
      }
      case "ble_scan": {
        if (n.cfg.bridge) return { ok: false, error: "the bridge doesn't drive Bluetooth lights — search from a prop board" };
        const now = Date.now();
        const ms = (body.ms as number) ?? 8000;
        this.ble.set(node, {
          mode: "scanning", until: now + ms,
          lights: [
            { addr: "a4:c1:38:5e:12:07", type: "RGB", rssi: -58, state: "found", at: now + 2000 },
            { addr: "a4:c1:38:5e:12:3b", type: "RGBW", rssi: -71, state: "found", at: now + 3200 },
            { addr: "a4:c1:38:5e:12:9c", type: "RGB", rssi: -64, state: "other", key: "b2fd16aa", number: 3, at: now + 4000 },
          ],
        });
        return { ok: true };
      }
      case "ble_pair": {
        const b = this.ble.get(node);
        const l = b?.lights.find((x) => x.addr === body.addr && Date.now() >= x.at);
        if (!b || !l) return { ok: false, error: "that light hasn't been heard — search again" };
        if (l.state === "paired") return { ok: false, error: "already paired to this board" };
        const used = new Set(n.cfg.channels.filter((c) => c.kind === "BLE_LIGHT").map((c) => c.light));
        let num = 1;
        while (used.has(num)) num++;
        Object.assign(l, { state: "pairing", number: num });
        Object.assign(b, { mode: "pairing", until: Date.now() + 1500 });
        return { ok: true, number: num };
      }
      case "ble_found": {
        const b = this.ble.get(node) ?? { mode: "idle" as const, until: 0, lights: [] };
        const now = Date.now();
        if (b.mode !== "idle" && now >= b.until) {
          if (b.mode === "pairing") {
            for (const l of b.lights.filter((x) => x.state === "pairing")) {
              l.state = "paired";
              (l as SimBleLight & { acked?: boolean }).acked = false;
              const index = Math.max(0, ...n.cfg.channels.filter((c) => c.kind === "BLE_LIGHT").map((c) => c.index)) + 1;
              n.cfg = {
                ...n.cfg,
                brmesh_key: n.cfg.brmesh_key ?? "1a2b3c4d",
                channels: [...n.cfg.channels, { kind: "BLE_LIGHT", index, pins: [], light: l.number, label: `flood ${l.number} (${l.type})` }],
              };
              try { localStorage.setItem(SIM_KEY + node, JSON.stringify(n.cfg)); } catch { /* private mode */ }
            }
          }
          b.mode = "idle";
        }
        return {
          ok: true, mode: b.mode, remaining_ms: Math.max(0, b.until - now), key_set: !!n.cfg.brmesh_key,
          lights: b.lights.filter((l) => now >= l.at).map(({ at: _at, ...l }) => l),
        };
      }
      case "state":
        return {
          ok: true,
          channels: n.cfg.channels.map((c) => ({
            kind: c.kind, index: c.index,
            value: n.values.get(`${c.kind}_${c.index}`) ?? (c.kind === "SERVO" ? -1 : c.kind === "BATTERY" ? 3870 : 0),
          })),
        };
      case "mesh": {
        const bridge = !!this.nodes.get(SIM_LOCAL)!.cfg.bridge;
        return {
          ok: true, synced: true, role: 1 | (bridge ? 6 : 0), conductor: SIM_LOCAL, hop: 0,
          neighbors: node === SIM_LOCAL ? [{ node: "5c0ffee1", rssi: -53 }] : [],
        };
      }
      case "get_show":
        return {
          ok: true, armed: n.armed, rules: n.rules, ...this.modeStatus(n),
          sequences: [...n.seqs.values()].map((q) => ({ id: q.id, name: q.name, steps: q.steps.length, length_ms: Math.max(0, ...q.steps.map((x) => x[0])) })),
        };
      case "get_sequence": {
        const q = n.seqs.get(body.seq as number);
        return q ? { ok: true, sequence: q } : { ok: false, error: "no such sequence on this node" };
      }
      case "set_sequence": {
        const q = body.sequence as SimSeq;
        const bad = q.steps.find(([, kind, index]) => kind === "DIGITAL_IN" || !n.cfg.channels.some((c) => c.kind === kind && c.index === index));
        if (bad) return { ok: false, error: "step addresses a channel this node doesn't have" };
        for (const w of q.steps) {
          if (w.length !== 7 || !(w[4] > 0)) continue;
          if (w[4] > w[0]) return { ok: false, error: "a ramp can't start before the sequence does" };
          if (["RELAY", "DIGITAL_IN"].includes(w[1])) return { ok: false, error: "relays and inputs can't ramp" };
          if (w[5] + w[6] > 100) return { ok: false, error: "ease in + ease out must be at most 100 %" };
        }
        n.seqs.set(q.id, { ...q, steps: [...q.steps].sort((a, b) => a[0] - b[0]) });
        this.saveShow(node, n);
        return { ok: true };
      }
      case "delete_sequence":
        n.seqs.delete(body.seq as number);
        this.saveShow(node, n);
        return { ok: true };
      case "set_rules": {
        const rules = body.rules as SimRule[];
        if (rules.some((r) => (r.trigger ?? "sensor") === "sensor" && !n.cfg.channels.some((c) => c.kind === "DIGITAL_IN" && c.index === r.input)))
          return { ok: false, error: "trigger uses a sensor input this node doesn't have" };
        if (rules.some((r) => !((r.seqs?.length ?? 0) || r.seq))) return { ok: false, error: "trigger has no sequence" };
        n.rules = rules;
        n.lastFired.clear();
        this.saveShow(node, n);
        return { ok: true };
      }
      case "cue":
        if (n.mode === "off") return { ok: false, error: "the show is off — arm it, or switch to ambient" };
        this.fire(node, body.seq as number);
        return { ok: true };
      case "arm":
      case "set_mode": {
        n.reason = "manual";
        const m = cmd === "arm" ? (body.on !== false ? "armed" : "off") : body.mode;
        if (m !== "off" && m !== "ambient" && m !== "armed") return { ok: false, error: "mode must be off, ambient or armed" };
        const was = n.mode;
        n.mode = m;
        n.armed = m === "armed";
        // As the firmware: outputs set by hand that were on come back when the show does.
        if (m === "off" && was !== "off") {
          n.parked = new Map([...(n.hand ?? new Map())].filter(([k, v]) => (k.startsWith("SERVO") ? v >= 0 : v !== 0)));
          n.cfg.channels.forEach((c) => { if (c.kind !== "DIGITAL_IN") n.values.set(`${c.kind}_${c.index}`, c.kind === "SERVO" ? -1 : 0); });
        }
        if (m !== "off" && was === "off") { n.parked?.forEach((v, k) => { if (!n.values.get(k)) n.values.set(k, v); }); n.parked = undefined; }
        this.events.emit({ evt: "mode", node, mode: m, reason: "manual" });
        return { ok: true, armed: n.armed, ...this.modeStatus(n) };
      }
      case "set_clock":
        return { ok: true, ...this.modeStatus(n) };
      case "set_schedule":
        n.schedule = body.schedule;
        return { ok: true, ...this.modeStatus(n) };
      case "get_schedule":
        return { ok: true, schedule: n.schedule ?? { enabled: false, lat: 0, lon: 0, manual_max_min: 60, windows: [] }, ...this.modeStatus(n) };
      case "all_off":
        if (n.mode !== "off") n.hand = undefined;  // All off by hand: stay off
        n.cfg.channels.forEach((c) => {
          if (c.kind !== "DIGITAL_IN") n.values.set(`${c.kind}_${c.index}`, c.kind === "SERVO" ? -1 : 0);
        });
        return { ok: true };
      default:
        return { ok: false, error: "unknown command" };
    }
  }

  private modeStatus(n: SimNode) {
    const outputs_on = n.cfg.channels.filter((c) => {
      if (c.kind === "DIGITAL_IN") return false;
      const v = n.values.get(`${c.kind}_${c.index}`) ?? (c.kind === "SERVO" ? -1 : 0);
      return c.kind === "SERVO" ? v >= 0 : v !== 0;
    }).length;
    return { mode: n.mode, reason: n.reason ?? (n.schedule ? "schedule (simulator: stored, not run)" : "no schedule"), clock: true, scheduled: !!n.schedule, outputs_on };
  }

  // CUE: every armed node with a part plays it 200 ms from now.
  // A rule's trigger happened on `node`: cooldown and lockout permitting,
  // its sequences fire after its delay — the firmware's PmTriggers.
  private arm(node: string, n: SimNode, r: SimRule, i: number) {
    if (!r.enabled) return;
    const now = Date.now();
    const last = n.lastFired.get(i);
    if (last !== undefined && now - last < r.cooldown_ms) return;
    if (r.limit?.fires) {
      const w = n.lockout.get(i) ?? { start: now, count: 0 };
      if (now - w.start >= r.limit.window_min * 60000) { w.start = now; w.count = 0; }
      if (w.count >= r.limit.fires) return;
      w.count++;
      n.lockout.set(i, w);
    }
    n.lastFired.set(i, now);
    const seqs = r.seqs?.length ? r.seqs : r.seq ? [r.seq] : [];
    const chosen = r.pick === "random" ? [seqs[Math.floor(Math.random() * seqs.length)]] : seqs;
    setTimeout(() => { if (n.mode !== "off") chosen.forEach((q) => this.fire(node, q)); }, r.delay_ms ?? 0);
  }

  private fire(from: string, seq: number) {
    this.events.emit({ evt: "cue", node: from, seq, armed: this.nodes.get(SIM_LOCAL)!.armed, here: this.nodes.get(SIM_LOCAL)!.seqs.has(seq) });
    // "after" rules anywhere: a sequence started.
    this.nodes.forEach((n, node) => n.rules.forEach((r, i) => { if (r.trigger === "after" && r.after === seq && n.mode !== "off") this.arm(node, n, r, i); }));
    this.nodes.forEach((n) => {
      const part = n.seqs.get(seq);
      if (!part || n.mode === "off") return;
      for (const w of part.steps) {
        const [t, kind, index, value] = w;
        const dur = w.length === 7 ? w[4] : 0;
        const [ein, eout] = w.length === 7 ? [w[5], w[6]] : [0, 0];
        if (!dur) { setTimeout(() => { if (n.mode !== "off") n.values.set(`${kind}_${index}`, value); }, 200 + t); continue; }
        // A ramp: walk the line in 50 ms ticks from t - dur to t.
        const key = `${kind}_${index}`;
        setTimeout(() => {
          const from = n.values.get(key) ?? 0;
          const t0 = Date.now();
          const iv = setInterval(() => {
            const p = Math.min(1, (Date.now() - t0) / dur);
            if (n.mode !== "off") n.values.set(key, isColor(kind) ? lerpColor(from, value, ease(ein, eout, p)) : Math.round(from + (value - from) * ease(ein, eout, p)));
            if (p >= 1) clearInterval(iv);
          }, 50);
        }, 200 + t - dur);
      }
    });
  }

  private saveShow(node: string, n: SimNode) {
    try { localStorage.setItem(SIM_KEY + "show." + node, JSON.stringify({ seqs: [...n.seqs.values()], rules: n.rules })); } catch { /* private mode */ }
  }

  onEvent(cb: (e: NodeEvent) => void) { return this.events.add(cb); }
  onLog() { return () => {}; }
  async close() { this.timers.forEach(clearInterval); }
}

export async function connectSim(boardId = "esp32-devkit-v1"): Promise<{ link: NodeLink; hello: NodeHello }> {
  const link = new SimLink(boardId);
  const hello = (await link.request("hello")) as unknown as NodeHello;
  return { link, hello };
}

// ---- reconnect after a page reload -------------------------------------------
// The last way in is remembered; a reload reconnects the same way with no
// clicks (2026-10-11). Disconnect forgets it, so a deliberate disconnect
// stays disconnected. USB: only a port this browser was already allowed
// (no chooser) and only if there is exactly one. Note opening the port
// restarts a classic devkit, as a manual Connect does.
const LAST_KEY = "propmesh.last";
export function rememberWay(how: "usb" | "wifi" | null) {
  try { if (how) localStorage.setItem(LAST_KEY, how); else localStorage.removeItem(LAST_KEY); } catch { /* private mode */ }
}
export async function reconnectLast(): Promise<{ link: NodeLink; hello: NodeHello; how: "usb" | "wifi" } | null> {
  let how: string | null = null;
  try { how = localStorage.getItem(LAST_KEY); } catch { /* private mode */ }
  if (how === "wifi") {
    let addr = DEFAULT_WIFI_URL;
    try { addr = localStorage.getItem("propmesh.bridge") ?? DEFAULT_WIFI_URL; } catch { /* default */ }
    // The bridge takes two consoles; the page just reloaded may still hold
    // one until the bridge notices it's gone — keep trying for 30 s.
    for (let i = 0; ; i++) {
      try { return { ...(await connectWifi(addr)), how: "wifi" }; }
      catch (e) { if (i >= 5) throw e; await new Promise((r) => setTimeout(r, 5000)); }
    }
  }
  if (how === "usb" && webSerialSupported()) {
    const ports = await (navigator as unknown as { serial: { getPorts(): Promise<SerialPortLike[]> } }).serial.getPorts();
    if (ports.length !== 1) return null;
    return { ...(await connectUsb(ports[0])), how: "usb" };
  }
  return null;
}

// How the console reaches the board it talks to directly ("the bridge" in
// practice): its tag everywhere. It used to say USB even over WiFi.
export const directLabel = (link: { via: "usb" | "wifi" | "sim" }) => link.via === "wifi" ? "WIFI" : link.via === "sim" ? "SIM" : "USB";

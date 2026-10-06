// How the console reaches a node. One request/response + event shape,
// several carriers: USB serial today (Web Serial — Chrome / Edge), the
// mesh via the USB node next, the bridge WebSocket after that
// (software-plan §5.1 "transport abstraction"). The documents are the
// node's console API — docs/generic-boards.md §"Serial protocol".
import { BOARDS } from "./boards_gen";
import { EMPTY_CONFIG, type NodeConfig } from "./nodeConfig";
import { validate } from "./pinRules";

export interface NodeHello {
  node: string; // 8 hex digits
  fw: number;
  board: string; // key into BOARDS
  name: string;
  bridge?: boolean;
  role?: number; // NodeRole flags
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
  readonly via: "usb" | "sim";
  // `body.node` (8 hex digits) sends the request to that node over the
  // mesh; without it the USB node answers itself.
  onEvent(cb: (e: NodeEvent) => void): () => void;
  onLog(cb: (line: string) => void): () => void;
  close(): Promise<void>;
}

// Requests for `node` through `link`; null = the USB node itself.
export function target(link: NodeLink, node: string | null): NodeTarget {
  return { request: (cmd, body = {}) => link.request(cmd, node ? { ...body, node } : body) };
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

class SerialLink implements NodeLink {
  readonly via = "usb" as const;
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private events = new Listeners<NodeEvent>();
  private logs = new Listeners<string>();
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private closed = false;

  constructor(private port: SerialPortLike) {
    this.writer = port.writable.getWriter();
    this.reader = port.readable.getReader();
    void this.readLoop();
  }

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
    this.failAll(new Error("USB connection lost"));
    if (!this.closed) this.events.emit({ evt: "disconnected" });
    // Dead from here on: a panel that wasn't listening (other view
    // open when the cable came out) gets a clear error, not a stream one.
    this.closed = true;
  }

  // JSON lines are protocol; anything else (boot ROM chatter, mesh
  // prints) is log text.
  private onLine(line: string) {
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

  private failAll(e: Error) {
    this.pending.forEach((p) => { clearTimeout(p.timer); p.reject(e); });
    this.pending.clear();
  }

  request(cmd: string, body: Record<string, unknown> = {}): Promise<Reply> {
    if (this.closed) return Promise.reject(new Error("USB disconnected — reconnect the node"));
    const id = this.nextId++;
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no reply to "${cmd}"`));
      }, body.node ? REMOTE_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const line = JSON.stringify({ id, cmd, ...body }) + "\n";
      this.writer.write(new TextEncoder().encode(line)).catch(reject);
    });
  }

  onEvent(cb: (e: NodeEvent) => void) { return this.events.add(cb); }
  onLog(cb: (line: string) => void) { return this.logs.add(cb); }

  async close() {
    this.closed = true;
    try { await this.reader.cancel(); } catch { /* already gone */ }
    try { this.writer.releaseLock(); } catch { /* already gone */ }
    try { await this.port.close(); } catch { /* already gone */ }
  }
}

// Ask the user for a port and wait for the node to answer. Opening the
// port resets a classic devkit (DTR/RTS drive EN through the auto-
// program transistors), so the first hello is retried through the boot.
export async function connectUsb(): Promise<{ link: NodeLink; hello: NodeHello }> {
  const serial = (navigator as unknown as { serial: { requestPort(): Promise<SerialPortLike> } }).serial;
  const port = await serial.requestPort();
  await port.open({ baudRate: 115200, bufferSize: 8192 });
  try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch { /* not all adapters */ }
  const link = new SerialLink(port);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await link.request("hello");
      if (r.ok) return { link, hello: r as unknown as NodeHello };
    } catch { /* still booting */ }
  }
  await link.close();
  throw new Error("The board did not answer. Is it flashed with firmware/node, and is the serial monitor closed?");
}

// ---- Simulated mesh ---------------------------------------------------

// Behaves like firmware/node on USB with two more nodes behind it on
// the mesh, for UI work with no hardware: same validator, configs kept
// in localStorage, heartbeats every 5 s, and each node's first input
// toggles every few seconds so input rows show life.
const SIM_KEY = "propmesh.sim.";
const SIM_LOCAL = "51a0beef";
const SIM_REMOTES = [
  { node: "5c0ffee1", hops: 0, rssi: -54 },
  { node: "5c0ffee2", hops: 1, rssi: -71 },
];

interface SimNode {
  cfg: NodeConfig;
  values: Map<string, number>;
}

class SimLink implements NodeLink {
  readonly via = "sim" as const;
  private nodes = new Map<string, SimNode>();
  private events = new Listeners<NodeEvent>();
  private timers: ReturnType<typeof setInterval>[] = [];

  constructor(private boardId: string) {
    for (const id of [SIM_LOCAL, ...SIM_REMOTES.map((r) => r.node)]) {
      let cfg: NodeConfig | null = null;
      try { cfg = JSON.parse(localStorage.getItem(SIM_KEY + id) ?? "null"); } catch { /* ignore */ }
      this.nodes.set(id, { cfg: cfg ?? EMPTY_CONFIG, values: new Map() });
    }
    this.timers.push(setInterval(() => {
      this.nodes.forEach((n, node) => {
        const input = n.cfg.channels.find((c) => c.kind === "DIGITAL_IN");
        if (!input) return;
        const k = `DIGITAL_IN_${input.index}`;
        const v = n.values.get(k) ? 0 : 1;
        n.values.set(k, v);
        this.events.emit({ evt: "input", node, kind: "DIGITAL_IN", index: input.index, value: v });
      });
    }, 4000));
    const beat = () => SIM_REMOTES.forEach((r, i) => {
      const n = this.nodes.get(r.node)!;
      const hb: Heartbeat = {
        node: r.node, board: 0, role: 1 | (n.cfg.bridge ? 6 : 0), fw: 3,
        up: Math.round(performance.now() / 1000) + 600 * (i + 1), heap: 190 - 7 * i,
        batt: 0, hops: r.hops, rssi: r.rssi + Math.round(Math.random() * 4 - 2),
        nbrs: [{ node: SIM_LOCAL, rssi: r.rssi }],
      };
      this.events.emit({ evt: "heartbeat", ...hb });
    });
    setTimeout(beat, 300);
    this.timers.push(setInterval(beat, 5000));
  }

  async request(cmd: string, body: Record<string, unknown> = {}): Promise<Reply> {
    const node = (body.node as string | undefined) ?? SIM_LOCAL;
    const n = this.nodes.get(node);
    if (node !== SIM_LOCAL) await new Promise((r) => setTimeout(r, 120)); // mesh round trip
    if (!n) return { ok: false, error: `no reply from node ${node}` };
    switch (cmd) {
      case "hello":
        return { ok: true, node, fw: 3, board: this.boardId, name: n.cfg.name, bridge: !!n.cfg.bridge, role: 1 | (n.cfg.bridge ? 6 : 0) };
      case "get_config":
        return { ok: true, config: n.cfg };
      case "set_config": {
        const cfg = body.config as NodeConfig;
        const issues = validate(BOARDS[this.boardId], cfg);
        if (issues.some((i) => i.error)) return { ok: false, error: "invalid config", issues };
        n.cfg = cfg;
        n.values.clear();
        try { localStorage.setItem(SIM_KEY + node, JSON.stringify(cfg)); } catch { /* private mode */ }
        return { ok: true, issues };
      }
      case "set": {
        const c = n.cfg.channels.find((x) => x.kind === body.kind && x.index === body.index);
        if (!c || c.kind === "DIGITAL_IN") return { ok: false, error: "no such output channel" };
        n.values.set(`${c.kind}_${c.index}`, body.value as number);
        return { ok: true };
      }
      case "state":
        return {
          ok: true,
          channels: n.cfg.channels.map((c) => ({
            kind: c.kind, index: c.index,
            value: n.values.get(`${c.kind}_${c.index}`) ?? (c.kind === "SERVO" ? -1 : 0),
          })),
        };
      case "all_off":
        n.cfg.channels.forEach((c) => {
          if (c.kind !== "DIGITAL_IN") n.values.set(`${c.kind}_${c.index}`, c.kind === "SERVO" ? -1 : 0);
        });
        return { ok: true };
      default:
        return { ok: false, error: "unknown command" };
    }
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

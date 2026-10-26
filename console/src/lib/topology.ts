// The real mesh as the Yard draws it, derived from what the nodes
// report: every heartbeat carries the sender's neighbor list with RSSI,
// and the USB node reports its own via `mesh`. Pure functions — the
// Yard view recomputes this on every connection change.
import { NodeRole } from "./proto_gen";
import { isMissing, isHidden, type Connection, type Entry } from "./connection";
import { linkStyle } from "./mesh";

export interface TopoNode {
  id: string;
  name: string;
  entry: Entry;
  usb: boolean;
  bridge: boolean;
  conductor: boolean;
  missing: boolean;
  depth: number; // hops from the root over live links; -1 = unreachable
  batteryRelay: boolean; // a battery repeater (docs §6m): relays only while the show runs
  // Reaches the root only through a battery repeater — cut off while it
  // sleeps. The repeater's id, or undefined.
  viaBattery?: string;
}

export interface TopoLink {
  k: string; // "a|b", a < b
  a: string;
  b: string;
  rssi: number; // the weaker direction — the one that fails first
  rssiAB?: number; // as a hears b
  rssiBA?: number;
  lost: boolean; // an end is missing
  color: string;
  w: number;
  dash: string;
}

export interface Topology {
  nodes: TopoNode[];
  links: TopoLink[];
  root: string | null; // the conductor (the bridge, normally)
  maxDepth: number;
}

export function buildTopology(c: Connection, now = Date.now()): Topology {
  const entries = Object.values(c.entries).filter((e) => !isHidden(e.node)); // hidden boards are off the map too
  const ids = new Set(entries.map((e) => e.node));
  const roleOf = (e: Entry) => (e.usb ? e.hello?.role ?? 0 : e.hb?.role ?? 0);

  // Collect directed reports, then merge into undirected links.
  const directed = new Map<string, number>(); // "from>to" -> rssi as `from` hears `to`
  for (const n of c.local?.neighbors ?? []) directed.set(`${c.hello.node}>${n.node}`, n.rssi);
  for (const e of entries) for (const n of e.hb?.nbrs ?? []) directed.set(`${e.node}>${n.node}`, n.rssi);

  const missing = new Set(entries.filter((e) => isMissing(e, now)).map((e) => e.node));
  const links = new Map<string, TopoLink>();
  for (const [key, rssi] of directed) {
    const [from, to] = key.split(">");
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    const [a, b] = from < to ? [from, to] : [to, from];
    const k = `${a}|${b}`;
    const l = links.get(k) ?? { k, a, b, rssi: 0, lost: false, color: "", w: 0, dash: "" };
    if (from === a) l.rssiAB = rssi; else l.rssiBA = rssi;
    links.set(k, l);
  }
  for (const l of links.values()) {
    l.rssi = Math.min(...[l.rssiAB, l.rssiBA].filter((x): x is number => x !== undefined));
    l.lost = missing.has(l.a) || missing.has(l.b);
    Object.assign(l, linkStyle(l.rssi, l.lost));
  }

  // A battery repeater: on battery and relaying (docs §6m).
  const batteryRelay = new Set(entries.filter((e) => e.hello?.power === "battery" && (roleOf(e) & NodeRole.RELAY)).map((e) => e.node));

  // Depth: breadth-first from the conductor over live links.
  const conductor = entries.find((e) => roleOf(e) & NodeRole.CONDUCTOR)?.node
    ?? c.local?.conductor ?? null;
  const root = conductor && ids.has(conductor) ? conductor : c.hello.node;
  const depth = new Map<string, number>([[root, 0]]);
  const parent = new Map<string, string>();
  const queue = [root];
  while (queue.length) {
    const at = queue.shift()!;
    for (const l of links.values()) {
      if (l.lost || (l.a !== at && l.b !== at)) continue;
      const other = l.a === at ? l.b : l.a;
      if (depth.has(other)) continue;
      depth.set(other, depth.get(at)! + 1);
      parent.set(other, at);
      queue.push(other);
    }
  }
  // The same walk, but never THROUGH a battery repeater: whoever it misses
  // depends on one (named by the first repeater up its route).
  const solid = new Set([root]);
  const q2 = [root];
  while (q2.length) {
    const at = q2.shift()!;
    if (at !== root && batteryRelay.has(at)) continue;
    for (const l of links.values()) {
      if (l.lost || (l.a !== at && l.b !== at)) continue;
      const other = l.a === at ? l.b : l.a;
      if (!solid.has(other)) { solid.add(other); q2.push(other); }
    }
  }
  const viaBattery = (id: string) => {
    if (solid.has(id) || !depth.has(id)) return undefined;
    for (let at = parent.get(id); at; at = parent.get(at)) if (batteryRelay.has(at)) return at;
    return undefined;
  };

  const nodes: TopoNode[] = entries.map((e) => {
    const role = roleOf(e);
    return {
      id: e.node,
      name: e.hello?.name || e.node,
      entry: e,
      usb: e.usb,
      bridge: !!(role & NodeRole.BRIDGE),
      conductor: !!(role & NodeRole.CONDUCTOR),
      missing: missing.has(e.node),
      batteryRelay: batteryRelay.has(e.node),
      viaBattery: viaBattery(e.node),
      // A node with no link report yet (just heard, before its first
      // neighbor table fills) still has a hop count from its heartbeat.
      depth: depth.get(e.node) ?? (missing.has(e.node) ? -1 : (e.hb ? e.hb.hops + 1 : -1)),
    };
  }).sort((x, y) => x.id.localeCompare(y.id));

  return {
    nodes,
    links: [...links.values()],
    root,
    maxDepth: Math.max(0, ...nodes.map((n) => n.depth)),
  };
}

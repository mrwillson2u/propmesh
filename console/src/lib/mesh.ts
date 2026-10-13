// Mock mesh model + 1 s live simulation, ported from the design
// handoff's Survey prototype logic. Replace the simulation with the
// bridge's WebSocket telemetry stream when it exists — the shapes here
// are what the bridge API should serve.
import { useEffect, useRef, useState } from "react";
import { C } from "./tokens";
import type { PropType } from "./propIcons";

export type NodeStatus = "online" | "asleep" | "low" | "missing";

export interface YardNode {
  id: string;
  name: string;
  x: number; // survey canvas position (viewBox 1080×700)
  y: number;
  bx: number; // blueprint position (viewBox 1140×700)
  by: number;
  pro: boolean;
  status: NodeStatus;
  hop: number;
  fw: string;
  mem: number | null;
  up: string;
  route: string;
  batt?: number;
  prop: PropType; // what this node drives — node config, set by the user
}

export interface YardLink {
  k: string;
  a: string;
  b: string;
  rssi: number;
  lost?: boolean;
}

export interface NodeEvent {
  t: string;
  s: string;
  warn?: boolean;
}

export interface Channel {
  code: string;
  label: string;
  state: string;
  kind: "output" | "input";
  on?: boolean;
  detail?: string;
}

export const NODES: YardNode[] = [
  { id: "bridge", name: "Bridge (garage)", x: 520, y: 110, bx: 775, by: 250, pro: true, status: "online", hop: 0, fw: "v0.9.4", mem: 141, up: "6d 02h", route: "— (root)", prop: "hub" },
  { id: "pir", name: "Driveway PIR", x: 180, y: 140, bx: 880, by: 480, pro: false, status: "missing", hop: 1, fw: "v0.9.4", mem: null, up: "—", route: "was H1 via Bridge", batt: 3.71, prop: "sensor" },
  { id: "skeleton", name: "Front Porch Skeleton", x: 270, y: 300, bx: 445, by: 430, pro: true, status: "online", hop: 1, fw: "v0.9.3", mem: 104, up: "2d 14h", route: "H1 via Bridge", prop: "skull" },
  { id: "fog", name: "Fog Chiller", x: 740, y: 260, bx: 640, by: 130, pro: true, status: "online", hop: 1, fw: "v0.9.4", mem: 96, up: "2d 14h", route: "H1 via Bridge", prop: "fog" },
  { id: "graveyard", name: "Graveyard Servo Rig", x: 820, y: 470, bx: 230, by: 500, pro: true, status: "online", hop: 2, fw: "v0.9.3", mem: 118, up: "2d 14h", route: "H2 via Fog Chiller", prop: "tombstone" },
  { id: "l1", name: "Lantern 1", x: 150, y: 470, bx: 150, by: 560, pro: false, status: "asleep", hop: 2, fw: "v0.9.4", mem: 38, up: "11h 20m", route: "H2 via Skeleton", batt: 3.92, prop: "lantern" },
  { id: "l2", name: "Lantern 2", x: 400, y: 520, bx: 290, by: 565, pro: false, status: "online", hop: 2, fw: "v0.9.4", mem: 41, up: "11h 20m", route: "H2 via Skeleton", batt: 3.41, prop: "lantern" },
  { id: "l3", name: "Lantern 3", x: 610, y: 600, bx: 360, by: 560, pro: false, status: "low", hop: 3, fw: "v0.9.4", mem: 39, up: "11h 19m", route: "H3 via Graveyard Rig", batt: 3.18, prop: "pumpkin" },
];

export const LINKS: YardLink[] = [
  { k: "b-sk", a: "bridge", b: "skeleton", rssi: -52 },
  { k: "b-fg", a: "bridge", b: "fog", rssi: -48 },
  { k: "b-pir", a: "bridge", b: "pir", rssi: -79, lost: true },
  { k: "sk-l1", a: "skeleton", b: "l1", rssi: -71 },
  { k: "sk-l2", a: "skeleton", b: "l2", rssi: -68 },
  { k: "fg-gr", a: "fog", b: "graveyard", rssi: -61 },
  { k: "gr-l3", a: "graveyard", b: "l3", rssi: -83 },
];

export const PARENT: Record<string, string> = {
  skeleton: "b-sk", fog: "b-fg", pir: "b-pir", l1: "sk-l1", l2: "sk-l2",
  graveyard: "fg-gr", l3: "gr-l3",
};

export const EVENTS: Record<string, NodeEvent[]> = {
  bridge: [
    { t: "20:44:02", s: "cue Ambient Fog dispatched" },
    { t: "20:43:30", s: "sACN stream idle" },
    { t: "20:42:11", s: "cue Driveway Scare → lockout" },
    { t: "20:02:33", s: "lost Driveway PIR", warn: true },
  ],
  pir: [
    { t: "20:02:33", s: "link lost (last −79 dBm)", warn: true },
    { t: "20:01:50", s: "battery 3.71 V reported" },
    { t: "19:58:12", s: "motion CLEAR" },
    { t: "19:57:44", s: "motion DETECT → cue fired" },
  ],
  skeleton: [
    { t: "20:42:11", s: "fired SERVO_1 coffin lid" },
    { t: "20:42:11", s: "fired LED_STRIP_1 eye glow" },
    { t: "20:31:02", s: "PIR_1 motion → cue matched" },
    { t: "19:02:10", s: "firmware check: v0.9.4 available" },
  ],
  fog: [
    { t: "20:44:02", s: "RELAY_1 fog machine ON (8 s)" },
    { t: "20:39:00", s: "fog burst complete" },
    { t: "20:38:41", s: "TEMP_1 12.4 °C" },
  ],
  graveyard: [
    { t: "20:42:11", s: "fired SERVO_1 coffin lid" },
    { t: "20:42:11", s: "cue Graveyard Rustle matched" },
    { t: "20:38:54", s: "route change → Fog Chiller" },
    { t: "20:14:47", s: "link Lantern 3 weak (−83)", warn: true },
  ],
  l1: [
    { t: "20:30:00", s: "deep sleep until :00/:30" },
    { t: "20:29:58", s: "battery 3.92 V" },
  ],
  l2: [
    { t: "20:44:00", s: "flicker pattern running" },
    { t: "20:29:58", s: "battery 3.41 V" },
  ],
  l3: [
    { t: "20:44:00", s: "flicker pattern running" },
    { t: "20:29:58", s: "battery 3.18 V LOW", warn: true },
    { t: "20:14:47", s: "parent link weak −83 dBm", warn: true },
  ],
};

export const CHANNELS: Record<string, Channel[]> = {
  skeleton: [
    { code: "SERVO_1", label: "coffin lid", state: "idle · 0°", kind: "output" },
    { code: "SERVO_2", label: "jaw snap", state: "idle · 12°", kind: "output" },
    { code: "RELAY_1", label: "porch spot light", state: "● ON", kind: "output", on: true },
    { code: "LED_STRIP_1", label: "eye glow", state: "off · 30 px", kind: "output" },
    { code: "PIR_1", label: "porch sensor", state: "CLEAR", kind: "input", detail: "last motion 20:42:09 · 3 fires tonight" },
  ],
  bridge: [
    { code: "LED_STRIP_1", label: "garage eaves", state: "off · 60 px", kind: "output" },
    { code: "RELAY_1", label: "spare", state: "off", kind: "output" },
    { code: "AUDIO_OUT", label: "yard speaker", state: "idle", kind: "output" },
  ],
  fog: [
    { code: "RELAY_1", label: "fog machine", state: "● ON", kind: "output", on: true },
    { code: "MOTOR_A", label: "chiller fan", state: "idle · 0%", kind: "output" },
    { code: "TEMP_1", label: "chiller temp", state: "12.4 °C", kind: "input" },
  ],
  graveyard: [
    { code: "SERVO_1", label: "coffin lid", state: "idle · 0°", kind: "output" },
    { code: "SERVO_2", label: "hand reach", state: "idle · 0°", kind: "output" },
    { code: "SERVO_3", label: "headstone tilt", state: "idle · 0°", kind: "output" },
    { code: "MOTOR_A", label: "shaker", state: "idle · 0%", kind: "output" },
    { code: "PIR_2", label: "path sensor", state: "CLEAR", kind: "input" },
  ],
  l1: [{ code: "LED_STRIP_1", label: "flicker candle", state: "asleep", kind: "output" }],
  l2: [{ code: "LED_STRIP_1", label: "flicker candle", state: "flickering", kind: "output" }],
  l3: [{ code: "LED_STRIP_1", label: "flicker candle", state: "flickering", kind: "output" }],
  pir: [{ code: "PIR_1", label: "driveway sensor", state: "— missing", kind: "input", detail: "used by cue “Driveway Scare”" }],
};

export function statusStroke(st: NodeStatus): string {
  return st === "online" ? C.green : st === "asleep" ? C.t4 : st === "low" ? C.amber : C.red;
}

// [bg, border, fg, label]
export function statusPill(st: NodeStatus): [string, string, string, string] {
  if (st === "online") return [C.greenBg, C.greenB, C.green, "ONLINE"];
  if (st === "asleep") return [C.raised, C.b3, C.t4, "☾ ASLEEP"];
  if (st === "low") return [C.amberBg, C.amberB, C.amber, "LOW BATT"];
  return [C.redBg, C.redB, C.red, "✕ MISSING"];
}

export function linkStyle(rssi: number, lost?: boolean) {
  if (lost) return { color: C.red, w: 1.4, dash: "4 5" };
  if (rssi >= -60) return { color: C.green, w: 2.5, dash: "" };
  if (rssi >= -75) return { color: C.linkGray, w: 1.8, dash: "" };
  return { color: C.amber, w: 1.3, dash: "6 4" };
}

export interface Mesh {
  tick: number;
  rssiOf: (k: string) => number;
  counts: { online: number; asleep: number; missing: number };
  sync: string;
}

// A link with this tick's RSSI, its display style, and both layouts'
// endpoints resolved. Both yard layouts render from this one list so
// they can never disagree about the mesh.
export interface LiveLink extends YardLink {
  rssi: number;
  color: string;
  w: number;
  dash: string;
  x1: number; y1: number; x2: number; y2: number;  // topology
  lab: string;
}

export function useLiveLinks(mesh: Mesh): LiveLink[] {
  return LINKS.map((l) => {
    const rssi = mesh.rssiOf(l.k);
    const st = linkStyle(rssi, l.lost);
    const A = NODES.find((n) => n.id === l.a)!;
    const B = NODES.find((n) => n.id === l.b)!;
    return {
      ...l, rssi, ...st,
      x1: A.x, y1: A.y, x2: B.x, y2: B.y,
      lab: l.lost ? "LOST 42m" : String(rssi),
    };
  });
}

// 1 s telemetry tick: RSSI random-walks ±4 dBm around each link's base.
export function useMesh(): Mesh {
  const [tick, setTick] = useState(0);
  const jit = useRef<Record<string, number>>({});
  useEffect(() => {
    const iv = setInterval(() => {
      for (const l of LINKS) {
        const d = (jit.current[l.k] || 0) + (Math.random() - 0.5) * 2.4;
        jit.current[l.k] = Math.max(-4, Math.min(4, d));
      }
      setTick((t) => t + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  const counts = { online: 0, asleep: 0, missing: 0 };
  for (const n of NODES) counts[n.status === "low" ? "online" : n.status]++;

  return {
    tick,
    rssiOf: (k) => {
      const b = LINKS.find((l) => l.k === k)!;
      return Math.round(b.rssi + (jit.current[k] || 0));
    },
    counts,
    sync: "±" + (2.1 + (tick % 3) * 0.1).toFixed(1) + " ms",
  };
}

// A generic-board node's config: which pins the user assigned to which
// function. This is the document the node stores as /config.json and
// the console sends with set_config — docs/generic-boards.md. Each
// entry is a logical channel; `SERVO_2` is { kind: "SERVO", index: 2 }.
import { FUNCTIONS, type ChannelKindName } from "./boards_gen";

export type Pull = "none" | "up" | "down";

export interface ChannelCfg {
  kind: ChannelKindName;
  index: number; // 1-based
  label: string;
  pins: number[]; // in FUNCTIONS[kind].pins role order
  active_low?: boolean; // RELAY, DIGITAL_IN
  pull?: Pull; // DIGITAL_IN
  min_us?: number; // SERVO: pulse at 0 %
  max_us?: number; // SERVO: pulse at 100 % — below min_us = reversed
  travel_ms?: number; // SERVO smoothing: full sweep at cruise, 0 = snap
  ease_ms?: number; // SERVO smoothing: time to reach cruise speed
  pixels?: number; // LED_STRIP
  light?: number; // BLE_LIGHT: the light's number in the BRMesh app
}

// Outputs whose value is a color (0xRRGGBB, 0 = off) rather than a level.
export const isColor = (kind: string) => kind === "LED_STRIP" || kind === "BLE_LIGHT";

export interface NodeConfig {
  v: 1;
  name: string;
  // A bridge drives no pins: it is the console's way into the mesh and
  // the mesh's clock. docs/generic-boards.md §1.
  bridge?: boolean;
  brmesh_key?: string; // 8 hex digits from the BRMesh app, for BLE_LIGHT channels
  // Bridge only: the home WiFi it joins (docs §6d). The board reports
  // ssid + pass_set; `pass` is only ever sent, and only when changed.
  wifi?: { ssid: string; pass?: string; pass_set?: boolean };
  // "battery": a leaf that never relays (and later sleeps between triggers); "mains" (default) relays.
  power?: "mains" | "battery";
  // Sleep on battery (docs §6f): show tier listens window_ms of every interval_ms;
  // off tier deep-sleeps, checking in every checkin_min minutes.
  sleep?: { interval_ms: number; window_ms: number; checkin_ms: number };
  channels: ChannelCfg[];
}

export const EMPTY_CONFIG: NodeConfig = { v: 1, name: "", bridge: false, channels: [] };

// Limits the node enforces (pm_config.h).
export const MAX_CHANNELS = 16;
export const SERVO_MIN_US = 400;
export const SERVO_MAX_US = 2600;
export const SERVO_MIN_TRAVEL_US = 50;
export const MAX_TRAVEL_MS = 10000;
export const MAX_EASE_MS = 5000;

// Servo smoothing presets (firmware pm_motion.h). Off snaps — right for
// a jump scare; the rest trade speed for a natural, creepier move.
export const SMOOTHING = [
  { id: "off", label: "Off — snap", travel_ms: 0, ease_ms: 0 },
  { id: "snappy", label: "Snappy", travel_ms: 250, ease_ms: 80 },
  { id: "smooth", label: "Smooth", travel_ms: 600, ease_ms: 200 },
  // Between Smooth and Slow in speed, but with the softest ease: jerk at
  // start and stop comes from the ease, so this one rounds them most
  // (added 2026-10-05 — Smooth still felt abrupt on the heads prop).
  { id: "gentle", label: "Gentle", travel_ms: 1000, ease_ms: 450 },
  { id: "slow", label: "Slow", travel_ms: 1500, ease_ms: 400 },
] as const;
export const STRIP_MAX_PIXELS = 300;
export const LABEL_MAX = 23;
export const NAME_MAX = 31;

export const channelCode = (c: { kind: string; index: number }) => `${c.kind}_${c.index}`;

// A new channel of `kind` on `gpio`, with the lowest free index and the
// same defaults the firmware applies to missing fields.
export function newChannel(cfg: NodeConfig, kind: ChannelKindName, gpio: number): ChannelCfg {
  const used = new Set(cfg.channels.filter((c) => c.kind === kind).map((c) => c.index));
  let index = 1;
  while (used.has(index)) index++;
  const c: ChannelCfg = { kind, index, label: "", pins: [gpio] };
  if (kind === "RELAY") c.active_low = false;
  if (kind === "DIGITAL_IN") { c.active_low = false; c.pull = "none"; }
  if (kind === "SERVO") { c.min_us = 500; c.max_us = 2500; c.travel_ms = 0; c.ease_ms = 0; }
  if (kind === "LED_STRIP") c.pixels = 30;
  return c;
}

export const pinRole = (c: ChannelCfg, gpio: number) =>
  FUNCTIONS[c.kind].pins[c.pins.indexOf(gpio)]?.role ?? "";

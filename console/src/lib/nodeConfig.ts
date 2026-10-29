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
  pixels?: number; // LED_STRIP / SPI_STRIP
  order?: ColorOrder; // strips: color order on the wire (WS2812 grb, SK9822 bgr)
  effect?: StripEffect; // strips: what they show — the set color, or a running effect the color only switches on/off
  fire?: FireCfg; // when effect is "fire"
  candle?: CandleCfg; // CANDLE (active_low: the LED is on when its pin is LOW)
  divider?: number; // BATTERY: (R_top + R_bottom) / R_bottom; 100k / 100k = 2.0
  light?: number; // BLE_LIGHT: the light's number in the BRMesh app
}

export type ColorOrder = "grb" | "rgb" | "bgr";
export type StripEffect = "solid" | "fire";

// Fire2023 on a strip laid out as w × h vertical columns (firmware
// pm_fire.h; the layout is pm_fire_pixel in pm_config.h). The lantern
// prop's values are the defaults.
export interface FireCfg {
  w: number; h: number;
  zigzag: boolean; // each column runs back the other way (serpentine wiring)
  brightness: number; // 0–255
  speed: number; // flame noise speed
  flame10: number; // flame height × 10 — taller flames with higher values
  noise: number; // flame noise scale: small = soft, big = blinky
  smoke_speed: number;
  smoke_dim: number; // smoke thickness: lower = brighter flames
  smoke_scale: number;
  from_top?: boolean; // the strip starts at the top (data comes in from above); absent = at the bottom
}
export const FIRE_DEFAULTS: FireCfg = { w: 2, h: 4, zigzag: true, brightness: 128, speed: 2, flame10: 30, noise: 0, smoke_speed: 25, smoke_dim: 250, smoke_scale: 125 };

// CANDLE (firmware pm_candle_core.h, docs §6n): an electric candle's LED and
// the coil that swings its flame. The defaults are the candle sketch's.
export interface CandleCfg {
  drama10: number; // every effect × 10: 0 calm, 10 normal, 15 wild
  floor: number; // dimmest the flame gets, % (0–30)
  gust_s: number; // mean seconds between gusts (2–255)
  sputter_s: number; // mean seconds between near-blowouts; 0 = never (≤ 3600)
  swing_chz: number; // flame swing frequency, Hz × 100 (50–800)
  kick_ms: number; // coil pulse width (4–80)
  coil: boolean; // swing the flame at all
  draft?: number; // 1-8: candles in the same draft gust and sputter together (from the mesh clock); 0/absent = alone
}
export const CANDLE_DEFAULTS: CandleCfg = { drama10: 10, floor: 3, gust_s: 18, sputter_s: 150, swing_chz: 270, kick_ms: 25, coil: true };

export const isStrip = (kind: string) => kind === "LED_STRIP" || kind === "SPI_STRIP";
// Outputs whose value is a color (0xRRGGBB, 0 = off) rather than a level.
export const isColor = (kind: string) => isStrip(kind) || kind === "BLE_LIGHT";

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
  // relay: a battery repeater (docs §6m) — awake and relaying while the show
  // runs, deep sleep when it's off.
  sleep?: { interval_ms: number; window_ms: number; checkin_ms: number; relay?: boolean };
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
  if (kind === "LED_STRIP") { c.pixels = 30; c.order = "grb"; c.effect = "solid"; }
  if (kind === "SPI_STRIP") { c.pixels = 8; c.order = "bgr"; c.effect = "solid"; }
  if (kind === "CANDLE") { c.active_low = false; c.candle = { ...CANDLE_DEFAULTS }; }
  if (kind === "BATTERY") c.divider = 2;
  return c;
}

export const pinRole = (c: ChannelCfg, gpio: number) =>
  FUNCTIONS[c.kind].pins[c.pins.indexOf(gpio)]?.role ?? "";

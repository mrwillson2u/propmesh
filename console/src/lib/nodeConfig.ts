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
  pixels?: number; // LED_STRIP
}

export interface NodeConfig {
  v: 1;
  name: string;
  // A bridge drives no pins: it is the console's way into the mesh and
  // the mesh's clock. docs/generic-boards.md §1.
  bridge?: boolean;
  channels: ChannelCfg[];
}

export const EMPTY_CONFIG: NodeConfig = { v: 1, name: "", bridge: false, channels: [] };

// Limits the node enforces (pm_config.h).
export const MAX_CHANNELS = 16;
export const SERVO_MIN_US = 400;
export const SERVO_MAX_US = 2600;
export const SERVO_MIN_TRAVEL_US = 50;
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
  if (kind === "SERVO") { c.min_us = 500; c.max_us = 2500; }
  if (kind === "LED_STRIP") c.pixels = 30;
  return c;
}

export const pinRole = (c: ChannelCfg, gpio: number) =>
  FUNCTIONS[c.kind].pins[c.pins.indexOf(gpio)]?.role ?? "";

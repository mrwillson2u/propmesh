// Pin recommendations — advice, not rules. The board profile names a
// best use (and other good uses) per pin, plus a line per function on
// why; pinRules.ts decides what is allowed. Kept apart so a tip can
// never block a save.
import { type Board, type BoardPin, type ChannelKindName } from "./boards_gen";
import { channelCode, type NodeConfig } from "./nodeConfig";

// Guide order: what moves, what switches, what lights, what senses.
export const GUIDE_ORDER: ChannelKindName[] = ["SERVO", "MOTOR", "RELAY", "LED_STRIP", "SPI_STRIP", "LED", "DIGITAL_IN"];

// Plural, lower-case names for sentences ("better for servos").
export const SHORT: Record<ChannelKindName, string> = {
  RELAY: "relays", LED: "LED dimmers", SERVO: "servos", MOTOR: "DC motors",
  LED_STRIP: "LED strips", SPI_STRIP: "clocked LED strips", DIGITAL_IN: "sensors & buttons", BLE_LIGHT: "Bluetooth lights",
};

export const isBest = (p: BoardPin, k: ChannelKindName) => p.best === k;
export const isGood = (p: BoardPin, k: ChannelKindName) => p.best === k || !!p.also?.includes(k);

// Which channel (if any) holds a pin in the draft.
export const holder = (cfg: NodeConfig, gpio: number) => cfg.channels.find((c) => c.pins.includes(gpio));

// Pins recommended for `kind`, best first, then other good ones.
export function pinsFor(board: Board, kind: ChannelKindName) {
  return {
    best: board.pins.filter((p) => isBest(p, kind)),
    also: board.pins.filter((p) => p.also?.includes(kind)),
  };
}

export interface Tip {
  channel: number;
  text: string;
}

// For every channel on a pin that isn't recommended for it: where it
// would sit better, among pins still free.
export function tips(board: Board, cfg: NodeConfig): Tip[] {
  const out: Tip[] = [];
  cfg.channels.forEach((c, i) => {
    c.pins.forEach((gpio) => {
      const pin = board.pins.find((p) => p.gpio === gpio);
      if (!pin || isGood(pin, c.kind)) return;
      const { best, also } = pinsFor(board, c.kind);
      const free = (ps: BoardPin[]) => ps.filter((p) => !holder(cfg, p.gpio)).map((p) => p.label);
      const better = free(best).length ? free(best) : free(also);
      if (!better.length) return;
      const why = board.guide[c.kind];
      const name = c.label ? `${channelCode(c)} (${c.label})` : channelCode(c);
      out.push({
        channel: i,
        text: `${name} on ${pin.label} works, but ${SHORT[c.kind]} are better on ${better.slice(0, 4).join(", ")}${better.length > 4 ? "…" : ""}${why ? ` — ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ""}`,
      });
    });
  });
  return out;
}

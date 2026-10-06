// Is this pin assignment safe on this board? Mirror of the node's
// pm_pinrules.h over the same generated tables (boards_gen.ts), with
// the same issue codes. This copy exists so the editor can explain a
// problem as you make it; THE NODE IS THE AUTHORITY — set_config runs
// the firmware's validator and its verdict is what gets shown on save.
import { Cap, FUNCTIONS, type Board } from "./boards_gen";
import {
  MAX_CHANNELS, MAX_EASE_MS, MAX_TRAVEL_MS, SERVO_MAX_US, SERVO_MIN_TRAVEL_US, SERVO_MIN_US, STRIP_MAX_PIXELS,
  channelCode, type NodeConfig,
} from "./nodeConfig";

export interface Issue {
  code: string;
  error: boolean; // false = warning: allowed, but shown
  channel: number; // index into config.channels, -1 = whole config
  gpio?: number;
}

export function validate(board: Board, cfg: NodeConfig): Issue[] {
  const out: Issue[] = [];
  const add = (code: string, error: boolean, channel: number, gpio?: number) =>
    out.push({ code, error, channel, gpio });
  if (cfg.channels.length > MAX_CHANNELS) return [{ code: "too_many_channels", error: true, channel: -1 }];

  if (cfg.bridge && cfg.channels.length) add("bridge_has_pins", true, -1);

  let ledc = 0, rmt = 0;
  cfg.channels.forEach((c, i) => {
    const f = FUNCTIONS[c.kind];
    if (!f) return add("unknown_kind", true, i);
    if (!(c.index >= 1)) add("bad_index", true, i);
    if (cfg.channels.slice(0, i).some((o) => o.kind === c.kind && o.index === c.index))
      add("duplicate_channel", true, i);
    if (c.pins.length !== f.pins.length) return add("pin_count", true, i);

    c.pins.forEach((gpio, p) => {
      const bp = board.pins.find((x) => x.gpio === gpio);
      if (!bp) return add("no_such_pin", true, i, gpio);
      if (bp.tier === "reserved") return add("pin_reserved", true, i, gpio);
      const need = f.pins[p].need;
      if ((bp.caps & need) !== need) add("pin_cannot", true, i, gpio);
      else if (bp.tier === "caution") add("pin_caution", false, i, gpio);

      const taken = c.pins.slice(0, p).includes(gpio) ||
        cfg.channels.slice(0, i).some((o) => o.pins.includes(gpio));
      if (taken) add("pin_taken", true, i, gpio);

      if (c.kind === "DIGITAL_IN") {
        if (c.pull === "up" && !(bp.caps & Cap.PULLUP)) add("no_pull", true, i, gpio);
        if (c.pull === "down" && !(bp.caps & Cap.PULLDOWN)) add("no_pull", true, i, gpio);
      }
    });

    if (c.kind === "SERVO") {
      const lo = c.min_us ?? 500, hi = c.max_us ?? 2500;
      const inRange = (us: number) => us >= SERVO_MIN_US && us <= SERVO_MAX_US;
      // Either way round (min above max = reversed), but apart.
      if (!inRange(lo) || !inRange(hi) || Math.abs(hi - lo) < SERVO_MIN_TRAVEL_US) add("servo_range", true, i);
    }
    if (c.kind === "SERVO" && ((c.travel_ms ?? 0) > MAX_TRAVEL_MS || (c.ease_ms ?? 0) > MAX_EASE_MS))
      add("servo_motion", true, i);
    if (c.kind === "LED_STRIP") {
      const n = c.pixels ?? 30;
      if (!(n >= 1 && n <= STRIP_MAX_PIXELS)) add("pixel_count", true, i);
    }
    ledc += f.ledc;
    rmt += f.rmt;
  });
  if (ledc > board.ledcChannels) add("pwm_budget", true, -1);
  if (rmt > board.rmtTxChannels) add("strip_budget", true, -1);
  return out;
}

// One sentence a person can act on. Codes: pm_pinrules.h.
export function issueText(board: Board, cfg: NodeConfig, it: Issue): string {
  const c = cfg.channels[it.channel];
  const who = c ? channelCode(c) : "This node";
  const bp = board.pins.find((x) => x.gpio === it.gpio);
  const pin = bp ? `${bp.label} (GPIO ${bp.gpio})` : `GPIO ${it.gpio}`;
  switch (it.code) {
    case "pin_count":
      return c?.kind === "MOTOR" ? `${who}: choose the second pin (IN2)` : `${who}: wrong number of pins`;
    case "no_such_pin": return `${who}: ${pin} is not on this board`;
    case "pin_reserved": return `${who}: ${pin} is reserved — ${bp?.note ?? ""}`;
    case "pin_cannot": return `${who}: ${pin} can't do this${bp?.note ? ` — ${bp.note}` : ""}`;
    case "pin_caution": return `${pin}: ${bp?.note ?? "use with care"}`;
    case "pin_taken": return `${who}: ${pin} is already in use`;
    case "no_pull": return `${who}: ${pin} has no internal pull resistor — set pull to "none" and add one externally`;
    case "servo_range": return `${who}: min and max must each be ${SERVO_MIN_US}–${SERVO_MAX_US} µs and at least ${SERVO_MIN_TRAVEL_US} µs apart`;
    case "servo_motion": return `${who}: smoothing must be at most ${MAX_TRAVEL_MS / 1000} s per sweep and ${MAX_EASE_MS / 1000} s to reach speed`;
    case "pixel_count": return `${who}: pixel count must be 1–${STRIP_MAX_PIXELS}`;
    case "pwm_budget": return `Too many PWM outputs — this board has ${board.ledcChannels} PWM channels (a motor uses 2)`;
    case "strip_budget": return `Too many LED strips — this board drives ${board.rmtTxChannels}`;
    case "too_many_channels": return `Too many channels — a node holds ${MAX_CHANNELS}`;
    case "bridge_has_pins": return "A bridge drives no pins — clear the assignments or turn Bridge off";
    case "duplicate_channel": return `${who} is defined twice`;
    default: return `${who}: ${it.code}`;
  }
}

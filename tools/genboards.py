#!/usr/bin/env python3
"""Generate generic-board profiles from boards/*.yaml.

Usage:
    python3 tools/genboards.py           regenerate C header + TS module
    python3 tools/genboards.py --check   exit 1 if generated files are stale (CI)

A profile says what each pin of an off-the-shelf board is ABLE to do;
the user assigns functions to pins in the console. Firmware and console
validate an assignment against the same generated tables, so the UI can
never offer something the node will refuse. Fixed-pin boards (Pro, Mini)
stay in pinmap.yaml / genpins.py.
"""
import sys, json, pathlib, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
BOARDS = ROOT / "boards"
OUTPUTS = {
    "c":  ROOT / "firmware" / "common" / "propmesh" / "src" / "boards_gen.h",
    "ts": ROOT / "console" / "src" / "lib" / "boards_gen.ts",
}

# wake: an RTC / low-power pin — the only kind that can wake the chip
# from deep sleep (ESP32: RTC GPIOs; ESP32-C6: LP GPIO 0-7).
CAPS = {"in": 0x01, "out": 0x02, "pullup": 0x04, "pulldown": 0x08, "adc": 0x10, "wake": 0x20}
TIERS = ["good", "caution", "reserved"]
MAX_FN_PINS = 2
# Functions that move or switch something: never recommend them on a
# pin that glitches at power-up (tier caution) — the whole point of
# the recommendation is "nothing twitches at boot".
QUIET = {"SERVO", "MOTOR", "RELAY"}
# functions.yaml pwm_hz must agree with the project-wide constants.
PWM_CONST = {"LED": "LED_PWM_HZ", "SERVO": "SERVO_PWM_HZ", "MOTOR": "MOTOR_PWM_HZ", "CANDLE": "LED_PWM_HZ"}


def load():
    funcs = yaml.safe_load((BOARDS / "functions.yaml").read_text())["functions"]
    boards = [yaml.safe_load(p.read_text())
              for p in sorted(BOARDS.glob("*.yaml")) if p.name != "functions.yaml"]
    schema = yaml.safe_load((ROOT / "schema" / "messages.yaml").read_text())
    consts = yaml.safe_load((ROOT / "pinmap.yaml").read_text()).get("constants", {})
    return funcs, boards, schema["enums"], consts


def validate(funcs, boards, enums, consts):
    errs = []
    kinds = enums["ChannelKind"]
    if set(funcs) != set(kinds):
        errs.append(f"functions.yaml keys {sorted(funcs)} != ChannelKind "
                    f"{sorted(kinds)} in schema/messages.yaml")
    for name, f in funcs.items():
        if not 0 <= len(f["pins"]) <= MAX_FN_PINS:
            errs.append(f"{name}: needs 0..{MAX_FN_PINS} pins")
        for p in f["pins"]:
            if p["need"] not in CAPS:
                errs.append(f"{name}: unknown capability '{p['need']}'")
        want = consts.get(PWM_CONST.get(name))
        if want is not None and f.get("pwm_hz") != want:
            errs.append(f"{name}: pwm_hz {f.get('pwm_hz')} != {PWM_CONST[name]} "
                        f"{want} in pinmap.yaml")
    ids = set()
    for b in boards:
        bid = b["id"]
        if bid in ids:
            errs.append(f"duplicate board id {bid}")
        ids.add(bid)
        if b["board_type"] not in enums["BoardType"]:
            errs.append(f"{bid}: board_type {b['board_type']} not in BoardType")
        bat = b.get("battery")
        if bat is not None:
            if not isinstance(bat, dict) or "gpio" not in bat or "divider" not in bat:
                errs.append(f"{bid}: battery needs gpio and divider")
            elif bat["gpio"] not in {p["gpio"] for p in b["pins"]}:
                errs.append(f"{bid}: battery gpio {bat['gpio']} is not one of the board's pins")
        hdr = b.get("header")
        if hdr is not None:
            if hdr.get("usb") not in ("top", "bottom"):
                errs.append(f"{bid}: header.usb must be top or bottom")
            listed = {str(x) for x in hdr.get("left", []) + hdr.get("right", [])}
            for p in b["pins"]:
                if p["tier"] != "reserved" and str(p["label"]) not in listed:
                    errs.append(f"{bid}: GPIO {p['gpio']} ({p['label']}) is not in the header drawing")
        seen = {}
        for p in b["pins"]:
            g = p["gpio"]
            if g in seen:
                errs.append(f"{bid}: GPIO {g} listed twice")
            seen[g] = p
            for c in p["caps"]:
                if c not in CAPS:
                    errs.append(f"{bid}: GPIO {g} unknown capability '{c}'")
            if "wake" in p["caps"] and "in" not in p["caps"]:
                errs.append(f"{bid}: GPIO {g} can wake but can't be an input")
            if p["tier"] not in TIERS:
                errs.append(f"{bid}: GPIO {g} unknown tier '{p['tier']}'")
            if p["tier"] == "reserved" and p["caps"]:
                errs.append(f"{bid}: GPIO {g} is reserved but lists caps")
            if p["tier"] != "good" and not p.get("note"):
                errs.append(f"{bid}: GPIO {g} is {p['tier']} and needs a note "
                            f"— the note is the warning the user sees")
            # Recommendations: advice only, but never advice the rules
            # would refuse or warn about.
            recs = ([p["best"]] if p.get("best") else []) + p.get("also", [])
            if p["tier"] != "reserved" and not p.get("best"):
                errs.append(f"{bid}: GPIO {g} has no 'best' use — every usable pin gets a recommendation")
            if p.get("best") in p.get("also", []):
                errs.append(f"{bid}: GPIO {g} lists {p['best']} as both best and also")
            for r in recs:
                f = funcs.get(r)
                if not f:
                    errs.append(f"{bid}: GPIO {g} recommends unknown function '{r}'")
                    continue
                need = CAPS[f["pins"][0]["need"]]
                if capmask(p["caps"]) & need != need:
                    errs.append(f"{bid}: GPIO {g} recommends {r} but can't do it (caps)")
                if r in QUIET and p["tier"] == "caution":
                    errs.append(f"{bid}: GPIO {g} glitches at power-up — don't recommend {r} on it")
        var = b.get("variants")
        if var is not None and (not isinstance(var, list) or not all(isinstance(v, str) and v for v in var)):
            errs.append(f"{bid}: variants must be a list of non-empty strings")
        guide = b.get("guide", {})
        for k in guide:
            if k not in funcs:
                errs.append(f"{bid}: guide entry for unknown function '{k}'")
        for k in {p.get("best") for p in b["pins"]} - {None}:
            if k not in guide:
                errs.append(f"{bid}: pins recommend {k} but the guide has no entry saying why")
    return errs


def capmask(caps):
    m = 0
    for c in caps:
        m |= CAPS[c]
    return m


def cident(s):
    return s.upper().replace("-", "_")


def cstr(s):
    return json.dumps(s, ensure_ascii=False) if s else "nullptr"


def render_c(funcs, boards, enums):
    L = ["// GENERATED FILE — DO NOT EDIT",
         "// Source: boards/*.yaml   Regenerate: python3 tools/genboards.py",
         "",
         "#pragma once",
         "#include <stdint.h>",
         '#include "proto_gen.h"',
         ""]
    for c, v in CAPS.items():
        L.append(f"#define PM_CAP_{c.upper()} 0x{v:02X}")
    L.append("")
    for i, t in enumerate(TIERS):
        L.append(f"#define PM_TIER_{t.upper()} {i}")
    L += ["", f"#define PM_FN_MAX_PINS {MAX_FN_PINS}", "",
          "typedef struct {",
          "    uint8_t gpio;",
          "    uint8_t caps;   // PM_CAP_* mask",
          "    uint8_t tier;   // PM_TIER_*",
          "    const char *label;  // silkscreen",
          "    const char *note;   // warning text, or nullptr",
          "} pm_board_pin_t;",
          "",
          "typedef struct {",
          "    const char *id;",
          "    const char *name;",
          "    const char *mcu;",
          "    uint8_t board_type;  // pm_board_type_t",
          "    uint8_t ledc_channels;",
          "    uint8_t rmt_tx_channels;",
          "    uint8_t battery_gpio;    // 0 = no battery sense",
          "    float battery_divider;   // VBAT = reading * divider",
          "    uint8_t pin_count;",
          "    const pm_board_pin_t *pins;",
          "} pm_board_t;",
          "",
          "typedef struct {",
          "    uint8_t kind;  // pm_channel_kind_t",
          "    const char *name;",
          "    uint8_t pin_count;",
          "    uint8_t need[PM_FN_MAX_PINS];  // PM_CAP_* required per pin",
          "    const char *role[PM_FN_MAX_PINS];",
          "    uint8_t ledc;  // LEDC channels used per instance",
          "    uint8_t rmt;   // RMT TX channels used per instance",
          "    uint32_t pwm_hz;",
          "    int32_t value_min;",
          "    int32_t value_max;",
          "} pm_function_t;",
          "",
          "static const pm_function_t PM_FUNCTIONS[] = {"]
    kinds = enums["ChannelKind"]
    for name in sorted(funcs, key=lambda n: kinds[n]):
        f = funcs[name]
        pins = f["pins"]
        need = ", ".join(f"PM_CAP_{p['need'].upper()}" for p in pins) or "0"
        role = ", ".join(cstr(p["role"]) for p in pins) or "nullptr"
        L.append(f"    {{PM_CHANNEL_KIND_{name}, {cstr(name)}, {len(pins)}, "
                 f"{{{need}}}, {{{role}}}, {f.get('ledc', 0)}, {f.get('rmt', 0)}, "
                 f"{f.get('pwm_hz', 0)}, {f['value']['min']}, {f['value']['max']}}},")
    L += ["};", f"#define PM_FUNCTION_COUNT {len(funcs)}", ""]
    for b in boards:
        cid = cident(b["id"])
        L += [f"// {b['name']} — {b['mcu']}",
              f"static const pm_board_pin_t PM_BOARD_{cid}_PINS[] = {{"]
        for p in b["pins"]:
            caps = " | ".join(f"PM_CAP_{c.upper()}" for c in p["caps"]) or "0"
            L.append(f"    {{{p['gpio']}, {caps}, PM_TIER_{p['tier'].upper()}, "
                     f"{cstr(p['label'])}, {cstr(p.get('note'))}}},")
        L += ["};",
              f"static const pm_board_t PM_BOARD_{cid} = {{",
              f"    {cstr(b['id'])}, {cstr(b['name'])}, {cstr(b['mcu'])},",
              f"    PM_BOARD_TYPE_{b['board_type']}, {b['ledc_channels']}, "
              f"{b['rmt_tx_channels']}, {(b.get('battery') or {}).get('gpio', 0)}, {float((b.get('battery') or {}).get('divider', 0))}f, "
              f"{len(b['pins'])}, PM_BOARD_{cid}_PINS,",
              "};", ""]
    return "\n".join(L)


def render_ts(funcs, boards, enums):
    L = ["// GENERATED FILE — DO NOT EDIT",
         "// Source: boards/*.yaml   Regenerate: python3 tools/genboards.py",
         "",
         'import { ChannelKind } from "./proto_gen";',
         "",
         "export const Cap = {"]
    for c, v in CAPS.items():
        L.append(f"  {c.upper()}: 0x{v:02x},")
    L += ["} as const;", "",
          f"export type PinTier = {' | '.join(json.dumps(t) for t in TIERS)};",
          "",
          "export interface BoardPin {",
          "  gpio: number;",
          "  label: string; // silkscreen",
          "  caps: number; // Cap mask",
          "  tier: PinTier;",
          "  note?: string; // warning text",
          "  best?: ChannelKindName; // recommended use (advice only)",
          "  also?: ChannelKindName[]; // other good uses",
          "}",
          "",
          "export interface Board {",
          "  id: string;",
          "  name: string;",
          "  mcu: string;",
          "  ledcChannels: number;",
          "  rmtTxChannels: number;",
          "  battery?: { gpio: number; divider: number }; // VBAT sense pin, VBAT = reading * divider",
          "  pinoutUrl?: string; // the vendor's pinout page, for the photo-style reference",
          "  // The headers as printed, top to bottom, for the console's pinout drawing;",
          "  // absent when vendors differ (the C6 SuperMini) — shown as a list instead.",
          "  header?: { usb: \"top\" | \"bottom\"; left: string[]; right: string[] };",
          "  // Versions of the board people receive (sellers differ): what to check on",
          "  // the one in hand. Markdown on the site, plain text in the console.",
          "  variants?: string[];",
          "  pins: BoardPin[];",
          "  guide: Partial<Record<ChannelKindName, string>>; // why those pins, per function",
          "}",
          "",
          "export type ChannelKindName = keyof typeof ChannelKind;",
          "",
          "export interface FunctionDef {",
          "  kind: ChannelKindName;",
          "  label: string;",
          "  pins: { role: string; need: number }[];",
          "  ledc: number;",
          "  rmt: number;",
          "  pwmHz: number;",
          "  min: number;",
          "  max: number;",
          "}",
          "",
          "export const FUNCTIONS: Record<ChannelKindName, FunctionDef> = {"]
    kinds = enums["ChannelKind"]
    for name in sorted(funcs, key=lambda n: kinds[n]):
        f = funcs[name]
        pins = ", ".join(f"{{ role: {json.dumps(p['role'])}, need: 0x{CAPS[p['need']]:02x} }}"
                         for p in f["pins"])
        L.append(f"  {name}: {{ kind: {json.dumps(name)}, label: {json.dumps(f['label'])}, "
                 f"pins: [{pins}], ledc: {f.get('ledc', 0)}, rmt: {f.get('rmt', 0)}, "
                 f"pwmHz: {f.get('pwm_hz', 0)}, min: {f['value']['min']}, "
                 f"max: {f['value']['max']} }},")
    L += ["};", "", "export const BOARDS: Record<string, Board> = {"]
    for b in boards:
        L += [f"  {json.dumps(b['id'])}: {{",
              f"    id: {json.dumps(b['id'])},",
              f"    name: {json.dumps(b['name'])},",
              f"    mcu: {json.dumps(b['mcu'])},",
              f"    ledcChannels: {b['ledc_channels']},",
              f"    rmtTxChannels: {b['rmt_tx_channels']},",
              f"    battery: {json.dumps(b['battery']) if b.get('battery') else 'undefined'},",
              f"    pinoutUrl: {json.dumps(b['pinout_url']) if b.get('pinout_url') else 'undefined'},",
              f"    header: {json.dumps({k: ([str(x) for x in v] if isinstance(v, list) else v) for k, v in b['header'].items()}) if b.get('header') else 'undefined'},",
              f"    variants: {json.dumps(b['variants'], ensure_ascii=False) if b.get('variants') else 'undefined'},",
              "    pins: ["]
        for p in b["pins"]:
            note = f", note: {json.dumps(p['note'], ensure_ascii=False)}" if p.get("note") else ""
            if p.get("best"):
                note += f", best: {json.dumps(p['best'])}"
            if p.get("also"):
                note += f", also: {json.dumps(p['also'])}"
            L.append(f"      {{ gpio: {p['gpio']}, label: {json.dumps(p['label'])}, "
                     f"caps: 0x{capmask(p['caps']):02x}, tier: {json.dumps(p['tier'])}{note} }},")
        L += ["    ],", "    guide: {"]
        for k, v in b.get("guide", {}).items():
            L.append(f"      {k}: {json.dumps(v, ensure_ascii=False)},")
        L += ["    },", "  },"]
    L += ["};", ""]
    return "\n".join(L)


def main():
    check = "--check" in sys.argv
    funcs, boards, enums, consts = load()
    errs = validate(funcs, boards, enums, consts)
    if errs:
        print("board profile validation FAILED:", file=sys.stderr)
        for e in errs:
            print("  -", e, file=sys.stderr)
        return 1

    rendered = {"c": render_c(funcs, boards, enums),
                "ts": render_ts(funcs, boards, enums)}
    stale = []
    for key, path in OUTPUTS.items():
        if check:
            if not path.exists() or path.read_text() != rendered[key]:
                stale.append(path.relative_to(ROOT))
        else:
            path.write_text(rendered[key])
            print(f"wrote {path.relative_to(ROOT)}")
    if check:
        if stale:
            print("stale board bindings — run tools/genboards.py:", file=sys.stderr)
            for p in stale:
                print("  -", p, file=sys.stderr)
            return 1
        print("board bindings match boards/*.yaml")
    return 0


if __name__ == "__main__":
    sys.exit(main())

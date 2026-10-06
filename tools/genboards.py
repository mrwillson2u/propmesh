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

CAPS = {"in": 0x01, "out": 0x02, "pullup": 0x04, "pulldown": 0x08, "adc": 0x10}
TIERS = ["good", "caution", "reserved"]
MAX_FN_PINS = 2
# functions.yaml pwm_hz must agree with the project-wide constants.
PWM_CONST = {"LED": "LED_PWM_HZ", "SERVO": "SERVO_PWM_HZ", "MOTOR": "MOTOR_PWM_HZ"}


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
        if not 1 <= len(f["pins"]) <= MAX_FN_PINS:
            errs.append(f"{name}: needs 1..{MAX_FN_PINS} pins")
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
        seen = {}
        for p in b["pins"]:
            g = p["gpio"]
            if g in seen:
                errs.append(f"{bid}: GPIO {g} listed twice")
            seen[g] = p
            for c in p["caps"]:
                if c not in CAPS:
                    errs.append(f"{bid}: GPIO {g} unknown capability '{c}'")
            if p["tier"] not in TIERS:
                errs.append(f"{bid}: GPIO {g} unknown tier '{p['tier']}'")
            if p["tier"] == "reserved" and p["caps"]:
                errs.append(f"{bid}: GPIO {g} is reserved but lists caps")
            if p["tier"] != "good" and not p.get("note"):
                errs.append(f"{bid}: GPIO {g} is {p['tier']} and needs a note "
                            f"— the note is the warning the user sees")
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
        need = ", ".join(f"PM_CAP_{p['need'].upper()}" for p in pins)
        role = ", ".join(cstr(p["role"]) for p in pins)
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
              f"{b['rmt_tx_channels']}, {len(b['pins'])}, PM_BOARD_{cid}_PINS,",
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
          "}",
          "",
          "export interface Board {",
          "  id: string;",
          "  name: string;",
          "  mcu: string;",
          "  ledcChannels: number;",
          "  rmtTxChannels: number;",
          "  pins: BoardPin[];",
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
              "    pins: ["]
        for p in b["pins"]:
            note = f", note: {json.dumps(p['note'], ensure_ascii=False)}" if p.get("note") else ""
            L.append(f"      {{ gpio: {p['gpio']}, label: {json.dumps(p['label'])}, "
                     f"caps: 0x{capmask(p['caps']):02x}, tier: {json.dumps(p['tier'])}{note} }},")
        L += ["    ],", "  },"]
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

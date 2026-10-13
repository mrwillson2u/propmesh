#!/usr/bin/env python3
"""Generate firmware pin headers from pinmap.yaml.

Usage:
    python3 tools/genpins.py           regenerate headers
    python3 tools/genpins.py --check   exit 1 if headers are stale (CI)
"""
import sys, pathlib, yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
PINMAP = ROOT / "pinmap.yaml"
OUTDIR = ROOT / "firmware" / "common"


def expand_pins(spec):
    """Expand a list of ints and "a-b" range strings into a set of ints."""
    pins = set()
    for item in spec or []:
        if isinstance(item, int):
            pins.add(item)
        else:
            a, b = str(item).split("-")
            pins.update(range(int(a), int(b) + 1))
    return pins


def pca_chips(board):
    """pinmap allows one PCA9685 (a mapping) or several (a list with ids)."""
    pca = board.get("pca9685")
    if not pca:
        return []
    return pca if isinstance(pca, list) else [pca]


def validate(name, board):
    """Catch the mistakes that cost an evening at bring-up."""
    errs = []
    seen = {}
    valid = expand_pins(board.get("valid_pins"))
    adc = expand_pins(board.get("adc_pins"))
    for sig, d in board["gpio"].items():
        pin = d["pin"]
        if pin in seen:
            errs.append(f"{name}: GPIO {pin} assigned to both {seen[pin]} and {sig}")
        seen[pin] = sig
        if d["dir"] not in ("in", "out", "bidir", "adc"):
            errs.append(f"{name}: {sig} has unknown dir '{d['dir']}'")
        if valid and pin not in valid:
            errs.append(f"{name}: {sig} on GPIO {pin} — pin does not exist "
                        f"on {board['mcu']}")
        if adc and d["dir"] == "adc" and pin not in adc:
            errs.append(f"{name}: {sig} is dir=adc but GPIO {pin} is not "
                        f"ADC-capable")

    chips = pca_chips(board)
    addrs, sigs = {}, {}
    for chip in chips:
        cid = chip.get("id", "PCA9685")
        if chip["addr"] in addrs:
            errs.append(f"{name}: PCA9685 address 0x{chip['addr']:02X} used by both {addrs[chip['addr']]} and {cid}")
        addrs[chip["addr"]] = cid
        ch = {}
        for sig, c in chip.get("channels", {}).items():
            if c in ch:
                errs.append(f"{name}: PCA9685 {cid} ch {c} assigned to both {ch[c]} and {sig}")
            if not 0 <= c <= 15:
                errs.append(f"{name}: PCA9685 {cid} ch {c} out of range for {sig}")
            if sig in sigs:
                errs.append(f"{name}: signal {sig} on both {sigs[sig]} and {cid}")
            ch[c] = sig
            sigs[sig] = cid

    # STEP/DIR and motor inputs must be LEDC-capable outputs. On ESP32-S3/C3
    # every GPIO is, but this catches a signal that drifted onto an input-only
    # pin or had its direction mistyped. Matched on suffix, not substring, so
    # STEPPER_1_DIAG (an input) is not caught.
    pwm_out = [s for s in board["gpio"]
               if s.endswith(("_STEP", "_DIR")) or s.startswith("MOTOR_")]
    for sig in pwm_out:
        if board["gpio"][sig]["dir"] != "out":
            errs.append(f"{name}: {sig} drives PWM and must be dir=out, "
                        f"got {board['gpio'][sig]['dir']}")
    return errs


def render(name, board, consts):
    guard = f"PROPMESH_PINS_{name.upper()}_H"
    L = [
        "// GENERATED FILE — DO NOT EDIT",
        "// Source: pinmap.yaml   Regenerate: python3 tools/genpins.py",
        "",
        f"#ifndef {guard}",
        f"#define {guard}",
        "",
        f"// Board: {name}   MCU: {board['mcu']}",
        "",
    ]
    w = max(len(s) for s in board["gpio"]) + 5
    for sig, d in sorted(board["gpio"].items(), key=lambda kv: kv[1]["pin"]):
        note = f"  // {d['note']}" if d.get("note") else ""
        L.append(f"#define PIN_{sig:<{w}} {d['pin']}{note}")

    pca = board.get("pca9685")
    if isinstance(pca, dict):          # one chip: unchanged output
        L += ["", f"#define PCA9685_ADDR 0x{pca['addr']:02X}", ""]
        cw = max(len(s) for s in pca["channels"]) + 5
        for sig, c in sorted(pca["channels"].items(), key=lambda kv: kv[1]):
            L.append(f"#define PCA_{sig:<{cw}} {c}")
    elif isinstance(pca, list):        # several chips: address + rate per chip, chip per signal
        L += ["", f"#define PCA9685_COUNT {len(pca)}"]
        for chip in pca:
            L.append(f"#define PCA9685_{chip['id']}_ADDR 0x{chip['addr']:02X}")
            if chip.get("pwm_hz"):
                L.append(f"#define PCA9685_{chip['id']}_HZ   {chip['pwm_hz']}")
        cw = max(len(s) for chip in pca for s in chip["channels"]) + 5
        for chip in pca:
            L += ["", f"// PCA9685_{chip['id']} (0x{chip['addr']:02X})"]
            for sig, c in sorted(chip["channels"].items(), key=lambda kv: kv[1]):
                L.append(f"#define PCA_{sig:<{cw}} {c}")
                L.append(f"#define PCA_{sig + '_ADDR':<{cw}} PCA9685_{chip['id']}_ADDR")

    L += [""]
    for k, v in consts.items():
        L.append(f"#define {k} {v}")
    L += ["", f"#endif  // {guard}", ""]
    return "\n".join(L)


def main():
    check = "--check" in sys.argv
    data = yaml.safe_load(PINMAP.read_text())
    consts = data.get("constants", {})

    errs = []
    for name, board in data["boards"].items():
        errs += validate(name, board)
    if errs:
        print("pinmap validation FAILED:", file=sys.stderr)
        for e in errs:
            print("  -", e, file=sys.stderr)
        return 1

    OUTDIR.mkdir(parents=True, exist_ok=True)
    stale = []
    for name, board in data["boards"].items():
        path = OUTDIR / f"pins_{name}.h"
        text = render(name, board, consts)
        if check:
            if not path.exists() or path.read_text() != text:
                stale.append(path.relative_to(ROOT))
        else:
            path.write_text(text)
            print(f"wrote {path.relative_to(ROOT)}")

    if check:
        if stale:
            print("stale headers — run tools/genpins.py:", file=sys.stderr)
            for p in stale:
                print("  -", p, file=sys.stderr)
            return 1
        print("headers match pinmap.yaml")
    return 0


if __name__ == "__main__":
    sys.exit(main())

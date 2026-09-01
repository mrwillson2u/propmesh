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


def validate(name, board):
    """Catch the mistakes that cost an evening at bring-up."""
    errs = []
    seen = {}
    for sig, d in board["gpio"].items():
        pin = d["pin"]
        if pin in seen:
            errs.append(f"{name}: GPIO {pin} assigned to both {seen[pin]} and {sig}")
        seen[pin] = sig

    ch = {}
    for sig, c in board.get("pca9685", {}).get("channels", {}).items():
        if c in ch:
            errs.append(f"{name}: PCA9685 ch {c} assigned to both {ch[c]} and {sig}")
        if not 0 <= c <= 15:
            errs.append(f"{name}: PCA9685 ch {c} out of range for {sig}")
        ch[c] = sig

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
    if pca:
        L += ["", f"#define PCA9685_ADDR 0x{pca['addr']:02X}", ""]
        cw = max(len(s) for s in pca["channels"]) + 5
        for sig, c in sorted(pca["channels"].items(), key=lambda kv: kv[1]):
            L.append(f"#define PCA_{sig:<{cw}} {c}")

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

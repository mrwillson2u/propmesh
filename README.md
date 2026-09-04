# PropMesh

Open-source ESP32 mesh prop controller for Halloween and holiday displays.

Networked actuator boards you stake around a yard. Each drives relays,
servos, motors, addressable LED strips, and audio, synchronized over an
ESP-NOW mesh and triggerable from local sensors or from any other node.

## Boards

| | **PropMesh Pro** | **PropMesh Mini** |
|---|---|---|
| MCU | ESP32-S3-WROOM-1U | ESP32-C3-MINI-1U |
| Size | 130 × 100 mm, 4-layer | 50 × 40 mm, 2-layer |
| Power | 12–30 V DC | 1S Li-ion, solar-ready |
| Motors | 2 stepper + 2 brushed DC | — (Qwiic expansion) |
| Servos | 6 | 3 |
| Relays (dry contact) | 3 | 1 |
| Addressable LED | 2 ch | 1 ch |
| Dimmable LED | 6 ch | 4 ch |
| Audio | I²S + microSD | I²S + flash |
| Sensors | 3 digital, 2 analog, IR | 2 digital, 1 analog, IR |

## Layout

```
CLAUDE.md              working notes, locked decisions, open items
pinmap.yaml            SINGLE SOURCE OF TRUTH for pin assignments
schema/messages.yaml   SINGLE SOURCE OF TRUTH for mesh messages
docs/hardware-spec.md  full spec: BOM, costs, mechanical, manufacturing
docs/software-plan.md  firmware, mesh protocol, and control-app plan
hardware/pro|mini/     KiCad projects
firmware/common/       shared code, GENERATED pins_*.h, propmesh mesh core
firmware/mesh-node/    devkit mesh testbed (flashable today)
firmware/pro|mini/     board-specific firmware
console/               web control app (Vite + React + TS)
reference/             pre-PropMesh prototypes (2024-25), scrubbed; see its README
tools/                 genpins.py + genmsg.py (yaml -> C + TS)
```

## Pin assignments

Edit `pinmap.yaml`, never the generated headers.

```
python3 -m pip install -r requirements.txt   # once (pyyaml)
python3 tools/genpins.py                     # regenerate
python3 tools/genpins.py --check             # CI: fail if stale
```

The generator also validates: duplicate GPIO, pins that don't exist on
the target module, non-ADC pins marked `adc`, duplicate or out-of-range
PCA9685 channels, and PWM signals mistyped as inputs.

## Status

Pre-schematic. See the open verification items in `CLAUDE.md` before layout.

## License

Hardware: CERN OHL-W · Firmware: MIT · Docs: CC BY-SA 4.0

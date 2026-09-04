# PropMesh — working notes for Claude

Open-source ESP32 mesh prop controller for Halloween and holiday displays.
Two boards, one firmware base, one mesh protocol.

## Repo conventions

**`pinmap.yaml` is the single source of truth for pin assignments.**
Never edit `firmware/common/pins.h` by hand — it is generated:

```
python3 tools/genpins.py            # regenerate headers
python3 tools/genpins.py --check    # verify headers match pinmap (CI)
```

When a pin assignment changes, edit `pinmap.yaml`, regenerate, and update
`docs/hardware-spec.md` in the same commit. A pin map that disagrees with
the schematic is the bug class most likely to cost an evening at bring-up.

## Locked design decisions — do not relitigate

These were settled after analysis. If a change is proposed, say why the
original reasoning no longer holds rather than re-deriving it.

| Decision | Reason |
|---|---|
| **No mains switching on board** | Dry-contact relays, 30 V max. Avoids creepage/clearance, isolation, and product liability. Mains props pair with a commercial IP-rated relay box. |
| **I²S audio, not DFPlayer Mini** | DFPlayer trigger latency is ~100 ms and variable; mesh sync is the whole point. Also avoids two SD cards on one board. |
| **PCA9685 for slow outputs** | 16 ch of 12-bit PWM for 2 GPIO. |
| **Motor PWM on ESP32 LEDC at 20–25 kHz, never PCA9685** | PCA9685 caps near 1.6 kHz — audible. A whining motor telegraphs the scare. |
| **Socketed stepper drivers** | TMC2209 recommended. Driver never enters the BOM; users already own spares; blown driver is a swap. |
| **Sockets are dual-mode** | MS1/2/3 jumpers allow an MP6603-class module for 2 brushed DC channels per socket. |
| **74AHCT125 level shifter on WS2812** | 3.3 V data into 5 V strips is marginal — #1 cause of random strip flicker. |
| **Battery on Mini only** | Mini averages ~200 mA; Pro averages ~2 A. |
| **Mini stores audio in flash, not SD** | C3 has no SDMMC; SPI SD costs 4 GPIO the C3 cannot spare. Upload over WiFi. |
| **5 V load switch on Mini is mandatory** | WS2812 quiescent (~0.7–1 mA/px) turns months of sleep into six days without it. |
| **Economic PCBA → single-sided SMT** | All SMT parts on the top layer. Constrains layout from the start. |

## Open verification items — before layout

- [ ] **GPIO 33/34 free on the exact WROOM-1 variant.** Available on N8R2 (quad PSRAM); consumed by octal PSRAM on R8/R16.
- [ ] **WS2812B-mini and TSOP38238 checked for "Standard Only" flags** in JLCPCB's parts library. Either one forces the board off Economic PCBA and roughly doubles prototype assembly cost. Fix by moving to hand-soldered THT.
- [ ] **StepStick control-side pinouts cross-referenced** — MP6603, the specific vendor's TMC2209, and A4988. Power and coil pins are universal; MS/UART/SPREAD assignments are not.
- [ ] **US import duty rate confirmed** against current HTS classification for assembled PCBAs. The 25% figure in the spec is a placeholder and is the largest cost uncertainty.
- [ ] **Mounting-hole pattern fixed** so the printable bracket stays stable across revisions.

## Schedule (revised 2026-09-01)

**Halloween 2026 = field test on prototypes. Halloween 2027 = launch.**

Pro v0.1 designed and ordered in the first two weeks of Sep 2026
(hand-populated bare boards — no PCBA queue). Bring-up late Sep.
**Rev-B decision point ~Oct 10**: bodge it, one quick-turn shot, or fall
back to devkits for this year's show — never a mid-October redesign.
Mini v0.1 in Nov–Dec (second KiCad project learns from the first).
v0.2 both boards Jan–Feb 2027, beta May–Jun, **promote Jul–Aug 2027**
(when the community researches next season), ship Sep 2027.

The recurring failure mode on this project is starting in October.
Ship a reduced v0.1 rather than slipping. Full table: hardware-spec §7.

## When reviewing board designs

Any time a schematic or layout is up for review, check — in this order:

1. **Netlist agrees with `pinmap.yaml`** — the #1 bug class. Net names
   should match pinmap signal names exactly.
2. **Schematic-capture checklists**: hardware-spec §2.5 (Pro) / §3.5
   (Mini) — EN inverter, series resistors, strap protection, etc.
   Plus the sheet's own doc in `hardware/pro/sheets/` (map:
   `hardware/pro/README.md`): every sheet must include its supporting
   passives and pass its checklist, and no ⚠-verify item may survive
   to layout unresolved. New findings go INTO the sheet doc same-day —
   never left in chat.
3. **Patchability**: hardware-spec §2.6 — test points on every GPIO and
   rail, 0 Ω links on unproven nets, staged power, empty bottom side,
   spare pull-up/down pads, 0603+ passives. v0.1's recovery plan is
   bodge wires; the layout must make that possible.
4. **Strapping pins** safe at reset in every population/attachment case.
5. **Open verification items** (above) actually closed, not deferred.

## Firmware priorities

Full architecture, mesh protocol, control app, and milestones:
`docs/software-plan.md`. Two tracks: the Oct 2026 show runs "show
firmware v0" (hardcoded sequences + the old painlessMesh rig, one last
season); the real ESP-NOW stack is winter work on devkits and
field-tested v0.1 boards.

Must-have: ESP-NOW mesh with conductor time sync, OTA, captive portal +
web UI, deep-sleep mode selector (Mini), battery reporting (Mini).

Highest-value for adoption: **E1.31 / sACN input.** The display community
already runs xLights and Vixen. Speaking sACN means the boards drop into
existing shows on day one.

## Style

Hierarchical responses — headers, bullets, bold for key terms. Don't bury
conclusions in prose.

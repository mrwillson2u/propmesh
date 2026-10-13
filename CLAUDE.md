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

**Generic ESP32 boards (devkits) have no fixed pin map** — users assign
pins to functions in the console. What each pin *can* do lives in
`boards/<board>.yaml`; what each function *needs* in
`boards/functions.yaml`; the recommended use per pin (`best` / `also`
/ `guide`) lives in the board file too and is advice only. Never edit
`boards_gen.h` / `boards_gen.ts`:

```
python3 tools/genboards.py          # regenerate
python3 tools/genboards.py --check  # CI
```

Full design, serial protocol and October plan: `docs/generic-boards.md`.

**Branches:** work goes to GitHub as pull requests into `dev` (the
default branch); `main` takes PRs from `dev` only. Nobody pushes to
either directly — commit on a topic branch, `gh pr create --base dev`,
merge the PR. See `CONTRIBUTING.md`.

## Locked design decisions — do not relitigate

These were settled after analysis. If a change is proposed, say why the
original reasoning no longer holds rather than re-deriving it.

| Decision | Reason |
|---|---|
| **No mains switching on board** | Dry-contact relays, 30 V max. Avoids creepage/clearance, isolation, and product liability. Mains props pair with a commercial IP-rated relay box. |
| **I²S audio, not DFPlayer Mini** | DFPlayer trigger latency is ~100 ms and variable; mesh sync is the whole point. Also avoids two SD cards on one board. |
| **PCA9685 for slow outputs** (two chips since 2026-09-16) | 16 ch of 12-bit PWM for 2 GPIO. One chip = one PWM frequency, so servos (50 Hz) and DC dimming (1 kHz) are on separate PCA9685s at 0x40 / 0x41; both OE on GPIO 37. |
| **Motor PWM on ESP32 LEDC at 20–25 kHz, never PCA9685** | PCA9685 caps near 1.6 kHz — audible. A whining motor telegraphs the scare. |
| **Socketed stepper drivers** | TMC2209 recommended. Driver never enters the BOM; users already own spares; blown driver is a swap. |
| **Sockets are dual-mode** | MS1/2/3 jumpers allow an MP6603-class module for 2 brushed DC channels per socket. |
| **74AHCT-family level shifter on WS2812** (one octal 74AHCT541 since 2026-09-05) | 3.3 V data into 5 V strips is marginal — #1 cause of random strip flicker. |
| **Battery on Mini only** | Mini averages ~200 mA; Pro averages ~2 A. |
| **Mini MCU: ESP32-S3-WROOM-1U-N16R2** (selected 2026-09-19) | Colin accepted the larger module for audio storage and simpler GPIO/firmware design. See `hardware/mini/module-selection-2026-09-19.md`. The existing Mini pinmap/header remain a marked legacy C3 baseline pending a complete S3 allocation; never reuse those USB/ADC/boot pins by just renaming the MCU. |
| **Mini stores audio in flash, not SD** | The selected S3 provides 16 MB flash shared by firmware/OTA and audio, avoiding a card socket and separate storage bus. Upload over WiFi. |
| **5 V load switch on Mini is mandatory** | WS2812 quiescent (~0.7–1 mA/px) turns months of sleep into six days without it. |
| **Economic PCBA → single-sided SMT** | All SMT parts on the top layer. Constrains layout from the start. |
| **Copyleft licensing** (2026-10-12) | GPL-3.0 firmware/tools, AGPL-3.0 console, CERN-OHL-S-2.0 hardware, CC BY-SA 4.0 docs — commercial use and variations welcome, closed derivatives not. Never copy code from unlicensed projects (the BRMesh lineage has none). See `LICENSING.md`. |

## Open verification items — before layout

- [x] ~~GPIO 33/34 free on the exact WROOM-1 variant~~ **RESOLVED 2026-09-03, and the premise was wrong: GPIO 33/34 are not bonded out on ANY WROOM-1** (Espressif DS v1.8 pin table). MOTOR_B moved to GPIO 35/36 — which ARE the octal-PSRAM casualties, so the N8R2 (quad) variant is still load-bearing. `C3013944` verified in stock.
- [x] **WS2812B-mini and TSOP38238 "Standard Only" flags** — RESOLVED 2026-09-05: the TSOP left the Pro BOM entirely (onboard IR is useless on a hidden board — plug-in receiver on a `DIGITAL_IN` instead; GPIO 3 became strip 1's clock). Only the status pixel remains (WS2812B-MINI-X2 `C4154873`); the parts API doesn't expose the flag and v0.1 is hand-built, so the residual check is **look in the JLCPCB order UI before the first PCBA run** (hardware-spec §7 note). Fallback if flagged: THT 5 mm WS2812.
- [x] ~~StepStick control-side pinouts cross-referenced~~ **RESOLVED 2026-09-04** from the Pololu md09b drawing: rows 12.70 mm apart; RST/SLP hardwired together = both A4988-legal AND the TMC2209 PDN_UART bus; MS1-3 on 3-pin straps; DIAG via per-socket aux headers + jumper wire (vendor positions differ). ILIM: ITRIP=64000/R per TI DS, 30 k = 2.13 A. See sheets/06-motors.md.
- [x] **Datasheet-review changes (2026-09-16) — DONE 2026-10-02:** all drawn; eight sheet checkers green, ERC 0/0. Decisions 1A, 2A, 3B, OE on GPIO 37, 4B (SI2356DS). Remaining Board Setup cells tracked by `checksetup.py`.
- [ ] **US import duty rate confirmed** against current HTS classification for assembled PCBAs. The 25% figure in the spec is a placeholder and is the largest cost uncertainty.
- [x] ~~Mounting-hole pattern fixed~~ **FROZEN 2026-09-07: 4 × M3 3.2 mm unplated holes, centres 5 mm in from each corner of the 130 × 100 board → 120 × 90 mm pattern** (`hardware/pro/layout.md` step A3 and B1; `tools/checksetup.py` verifies positions). The printable **mounting plate** adapts the board to the Multilink RNI-1500 and Bud NBF-32022 (hardware-spec §2.3); any revision that moves a hole must say why here.

## Schedule (revised 2026-10-12)

**The Pro v0.1 PCB is delayed until after Halloween 2026.** This year's
show runs on off-the-shelf ESP32 dev boards (DevKit V1, HUZZAH32, C6
SuperMini) on breadboards/protoboard, with the generic-board firmware.
Software is the main track through October: **the software feature
freeze is dropped** — push the console and firmware as far as they go,
keeping every step shippable so the yard has a working show on the
night. The hardware plan below stands, shifted: Pro v0.1 after the show.

**Halloween 2026 = field test on dev boards. Halloween 2027 = launch.**

*(Earlier text, kept for the hardware dates:)*

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
3. **Symbol pin numbers ⊆ footprint pad numbers** for every part —
   `checknet.py` reports it; a pin with no pad is silently left
   unconnected and neither ERC nor DRC will say so (sheet 01's input
   FET, 2026-09-06). Never pair a generic `Device:Q_*` symbol with a
   footprint.
4. **Patchability**: hardware-spec §2.6 — test points on every GPIO and
   rail, 0 Ω links on unproven nets, staged power, empty bottom side,
   spare pull-up/down pads, 0603+ passives. v0.1's recovery plan is
   bodge wires; the layout must make that possible. The working
   checklist for all of this is `hardware/pro/layout.md`.
5. **Strapping pins** safe at reset in every population/attachment case.
6. **Open verification items** (above) actually closed, not deferred.

## Firmware memory rules (ESP32 builds — learned the hard way)

- **Static RAM stays ≤ ~95.5 KB** (`RAM:` line of `pio run`) — the
  static-data region is ~128 KB and FreeRTOS creates its timer task from
  what's left of it. A static 4 KB buffer boot-looped every ESP32 board
  (`assert failed: vApplicationGetTimerTaskMemory`, 2026-10-12).
- **No heap allocation in static initializers.** Global constructors
  run before the scheduler, from that same leftover; `static PmShow &show
  = *new PmShow()` (31 KB) did it a second time the same day. Allocate
  in a `begin()` instead.
- **No big objects on the loop task's 8 KB stack** (`-Wframe-larger-than`
  catches it). Transient buffers: `malloc` for the call, then free.
- **IRAM is full** (381 B free): check `firmware.map` before adding a
  library; `PM_NO_BLE` / `PM_NO_SLEEP` are the escape hatches.

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

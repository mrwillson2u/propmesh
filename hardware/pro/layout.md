# PropMesh Pro v0.1 — layout guide

**One document for the whole layout.** Everything below is keyed to the
designators you see in the PCB editor (`U5`, `C7`…), with the spec name
in parentheses where the sheet docs use it. Written 2026-09-07 from the
seven sheet specs, their datasheet notes, spec §2.3/§2.6/§2.9 and the
enclosure decision.

---

## 0. Before you place anything

Do these in order; each is short.

1. **Commit.** Everything since `95295fa` — the IR removal, both strips
   dual-mode, the octal shifter, the checker fixes, the renumber, the
   schema field, the software-plan and enclosure sections — is
   uncommitted. Say the word.
2. **Draw sheet 08 (test points)** from `sheets/08-testpoints.md` — one
   pad per GPIO net and per rail, plus one DNP strap pad. Spec §2.6
   requires it and it is a 20-minute sheet of labels. Checker:
   `08-testpoints.net.yaml`.
3. **Add the three staged-power links on sheet 01** — 2-pin headers with
   shunts between input → buck, buck → +5V, buck → +3V3 (spec §2.6;
   the yaml and `01-power.md` already carry them, so sheet 01's checker
   is red until they are drawn). Pull a shunt and put a meter across
   the header = an ammeter on that rail at bring-up.
4. **F8** so the board gets the renumbered references and the new parts,
   then re-run all eight checkers and ERC — the last all-green before
   the board file starts changing.
5. **Verify the two flagged footprints before placing them** (import-lie
   doctrine): `J47` Qwiic clone drawing vs KiCad's JST-SH pattern, and
   `U7`/`U8` DRV8871 exposed-pad paste vs TI's 2.29 × 3.05 mm drawing.
   Ask and they get measured the way L1/L2/F1 were.
6. **Set up the board** (§1 below): outline, stackup, design rules,
   netclasses, mounting holes — *before* the first footprint moves.
7. Optional but cheap: **JLCPCB's stackup and DRC numbers** are in §1;
   nothing else about the fab needs deciding until export.

---

## 1. Board frame

| Item | Decision |
|---|---|
| Outline | **130 × 100 mm**, 3 mm corner radius, on `Edge.Cuts` |
| Layers | **4-layer, JLC7628 stackup, 1.6 mm, 1 oz outer / 0.5 oz inner**: L1 = components + signals + power pours; **L2 = solid GND, never split**; L3 = power (VIN_PROT / +5V / +3V3 regions); L4 = sparse signals only — it is the bodge canvas (§2.6) |
| Mounting holes | **4 × M3, 3.2 mm drill, 6.4 mm pad, centres 5 mm in from each edge → 120 × 90 mm pattern.** Freeze it once placed (CLAUDE.md open item — the printed mounting plate depends on it). Keep-out 7 mm around each for the plate's bosses/screw heads |
| Edges (enclosure §2.3) | **Bottom edge**: DC in, both LED strips, motors, the six DC outputs. **Short edges**: relays, stepper coil XHs, sensor XHs, speaker, line-out, Qwiic, expansion. **Top edge**: USB-C, microSD, boot/reset, status pixel, U.FL. Nothing that carries yard wiring on the top edge |
| Component sides | **All SMT on the top (F.Cu). Never flip a footprint.** Economic PCBA is single-sided and the empty bottom is the repair canvas. THT parts are top-inserted (their pins come out the bottom, that's fine) |
| Antenna | The -1U module has no PCB antenna and — per its datasheet §3.1 — **no keep-out zone at all** (that zone exists only on the PCB-antenna WROOM-1). Espressif's rules for it: **keep all copper on all layers clear under the U.FL connector itself**, and put that end at the **top edge corner** so the pigtail exits to the box wall |

**Design rules for JLC 4-layer** (conservative; all within their
capabilities with margin):

| Rule | Value |
|---|---|
| Signal trace / clearance | 0.25 mm / 0.2 mm (min allowed 0.09/0.09 — don't go there on v0.1) |
| Via | 0.3 mm drill, 0.6 mm pad |
| Power netclass (`+5V`, `+3V3`, motor outputs, coil lines) | 1.0 mm trace |
| High-current netclass (`VIN_RAW`, `VIN_FUSED`, `VIN_PROT`, `VIN_BUCK`) | 3.0 mm minimum, but use **pours** — see §4 |
| Copper-to-edge | 0.5 mm |
| Silkscreen | 0.15 mm line, 1 mm text minimum |

Set these as **netclasses** (File → Board Setup → Net Classes) before
routing: assign `VIN_*` nets to *High current*, rails and motor/coil
nets to *Power*, everything else stays *Default*. The router then picks
the width for you.

---

## 2. Floorplan

Read it as the board lies in the enclosure, connectors along the
bottom, lid above.

```
 TOP EDGE ─── USB-C(J1) ── microSD(Card1) ── BOOT/RST(SW1,SW2) ── LED1 ── U.FL ──────────
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │  ESP32-S3 module U2 (antenna end at the corner)        expansion J42   Qwiic J47 │ ←short edge:
 │  C1 C2 C3 R3 R4 · TP field (sheet 08)                                            │  sensors J40/J41/
 │                                                                                  │  J43/J44/J45/J46
 │  audio: U9 amp + U10 DAC + caps          PCA9685 U4 + straps       sensors R/D   │  speaker J35
 │        FB1/FB2/C30/C31 → J35            ULN2003 U3 → K1 K2 K3 → J14 J15 J16      │  line-out CN1
 │                                                                                  │
 │  LED: U11 541 + C42                    STEPPER SOCKETS J19/J20 · J24/J22          │ ←short edge:
 │       R34–R38 at the terminals         (12.70 mm rows, 20 mm heatsink air)       │  relays J14–J16
 │       C43 C45 radials                  C18 C19 · straps J29–J34 · J21 J26         │  coils J25 J27
 │                                        DRV8871 U7 U8 + C20–C23 + R22 R24         │
 │  POWER: J17/J18 → F1 → Q7 → D9/D8 → C11 → U5 buck (L1,C7,C12,C9,C10)              │
 │         → U6 buck (L2,C15,C16)  · links JP_VIN JP_5V JP_3V3 · D10 D11             │
 └──────────────────────────────────────────────────────────────────────────────────┘
 BOTTOM EDGE ── DC in J17 J18 ── strips J38 J37 · J39 J36 ── motors J23 J28 ── outputs J8–J13 ──
```

Placement order that works: **(1)** outline + holes + every edge
connector, then **lock them**; **(2)** the module and the top-edge
service parts; **(3)** the power chain bottom-left, inward from J17;
**(4)** stepper sockets centre-right with their sockets' 20 mm of
vertical clearance in mind; **(5)** DRV8871s between sockets and their
terminals; **(6)** PCA9685 where relays, servos and the six output
channels can all reach it; **(7)** audio near its jack and speaker
terminal; **(8)** the shifter near the strip terminals; **(9)** sensor
protection at the sensor connectors; **(10)** test points last, in the
gaps, labelled.

---

## 3. What goes next to what

The rule behind every row: **a decoupling cap belongs at the pin it
serves, on the same layer, with the shortest possible loop to that
chip's ground pin** — not "somewhere on the rail." Distances are
edge-to-edge.

### Sheet 01 — power (`U5` AP64350 buck 5 V, `U6` TLV62569 buck 3.3 V)

| Part(s) | Put it | Why |
|---|---|---|
| `J17` DG128 (DC in), `J18` barrel | bottom-left corner, side by side | one supply at a time — silk `ONE SUPPLY ONLY`, `+ TIP` at J18; **widen J17's pad ring to ≥ 2.8 mm** (import gave 0.4) |
| `F1` blade fuse holder | first thing after the connectors | user-swappable; the 10 A blade option needs the path sized for it |
| `Q7` (Q1) AOD4185 P-FET, `D8` (D_Z) zener, `R13` (R_G) | right after F1; gate parts at the FET | the input path J17 → F1 → Q7 → VIN_PROT is the **10 A path** — pour it, don't trace it |
| `D9` (D1) SMAJ33A TVS | on VIN_PROT right at Q7's source, short to the GND pour | TVS only works with a low-inductance loop |
| `C11` (C_bulk) 100 µF/63 V | on VIN_PROT after the protection, before the buck | bulk charge + ESR damping for hot-plug; not a switching cap, can sit 10 mm off |
| `C7`, `C12` (C1a/C1b) 10 µF/100 V 1210 | **at U5 VIN (pin 2) and GND — < 2 mm** | the fast input loop; trace inductance defeats them anywhere else |
| `L1` 6.8 µH | at U5 SW pin, short wide trace; **keep the SW node small** — no other traces under or beside it | the SW node is the board's noisiest net |
| `C6` (C3) 100 nF BST | between BST and SW pins, tight | bootstrap |
| `C9`, `C10` (C2a/C2b) 22 µF | at L1's output end and the GND pour | output loop |
| `R14`/`R15` (R1/R2) FB divider, `C8` (C4, DNP) | at U5 FB pin; **route FB away from SW and L1** | FB is a high-impedance sense node — noise here is output ripple |
| `R17`/`C13`/`C14` (R5/C5/C6) comp network, `R16` (RT) | at COMP / RT-CLK pins | small-signal, keep them off the power loop |
| `JP_VIN` header | between VIN_PROT and U5's input caps | staged power link (§2.6) |
| `JP_5V` header | between `C9/C10` and the +5V rail | carries the full 3 A rail — the 2.54 mm header is rated 3 A; **pour to both pins** |
| `C15` (C_in) 10 µF | at U6 VIN — < 2 mm | same input-loop rule, smaller chip |
| `L2` 2.2 µH, `C16` (C_out) 22 µF | at U6 SW / at L2 output | same |
| `R19`/`R21` (R_FB1/R_FB2), `C17` (C_FF) | at U6 FB | same FB rule |
| `JP_3V3` header | between `C16` and the +3V3 rail | link |
| `D10`, `D11` rail LEDs + `R18`, `R20` | near the top edge, visible through the clear lid | that's what they're for |
| **Thermal** | `U5` is SO-8 with exposed pad: **EP to the L2 GND plane through a 3 × 3 grid of 0.3 mm vias, plus a top-side GND pour around it**. `U6` SOT-23-5 needs only its GND pad on a pour. | AP64350 datasheet §10.1: the EP is the heat path |
| Datasheet layout notes (AP64350 §10.1, TLV62569 §10.1 — near-identical wording) | input cap, output cap and inductor as close to the IC as possible; keep those power traces short, direct and wide; FB sense traces are signal traces — keep them away from SW; cap low sides straight to power GND; "GND layers might be used for shielding" | both checked 2026-09-07 |

### Sheet 02 — MCU + USB (`U2` module, `J1` USB-C)

| Part(s) | Put it | Why |
|---|---|---|
| `U2` ESP32-S3-WROOM-1U | top edge, U.FL at the corner. **No keep-out zone on the -1U** (datasheet §3.1: same pinout as the WROOM-1 "but without the Keepout Zone"); if KiCad's footprint draws one, it is the WROOM-1's — ignore it. **Keep all layers clear under the U.FL connector.** **Centre ground pad (pin 41): ≥ 9 vias to L2** (Espressif design guidelines). **3V3 feed ≥ 0.64 mm (25 mil)** with the 10 µF before the pin | Espressif hardware design guidelines + module datasheet, checked 2026-09-07 |
| `C3` (C_VDD1) 10 µF + `C2` (C_VDD2) 100 nF | at pin 2 (3V3), the 100 nF nearest | module decoupling |
| `C1` (C_EN) 1 µF + `R3` (R_EN) | at the EN pin | POR delay |
| `SW1` reset, `SW2` boot, `R4` (R_BOOT) | top edge, reachable with the lid open | service items |
| `J1` USB-C | top edge; **shield pads: 2 vias each to the GND plane** (the ⚠ item) | shield return |
| `U1` USBLC6-2SC6 | **in the D± path right behind J1**, flow-through (pins 1/6 and 3/4 are the same line) | ST AN §2.3: *"put the protection device as close as possible to the disturbance source (generally the connector)"*; the tracks from the data lines to the I/O pins, VBUS to the VCC pin and the GND plane to the GND pin "must be as short as possible" — every nH of trace adds volts to the clamp (their worked example: 6 nH × 24 A/ns = 144 V) |
| `R1`, `R2` CC pulldowns | at J1's CC pins | |
| `D1` (D_VBUS) SS34 | between J1 VBUS and the +5V pour | |
| `USB_DM`/`USB_DP` | **route as a pair**: same layer, side by side, no stubs, no vias if possible, nothing under them but L2 GND. Espressif asks for **90 Ω differential ±10 %** — on JLC7628 that is roughly 0.3 mm traces with a 0.2 mm gap over L2 (confirm with JLC's impedance calculator or KiCad's Inspect → Calculator Tools → coupled microstrip). Full-speed USB is forgiving, but it costs nothing to hit | Espressif guidelines |
| `TP1` (TP37) | anywhere near U2; silk `TP37` | spare GPIO |

### Sheet 03 — outputs (`U4` PCA9685, `U3` ULN2003, `K1–K3`, `Q1–Q6`)

| Part(s) | Put it | Why |
|---|---|---|
| `C5` (C_P1) 100 nF + `C4` (C_P2) 10 µF | at U4 VDD (pin 28) | NXP's datasheet has no layout section for the TSSOP; its one board rule — address pins have no internal pull-ups and must be tied high or low — is what the 10 k straps do |
| `R5`/`R6` I²C pull-ups | anywhere on the bus; near U4 is convenient | the board's only I²C pull-ups |
| `R7–R12` address straps | beside U4 | rework target if a Qwiic device conflicts |
| `U3` ULN2003 | between U4 and the relays | its outputs go straight to the coils; internal flyback diodes — COM pin (9) to +5V |
| `K1–K3` HK4100F | at `J14–J16` on a short edge, coils toward U3 | contacts carry the user's 30 V/3 A — **keep the NO/COM/NC copper wide (1 mm+) and clear of logic**; silk `NO\|COM\|NC`, `DRY CONTACT 30V MAX` |
| `Q1–Q6` AO3400A + `D2–D7` SS34 | **each FET/flyback pair right at its terminal `J8–J13`**; SS34 cathode to the VIN_PROT pour | the switched return and the flyback loop stay off the rest of the board; 2 A per channel → 1 mm traces, pour for VIN_PROT to pin 1; silk `V+/SW`, `V+ = SUPPLY VOLTAGE` |
| `J2–J7` servo headers | grouped, on the +5V pour | 3 A shared rail; GND-5V-SIG order silk |

### Sheet 04 — audio (`U9` MAX98357A, `U10` PCM5102A, `Card1` microSD)

| Part(s) | Put it | Why |
|---|---|---|
| `C28` (C_A1) 10 µF + `C29` (C_A2) 100 nF | at U9 VDD pins 7/8 (5 V) | |
| `U9` exposed pad | **to the GND plane with vias** — ADI: *"The exposed pad is not internally connected. Connect the exposed pad to a solid ground plane for thermal dissipation."* | thermal |
| `U9` outputs `AMP_P`/`AMP_N` → `FB1`/`FB2` → `J35` | **wide, short, low-resistance traces** (ADI's own numbers: 100 mΩ of speaker trace costs ~5 % of a 2 W output) but **not long** — parasitic capacitance on the outputs raises quiescent current by VDD × 330 kHz × C. Wide supply and ground copper too | ADI "Layout and Grounding", checked 2026-09-07 |
| Around the audio block | **ground fill around all signal traces**, top and bottom | ADI: "for best performance, add ground fills around all signal traces on top or bottom PCB planes" |
| `FB1`/`FB2` beads + `C30`/`C31` 100 pF | **at the speaker terminal `J35`, beads first then caps to GND** | EMI snubber belongs at the cable end |
| `R27` (R_SDM) 620 k | at U9 SD_MODE | high-impedance node — short |
| `U10` supplies | **10 µF + 100 nF at each pin, 100 nF nearest**: `C40`/`C41` at CPVDD (pin 1), `C38`/`C39` at AVDD (pin 8), `C36`/`C37` at DVDD (pin 20), `C25`/`C26` at LDOO (pin 18) | TI Fig. 33, followed literally |
| `C24` (C_CP) flying cap | **between CAPP (2) and CAPM (4), as short as physically possible** | charge-pump loop. TI §12.1 for the whole part: "simple to layout"; one shared ground is fine (AGND = DGND); **keep digital clock/interface traces away from the analog outputs**; supply and charge-pump caps as close as possible; signals on top, GND beneath |
| `C27` (C_VNEG) | at VNEG (pin 5) to GND | |
| `R29`/`C32`, `R30`/`C33` output RC | at the jack `CN1`, R first then C to GND | output filter at the connector |
| `CN1` PJ-320A jack, `J35` speaker | short edge, near the box entry | field wiring |
| `R28` (R_XSMT) | at pin 17 | bodge target: lift and wire to a GPIO |
| `Card1` microSD | **top edge, card slot facing out**; `C34`/`C35` at VDD (pin 4); `R31–R33` pull-ups beside it; `TP2` card-detect pad | service item; short SD traces, keep them together |
| I²S lines `I2S_BCLK/LRCLK/DOUT` | short, together, over the GND plane, from U2 to U9 and U10 | clocked digital audio |
| Keep the audio block **away from the buck switch nodes and the stepper sockets** | analog-ish, and the amp's speaker lines are big current loops | |

### Sheet 05 — LED (`U11` 74AHCT541, `LED1` status pixel)

| Part(s) | Put it | Why |
|---|---|---|
| `C42` (C_LS) 100 nF | at U11 VCC (pin 20) | one cap, one supply pin |
| `R35`, `R34`, `R36`, `R37` 330 Ω | **at the strip terminals `J37` (strip 1 DATA/CLK) and `J36` (strip 2 DATA/CLK)**, not at the chip | they damp reflections into the cable |
| `R38` 330 Ω | between U11 Y4 and `LED1` | |
| `LED1` + `C44` (C_ST) | **top edge, facing the lid**; C44 at its VDD (pin 2) | readable through the clear lid |
| `C43`, `C45` 1000 µF radials | **at the power blocks `J38` / `J39`**, +/− marked on silk, pin 1 = + | hot-plug inrush; tall THT — keep them off the stepper heatsink footprint |
| `J38`+`J37`, `J39`+`J36` | **butt each pair together** on the bottom edge so it reads as one 4-pole connector | |
| 5 V to the strips | pour from the +5V region to J38/J39 pin 1; the two strips share the 3 A rail | silk **`> 50 px: inject 5 V externally, data only from board`** |

### Sheet 06 — motors (sockets, `U7`/`U8` DRV8871)

| Part(s) | Put it | Why |
|---|---|---|
| `J19`+`J20` (socket 1), `J24`+`J22` (socket 2) | **rows exactly 12.70 mm apart, pin 1 to pin 1**, mid-board, with **20 mm of air above** — no tall parts within a StepStick's outline plus 3 mm | Pololu md09b geometry; heatsink and airflow |
| `C18` / `C19` 100 µF/63 V | at `J20` / `J22` pin 1 (VMOT) | per-socket bulk |
| `J29–J34` MS straps, `J21`/`J26` DIAG aux, `JP1`/`JP2` | beside their socket, reachable with a module inserted | user-set; silk the TMC defaults |
| `J25`/`J27` coil XH | next to the sockets on a short edge, order 2B 2A 1A 1B | NEMA17 pigtails; **1.5–2 A per phase → 1 mm** |
| `Q8`, `R26`, `R25`, `R23` | between the sockets | EN inverter, UART, DIAG series R |
| `U7`/`U8` DRV8871 | between sockets and `J23`/`J28`; **`C20`+`C21` at U7 VM (pin 5), `C22`+`C23` at U8 VM, 100 nF nearest**; **`R22`/`R24` at ILIM (pin 4)** | TI: bulk + ceramic at VM, ILIM short |
| DRV8871 exposed pads | TI §10.1 verbatim: *"thermal pad soldered to the PCB top-layer ground plane; multiple vias to a large bottom-layer ground plane"* → **top GND pour under and around each, a 3 × 3 grid of 0.3 mm vias through the pad, and a GND pour on L4 beneath them** (copper on the bottom is fine — it is *components* the bottom must not carry). Also §10.1: bulk cap on the shortest possible high-current path, wide traces, "numerous vias" between layers, ceramics close to the pins, wide output traces. *Verify EP paste against TI's 2.29 × 3.05 mm before placing* | TI DRV8871 §10.1, checked 2026-09-07 |
| `MA_OUT1/2`, `MB_OUT1/2` | 1 mm to `J23`/`J28` | 2.13 A trip |

### Sheet 07 — sensors + expansion

| Part(s) | Put it | Why |
|---|---|---|
| `D12`/`D13`/`D14` BAT54S + `R40`/`R47`/`R52` 1 k | **at the connectors `J41`/`J44`/`J45`** — clamp first, then the series R, then the trace to the MCU | protect at the point of entry |
| `R39`/`R48`/`R51` 10 k pull-ups | anywhere on their nets; beside the series Rs is tidy | |
| `R42`/`R41`, `R50`/`R49` dividers | at `J40`/`J43`; **`C46`/`C47` at the MCU end of the tap trace** (ADC pins 1/2) | filter where the ADC samples |
| `J46` PIR header | beside `J41` | parallel to input 1 |
| `J47` Qwiic | short edge, near the box wall — **measure the clone drawing vs the footprint first** | |
| `J42` 2×5 expansion + `R43`/`R45` 100 Ω + `R46`/`R44` 10 k | at the header; silk **`KEEP LOW AT RESET`** at pins 4/5, and **`5V\|GND\|SIG`** at all six sensor headers | strapping pins |

### Sheet 08 — test points

`TP_*` pads (sheet 08): one per GPIO net and per rail, **1.5 mm pads
in the gaps near the net's owner**, each labelled with its net name on
silk. The rail pads go next to their link headers. `R_STRAP3` DNP pad
by U11's A1 input.

---

## 4. Power distribution and trace widths

Computed from IPC-2221 for 1 oz outer copper (inner 0.5 oz needs ~2.5×):

| Current | 10 °C rise | 20 °C rise | Where |
|---|---|---|---|
| 0.5 A | 0.12 mm | 0.08 mm | any signal (use 0.25 anyway) |
| 1 A | 0.30 | 0.20 | +3V3 branches |
| 2 A | 0.78 | 0.51 | DC output channels, coil lines, motor outputs, 5 V branches |
| 3 A | 1.37 | 0.90 | the +5V rail trunk (buck → JP_5V → strips/servos) |
| 5 A | 2.77 | 1.82 | VIN_PROT aggregate to the six outputs |
| 7.5 A | 4.84 | 3.18 | worst-case input at 12 V |
| **10 A** | **7.19** | **4.72** | **the input path, sized for the 10 A fuse option** |

How to actually do it:

- **VIN_RAW → F1 → Q7 → VIN_PROT: pours, not traces**, ≥ 7 mm equivalent
  on L1, stitched to a VIN_PROT region on L3 with a row of vias every
  2–3 mm. The FET's tab and the fuse pads sit *in* the pour.
- **VIN_PROT is a region on L3** reaching the stepper sockets, both
  DRV8871s and the six output terminals, plus top-side pours where the
  parts are. It is the rail with the largest, most varied loads.
- **+5V**: L3 region under the LED block, servos, relays, audio amp; the
  trunk from `C9/C10` through `JP_5V` is 1.5 mm minimum or a pour.
- **+3V3**: L3 region under the module, PCA9685, DAC, sensors, and the
  stepper sockets' VDD pins; 1 mm traces are plenty.
- **GND: L2 is one uncut plane.** Every GND pad drops a via to it. Do
  not route across L2. Do not slot it under the USB pair or the I²S.
- Inner-layer copper is half thickness: a "2 A" inner trace is 2 mm.
  That is why the rails are *regions*, not traces, on L3.
- **Return paths**: the buck SW loops (U5/L1/C7/C12/C9/C10 and
  U6/L2/C15/C16) must close on the top layer or through vias directly
  under the parts — never around the board through L2 alone.

---

## 5. Thermal

| Source | Heat | Treatment |
|---|---|---|
| `U5` AP64350 (5 V at up to 3 A) | ~1.5 W worst case | EP via grid + top pour; nothing that dislikes heat within 5 mm (no electrolytics touching it) |
| `U7`/`U8` DRV8871 (2 A each) | ~1 W each at full load | EP via grids; leave 5 mm between them and the buck |
| Stepper driver modules | user parts with their own heatsinks | the 20 mm air column above the sockets; no THT parts (radials, headers) inside the socket outline; orient so the box's airflow (bottom entries) passes them |
| `Q1–Q6` AO3400A at 2 A | ~0.1 W each | pad on the pour is enough |
| `K1–K3` coils | 0.2 W each | nothing needed |
| `C43`/`C45` 1000 µF radials | none, but tall (13 mm) | keep them and the sockets apart |
| The whole board in a closed box | ~15 W typical | the module runs warm; keep it away from the buck and the DRVs — top edge vs bottom-left/centre already does this |

---

## 6. Noise: what must not be near what

- **SW nodes** (`U5` pin–`L1`, `U6` pin–`L2`): smallest possible copper;
  no signal traces underneath on any layer; the FB dividers and comp
  parts on the far side of the chip from L1/L2.
- **ADC inputs** (`ANALOG_IN_1/2`): route away from SW nodes, the
  stepper socket area and the speaker lines; the 100 nF at the MCU end.
- **USB pair**: over solid L2, together, short, no stubs, away from
  the buck.
- **I²S** and **SD**: short, bundled, over L2.
- **WS2812 data and clock**: series R at the connector, then straight
  to the terminal; keep the runs from U11 short — they are 800 kHz to
  several MHz square waves headed for a yard of cable.
- **Speaker outputs**: they are PWM at ~300 kHz with amps of current —
  beads and snubbers at the terminal, keep the loop area small, keep
  them away from the ADC and the DAC.
- **Relay contact copper** carries the user's loads: separate it from
  logic by ≥ 2 mm.
- **TMC UART bus** (`R25`, sockets pins 5+6): 1 k series exists for a
  reason; keep the bus short.

---

## 7. Patchability (spec §2.6) — the concrete list

- [ ] Sheet 08 test points placed and labelled: every GPIO net, `VIN_RAW`,
      `VIN_PROT`, `+5V`, `+3V3`, two `GND`.
- [ ] `JP_VIN`, `JP_5V`, `JP_3V3` link headers with shunts: rails come up
      one at a time; a meter across a pulled shunt reads that rail's current.
- [ ] `R_STRAP3` DNP pad on GPIO 3; `R4`/`R46`/`R44` already give GPIO 0/45/46
      their strap parts.
- [ ] `JP1`/`JP2` DIAG solder jumpers reachable with a knife.
- [ ] Bottom copper sparse; **no components on the bottom** — it is the
      bodge canvas.
- [ ] 0603 minimum; annular rings ≥ 0.15 mm beyond drill on every THT pad;
      `J17`'s ring widened to ≥ 2.8 mm.
- [ ] Silk: **`PropMesh Pro v0.1  2026-09`** on the top copper's silk,
      plus every silk item in §8.
- [ ] `C8` is flagged DNP in KiCad (checked: yes) — it will be excluded
      from the position file.

---

## 8. Silkscreen checklist

| Where | Text |
|---|---|
| `J17`/`J18` | `ONE SUPPLY ONLY`, `12–24V DC`, `+ TIP` at J18, `+`/`−` at J17 |
| `F1` | `7.5A MINI  (10A max)` |
| `J14–J16` | `NO\|COM\|NC`, `DRY CONTACT 30V MAX` |
| `J8–J13` | `V+ / SW`, `V+ = SUPPLY VOLTAGE` |
| `J2–J7` | `GND 5V SIG` |
| `J38`/`J39` | `5V GND`; `J37`/`J36`: `DATA CLK`; beside them: `>50px: inject 5V externally` |
| `C43`/`C45` | `+` at pin 1 |
| `J25`/`J27` | `2B 2A 1A 1B` |
| `J29–J34` | strap function + **TMC default position** marked |
| `J21`/`J26` | `DIAG GND`; `JP1`/`JP2`: `cut = free GPIO42/43` |
| `J23`/`J28` | `MOTOR A`, `MOTOR B` |
| `J40/J41/J43/J44/J45/J46` | `5V GND SIG`, and `AN1 AN2 DI1 DI2 DI3 PIR` |
| `J42` | pin 1 mark, `KEEP LOW AT RESET` at pins 4/5, `3V3 5V GND` |
| `J47` | `QWIIC  GND 3V3 SDA SCL` |
| `J35` | `SPK 4Ω 3W`; `CN1`: `LINE OUT` |
| `SW1`/`SW2` | `RST` / `BOOT` |
| `LED1` | `STATUS`; `D10`/`D11`: `5V` / `3V3` |
| `TP_*` | the net name |
| Every connector | pin 1 mark |
| Board | `PropMesh Pro v0.1`, date, `propmesh` URL when there is one |

---

## 9. Layout-time verification (the ⚠ column, collected)

- [ ] `J47` Qwiic clone (ZX-SH1.0-4PWT) drawing measured against
      `JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal`
- [ ] `U7`/`U8` DRV8871 EP paste opening vs TI's 2.29 × 3.05 mm
- [ ] `J17` pad ring ≥ 2.8 mm (edit the footprint copy in `propmesh.pretty`)
- [ ] `J1` USB-C shield pads have vias
- [ ] Socket rows exactly 12.70 mm (measure in the PCB editor after placing)
- [ ] `J38`/`J37` and `J39`/`J36` pairs butt together
- [ ] Mounting-hole pattern 120 × 90 placed, then **written into CLAUDE.md
      as closed**
- [ ] 3D viewer (Alt+3) pass: nothing tall inside the socket outlines,
      the module's U.FL is at the edge, radials are upright and off the
      sockets, every THT part is on the top

---

## 10. Datasheet layout guidance — what was actually read (2026-09-07)

| Part | Source | Verified | Says |
|---|---|---|---|
| AP64350 (`U5`) | DS §10.1 | ✅ (sheet 01 work) | caps + inductor at the IC, FB away from SW, cap grounds to power GND |
| TLV62569 (`U6`) | DS §10.1 | ✅ | same rules, plus "GND layers might be used for shielding" |
| DRV8871 (`U7`,`U8`) | DS §10.1–10.4 | ✅ | bulk cap on the shortest high-current path; wide traces, many vias; ceramics at pins; thermal pad to top GND + vias to a large bottom GND plane; TSD at ~175 °C means heatsinking failed |
| PCM5102A (`U10`) | DS §12.1 | ✅ | shared GND fine; digital clocks away from analog outputs; caps as close as possible |
| ESP32-S3-WROOM-1U (`U2`) | module DS §3.1/§7 + Espressif HW design guidelines | ✅ | **no keep-out on the -1U**; all layers clear under the U.FL; ≥ 9 vias on pin 41; 3V3 ≥ 25 mil with 10 µF; USB 90 Ω diff |
| USBLC6-2SC6 (`U1`) | ST AN §2.3 | ✅ | at the connector; shortest possible tracks to I/O, VBUS and GND pins |
| PCA9685 (`U4`) | DS | ✅ (nothing to apply) | no layout section; address pins must be tied — done by the 10 k straps |
| SN74AHCT541 (`U11`) | DS | ✅ (nothing to apply) | no layout section; one bypass cap at VCC |
| WS2812B-MINI (`LED1`) | DS (measured) | ✅ | "no external components needed"; we keep the 100 nF anyway; land pattern measured |
| MAX98357A (`U9`) | DS "Layout and Grounding" (p. 33 of the PDF; ADI/Maxim/Mouser serve a script-wall, Adafruit hosts the file) | ✅ | wide low-resistance output, supply and ground traces; short outputs (parasitic C raises IQ); EP not internally connected — tie to a solid GND plane for heat; ground fill around all signal traces; 10 µF + 0.1 µF at VDD |
| HK4100F, DG128/DG381S, XH, SH, TO-252, SOT-23 parts | — | n/a | mechanical only; footprints verified as recorded in the sheet docs |

## 11. KiCad PCB editor for the first time

**Setup, once (File → Board Setup):**
1. *Board Stackup → Physical*: 4 layers, 1.6 mm, name L2 `GND`, L3 `PWR`.
2. *Design Rules → Constraints*: the §1 numbers.
3. *Net Classes*: create `Power` (1.0 mm) and `HighCurrent` (3.0 mm),
   assign nets by pattern (`VIN_*` → HighCurrent; `+5V`, `+3V3`,
   `M?_OUT?`, `S?_??` → Power).
4. *Text & Graphics defaults*: silk 0.15 line / 1.0 text.
5. Draw the outline on `Edge.Cuts` (rectangle tool, then Edit → fillet
   corners 3 mm), place the four holes (`MountingHole:MountingHole_3.2mm_M3`
   from the footprint library) at (5,5) (125,5) (5,95) (125,95).

**Getting the parts in:** **F8** in the schematic. Footprints arrive in
a heap beside the outline, *grouped by sheet* — that grouping is your
friend: right-click a footprint → **Select → Items in Same Hierarchical
Sheet**, then **P (Pack and Move)** carries the whole sheet as a block
to where the floorplan wants it. Then spread within the block.

**Keys you'll live in:**

| Key | Does |
|---|---|
| `M` | move (pick up on the cursor) |
| `R` / `Shift+R` | rotate 90° cw / ccw |
| `F` | flip to the other side — **never use it on this board** |
| `E` | properties (reference, footprint, lock) |
| `L` | lock/unlock (lock every edge connector once placed) |
| `X` | route a track; `V` mid-route drops a via and switches layer |
| `Ctrl+D` | interactive router: **Shove** mode moves other tracks out of the way; **Walkaround** is politer for a first board |
| `` ` `` | highlight a net (click a pad) — the ratsnest for that net alone |
| `B` / `Ctrl+B` | fill / unfill all zones |
| `Ctrl+Shift+Z` ... | (DRC is under **Inspect → Design Rules Checker**) |
| `Alt+3` | 3D viewer — the best sanity check for THT height, orientation, silk |
| `N` | cycle grid; use **1.0 mm for placement, 0.5 for passives, 0.1 for routing** |
| `+` / `-` | switch the active copper layer while routing |
| Shift+click a footprint in the schematic | **cross-probe** — it highlights on the PCB (and vice versa) |

**Zones (pours):** Place → Add Filled Zone, pick the net (`GND` on L2
as one full-board zone; `VIN_PROT` / `+5V` / `+3V3` as regions on L3
and as local pours on L1 around the power parts). Set *clearance 0.3 mm*
and *thermal reliefs* for hand-soldered THT pads (a pad solid into a
plane never gets hot enough to solder by hand) but **solid connections
for the SMD power pads** (the buck EP, the FET tab, the DRV EPs).

**Routing order:** power loops first (each buck's input cap → chip →
inductor → output cap, tight, top layer), then the input path pour,
then USB pair and I²S, then everything else. Pour GND last and re-pour
(`B`) whenever you move anything.

**DRC before every save you care about**, and always before an export.
Zero errors is the bar; warnings are read individually.

**Checker + ERC still apply**: F8 doesn't alter the schematic, but any
time you change the schematic during layout (you will — a missing
pull-up, a net renamed), re-run
`tools/checknet.py` for the sheet and ERC, then F8 again. The checker
needs PyYAML: the repo's `.python-version` selects the pyenv env
`propmesh-env`, so a plain `python3 tools/checknet.py …` in your shell
is right. (Explicit path, for shells without pyenv shims:
`~/.pyenv/versions/propmesh-env/bin/python`.)

**Export for JLC**, when it's time: File → Fabrication Outputs →
Gerbers (all copper, silk, mask, paste, Edge.Cuts; plot with
"Subtract soldermask from silk") and Drill Files (Excellon, PTH and NPTH
merged is fine for JLC); plus BOM and position files via the JLCPCB
plugin — it reads the `LCSC Part` field the sheet specs put on every
symbol.

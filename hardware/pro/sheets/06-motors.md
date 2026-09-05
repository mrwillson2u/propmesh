# Sheet 06 — Motors (stepper sockets + DC drivers)

**Everything needed to draw this sheet is in this file.** Fully sourced
2026-09-04; both open items closed against primary sources. Drawing
guide: `06-motors.diagram.html`; checker:

```
python3 tools/checknet.py hardware/pro/sheets/06-motors.net.yaml
```

**Nets on this sheet** (all global, checker-enforced):
`STEPPER_1_STEP` (13), `STEPPER_1_DIR` (14), `STEPPER_2_STEP` (21),
`STEPPER_2_DIR` (47), `TMC_UART_TX` (17), `TMC_UART_RX` (18),
`STEPPER_1_DIAG` (42), `STEPPER_2_DIAG` (43), `MOTOR_A_IN1` (44),
`MOTOR_A_IN2` (48), **`MOTOR_B_IN1` (35), `MOTOR_B_IN2` (36)** — moved
from the nonexistent 33/34 — plus `STEPPER_EN_RAW` (sheet 03),
`VIN_PROT`, `+3V3`, `GND`.

## ✅ Open item #3 CLOSED — socket geometry (Pololu md09b, 2026-09-04)

**Two 1×8 rows at 2.54 mm pitch, row centres exactly 12.70 mm apart**,
end pins 1.27 mm in from the module edges. Verified from Pololu's own
dimension drawing, the de-facto StepStick standard.

| Logic row (J_SxL) 1→8 | Power row (J_SxR) 1→8 |
|---|---|
| EN, MS1, MS2, MS3, RST, SLP, STEP, DIR | VMOT, GND, 2B, 2A, 1A, 1B, VDD, GND |

**The ecosystem trick that makes one socket serve every driver:**
positions 5+6 (RST/SLP) are **hardwired together** on the board. An
A4988 requires them tied to run at all; the TMC2209 family places its
single-wire **PDN_UART on those same two pins**. So the tied pair *is*
the UART bus — no vendor-specific routing. `TMC_UART_TX` reaches the
bus through **1 kΩ** (half-duplex guard); `TMC_UART_RX` joins directly
(the bus net carries that name).

**MS1–MS3 → 3-pin straps** (+3V3 | pin | GND, shunt-selected): TMC2209
UART addresses on MS1/MS2, A4988 microstepping on all three.
**Silkscreen the TMC default positions.**

**DIAG is NOT in the 2×8** — vendors break it out in different places
(BTT: extra top-edge pins). Each socket gets a **2-pin aux header**
(signal + GND) the user jumper-wires to their module's DIAG, behind a
**bridged solder jumper** (JP_D1/JP_D2) that, when cut, frees the GPIO
for expansion. **GPIO 43 additionally gets 1 kΩ series** — it is U0TXD
and the ROM boot log drives it at every reset (spec §2.5).

**Shared EN inverter** (spec §2.5): `STEPPER_EN_RAW` (PCA9685 ch 15) →
AO3400A gate; drain = both sockets' EN with 10 k to +3V3. Drivers
default **disabled** from power-on until firmware raises ch 15.

## ✅ ILIM resolved — TI datasheet, not the guess

**ITRIP = 64 000 / R_ILIM** (TI's own example: 32 k → 2 A; minimum
legal 15 k). **R_ILIM = 30 kΩ (`C22984`, Basic) → 2.13 A per channel**,
matching the power budget's 2 A with the DRV8871's 3.6 A peak above it.

## Parts

| Ref | Part | LCSC | Note |
|---|---|---|---|
| J_S1L/R, J_S2L/R | 1×8 female header ×4 | **`C42431840`** — $0.11, THT gold | **Rows 12.70 mm apart in layout, pin 1 to pin 1.** |
| JP11–13, JP21–23 | 1×3 header ×6 + shunts | `C124376` + **`C100114`** shunts | strap fields. |
| Q_EN + R_ENP | AO3400A + 10 k | `C20917`, `C25804` | EN inverter. |
| R_UTX, R_DG2 | 1 kΩ ×2 | **`C21190`** Basic | UART TX leg; GPIO43 series. |
| JP_D1, JP_D2 | solder jumper, bridged | copper only | `Jumper:SolderJumper_2_Bridged`. |
| J_DIAG1/2 | 1×2 header | `C124375` | DIAG jumper-wire targets. |
| XH1, XH2 | **JST XH-4A** | **`C37815`** — $0.017, 428 k stock | NEMA17 pigtails plug straight in; pin order 2B 2A 1A 1B follows the power row. Stock KiCad `JST_XH_B4B-XH-A` footprint. |
| C_BS1/2, C_MA1, C_MB1 | 100 µF/63 V ×4 | `C7471890` | bulk at VMOT: per socket + per DC driver. 63 V clears the 50 V floor. |
| U_MA, U_MB | **DRV8871DDAR** ×2 | **`C75864`** — $2.51/1, $1.84/100 | genuine TI. Import inspected, pins OK; **footprint forked to `SO-8EP_DRV8871DDAR`** after the import nearly overwrote the AP64350's same-named generic (import lie #6). Internal input pulldowns → outputs off at boot. ⚠ layout: check EP paste vs TI's 2.29×3.05 drawing. |
| R_ILA/B | 30 kΩ ×2 | `C22984` Basic | 2.13 A trip, formula above. |
| C_MA2, C_MB2 | 100 nF ×2 | `C14663` | at each VM. |
| J_MA, J_MB | DG128-5.0-02P ×2 | `C711349` | motor terminals. |

## KiCad symbols to place

| Ref(s) | Symbol (`A` key) |
|---|---|
| J_S1L, J_S1R, J_S2L, J_S2R | `Connector_Generic:Conn_01x08` |
| JP11–23 | `Connector_Generic:Conn_01x03` |
| J_DIAG1/2 | `Connector_Generic:Conn_01x02` |
| XH1/2 | `Connector_Generic:Conn_01x04` |
| JP_D1/2 | `Jumper:SolderJumper_2_Bridged` |
| Q_EN | `Transistor_FET:AO3400A` |
| U_MA/B | `propmesh:DRV8871DDAR` |
| C_BSx/C_Mx1 | `Device:C_Polarized` |
| R, C | `Device:R`, `Device:C` |
| J_MA/B | `Connector:Screw_Terminal_01x02` |

Rails: `VIN_PROT` global label, `+3V3`/`GND` power symbols.

## Assign Footprints — by schematic reference (as annotated 2026-09-04)

| Refs | Footprint |
|---|---|
| J_S1L1, J_S1R1, J_S2L1, J_S2R1 | `Connector_PinSocket_2.54mm:PinSocket_1x08_P2.54mm_Vertical` — **sockets, not headers**: female receptacles the modules drop into |
| J15, J19, J20, J21, J22, J23 | `Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical` |
| J16, J24 | `Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical` |
| JP1, JP3 | `Jumper:SolderJumper-2_P1.3mm_Bridged_RoundedPad1.0x1.5mm` |
| XH1, XH2 | `Connector_JST:JST_XH_B4B-XH-A_1x04_P2.50mm_Vertical` |
| R29, R30, R31, R_ENP1, R_UTX1 | `Resistor_SMD:R_0603_1608Metric` |
| J_MA1, J_MB1 | `propmesh:CONN-TH_DG128-5.0-02P-14-00A-H` |

(If parts get re-annotated, the checker's report re-prints this mapping
with current references — the `(spec name)` in parentheses ties each
row back to the tables above.)

## Checklist

- [ ] Socket rows 12.70 mm apart noted for layout; pins 5+6 tied = UART bus
- [ ] EN inverter present, pull-up to +3V3; TX through 1 k, RX direct
- [ ] MS straps ×6 with +3V3/GND rails; silk TMC defaults
- [ ] DIAG aux headers + bridged SJs; 1 k on GPIO43 only
- [ ] ILIM 30 k both drivers; bulk 100 µF at both sockets and both VMs
- [ ] checknet green, then ERC

## Sourcing status

**Complete.** 32 parts, rollup (§2.4): **$6.89 @1, $4.75 @100** — the
DRV8871s are two-thirds of it; genuine TI runs double the old estimate.
Dual-mode note (spec §2.4): an MP6500-class module in the same socket
gives 2 brushed channels — the pinout above is why it just works.

# Sheet 03 — Slow outputs (PCA9685: servos, LED channels, relays)

> **Revised 2026-09-16** (datasheet review; drawing steps in
> `../schematic-changes-2026-09-16.md`): **a second PCA9685 (`U_PCA2`, 0x41) now drives the six DC channels at 1 kHz**; `U_PCA` (0x40) keeps servos at 50 Hz, relays and stepper enable, and its LED6–LED11 are unused. Both ~OE pins go to `PCA_OE` (GPIO 37) with a 10 k pull-up, so all outputs are held off while the MCU is in reset. Channel map: `pinmap.yaml`.

**Everything needed to draw this sheet is in this file.** Fully sourced
2026-09-04; the LED-channel decision is resolved. Open
`03-outputs.diagram.html` for the drawing guide; after capture:

```
python3 tools/checknet.py hardware/pro/sheets/03-outputs.net.yaml
```

## ✅ LED-channel decision — resolved 2026-09-04 (Colin)

**All 6 channels stay, driven by 6 discrete AO3400A N-FETs, one 3.5 mm
screw terminal each; ULN2003A drives only the 3 relays. Revised same
day: channels switch the SUPPLY rail (VIN_PROT), not +5V — see the
channel section.**
The old "trim to 4 channels" fallback is dead — no spec/feature change.

Why FETs beat a second Darlington array: a ULN drops ~1 V at load
(20 % of a 5 V LED string turned into heat in one package); the AO3400A
drops millivolts, is fully on from the PCA9685's 3.3 V outputs, and
SOT-23 is a free-swap footprint. `C20917` is JLC **Basic** with a
million in stock.

**Board-wide consolidation:** the AO3400A also replaces sheet 06's
pencilled 2N7002 as the STEPPER_EN inverter. ~~One MOSFET part number
for 7 placements~~ — **since 2026-09-16 the six output FETs are Vishay
SI2356DS (40 V, decision 4B) and only the EN inverter stays AO3400A**:
its drain sees 3.3 V, so the voltage argument doesn't apply to it.

**Connector consequence:** the 4-pos 3.5 mm terminal that would bank
3 channels per connector is effectively unstocked (10 pcs, 3× price),
so it's **one DG381S-3.5-02P per channel** — ~46 mm of board edge.
⚠ **`C723982` stock is thin (82 pcs)** — covers v0.1 hand-builds only;
re-source or re-bank before any volume order.

## Nets and labels

- Global labels (cross-sheet, checker-enforced): **`I2C_SDA`,
  `I2C_SCL`** (from sheet 02), **`STEPPER_EN_RAW`** (to sheet 06).
- Channel nets are local labels named after pinmap channels:
  `SERVO_1..6`, `LED_1..6`, `RELAY_1..3`.
- Rails: `+5V`, `+3V3`, `GND` power symbols.
- Channel map (pinmap `pca9685:` block): **LED0–5 = SERVO_1..6,
  LED6–11 = LED_1..6, LED12–14 = RELAY_1..3, LED15 = STEPPER_EN_RAW.**

## PCA9685 core

| Ref | Part | LCSC | Note |
|---|---|---|---|
| U_PCA | **PCA9685PW,118** TSSOP-28 | **`C2678753`** — $2.87/1, $1.84/100, 2.5 k stock | The ",118" is reel packaging, same part. **VDD = +3V3**, not 5 V: at VDD=5 V its I²C VIH (0.7·VDD = 3.5 V) is above the ESP32's 3.3 V and the bus goes marginal. Servos accept 3.3 V pulses; the FETs are spec'd at 2.5 V gate. Symbol `Driver_LED:PCA9685PW`, footprint stock TSSOP-28. |
| R_SDA, R_SCL | 4.7 kΩ | `C23162` **Basic** | **The board's ONLY I²C pull-ups** — they serve the PCA9685, Qwiic (sheet 07) and expansion. Never add more elsewhere. |
| R_A0…R_A5 | 10 kΩ ×6 | `C25804` **Basic** | A0–A5 → GND **via resistor, not direct tie** → address 0x40, reworkable if a Qwiic device ever conflicts. |
| C_P1, C_P2 | 100 nF + 10 µF | `C14663`, `C95841` | at VDD. |
| — | OE, EXTCLK | — | **both directly to GND** (OE low = outputs enabled but the chip powers up all-off anyway; EXTCLK unused). |

## Relays ×3

| Ref | Part | LCSC | Note |
|---|---|---|---|
| U_REL | **ULN2003ADR** SOIC-16 | **`C7512`** — $0.16, **Basic**, 377 k stock | Inputs I1–I3 from LED12–14 (3.3 V logic is fine). **COM (pin 9) → +5V or the internal flybacks protect nothing.** I4–I7 float — safe for Darlington inputs. |
| K1–K3 | **HK4100F-DC5V-SHG** | **`C12072`** — $0.53/1, $0.30/100, 28 k stock | Suffix decoded: S sealed, **H = 0.2 W coil → 40 mA each** (the old 70 mA guess was the 0.36 W variant; 3 held coils = 120 mA of 5 V budget, not 210). Contacts **3 A @ 30 VDC** — matches the locked dry-contact limit exactly. Symbol+footprint imported from LCSC (`propmesh:`), land pattern verified against the Huike drawing. |
| J_REL1–3 | **DG128-5.0-03P** | **`C691861`** — $0.28, 5.2 k stock | Silkscreen **NO \| COM \| NC** and **DRY CONTACT 30V MAX**. Footprint imported, 5.00 mm pitch verified. |

**Relay pad map (verified against the datasheet bottom view):** pads
**3/4 = coil** (either way round; 4 → +5V, 3 → ULN output), pads
**5+6 = COM, internally common — tie both** to the terminal's centre,
pads **1/2 = the throws**. ⚠ **Which throw is NO vs NC is
drawing-ambiguous** (bottom-view mirror). Wired as 1=NO, 2=NC.
**Bring-up step: continuity-beep COM↔pads 1/2 unpowered — NC beeps.
If reversed, swap the silkscreen only; no rewire.**

## DC switch/dim channels ×6 — supply-voltage loads (revised 2026-09-04)

**Re-pointed from +5V to `VIN_PROT` (Colin's call): the channels switch
loads at the board's supply voltage** — 12 V lights on a 12 V supply,
24 V on 24 — because the hobby's dumb-lighting and pneumatic-valve
world is 12/24 V, not 5 V. Low-side switching made this a rail choice,
not a redesign: only the terminal's + pin moved, plus one flyback per
channel so **solenoid valves are a first-class load**.

| Ref | Part | LCSC | Note |
|---|---|---|---|
| Q_LED1–6 | **Vishay SI2356DS-T1-GE3** SOT-23 | **`C74127`** — $0.32 @100, Extended, 5.2 k stock | Low-side: G ← **`U_PCA2`** LED0–5, S → GND, D → terminal pin 2. **40 V** (was AO3400A `C20917`, 30 V, until 2026-09-16: the input TVS only starts conducting at 36.7 V, so it could never protect a 30 V part). 70 mΩ max at 2.5 V gate / 2 A → 0.28 W worst case per channel at 2 A (AO3400A: 0.19 W). Symbol stays `Transistor_FET:AO3400A` — same G1/S2/D3 pins. No gate R at PCA9685 PWM rates. |
| D_FB1–6 | **SS34** SMA | **`C8678`** — $0.03, **Basic** | Flyback **across the load**: A → switched node, K → VIN_PROT. Same part as sheet 02's D_VBUS — zero new part numbers. |
| J_LED1–6 | **DG381S-3.5-02P** | **`C723982`** ⚠ 82 pcs | **Pin 1 = VIN_PROT (supply voltage!), pin 2 = switched return.** Silkscreen `V+` / `SW` and one shared `V+ = SUPPLY VOLTAGE`. |

**These are DUMB loads only — addressable strips are sheet 05**, which
owns the level shifter, per-line series resistors, inrush caps and the
5 V data connectors. No data path exists here. The one legitimate
crossover is using a channel as a **master power switch** for a strip
(on/off only — PWM would corrupt the pixel data timing).

**Why pin 1 is hardwired to VIN_PROT, and the coupling that creates.**
Channel voltage = **input voltage**, so the supply choice and the
lighting choice are linked: *the board recommends 24 V for motor
performance, while most prop lighting is 12 V.* Take the 24 V advice
and the channels are 24 V. **Ship this in the user guidance, not as a
surprise** — it is how commercial controllers behave, but it must be
read before someone buys a PSU.

A jumper to +5 V was considered and rejected: it does not solve the
painful case (24 V board, 12 V lights), and buys six solder jumpers
plus six new ways to have a dead channel. **Low-side switching already
provides the escape hatch for free** — feed the load from any external
supply and bring only its return to pin 2, with the two grounds tied
(board GND is available at any servo header). Document that as the
mixed-voltage recipe.

**Rating: 2 A continuous per channel, 5 A aggregate across the six.**
The stack under that number: FET 160 mW at 2 A (nothing, even in a hot
enclosure), flyback 3 A, terminal 10 A, and the 7.5 A input fuse is
what caps the aggregate alongside the rest of the board. At 24 V the
same 5 A is 120 W of lighting. **Usage rule for the docs: dim lights
freely; switch solenoids 0/100 %, never PWM them.** Typical loads:
12 V floods (lightning rigs), flicker/breathe effects, pneumatic
valves, small pumps.

## Servo headers ×6

| Ref | Part | LCSC | Note |
|---|---|---|---|
| J_SRV1–6 | 1×3 2.54 mm male header | **`C124376`** (B-2100S03P) — $0.03 | Pin order **GND–5V–SIG** (universal servo pigtail; SIG = LED0–5). Stock KiCad footprint `PinHeader_1x03`. Six stalled servos can eat the whole 5 V rail — documented limit. |

## KiCad symbols to place

| Ref(s) | Symbol (`A` key) |
|---|---|
| U_PCA | `PCA9685PW` (Driver_LED) |
| U_REL | `ULN2003A` (Transistor_Array) — pins I1–7/O1–7/COM/GND |
| Q_LED1–6 | `AO3400A` (Transistor_FET) — symbol only; Value `SI2356DS` |
| D_FB1–6 | `Device:D_Schottky` — A → the switched node (terminal pin 2 / drain), K → `VIN_PROT` |
| K1–K3 | `propmesh:HK4100F-DC5V-SHG` (imported; pins are bare numbers 1–6 — the yaml/diagram is the map) |
| J_REL1–3 | `Connector:Screw_Terminal_01x03` |
| J_LED1–6 | `Connector:Screw_Terminal_01x02` |
| J_SRV1–6 | `Connector_Generic:Conn_01x03` |
| R, C | `Device:R`, `Device:C` |

Power symbols `P`: `+5V`, `+3V3`, `GND`. No PWR_FLAG needed (rails
already flagged on sheets 01/02).

## Checklist

- [ ] I²C pull-ups present — here only
- [ ] ULN COM → +5V; OE and EXTCLK → GND
- [ ] A0–A5 strapped via 10 k, not direct
- [ ] Relay: coil 3/4, COM 5+6 both, throws 1/2; silk NO|COM|NC + 30 V warning
- [ ] Channel terminals: VIN_PROT on pin 1, switched return pin 2; flyback A→pin 2 node, K→VIN_PROT
- [ ] Servo headers GND–5V–SIG order
- [ ] `STEPPER_EN_RAW` global label placed (sheet 06 consumes)
- [ ] checknet green, then ERC

## Sourcing status

**Complete.** 42 placements, 13 part numbers (6 shared with earlier
sheets). Rollup (§2.4): **$8.67 @ qty 1, $5.46 @ qty 100.** Watch
items: `C723982` stock (82); relay NO/NC continuity check at bring-up.

# Sheet 07 — Sensors, Qwiic, expansion header

> **Revised 2026-09-16** (datasheet review; drawing steps in
> `../schematic-changes-2026-09-16.md`): the digital-input series resistors `R_D1`–`R_D3` are **2.2 kΩ 1206** (`C17948`).

**Everything needed to draw this sheet is in this file.** Fully sourced
2026-09-04; **IR receiver dropped 2026-09-05** (see below). Drawing
guide: `07-sensors-expansion.diagram.html`; checker:

```
python3 tools/checknet.py hardware/pro/sheets/07-sensors-expansion.net.yaml
```

**Nets on this sheet** (global, checker-enforced): `DIGITAL_IN_1..3`
(GPIO 10/11/12), `ANALOG_IN_1/2` (GPIO 1/2), `EXPANSION_1/2`
(GPIO 45/46), `I2C_SDA`/`I2C_SCL` (pull-ups on sheet 03 — **add none
here**), and from sheet 06: `STEPPER_1_DIAG` and `D2_MID` (global on
both sheets).

## Why there is no IR receiver (2026-09-05)

The sheet was drawn and green with an onboard TSOP38238. It leaves
because **the board lives hidden inside a prop, where a receiver can't
see a remote** — an IR receiver only makes sense as a plug-in on a
wire, and that already exists: a TSOP module on a pigtail into any
`DIGITAL_IN` (5 V on the XH, output clamped by the BAT54S; firmware
runs RMT receive on that pin). It was also the block's most expensive
part, its only THT joint, and half of open item #2. Its GPIO 3 became
strip 1's clock on sheet 05.

The six symbols it needed (TSOP, 100 Ω, 10 µF, 10 k pull-up, PWR_FLAG,
`IR_RX` label) were removed from the drawn sheet on 2026-09-06.

## Digital inputs ×3

Per input, sensor-side to pin-side: **JST-XH 3-pin (5V | GND | SIG) →
1 kΩ series → BAT54S clamp → GPIO, with 10 kΩ pull-up to 3V3 on the
GPIO side.** Handles 5 V-output sensors (HC-SR501) and miswires.

### ⚠ Order corrected 2026-09-08 — series R FIRST, clamp SECOND

The sheet was drawn clamp-first (clamp at the connector, resistor
between clamp and GPIO). **That is wrong for this board's threat
model.** With the clamp at the connector nothing limits fault current:
`J_PIR` is a bare 0.1″ header wired `5V | GND | SIG`, so a dupont plug
fitted backwards puts the board's **own +5 V onto SIG**, the upper
clamp diode conducts straight into the +3V3 rail, and the rail is
dragged to ≈4.4 V. Everything on it — MCU, PCA9685, DAC, card — is
rated 3.6 V absolute maximum. A 12 V miswire into a sensor XH does the
same, harder. With the 1 kΩ first, the same two mistakes become 1.4 mA
and 8.4 mA — harmless. **Qualified 2026-09-16:** at **24 V** the same
mistake is 20 mA and **0.42 W in the resistor — four times an 0603's
rating**. Decision needed (datasheet review §10): either fit the three
series resistors as **2.2 kΩ 1206** (9 mA / 0.19 W at 24 V, no effect on
the signal — the pin side is high impedance) or document the sensor
ports as **5–12 V only**. Also: the clamp diverts the fault into +3V3;
the board's own idle load absorbs a few mA, so this is fine while the
board is powered, but an externally driven sensor with the board **off**
back-powers the 3V3 rail — say so on the silk (`POWER BOARD FIRST`).

The trade is real and deliberate: clamp-at-the-port is better for pure
ESD, because the transient never reaches the resistor. Sustained
miswiring is this board's realistic failure (hidden yard box, dupont
sensor leads, wired in the dark), and its consequence is losing every
3V3 part rather than degraded ESD margin. Found by the 2026-09-08
audit (`../review-2026-09-08.md` §1.4).

**How to make the change (KiCad, sensor sheet).** Nothing moves and no
part is added. Each input's 1 kΩ already sits vertically between the
raw node and the GPIO node; the only change is which of those two the
clamp's COM pin joins. For each of the three inputs:

1. Click the **horizontal wire running from the BAT54S's COM pin to the
   raw node** (the coordinates are in the table below) so it highlights,
   and press **Delete**.
2. Press **W** to start a wire at the now-free COM pin, click once
   straight above it at the GPIO node's height to turn the corner, then
   click on the GPIO node to finish. The wire is an L.
3. The corridor between the two nodes is empty on all three inputs
   (checked 2026-09-08), so the vertical leg crosses nothing.

| Input | Clamp | Delete this wire | Draw: COM → corner → GPIO node |
|---|---|---|---|
| 1 | `D12` | (223.52, 45.72) → (237.49, 45.72) | (223.52, 45.72) → (223.52, 38.10) → (237.49, 38.10) |
| 2 | `D13` | (224.79, 81.28) → (238.76, 81.28) | (224.79, 81.28) → (224.79, 73.66) → (238.76, 73.66) |
| 3 | `D14` | (224.79, 114.30) → (238.76, 114.30) | (224.79, 114.30) → (224.79, 106.68) → (238.76, 106.68) |

The GPIO node is the one that already carries the `DIGITAL_IN_n` global
label and the 10 k pull-up's lower pin, so after the change the clamp,
the pull-up and the label all meet there. `J_PIR` stays on the raw node
— it is upstream of the resistor, which is the point. Then save, run
`python3 tools/checknet.py hardware/pro/sheets/07-sensors-expansion.net.yaml`
(the yaml already expects the new order), ERC, and **F8**.

**BAT54S orientation** (the S suffix = series pair, one SOT-23 per
input; A/C suffixes are different topologies — don't substitute). The
symbol names its pins, and the yaml uses those names:

| Pin | Goes to | Why |
|---|---|---|
| 1 `A` (anode, lower diode) | **GND** | conducts when SIG < −0.3 V |
| 2 `K` (cathode, upper diode) | **+3V3** | conducts when SIG > 3.6 V |
| 3 `COM` (common junction) | **SIG** (the raw net) | |

**J_PIR** is a 2.54 mm 1×3 header wired **in parallel with digital
input 1**, same 5V | GND | SIG order (silkscreen it) — an HC-SR501
plugs in over dupont wires with no XH pigtail.

## Analog inputs ×2

Same XH with 5 V power, then **100 k / 100 k halver → tap = GPIO**: a
5 V-powered sensor's full scale lands at 2.5 V, inside the ADC's
calibrated range. **100 nF from tap to GND** (`C_AN1`/`C_AN2`) quiets
the reading.

## Qwiic

Genuine SM04B-SRSS-TB is **stock-dead at JLC** → **ZX-SH1.0-4PWT**
clone (`C7430446`, $0.065, 130 k stock), placed on **KiCad's official
JST-SH footprint**. ⚠ **Verify at layout**: measure the clone's DS
drawing against that footprint (import-lie doctrine — the DS link is
in the parts API). Pin order per Qwiic spec: **1=GND, 2=3V3, 3=SDA,
4=SCL**. 3V3 bus; pull-ups live on sheet 03.

## Expansion header (2×5, 0.1")

| Pin | Signal | Notes |
|---|---|---|
| 1 | 3V3 | 500 mA budget |
| 2 | 5V | shares the 3 A rail |
| 3, 10 | GND | |
| 4 | GPIO 45 via 100 Ω | ⚠ strapping — silk **"KEEP LOW AT RESET"** |
| 5 | GPIO 46 via 100 Ω | ⚠ strapping — same silk |
| 6, 7 | SDA / SCL | Qwiic duplicated in 0.1" |
| 8 | GPIO 42 = `STEPPER_1_DIAG` | doubles as stepper 1 DIAG via JP_D1 (sheet 06) |
| 9 | `D2_MID` (GPIO 43 behind its 1 k) | the 1 k that guards U0TXD's boot log guards the header too |

**Strap protection, mandatory:** GPIO 45 (VDD_SPI voltage select) and
46 (boot mode) each get **10 k pulldown + 100 Ω series** — and the
**pulldown sits on the MCU side of the series R**, so the pin is
guaranteed LOW at reset even with the header floating, while the
series R limits damage from a miswire.

## Parts

| Ref | Part | LCSC | Note |
|---|---|---|---|
| J_DI1–3, J_AN1–2 | JST XH-3A ×5 | **`C2316`** — $0.011, 402 k stock | all five: 5V \| GND \| SIG. |
| J_PIR | 1×3 2.54 header | `C124376` | parallel to input 1. |
| D_C1–3 | **BAT54S** ×3 | **`C8592`** — $0.023, 202 k stock | orientation table above. |
| R_D1–3 | **2.2 k 1206** ×3 | `C17948` (Extended) | series before the clamp; 0.19 W at a 24 V miswire (was 1 k 0603, `C21190`). |
| R_P1–3, R_E1P, R_E2P | 10 k ×5 | `C25804` Basic | pull-ups / strap pulldowns. |
| R_A1T/B, R_A2T/B | 100 k ×4 | `C25803` Basic | halvers. |
| C_AN1, C_AN2 | 100 nF ×2 | `C14663` Basic | ADC tap filters. |
| J_QW | **ZX-SH1.0-4PWT** | **`C7430446`** — $0.065, 130 k stock | Qwiic; ⚠ measure vs footprint at layout. |
| J_EXP | 2×5 header 2.54 | **`C42431818`** — $0.053, 16 k stock | vertical, gold flash. |
| R_E1S, R_E2S | 100 Ω ×2 | `C22775` Basic | strap series Rs. |

## KiCad symbols to place

| Ref(s) | Symbol (`A` key) |
|---|---|
| J_DI1–3, J_AN1–2, J_PIR | `Connector_Generic:Conn_01x03` |
| D_C1–3 | `Diode:BAT54S` |
| J_QW | `Connector_Generic:Conn_01x04` |
| J_EXP | `Connector_Generic:Conn_02x05_Odd_Even` |
| R, C | `Device:R`, `Device:C` |

Rails: `+5V`/`+3V3`/`GND` power symbols. All signal labels global.
The drawn sheet uses standard sequential designators (`J40`, `R39`,
`D12`…); the names in this doc are spec names, and the checker pairs the
two by Value, printing both (`R39 (R_P1)`).

## Footprints (checker-enforced via the yaml)

| Part | Footprint |
|---|---|
| XH connectors | `Connector_JST:JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical` |
| J_PIR | `Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical` |
| D_C1–3 | `Package_TO_SOT_SMD:SOT-23` |
| J_QW | `Connector_JST:JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal` |
| J_EXP | `Connector_PinHeader_2.54mm:PinHeader_2x05_P2.54mm_Vertical` |
| R / C 0603 | stock `R_0603` / `C_0603` |

## Checklist

- [ ] Every digital input: clamp (COM = signal!) + 1 k + 10 k pull-up
- [ ] Analog: halver + 100 nF at the tap; nothing else in the path
- [ ] 45/46: pulldown MCU-side of the 100 Ω; silk noted for layout
- [ ] No I²C pull-ups added here (they're on sheet 03)
- [x] checknet green, ERC clean (2026-09-06)

## Sourcing status

**Complete.** 27 parts, rollup (§2.4): **$0.32 @1, $0.28 @100** — was
$0.94 with the TSOP. Qwiic and 2×5 header re-sourced after the genuine
JST and first-choice header queries came back dead/empty.

## Open decision (raised 2026-09-08): XH, 0.1″ header, or one footprint for both?

The five sensor inputs use JST-XH 3-pin. **The objection:** the cheap
sensors this board is for (HC-SR501 PIR, reed switches, LDR modules)
ship with **male 0.1″ pins and female dupont leads**, not XH pigtails,
so an XH socket forces the user to make an adapter. `J46` exists
precisely because of that, but only for input 1.

**Measured 2026-09-08 — one footprint can take both.** XH-3A pads are
on 2.50 mm, a 0.1″ header on 2.54 mm; over three pins the cumulative
error is **0.08 mm** (pin 2 off by 0.04, pin 3 by 0.08). The XH
footprint drills 0.95 mm and a 0.1″ header pin is 0.64 mm square
(0.90 mm diagonal), leaving 0.155 mm radial slack — the error fits with
nothing spare. **Open the drill to 1.00 mm** and the slack becomes
0.18 mm, comfortable for both parts.

**Proposal (not applied — Colin's call).** Fork the footprint to
`propmesh:JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical_HdrCompat` with 1.00 mm
drills, use it on all five sensor inputs, and silk both the XH shroud
outline and the 0.1″ pin positions. The user solders **whichever
connector they prefer** — no second part, no extra soldering, no board
area, and `J46` becomes redundant.

Trade to weigh: the XH is keyed and latched, which is exactly what
prevents the reversed-plug miswire the clamp reorder above also guards
against. A 0.1″ header has neither. So XH stays the documented default
and the header is the escape hatch, not the other way round.

# Sheet 07 — Sensors, Qwiic, expansion header

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
BAT54S clamp → 1 kΩ series → GPIO, with 10 kΩ pull-up to 3V3 on the
GPIO side.** Handles 5 V-output sensors (HC-SR501) and miswires.

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
| R_D1–3 | 1 k ×3 | `C21190` Basic | series after clamp. |
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

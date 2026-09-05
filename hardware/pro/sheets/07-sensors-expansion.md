# Sheet 07 — Sensors, IR, Qwiic, expansion header

**Everything needed to draw this sheet is in this file.** Fully sourced
2026-09-04. Drawing guide: `07-sensors-expansion.diagram.html`; checker:

```
python3 tools/checknet.py hardware/pro/sheets/07-sensors-expansion.net.yaml
```

**Nets on this sheet** (global, checker-enforced): `DIGITAL_IN_1..3`
(GPIO 10/11/12), `ANALOG_IN_1/2` (GPIO 1/2), `IR_RX` (GPIO 3),
`EXPANSION_1/2` (GPIO 45/46), `I2C_SDA`/`I2C_SCL` (pull-ups on
sheet 03 — **add none here**), and from sheet 06: `STEPPER_1_DIAG`
and `D2_MID`.

> **⚠ One-time fix on the MOTORS sheet first:** the `D2_MID` label
> (between GPIO43's 1 k and JP_D2) was drawn as a **local** label.
> Expansion pin 9 joins that net from this sheet, so it must become a
> **global** label: on the motors sheet select it → E → Label type:
> Global. Its yaml is already updated (`named:` list).

## Digital inputs ×3

Per input, sensor-side to pin-side: **JST-XH 3-pin (5V | GND | SIG) →
BAT54S clamp → 1 kΩ series → GPIO, with 10 kΩ pull-up to 3V3 on the
GPIO side.** Handles 5 V-output sensors (HC-SR501) and miswires.

**BAT54S orientation** (the S suffix = series pair, one SOT-23 per
input; A/C suffixes are different topologies — don't substitute):

| Pin | Goes to | Why |
|---|---|---|
| 1 (anode, lower diode) | **GND** | conducts when SIG < −0.3 V |
| 2 (cathode, upper diode) | **+3V3** | conducts when SIG > 3.6 V |
| 3 (common junction) | **SIG** (the raw net) | |

**J_PIR** is a 2.54 mm 1×3 header wired **in parallel with digital
input 1**, same 5V | GND | SIG order (silkscreen it) — an HC-SR501
plugs in over dupont wires with no XH pigtail.

## Analog inputs ×2

Same XH with 5 V power, then **100 k / 100 k halver → tap = GPIO**: a
5 V-powered sensor's full scale lands at 2.5 V, inside the ADC's
calibrated range. **100 nF from tap to GND** quiets the reading.

## IR receiver — and why it runs on 3V3

**TSOP38238** (`C141632`, $0.73@1, 16 k stock) — the 38 = **38 kHz
carrier**, the one common remotes actually use. THT **on purpose**
(open item #2). Two wiring facts verified against the DS 2026-09-04:

- **Supply is +3V3, not 5 V**: the output is open-collector with an
  internal ~30 k pull-up **to its own Vs** — a 5 V supply would idle
  GPIO 3 at 5 V. External 10 k pull-up to 3V3 on OUT.
- **Supply filter 100 Ω + 10 µF at the part** (DS asks ≥4.7 µF; 10 µF
  is already on the BOM).
- KiCad's stock `TSOP382xx` symbol checked: OUT=1, GND=2, Vs=3 —
  matches Vishay. Its default MINICAST footprint is the right package.

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
| R_P1–3, R_IP, R_E1P, R_E2P | 10 k ×6 | `C25804` Basic | pull-ups / strap pulldowns. |
| R_A1T/B, R_A2T/B | 100 k ×4 | `C25803` Basic | halvers. |
| C_AN1, C_AN2 | 100 nF ×2 | `C14663` Basic | ADC tap filters. |
| U_IR | **TSOP38238** | **`C141632`** — $0.73/1, $0.56/100 | THT, deliberate. |
| R_IR | 100 Ω | `C22775` Basic | supply filter. |
| C_IR | 10 µF/16 V 0805 | `C95841` | supply filter (DS ≥4.7 µF). |
| J_QW | **ZX-SH1.0-4PWT** | **`C7430446`** — $0.065, 130 k stock | Qwiic; ⚠ measure vs footprint at layout. |
| J_EXP | 2×5 header 2.54 | **`C42431818`** — $0.053, 16 k stock | vertical, gold flash. |
| R_E1S, R_E2S | 100 Ω ×2 | `C22775` Basic | strap series Rs. |

## KiCad symbols to place

| Ref(s) | Symbol (`A` key) |
|---|---|
| J_DI1–3, J_AN1–2, J_PIR | `Connector_Generic:Conn_01x03` |
| D_C1–3 | `Diode:BAT54S` |
| U_IR | `Interface_Optical:TSOP382xx` |
| J_QW | `Connector_Generic:Conn_01x04` |
| J_EXP | `Connector_Generic:Conn_02x05_Odd_Even` |
| R, C | `Device:R`, `Device:C` |

Rails: `+5V`/`+3V3`/`GND` power symbols. All signal labels global.

## Footprints (checker-enforced via the yaml)

| Part | Footprint |
|---|---|
| XH connectors | `Connector_JST:JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical` |
| J_PIR | `Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical` |
| D_C1–3 | `Package_TO_SOT_SMD:SOT-23` |
| U_IR | `OptoDevice:Vishay_MINICAST-3Pin` |
| J_QW | `Connector_JST:JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal` |
| J_EXP | `Connector_PinHeader_2.54mm:PinHeader_2x05_P2.54mm_Vertical` |
| R / C 0603 | stock `R_0603` / `C_0603`; C_IR is `C_0805` |

## Checklist

- [ ] `D2_MID` label on the motors sheet converted to global
- [ ] Every digital input: clamp (pin 3 = signal!) + 1 k + 10 k pull-up
- [ ] Analog: halver + 100 nF at the tap; nothing else in the path
- [ ] TSOP on **3V3** with 100 Ω + 10 µF filter and 10 k pull-up
- [ ] 45/46: pulldown MCU-side of the 100 Ω; silk noted for layout
- [ ] No I²C pull-ups added here (they're on sheet 03)
- [ ] checknet green, then ERC

## Sourcing status

**Complete.** 31 parts, rollup (§2.4): **$1.18 @1, $0.94 @100** —
the TSOP is over half of it. Qwiic and 2×5 header re-sourced after the
genuine JST and first-choice header queries came back dead/empty.

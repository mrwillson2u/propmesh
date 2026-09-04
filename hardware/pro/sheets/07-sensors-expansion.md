# Sheet 07 — Sensors, IR, Qwiic, expansion header

**Everything needed to draw this sheet is in this file.**

**Nets on this sheet**: `ANALOG_IN_1` (GPIO 1), `ANALOG_IN_2` (GPIO 2),
`IR_RX` (GPIO 3), `DIGITAL_IN_1..3` (GPIO 10/11/12), `EXPANSION_1`
(GPIO 45), `EXPANSION_2` (GPIO 46), plus `I2C_SDA`/`I2C_SCL` passing
through (pull-ups live on sheet 03 — do not add more).

## Digital inputs ×3

Per input, sensor-side to pin-side: JST-XH 3-pin (**5 V** / GND / SIG)
→ **BAT54S** clamp (to 3V3 and GND — the **S** suffix = series pair,
one SOT-23 per input; A/C suffixes are different topologies) → **1 kΩ
series** → **10 kΩ pull-up to 3V3** → GPIO. Handles 5 V-output sensors
(HC-SR501) and wiring mistakes.

## Analog inputs ×2

Same JST-XH 3-pin with 5 V power, then a **2:1 divider (2× 100 kΩ)**
before the GPIO — a 5 V-powered sensor's full-scale output lands at
2.5 V, inside the ADC's calibrated range. 100 nF from the tap to GND
quiets the reading.

## IR receiver

| Part | Criteria |
|---|---|
| TSOP38**238** | The 38 = **38 kHz carrier** — matches common remotes; other suffixes decode nothing you own. THT, and deliberately so (Economic-PCBA watch, open item #2). Supply must be filtered: **100 Ω series + ≥4.7 µF at the part**. Output is open-collector: add a **10 kΩ pull-up to 3V3**. |

Also: HC-SR501 PIR footprint header (3-pin, 5 V) per BOM.

## Qwiic

**JST SH 1.0 mm 4-pin, SM04B-SRSS-TB** — the Qwiic standard. 3V3 bus.
Pull-ups are on sheet 03. Pin order per Qwiic spec: GND / 3V3 / SDA /
SCL.

## Expansion header (2×5, 0.1")

| Pin | Signal | Notes |
|---|---|---|
| 1 | 3V3 | 500 mA budget |
| 2 | 5V | shares the 3 A rail |
| 3, 10 | GND | |
| 4 | GPIO 45 | ⚠ strapping |
| 5 | GPIO 46 | ⚠ strapping |
| 6, 7 | SDA / SCL | Qwiic duplicated in 0.1" |
| 8 | GPIO 42 | Stepper 1 DIAG via JP1 (sheet 06) |
| 9 | GPIO 43 | Stepper 2 DIAG via JP2 (sheet 06) |

**Strap protection, mandatory:** GPIO 45 and 46 each get **10 kΩ
pulldown to GND + 100 Ω series** to the header pin. Both must be LOW at
reset (45 = VDD_SPI voltage select, 46 = boot mode) — the pulldown
guarantees it with the header floating; the series R limits damage from
a miswire. Silkscreen **"KEEP LOW AT RESET"** at pins 4/5.

## Checklist

- [ ] Every input has clamp + series + pull-up (digital) or divider (analog)
- [ ] TSOP RC filter + pull-up present
- [ ] 45/46 pulldowns + series Rs present, silkscreen noted
- [ ] No duplicate I²C pull-ups added here

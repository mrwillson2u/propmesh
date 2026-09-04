# Sheet 06 — Motors (stepper sockets + DC drivers)

**Everything needed to draw this sheet is in this file.**

**Nets on this sheet**: `STEPPER_1_STEP` (13), `STEPPER_1_DIR` (14),
`STEPPER_2_STEP` (21), `STEPPER_2_DIR` (47), `TMC_UART_TX` (17),
`TMC_UART_RX` (18), `STEPPER_1_DIAG` (42), `STEPPER_2_DIAG` (43),
`MOTOR_A_IN1` (44), `MOTOR_A_IN2` (48), `MOTOR_B_IN1` (33),
`MOTOR_B_IN2` (34), `STEPPER_EN_RAW` (from sheet 03), `VIN_PROT`.

## Stepper sockets (user-supplied drivers)

| Part | Criteria |
|---|---|
| 2× 8-pin 2.54 mm female headers, ×2 sockets | **Row-to-row spacing must match the StepStick mechanical drawing — open item #3.** Power/coil pins are universal; MS/UART/SPREAD pins are not: cross-check TMC2209 (your vendor's), A4988, and MP6603 before freezing the footprint. Do not eyeball. |
| MS1/MS2/MS3 jumper blocks, 3-pin ×6 | MS1/MS2 double as **UART address straps** for the two TMC2209s on the shared bus. Silkscreen the TMC default positions. |

**Shared EN — the inverter (hardware, this sheet):** `STEPPER_EN_RAW`
from PCA9685 ch 15 drives a **AO3400A (`C20917` — consolidated with sheet 03's LED FETs, decided 2026-09-04; was AO3400A) gate; drain = the sockets' EN pins
with a 10 kΩ pull-up to 3V3**. Uninverted, drivers energize from
power-on until I²C init (PCA9685 wakes outputs-low, EN is active-low).
Inverted, they default disabled; firmware drives ch 15 HIGH to enable.
Spec §2.5 item.

**TMC UART is single-wire half-duplex:** `TMC_UART_TX` → **1 kΩ series
resistor** → the shared PDN_UART wire; `TMC_UART_RX` connects to the
wire directly. One bus, both sockets, addresses via MS straps.

**DIAG lines:** 42/43 from the sockets, each with **JP1/JP2 solder
jumper** to release the pin to the expansion header for non-StallGuard
drivers. **GPIO 43 is U0TXD — the ROM boot log drives it at every
reset, so 1 kΩ series** between socket DIAG and the pin (spec §2.5).

## Brushed DC drivers

| Part | Criteria |
|---|---|
| DRV8871**DDA**R ×2 | DDA = SOIC-8 PowerPAD. **Current limit is a resistor on ILIM** — not fixed-function. ⚠ verify the formula from the datasheet (order of I_TRIP ≈ 64 kΩ·A / R_ILIM; ~30 kΩ ≈ 2 A) and size for the largest planned motor/fan with margin. Inputs have internal pulldowns → outputs safely off with floating GPIO at boot. |

Support: 100 µF electrolytic + 100 nF per driver at VIN_PROT, close.

## Power + connectors

- **`VIN_PROT`** = protected input rail (12–24 V, 28 V abs max, from sheet 01,
  post-FET). **The TMC2209 is why the board's ceiling is 28 V** — its
  operating range ends at 29 V and this rail reaches its VM pin with no
  regulator in between. Anything socketed here must tolerate 28 V.
  Stepper-driver datasheets call this pin **VMOT** — same net, and the
  schematic label must be `VIN_PROT` so it joins sheet 01's rail.
  **Bulk: ≥100 µF per stepper socket + shared reservoir, rated 50 V**
  (35 V minimum for 30 V input). Electrolytic — the job is charge
  storage, not ESR.
- Stepper coils: **JST-XH 4-pin ×2** (NEMA17s plug straight in).
- DC motors: screw terminal 2-pos ×2, 5.08 mm.

## Checklist

- [ ] Socket footprint cross-checked against all three driver pinouts (open item #3 closed, not deferred)
- [ ] EN inverter present, pull-up to 3V3
- [ ] 1 kΩ on the UART TX leg; 1 kΩ on DIAG 43
- [ ] ILIM values calculated and verified
- [ ] VIN_PROT bulk rated ≥50 V

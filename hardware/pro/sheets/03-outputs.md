# Sheet 03 — Slow outputs (PCA9685: servos, dimmable LEDs, relays)

**Everything needed to draw this sheet is in this file.**

**Nets on this sheet**: `I2C_SDA` (GPIO 8), `I2C_SCL` (GPIO 9), plus
the PCA9685 output nets — name them after the pinmap channels:
`SERVO_1..6`, `LED_1..6`, `RELAY_1..3`, `STEPPER_EN_RAW` (ch 15, before
the inverter — the inverter itself lives on sheet 06 with the sockets).

## PCA9685

| Part | Criteria |
|---|---|
| PCA9685**PW** | PW = TSSOP-28. Address 0x40: A0–A5 → GND **via 10 kΩ resistors, not direct ties** — reworkable if a Qwiic expander ever conflicts. **OE → GND** (outputs power up off regardless). 100 nF + 10 µF decoupling. |

**I²C pull-ups live here, once: 2× 4.7 kΩ to 3V3** on SDA/SCL. They
serve the PCA9685, the Qwiic connector (sheet 07), and the expansion
header. Do not add more elsewhere.

## Relays

| Part | Criteria |
|---|---|
| ULN2003A | Package: **SOIC-16 (`ULN2003ADR`)** — LCSC also stocks DIP and TSSOP under the same base name. **COM (pin 9) → +5 V** or the internal flyback diodes protect nothing. Inputs from PCA9685 at 3.3 V logic — fine. |
| HK4100F-**DC5V**-SHG ×3 | Coil voltage is in the suffix. ~70 mA per coil → 210 mA of 5 V budget with all three held. ⚠ verify the JLC-stocked variant's pinout/footprint — relay footprints vary by vendor; import from the exact LCSC part. |
| Screw terminal 3-pos ×3 | 5.08 mm, NO/COM/NC. Dry contact only, 30 V max — silkscreen it. |

## Servos

3-pin 2.54 mm headers ×6, pin order **GND–5V–SIG** (universal servo
pigtail). Six stalled servos can eat the whole 5 V rail — documented
limit, not a hardware fix.

## Dimmable LED channels — ⚠ open design decision

The spec is underspecified here and it must be resolved on this sheet:

- The ULN2003A has **7 channels**; 3 are relays. That leaves 4 — but
  the spec promises **6** dimmable LED channels, and only 2 "basic LED
  output terminals" appear in the BOM.
- Options: **ULN2803A** (8 ch — still only 5 free), a **second
  ULN2003A**, or **6× AO3400-class N-FETs** (~$0.05 each, no extra
  package type if relays keep the ULN).
- Also decide connector count: 6 channels into 2 terminals doesn't add
  up. Either 6 channels → 3× 2-pos terminals sharing +5 V, or trim the
  claim to 4 channels.

Recommendation: keep ULN2003A for the 3 relays + 4 LED channels,
**revise the spec to 4 dimmable channels**, and note that more channels
come from a Qwiic expander — matches the "I²C is the expansion story"
decision. But this changes the README feature table, so it's Colin's
call, not a default.

## Checklist

- [ ] I²C pull-ups present (only here)
- [ ] ULN2003 COM tied to +5 V
- [ ] Relay footprint imported from the exact LCSC part
- [ ] LED-channel decision made and spec updated to match
- [ ] STEPPER_EN_RAW labeled off-sheet to sheet 06

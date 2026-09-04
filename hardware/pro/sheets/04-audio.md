# Sheet 04 — Audio + microSD

**Everything needed to draw this sheet is in this file.**

**Nets on this sheet**: `I2S_BCLK` (GPIO 7), `I2S_LRCLK` (GPIO 15),
`I2S_DOUT` (GPIO 16), `SD_CLK` (GPIO 39), `SD_CMD` (GPIO 40), `SD_D0`
(GPIO 41).

## Amplifier

| Part | Criteria |
|---|---|
| MAX98357A**ETE**+T | ETE = TQFN-16 (fine with hot air). **Two pins are resistor-programmed — this is not a fixed-function part:** `GAIN` selects 3–15 dB by how it's tied (GND / VDD / float / 100 kΩ variants); `SD_MODE` selects left / right / **(L+R)/2 mono** by resistor value. ⚠ verify the exact values in datasheet tables — do NOT guess them; a wrong SD_MODE resistor silently gives one channel instead of the mono mix we want. Genuine-vs-clone sourcing decision: hardware-spec §2.4 note. |

Support:

- Decoupling 10 µF + 100 nF at VDD.
- **Ferrite bead + ~100 pF to GND on each speaker line**, near the amp
  — class-D edges radiate; the speaker cable is an antenna. Bead
  criteria on LCSC: **rated current ≥2 A** (speaker RMS is ~0.9 A at
  3 W/4 Ω but peaks higher — an undersized bead saturates and does
  nothing) and 120–600 Ω @ 100 MHz; 0805.
- Speaker screw terminal 2-pos, 3.5 mm pitch.

## Line out

| Part | Criteria |
|---|---|
| PJ-320A 3.5 mm jack | Use the **switched-contact** variant and route the switch pin to a test point — plug-detect for free, firmware can use it later. Series ~100 Ω + DC-blocking caps from the I²S DAC? No — line-out here is amp-level dependent: **⚠ decide the line-out topology** (off MAX98357A speaker pins via attenuator, or drop line-out for v0.1). The BOM lists the jack but no source circuit — flag, don't improvise. |

## microSD (SDMMC 1-bit)

| Part | Criteria |
|---|---|
| Push-push microSD socket | **Footprint is vendor-specific** — pick the exact LCSC part first, import its footprint (easyeda2kicad), don't grab a lookalike. Ignore card-detect pins when choosing: no GPIO is free for it. |

Support:

- **10 kΩ pull-ups on SD_CMD and SD_D0** (per pinmap notes).
- 10 µF + 100 nF at card VDD — cards pull sharp current spikes.

## Checklist

- [ ] GAIN and SD_MODE resistor values verified against datasheet
- [ ] Ferrite + cap on speaker lines
- [ ] Line-out topology decided or explicitly deferred
- [ ] SD pull-ups + card decoupling present
- [ ] Socket footprint imported from the exact part

# Sheet 04 — Audio + microSD

> **Revised 2026-09-16** (datasheet review; drawing steps in
> `../schematic-changes-2026-09-16.md`): microSD DAT1 and DAT2 get 10 k pull-ups (`R_DAT1`, `R_DAT2`) instead of no-connect flags.

**Everything needed to draw this sheet is in this file.** Fully sourced
2026-09-04; both old ⚠ items resolved against the real MAX98357A
datasheet. Drawing guide: `04-audio.diagram.html`; checker:

```
python3 tools/checknet.py hardware/pro/sheets/04-audio.net.yaml
```

## ✅ Resolved: the two resistor-programmed pins (datasheet, not guess)

| Pin | Setting | How | Why |
|---|---|---|---|
| GAIN_SLOT | **12 dB** | **tie directly to GND — zero parts** (Table 8) | max clean gain for a 3 W scare box; firmware owns volume. 15 dB costs a resistor to clip harder into a 5 V-limited supply — pointless |
| SD_MODE | **(L+R)/2 mono** | **620 kΩ pull-up to +3V3** (`R_SDM`) | Table 5: mono needs a *large* pull-up. Table 6 formula: R = 222.2×VDDIO−100 = **633 k at 3.3 V**. Against the 92–108 k internal pulldown and the B0/B1 trip limits the safe window is **440–763 k** (corrected 2026-09-08 from a wrong 324 k — staying under B1_min 0.65 V with the pulldown at its 108 k max needs R > 108k×(3.3−0.65)/0.65 = 440 k; 390 k would land at 0.72 V and silently select **Right channel only**. See `../review-2026-09-08.md` §6); stocked 620 k (`C23219`, 110 k stock) sits mid-window; the 634 k E96 nominal (`C65831`) has 2 k stock. **Never direct-tie SD_MODE high — that selects Left only**, the silent one-channel failure the old ⚠ warned about. |

## ✅ Decided: line-out KEPT — done right (Colin, 2026-09-04)

First decided as "drop", reversed same day when the honest version
priced at **~$1.65 @100**: the amp's speaker pins can never be
line-out (filterless BTL class-D — no ground-referenced node), but a
**PCM5102A second DAC on the same I²S bus** is the textbook answer:
ground-centred 2.1 Vrms, no DC-blocking caps, genuine TI at $0.93.
Prime user: **feeding an FM transmitter or powered speakers** — the
xLights crowd broadcasts show audio to car radios; this jack is that
feature.

| Ref | Part | LCSC | Note |
|---|---|---|---|
| U_DAC | **PCM5102APWR**, TSSOP-20 | **`C107671`** — $1.40/1, $0.93/100, 10.5 k stock | TI Fig. 33 hookup exactly: **FLT, FMT, DEMP, SCK all → GND** (SCK grounded = internal PLL from BCK — no extra clock). XSMT (unmute) via 10 k → +3V3. Import inspected, pins OK. |
| C_CP, C_VNEG | 2.2 µF ×2 | `C513691` | charge-pump flying cap + VNEG store. Yageo X7R/10 V. |
| C_DV/LDO/AV/CPV 1+2 | 10 µF + 100 nF ×4 pairs | `C95841`, `C14663` | one pair at **each** of DVDD, LDOO, AVDD, CPVDD — Fig. 33 followed literally. |
| R_OL, R_OR + C_OL, C_OR | 470 Ω + 2.2 nF per channel | `C23179` **Basic**, `C16033` | TI's output EMI RC, at the jack. |
| J_LINE | **XKB PJ-320A** | **`C2884926`** — $0.14, 12 k stock | **L = 4 (tip), R = 3 (ring1), GND = 5 (sleeve) + 2 (ring2).** Settled by two agreeing geometric measurements after three numbering schemes collided (datasheet contacts 1–4, import pads 2–5, unnumbered PCB layout): spring contact depth orders 2 < 3 < 4 identically in the schematic drawing and the footprint slots, and **deepest spring = tip = left** — Colin's argument, confirmed. The tall bar in jack schematics is the *sleeve barrel*, not the tip (both of us misread it once). Pad 2 is the shallow ring2 a TRS plug's sleeve rides — grounded. There are **no switch contacts** on this jack; the earlier 2+4 switch-pair claim was a glyph misreading, retracted. **Meter-confirm tip/ring/sleeve at bring-up; wrong = silent channel, wire-link fix.** |

## ✅ Dissolved: genuine-vs-clone

The spec's $1.90 estimate made clones tempting at ~$0.60. **Genuine
ADI is $1.31 @1 / $0.88 @100 (`C910544`, 16.6 k stock)** — a $0.28 gap.
Buy genuine; the public BOM says so.

## Amplifier

| Ref | Part | LCSC | Note |
|---|---|---|---|
| U_AMP | **MAX98357AETE+T**, TQFN-16 | **`C910544`** | Symbol+footprint imported (`propmesh:`), pins inspected — oriented OK. **EP is not internally connected (DS p15) — tie to GND** anyway for the plane stitch. NC pins 5, 6, 12, 13 get no-connect flags. Hot-air part. |
| FB_P, FB_N | **Murata BLM21PG221SN1D**, 0805 | **`C85840`** | 220 Ω @100 MHz, **2 A**. ⚠ criteria trap confirmed real: both Basic-tier 0805 beads (GZ2012 family) are 0.5/0.8 A — they'd saturate at the ~0.9 A speaker RMS and filter nothing. Extended, earned. |
| C_FBP, C_FBN | 100 pF C0G | `C14858` **Basic** | bead output → GND, at the terminal side: the EMI snubber pair. |
| C_A1, C_A2 | 10 µF + 100 nF | `C95841`, `C14663` | at VDD (**+5V rail**). |
| J_SPK | DG381S-3.5-02P | `C723982` ⚠ same 82-pc stock pool as the LED terminals — 7 used per board | 4 Ω / 3 W max, silk `SPK`. |

## microSD — SDMMC 1-bit

| Ref | Part | LCSC | Note |
|---|---|---|---|
| U_SD | **TF-01A** push-push | **`C91145`** — $0.19, 216 k stock | The ubiquitous socket. Import inspected: pins oriented OK; **two locating pegs arrived as plated zero-ring holes → fixed to NPTH in the library** (defect #3 strikes again). |
| R_CMD, R_D0, **R_D3** | 10 kΩ ×3 | `C25804` **Basic** | to +3V3. CMD and DAT0 per pinmap — **plus DAT3, which the pinmap missed: ESP-IDF requires D3 held high in 1-bit mode or the card falls into SPI mode.** ~~DAT1/DAT2 get no-connect flags.~~ **Corrected 2026-09-16: DAT1 and DAT2 also get 10 kΩ to +3V3** — Espressif's SD pull-up page: *"SD cards and SDIO devices should also have pull-ups on all above-mentioned lines (regardless of whether these lines are connected to the host) in order to prevent them from entering a wrong state."* Two more `C25804`, no GPIO. Remove the two no-connect flags; update `04-audio.net.yaml`. |
| C_SD1, C_SD2 | 10 µF + 100 nF | `C95841`, `C14663` | at card VDD (**+3V3**) — cards pull sharp spikes. |
| TP_CD | test pad | — | the socket's card-detect switch to a 1.5 mm pad: no GPIO free today, firmware option later (§2.6 spirit). |

## KiCad symbols to place

| Ref(s) | Symbol (`A` key) |
|---|---|
| U_AMP | `propmesh:MAX98357AETE+T` (KiCad ships no MAX98357A) |
| U_DAC | `propmesh:PCM5102APWR` |
| J_LINE | `propmesh:PJ-320A` |
| R_OL, R_OR, R_XSMT | `Device:R` |
| C_CP, C_VNEG, C_OL, C_OR + 4× 10 µF/100 nF pairs | `Device:C` |
| U_SD | `propmesh:TF-01A` |
| FB_P, FB_N | `Device:FerriteBead` |
| R_SDM, R_CMD, R_D0, R_D3 | `Device:R` |
| C_FBP, C_FBN, C_A1, C_A2, C_SD1, C_SD2 | `Device:C` |
| J_SPK | `Connector:Screw_Terminal_01x02` |
| TP_CD | `Connector:TestPoint` |

Power symbols `P`: `+5V`, `+3V3`, `GND`. Global labels (checked by
name): `I2S_BCLK`, `I2S_LRCLK`, `I2S_DOUT`, `SD_CLK`, `SD_CMD`,
`SD_D0` — these consume six of sheet 02's one-sided labels.

## Checklist

- [ ] GAIN_SLOT tied to GND (12 dB); SD_MODE via 620 k to +3V3 (mono)
- [ ] Bead + 100 pF on each speaker line, snubber caps terminal-side
- [ ] EP to GND; NC flags on amp 5/6/12/13; **card DAT1/DAT2 pulled up 10 k (not NC — corrected 2026-09-16)**
- [ ] Pull-ups ×3 incl. DAT3; card decoupling at +3V3
- [ ] TP_CD placed
- [ ] DAC: FLT/FMT/DEMP/SCK grounded, XSMT pulled up, 4 supply pairs
- [ ] Jack: L→4, R→3, GND→2+5 — then METER at bring-up
- [ ] checknet green, then ERC

## Sourcing status

**Complete.** 33 parts, 12 new part numbers. Rollup (§2.4): **$4.47 @
qty 1, $3.28 @ qty 100** — the amp side beat its estimate (genuine ADI
cheaper than feared) and the line-out done right adds ~$1.65. Watch:
`C723982` shared stock pool.

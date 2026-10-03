# Sheet 05 — Addressable LED + status LED
> **2026-10-02:** all **five** shifter-input pulldowns are on this sheet — `R_PD1`–`R_PD4` plus `R_STRAP3` (`R53`) on `LED_STRIP_1_CLK`, moved here from sheet 08.

> **Revised 2026-09-16** (datasheet review; drawing steps in
> `../schematic-changes-2026-09-16.md`): strip bulk `C_B1`/`C_B2` are **220 µF** (Rubycon `C88757`, 6.3 mm) instead of 1000 µF, and the shifter's used inputs get 10 k pulldowns (`R_PD1`–`R_PD4`; strip 1 clock's is `R_STRAP3` on sheet 08).

**Everything needed to draw this sheet is in this file.** Fully sourced
2026-09-04; **re-specced 2026-09-05 (final): both strip outputs are
3- or 4-wire, through one octal level shifter; no mode jumpers
(2026-09-06).** Drawing guide:
`05-led.diagram.html`; checker:

```
python3 tools/checknet.py hardware/pro/sheets/05-led.net.yaml
```

**Nets on this sheet** (all global, checker-enforced):
`LED_STRIP_1_DATA` (GPIO 4), `LED_STRIP_1_CLK` (GPIO 3),
`LED_STRIP_2_DATA` (GPIO 5), `LED_STRIP_2_CLK` (GPIO 6), `STATUS_LED`
(GPIO 38), plus `+5V`/`GND`.

## Why both outputs are dual-mode (2026-09-05)

Two outputs exist for **two zones** (eyes + spine, prop + wash), not
for two protocols. Originally only strip 2 could do 4-wire because a
clock costs a GPIO and a shifter gate, and both were spent. Dropping
the onboard IR receiver (a receiver inside a hidden enclosure can't see
a remote — plug-in IR goes on a `DIGITAL_IN`) freed **GPIO 3**. GPIO 3
is a strapping pin (JTAG select) but safe: it drives only a shifter
input. **Correction 2026-09-08:** GPIO 3 has **no internal pull** — ESP32-S3 DS Table 3-1 lists it
as *Floating*. It is safe because the JTAG-select strap only applies once the `JTAG_SEL_ENABLE`
eFuse is burned; to make it deterministic anyway, **populate `R53`**, the DNP 10 k pad already on
this net (sheet 08). See `../review-2026-09-08.md` §6.

## The level shifter — one octal part

**SN74AHCT541DWR** (`C2682058`, SOIC-20W, $0.44@100, 2.9 k stock):
eight non-inverting buffers in **one ordinary 20-pin symbol**. Five
are used, **three are spare** — 5 V-level outputs you can bodge a wire
straight onto (1.27 mm pitch) if v0.1 needs one. It replaced a quad
AHCT125 + single-gate AHCT1G125 pair on 2026-09-05 (+$0.12, and no
multi-unit symbol to place five times).

**AHCT, never AHC/HC** (locked decision): the T = TTL input thresholds
(V_IH = 2.0 V), which is what makes 3.3 V data legal into a 5 V-supplied
buffer. Plain HC at 5 V needs 3.5 V to guarantee a high — it *mostly*
works, which is worse than failing: that is the random-flicker bug
this chip exists to kill. Check the ordered MPN says AHCT.

### Wiring key — every pin of U_LS

KiCad's `74xx:74AHCT541` names the pins; the yaml and diagram use those
names. Flow-through: A*n* in → Y*n* out, straight across the chip.

| Pin (name) | Wire to |
|---|---|
| 1 (G1), 19 (G2) | GND — both enables, active-low = always on |
| 2 (A0) | global label `LED_STRIP_1_DATA` |
| 3 (A1) | global label `LED_STRIP_1_CLK` |
| 4 (A2) | global label `LED_STRIP_2_DATA` |
| 5 (A3) | global label `LED_STRIP_2_CLK` |
| 6 (A4) | global label `STATUS_LED` |
| 7, 8, 9 (A5–A7) | **GND** — unused CMOS inputs must not float |
| 10 (GND) | GND |
| 18 (Y0) | `R_S1` → `J_ST1B` pin 1 (strip 1 DATA) |
| 17 (Y1) | `R_S1C` → `J_ST1B` pin 2 (strip 1 CLK) |
| 16 (Y2) | `R_S2D` → `J_ST2B` pin 1 (strip 2 DATA) |
| 15 (Y3) | `R_S2C` → `J_ST2B` pin 2 (strip 2 CLK) |
| 14 (Y4) | `R_ST` → `D_ST` pin 1 (status DIN) |
| 13, 12, 11 (Y5–Y7) | **no-connect X flags** — the spares |
| 20 (VCC) | +5V, `C_LS` beside it |

Only the five input labels are labels; every other connection is plain
wire (the diagram's LED1_5V etc. are segment names, not labels).

## Per-output support (identical for both strips)

- **330 Ω series on each data/clock line, placed AT THE CONNECTOR** —
  it damps reflections into the cable, so it belongs at the cable end,
  not the chip end. (220–470 Ω acceptable.)
- **220 µF bulk at each strip's power block** (1000 µF until 2026-09-16 — 2 mF on +5V made the 5 V buck hiccup at start) — hot-plug inrush for
  the first pixel. Radial THT D10 (`C439782`). A general-purpose
  electrolytic is fine here — this is charge storage, not a switcher
  output; the true low-ESR NXA (`C165516`) is the alternate.
- **No mode jumper** (dropped 2026-09-06). 3- vs 4-wire is a firmware
  setting; a 3-wire strip simply leaves the CLK screw empty, and the
  330 Ω already limits a miswire to ~15 mA. The earlier jumper dated
  from a plan to share the clock GPIO, which no longer applies.
- **Connectors: two DG128-02P blocks per strip** — `J_STxA` = 5V | GND,
  `J_STxB` = DATA | CLK. (The 04P block is stock-dead; the split also
  reads well at the bench: one block power, one block signals.) In
  layout the pair butts together as one 4-pole connector.
- Silkscreen near the terminals: **strips beyond ~50 px get external
  5 V injection — data-only from the board.**

## Status pixel — import verified (open item #2)

**WS2812B-MINI-X2** (`C4154873`, 3.5 mm, $0.13@1, 20 k stock) —
the 2020 variant is dead (stock 3), the MINI is healthy. Import
verified against the Worldsemi datasheet 2026-09-04:

- **Symbol pins 1=DIN 2=VDD 3=DOUT 4=GND match the DS table exactly**
  (symbol arrives named `WS2812B-MINI-X1`, the vendor's base name; the
  X2 is the same part on tape). Pin types set in the library.
- **Land pattern measured against the DS recommendation**: the import
  is the same pattern enlarged ~0.1–0.3 mm per pad with the DS's
  0.5 mm gaps preserved — fine, and easier to hand-solder.
- **V_IH = 0.65 × VDD = 3.25 V at 5 V** — the datasheet's own number
  for why this pixel hangs off a buffer and not a bare 3.3 V GPIO.
- **DOUT (pin 3) gets a no-connect X flag.**

With the TSOP gone, this pixel is the **only** remaining Economic-PCBA
risk part: verify it in the JLC order UI before the first PCBA run.

## Parts

| Ref | Part | LCSC | Note |
|---|---|---|---|
| U_LS | **SN74AHCT541DWR** SOIC-20W | **`C2682058`** — $0.66/1, $0.44/100 | octal shifter, genuine TI. |
| C_LS | 100 nF | `C14663` Basic | at pin 20. |
| R_S1, R_S1C, R_S2D, R_S2C, R_ST | 330 Ω ×5 | `C23138` Basic | series Rs at the connectors. |
| C_B1, C_B2 | **220 µF/16 V** radial ×2 | **`C88757`** Rubycon 16YXJ220M6.3X11 — $0.064 @100, 61 k stock | THT D6.3×L11, 2.5 mm pitch, 220 mΩ @100 kHz, 7000 h @105 °C. Was 1000 µF `C439782` until 2026-09-16. |
| J_ST1A, J_ST1B, J_ST2A, J_ST2B | DG128-5.0-02P ×4 | `C711349` | 5V \| GND and DATA \| CLK per strip. |
| D_ST | **WS2812B-MINI-X2** | **`C4154873`** — $0.13/1, $0.10/100 | onboard status pixel. |
| C_ST | 100 nF | `C14663` Basic | at D_ST VDD. |

## KiCad symbols to place

| Ref(s) | Symbol (`A` key) |
|---|---|
| U_LS | `74xx:74AHCT541` — one 20-pin symbol |
| R_S1/S1C/S2D/S2C/ST | `Device:R` |
| C_LS, C_ST | `Device:C` |
| C_B1, C_B2 | `Device:C_Polarized` |
| J_ST1A/1B/2A/2B | `Connector:Screw_Terminal_01x02` |
| D_ST | `propmesh:WS2812B-MINI-X1` |

Rails: `+5V`/`GND` power symbols. The five signal labels are global.
No-connect flags (Q key): U_LS pins 11, 12, 13 and D_ST pin 3.

## Footprints (checker-enforced via the yaml)

| Part | Footprint |
|---|---|
| U_LS | `Package_SO:SOIC-20W_7.5x12.8mm_P1.27mm` |
| R / C 0603 | stock `R_0603` / `C_0603` |
| C_B1/2 | `Capacitor_THT:CP_Radial_D10.0mm_P5.00mm` |
| J_ST1A/1B/2A/2B | `propmesh:CONN-TH_DG128-5.0-02P-14-00A-H` |
| D_ST | `propmesh:LED-SMD_4P-L3.5-W3.5-TL_WS2812B-1` |

## Checklist

- [ ] MCU sheet: `IR_RX` label on IO3 renamed to `LED_STRIP_1_CLK`
- [ ] Ordered MPN says AHCT541 (the T is the level shift)
- [ ] G1, G2, A5–A7 all to GND; Y5–Y7 and D_ST DOUT carry no-connect flags
- [ ] Series Rs at connectors, bulk caps at the power blocks
- [ ] Injection note on silkscreen (layout-time)
- [ ] checknet green, then ERC

## Sourcing status

**Complete.** 15 parts, rollup (§2.4): **$2.04 @1, $1.44 @100**.

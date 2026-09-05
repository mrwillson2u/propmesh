# Sheet 05 — Addressable LED + status LED

**Everything needed to draw this sheet is in this file.** Fully sourced
2026-09-04. Drawing guide: `05-led.diagram.html`; checker:

```
python3 tools/checknet.py hardware/pro/sheets/05-led.net.yaml
```

**Nets on this sheet** (all global, checker-enforced):
`LED_STRIP_1_DATA` (GPIO 4), `LED_STRIP_2_DATA` (GPIO 5),
`LED_STRIP_2_CLK` (GPIO 6), `STATUS_LED` (GPIO 38), plus `+5V`/`GND`.

## Level shifter — the part where the suffix is the whole point

**AHCT, never AHC/HC** (locked decision): the T = TTL input thresholds
(V_IH = 2.0 V), which is what makes 3.3 V data legal into a 5 V-supplied
buffer. Plain HC at 5 V needs 3.5 V to guarantee a high — it *mostly*
works, which is worse than failing: that is the random-flicker bug this
chip exists to kill.

**Package changed from the spec's PW (TSSOP): sourcing 2026-09-04 found
TSSOP dead at JLC** (PW stock 0, PWR stock 50). **SN74AHCT125DR** —
same genuine-TI die in SOIC-14 — is $0.40@1 / $0.24@100 with 7.8 k
stock, and SOIC's 1.27 mm pitch is friendlier to hand-solder anyway.
The checklist item "verify the MPN ordered says AHCT" survives the
package change unchanged.

Gate assignment (all 4 used, multi-unit symbol A–D + power unit E):

| Gate | in → out pins | Signal |
|---|---|---|
| A | 2 → 3 | LED_STRIP_1_DATA → strip 1 |
| B | 5 → 6 | LED_STRIP_2_DATA → strip 2 / APA102 DATA |
| C | 9 → 8 | LED_STRIP_2_CLK → APA102 CLK |
| D | 12 → 11 | STATUS_LED → onboard pixel |

All four **OE pins (1, 4, 10, 13) to GND**; 100 nF at pin 14 (5 V).

## Per-output support

- **330 Ω series on each data/clock line, placed AT THE CONNECTOR** —
  it damps reflections into the cable, so it belongs at the cable end,
  not the chip end. (220–470 Ω acceptable.)
- **1000 µF bulk at each strip connector** — hot-plug inrush for the
  first pixel. Radial THT D10 (`C439782`). A general-purpose
  electrolytic is fine here — this is charge storage, not a switcher
  output; the true low-ESR NXA (`C165516`) is the alternate if stock
  matters later.
- **Strip 2's CLK wire passes through bridged solder jumper `JP_M`**:
  bridged = APA102-capable (4-wire); cut = 3-wire WS2812, keeping the
  dead clock line off the cable (per the pinmap note on GPIO 6).
- Silkscreen near the terminals: **strips beyond ~50 px get external
  5 V injection — data-only from the board.**

## Strip connectors — the 04P casualty

**DG128-5.0-04P went stock-dead**, so strip 2 uses the README fallback:
**two DG128-02P blocks side by side** — one = 5V/GND, the other =
DATA/CLK. Same footprint as sheet 03/06's terminals, and the power/
signal split reads well at the bench. Strip 1 keeps the 3-pos
(`C691861`, 5.2 k stock).

## Status pixel — import verified (and open item #2 news)

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
  for why this pixel hangs off gate D and not a bare 3.3 V GPIO.
- **DOUT (pin 3) gets a no-connect X flag.**

## Parts

| Ref | Part | LCSC | Note |
|---|---|---|---|
| U_LS | **SN74AHCT125DR** SOIC-14 | **`C155176`** — $0.40/1, $0.24/100 | genuine TI. AHCT is load-bearing. |
| C_LS | 100 nF | `C14663` Basic | at pin 14. |
| R_S1, R_S2D, R_S2C, R_ST | 330 Ω ×4 | `C23138` Basic | series Rs at the connectors. |
| C_B1, C_B2 | 1000 µF/16 V radial ×2 | **`C439782`** — $0.075, 22 k stock | THT D10×L13, 5 mm pitch. |
| J_ST1 | DG128-5.0-03P | `C691861` | strip 1: 5V \| GND \| DATA. |
| J_ST2A, J_ST2B | DG128-5.0-02P ×2 | `C711349` | strip 2: 5V \| GND + DATA \| CLK. |
| JP_M | solder jumper, bridged | copper only | strip-2 mode. |
| D_ST | **WS2812B-MINI-X2** | **`C4154873`** — $0.13/1, $0.10/100 | onboard status pixel. |
| C_ST | 100 nF | `C14663` Basic | at D_ST VDD. |

## KiCad symbols to place

| Ref(s) | Symbol (`A` key) |
|---|---|
| U_LS | `74xx:74AHCT125` — **multi-unit**: place A, B, C, D and the power unit E |
| R_S1/S2D/S2C/ST | `Device:R` |
| C_LS, C_ST | `Device:C` |
| C_B1, C_B2 | `Device:C_Polarized` |
| J_ST1 | `Connector:Screw_Terminal_01x03` |
| J_ST2A, J_ST2B | `Connector:Screw_Terminal_01x02` |
| JP_M | `Jumper:SolderJumper_2_Bridged` (pins are **A/B**) |
| D_ST | `propmesh:WS2812B-MINI-X1` |

Rails: `+5V`/`GND` power symbols. The four signal labels are global.

## Footprints (checker-enforced via the yaml)

| Part | Footprint |
|---|---|
| U_LS | `Package_SO:SOIC-14_3.9x8.7mm_P1.27mm` |
| R / C 0603 | stock `R_0603` / `C_0603` |
| C_B1/2 | `Capacitor_THT:CP_Radial_D10.0mm_P5.00mm` |
| J_ST1 | `propmesh:CONN-TH_DG128-5.0-03P-14-00A-H` |
| J_ST2A/B | `propmesh:CONN-TH_DG128-5.0-02P-14-00A-H` |
| JP_M | `Jumper:SolderJumper-2_P1.3mm_Bridged_RoundedPad1.0x1.5mm` |
| D_ST | `propmesh:LED-SMD_4P-L3.5-W3.5-TL_WS2812B-1` |

## Checklist

- [ ] Ordered MPN says AHCT (the DR suffix change doesn't touch this)
- [ ] Series Rs at connectors, bulk caps at connectors
- [ ] Mode jumper in the CLK line; OEs grounded; all four gates used
- [ ] D_ST DOUT has a no-connect X
- [ ] Injection note on silkscreen (layout-time)
- [ ] checknet green, then ERC

## Sourcing status

**Complete.** 14 parts, rollup (§2.4): **$1.52 @1, $1.09 @100** —
under the old $1.25 estimate at quantity despite the 04P → 2×02P swap.

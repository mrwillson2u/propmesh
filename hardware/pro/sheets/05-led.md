# Sheet 05 — Addressable LED + status LED

**Everything needed to draw this sheet is in this file.**

**Nets on this sheet**: `LED_STRIP_1_DATA` (GPIO 4),
`LED_STRIP_2_DATA` (GPIO 5), `LED_STRIP_2_CLK` (GPIO 6), `STATUS_LED`
(GPIO 38).

## Level shifter — the part where the suffix is the whole point

| Part | Criteria |
|---|---|
| SN74**AHCT**125PW | **AHCT, never AHC/HC.** The T means TTL input thresholds (V_IH = 2.0 V), which is what makes 3.3 V data legal into a 5 V-supplied buffer. Plain HC at 5 V needs 3.5 V to guarantee a high — it *mostly* works, which is worse than failing, and is exactly the random-flicker bug this chip exists to kill (locked decision). PW = TSSOP-14; any package works. |

Gate assignment (all 4 used):

| Gate | Signal |
|---|---|
| 1 | LED_STRIP_1_DATA → strip 1 |
| 2 | LED_STRIP_2_DATA → strip 2 / APA102 DATA |
| 3 | LED_STRIP_2_CLK → APA102 CLK |
| 4 | STATUS_LED → onboard WS2812B-mini |

Tie all four **OE pins to GND**; 100 nF decoupling at 5 V.

## Per-output support

- **Series 330 Ω** (220–470 acceptable) on each data/clock line,
  **placed at the connector**, not at the chip — it damps reflections
  into the cable.
- **1000 µF low-ESR electrolytic, ≥6.3 V, at each strip connector** —
  hot-plug inrush protection for the first pixel.
- Strip 1: screw terminal 3-pos (5V/GND/DATA). Strip 2: screw terminal
  4-pos (5V/GND/DATA/CLK). 5.08 mm.
- **Solder jumper** selects strip-2 mode: 3-wire WS2812 (CLK unused) vs
  4-wire APA102 — per pinmap note on GPIO 6.
- Silkscreen near the terminals: strips beyond ~50 px get external 5 V
  injection, data-only from the board.

## Status LED

WS2812B-mini at 5 V, data from gate 4, **100 nF at its VDD**. Still on
the Economic-PCBA watch list (open item #2) — if flagged Standard-Only,
the fallback is a THT 5 mm WS2812 or three plain LEDs.

## Checklist

- [ ] Part is AHCT (check the actual MPN ordered, not just the symbol)
- [ ] Series Rs at connectors, bulk caps at connectors
- [ ] Mode jumper present on strip 2
- [ ] All four gates used, OEs grounded

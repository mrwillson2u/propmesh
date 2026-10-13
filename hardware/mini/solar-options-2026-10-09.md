# Solar charging for low-current nodes — options (2026-10-09)

Answer to "are there cheap, small solar charger modules suitable for
low-current battery nodes?" Self-contained; prices are US list on
2026-10-09 (sources at the end).

## Short answer

- **Mini v0.1 needs no module.** The spec already puts a TP4056
  charger, a solar terminal and a series Schottky on the board
  (hardware-spec §3.3 BOM, §3.4 "Solar"). A **6 V panel** wires straight
  to the solar terminal. The v0.2 proposal replaces the TP4056 with a
  BQ25185 power-path charger (recommendations-2026-09-16 §2) — same
  panel, better behavior under weak sun.
- **Devkit nodes (generic boards)** need a module that also makes
  **5 V** for the devkit's 5V pin: **DFRobot Solar Power Manager 5V
  (DFR0559), $10.29**, is the right size and price.
- **If MPPT on a Mini is wanted** (a few % more harvest, mostly in
  weak light): a **CN3791 board, 6 V variant, ~$5–13**, between panel
  and the Mini's battery connector; leave the Mini's solar terminal
  empty.

## How much panel (the part that actually matters)

Halloween sun at US mid-latitudes is **~2.5–3 peak-sun-hours/day**,
panels in yards are often shaded, and a TP4056 drags a panel off its
maximum-power point (~70 % of rating). Rule of thumb: **1 W of 6 V
panel ≈ 1.5–2 Wh/day in October**, not the 5 Wh/day the §3.4 note
assumes (that is a summer, ideal-tilt figure).

| Node behavior (from §3.4) | Energy per night | Panel for October |
|---|---|---|
| Trigger mode: deep sleep, ~20 scares × 30 s at 1.84 W | ~0.3 Wh | **6 V / 1 W** sustains it |
| Always-on candle, 8 px + audio, 0.80 W × 5 h | 4 Wh | **6 V / 3 W** with MPPT, **5 W** with TP4056 |
| Always-on 20 px flicker + audio, 1.84 W × 5 h | 9 Wh | 6 V / 10 W — at that point mains or a bigger pack is cheaper |

Two facts users will hit: **Li-ion must not be charged below 0 °C**
(TP4056 modules ground the TEMP pin; the BQ25185 proposal has a
thermistor input — keep it), and a 3000 mAh 18650 holds 10.8 Wh, so a
trigger-mode node runs weeks from one charge even with no sun.

## Modules compared

| Module | Price | Size | Panel in | Output | Charge | Notes |
|---|---|---|---|---|---|---|
| **Mini on-board (TP4056 + Schottky)** | $0.25 in BOM | — | 4.5–6 V (6 V panel) | board rails | up to 1 A (R_prog) | No MPPT; panel pulled to ~4.3 V. Fine for trigger-mode nodes. |
| **TP4056 module** (with DW01 protection) | $0.50–1 | 26 × 17 mm | 4.5–6 V + external Schottky | cell voltage only | 1 A (change R_prog to ~2 k for 500 mA with small panels) | Same circuit as the Mini's. Devkits need a 5 V boost or 3.3 V LDO as well. |
| **CN3791 MPPT board** | ~$5 (import) / £13 Pi Hut | ~28 × 22 mm | fixed-MPP variants 6 / 9 / 12 / 18 V | cell voltage only | 2 A max | Buy the **6 V** variant for 6 V panels. No cell protection on most boards — use a protected cell. |
| **DFRobot Solar Power Manager 5V, DFR0559** (CN3065) | $10.29 | 33 × 63 mm | 4.5–6 V, plus USB | **5 V / 1 A** USB + pins | 900 mA | Quiescent < 1 mA. The devkit-node pick: panel → module → devkit 5V pin, cell on the module. |
| **Waveshare Solar Power Manager (D)** | $13.91 | ~ 3×18650 holder size | **6–24 V** | **5 V / 3 A** USB-C + terminal | MPPT | For a 12 V panel or a node driving strips; too big for a Mini. |
| **Adafruit bq24074 #4755** | $14.95 | ~34 × 35 mm | 4.5–10 V (6 V panel), USB | load-shared cell voltage | 1.5 A | Best power path, no 5 V out; pair with a boost. Input-voltage regulation acts like MPPT for 6 V panels. |

## Recommendation per node type

| Node | Buy | Cost |
|---|---|---|
| Mini, trigger mode (PIR wake) | 6 V / 1 W panel | ~$5 |
| Mini, always-on candle | 6 V / 3 W panel (+ CN3791 6 V board if you want the MPPT margin) | ~$10 (+$5) |
| Devkit node, trigger mode | DFR0559 + 6 V / 2 W panel + 18650 | ~$20 |
| Devkit node driving a strip | Waveshare (D) + 12 V / 10 W panel + 3 × 18650 | ~$45 |

Panels: 6 V "epoxy" panels are 110 × 60 mm (1 W) to 170 × 110 mm
(3 W); mount tilted ~45° toward the south, above the prop, not under
foliage. Add this to the Mini user guide when that exists.

## Sources

- CN3791 boards: [Pi Hut £13.20](https://thepihut.com/products/mppt-li-ion-cn3791-charger-board), [TKP €4.90](https://magento-demo.elasticsuite.io/electronic_en/chargeur-solaire-mppt-module-cn3791-6v-panneau-vers-lipo-tkp-alm-ch-005.html)
- DFR0559: [RobotShop $10.29](https://robotshop.com/products/dfrobot-sunflower-solar-power-manager-5v), [DigiKey specs](https://www.digikey.com.au/en/products/detail/dfrobot/DFR0559/9356334)
- Waveshare (D): [RobotShop $13.91](https://www.robotshop.com/products/waveshare-solar-power-management-module-d-6-24v-panels-type-c-5v-3a), [CNX Software](https://www.cnx-software.com/2024/02/06/solar-power-manager-module-support-6v-24v-input-range-battery-charging-mptt-function-and-outputs-5v-3a/)
- Adafruit 4755: [Adafruit $14.95](https://www.adafruit.com/categories/575), [Jameco](https://www.jameco.com/z/4755-Adafruit-Industries-Adafruit-Universal-USB-DC-Solar-Lithium-Ion-Polymer-Charger-Bq24074_2520567.html)
- Mini figures: `docs/hardware-spec.md` §3.3–3.4; `hardware/mini/recommendations-2026-09-16.md` §1–2.

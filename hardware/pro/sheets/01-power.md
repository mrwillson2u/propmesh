# Sheet 01 — Power

**Everything needed to draw this sheet is in this file.** Values come
from the **AP64350 datasheet DS41976 Rev. 4-2, Table 1** (recommended
components, f_sw = 500 kHz) and the TLV62569 datasheet — not estimates.

Spec context: input **12–24 V DC, 24 V recommended, 28 V absolute
maximum** (lowered from 30 V on 2026-09-03 — the TMC2209's operating
range tops out at 29 V, see spec §2.9). 5 V rail at **3 A** (LEDs,
servos, relays), 3.3 V rail for the ESP32-S3 and logic.

## Power in and out of this sheet

This sheet is the board's only power source. It produces three rails
that every other sheet consumes.

```
J1 ──► VIN_RAW ──► F1 ──► Q1 ──► D1 ──► VIN_PROT ──┬──► U1 ──► L1 ──► +5V ──┬──► U2 ──► L2 ──► +3V3
 (12-30 V in)      fuse   P-FET   TVS               │      AP64350           │      TLV62569
                                                    └──► sheets 06 (motors)  └──► sheets 03/04/05
```

**Rails cross sheets by NAME, not by wires.** KiCad power symbols are
global: place `power:+5V` here at L1's output and again on sheet 03 at
the servo headers, and they are the same net. No sheet pins, no
hierarchical labels, nothing to connect. **This only works if the names
match exactly.**

| Rail | How to place it | Consumed by |
|---|---|---|
| `GND` | `power:GND` (`P` key) | every sheet |
| `+5V` | `power:+5V` | 03 servos/relays/LEDs, 04 audio, 05 strips |
| `+3V3` | `power:+3V3` | 02 MCU, 03, 04, 05, 07 |
| **`VIN_PROT`** | **global label** (no stock symbol) | 06 motors |

`VIN_PROT` has no stock power symbol, so use a **global label** with
that exact text. Stepper-driver datasheets call the same pin **VMOT** —
do not label it that, or it becomes a second, disconnected net.

**The input end — two connectors, one supply at a time.** J1 pin 1 →
`VIN_RAW`, pin 2 → `GND`. The protection chain sits between `VIN_RAW`
and `VIN_PROT`; everything downstream taps `VIN_PROT`, never `VIN_RAW`.

**J2 is a barrel-jack alternate input** (added 2026-09-03), in parallel
with J1 ahead of the fuse, for the large population of users whose 24 V
supply ends in a plug. Both connectors are populated; the rule is
**connect only one supply** — there is no isolation between them, so two
supplies at once backfeed each other. Silkscreen: `ONE SUPPLY ONLY` at
the input corner, and `+ TIP` at J2.

| Ref | Part | Package | Note |
|---|---|---|---|
| J2 | **DC-044A-20A — LCSC `C129006`**, $0.25/1, 16 k stock | right-angle THT barrel, Ø5.5 bore / **Ø2.0 pin** (fits 5.5×2.1 plugs) | **30 V / 5 A — the rating that matters: common jacks stop at 24 V.** The Ø2.5-pin **DC-044A-25A/N250** is a drop-in on the same pads for 5.5×2.5 supplies; decide which to stock at order time, not now. A 2.5 plug on a 2.0 pin fits loosely and arcs — the sizes are not cross-compatible. Wire pin 1 → `VIN_RAW`, pins **2 and 3 both** → `GND` (sleeve and its switch contact — tying both makes the sleeve/switch assignment irrelevant). Pads 4/5 are housing lugs, unconnected. |

**Barrel builds take a 5 A fuse, not 7.5 A** — the jack is the 5 A
element in the path and the blade fuse is the user-swappable part.
At 24 V that is 120 W, above the 89 W worst case; at 12 V the barrel
path is a reduced-power option (60 W) and heavy motor loads belong on
the screw terminal.

**PWR_FLAG — place on `GND`, `VIN_PROT`, `+5V`, `+3V3`.** ERC flags any
net that feeds a power-input pin without a power *output* driving it,
and a buck's output arrives through an inductor (a passive), so ERC
cannot tell it is powered. `PWR_FLAG` is you asserting "power really
enters here". Expect this to be your first ERC error and it is not a
real fault.

## Connections — see `01-power.net.yaml`

**Open `01-power.diagram.html` in a browser — that is the drawing
guide.** Three left-to-right wiring diagrams (protection, rail 1,
rail 2): boxes are parts with their value, rounded nodes are nets, the
label on each line is the pin, and every part's ground pin is written
inside its box. `01-power.diagram.png` is the same thing as an image.
Both are generated from `01-power.net.yaml` — edit the yaml, re-run
`tools/checknet.py … --mermaid`, never the diagram.

After capture the same yaml is the checker — it prints a fix list and
writes `01-power.check.html`, the diagram coloured by result (open in a
browser; all green = done):

```
python3 tools/checknet.py hardware/pro/sheets/01-power.net.yaml
```

diffs it against KiCad's own netlist export and reports any net whose
membership differs. Parts are matched by **Value**, so set each symbol's
Value to the string in the yaml (`10uF/100V`, `453k`, `AOD4185`…).

**Designator cross-reference** — where this sheet's names differ from
the datasheet figures:

| Datasheet | Here | | Datasheet | Here |
|---|---|---|---|---|
| AP64350 C1 | C1a, C1b (+ C_bulk) | | TLV62569 C1 | C_in |
| AP64350 C2 | C2a, C2b | | TLV62569 C2 | C_out |
| AP64350 L | L1 | | TLV62569 L1 | L2 |
| | | | TLV62569 R1 / R2 | R_FB1 / R_FB2 |
| | | | TLV62569 C3 | C_FF |

Rail 1's other designators (C3–C6, R1, R2, R5, RT) match Diodes'
Figure 1 exactly.

## Rail 1 — AP64350, Vin → 5 V @ 3 A

Symbol: `propmesh:AP64350SP-13` · Footprint: `propmesh:SO-8_...-EP`
Pinout verified against the datasheet: BST 1, VIN 2, EN 3, RT/CLK 4,
FB 5, COMP 6, GND 7, SW 8, exposed pad 9.

**Footprints for every part on this sheet are in `01-power.net.yaml`
(`footprint:` per part)** — assign them with Tools → Assign Footprints
and `checknet.py` verifies them. Package columns below say *what* the
package is; the yaml says the exact KiCad footprint name.

Four are vendor land patterns imported from LCSC on 2026-09-03 (the
rest are stock KiCad). What they contain, for the pre-layout
datasheet cross-check:

> **Do not trust an easyeda2kicad land pattern without checking it.**
> Both inductor footprints came back undersized — L1 by 27 % in pad
> area *and* 1.46 mm wrong on the gap, which would have left the part
> sitting on the inner edge of its pads. Ten minutes with the datasheet
> caught it; a reflow oven would not have.
>
> **The SXN SMMS land-pattern table (datasheet p.2) is internally
> inconsistent.** SMMS1040 and SMMS1050 have identical bodies
> (11.50 × 10.00) but the table lists F=4.10/H=5.40 for the 1040 and
> F=5.40/H=4.10 for the 1050 — F and H are transposed in one row.
> **H=4.10 is the correct pad width**: across the whole series H runs
> ~1.2–1.4× the terminal width D (3.00 here), and 5.40 would be 1.8×.
> Land pattern = gap **F**, overall span **G**, pad width **H**;
> pad length is therefore (G − F)/2.

| Footprint | Pads | Status |
|---|---|---|
| `propmesh:IND-SMD_L11.5-W10.0` (L1, SMMS1050) | 2× SMD **4.10×4.10 mm at ±4.75** | ✅ **corrected 2026-09-03** — the LCSC import was 3.50×3.50 at ±5.18: pads 27 % undersized and pushed 0.43 mm too far apart (gap 6.86 vs 5.40). Now matches the datasheet exactly |
| `propmesh:IND-SMD_L7.1-W6.6` (L2, SMMS0650) | 2× SMD 2.15×3.32 mm at ±2.91 | ⚠ **13 % undersized** — datasheet wants **2.35×3.50 at ±3.025**. Gap is right (3.67 vs 3.70); the shortfall is all on the outer toe |
| `propmesh:01530008Z` (F1, Littelfuse MINI holder) | 2× THT Ø1.397 drill / 2.03 pad, staggered at (±1.73, ±3.81); Ø3.81 peg hole at centre | ✅ **verified** against the Littelfuse drawing — positions exact. One construction fix: the centre hole is a *plated* pad with zero annular ring; change its type to **NPTH, Mechanical**. See below |
| `propmesh:CONN-TH_DG128-5.0-02P-14-00A-H` (J1) | 2× THT Ø1.50 drill / 2.30 pad at ±2.50 | ✅ **verified** against the DEGSON customer drawing: 5.00 mm pitch exact, drawing asks Ø1.40 and we have Ø1.50 (looser, fine for a 0.80 mm pin). Only the ring is thin — **enlarge pad to ≥2.8 mm in layout** (§2.6) |
| `propmesh:DC-IN-TH_DC-044A-20A` (J2) | 3× slotted THT 1.0×2.2 drill / 1.6×3.0 pad; 2× housing-lug slots; Ø2.10 NPTH post hole | ✅ **verified 2026-09-03** against the HRO drawing: terminal spacings 5.30/3.20 and lug span exact; slots cut 1.0 mm wide vs the drawing's 0.6/0.8 (looser, fine for blade pins). Import arrived with the post hole as a plated pad — already fixed to NPTH in the library. **The Ø2.10 post hole is correct even though the drawing says "1.5":** the snap post is a 1.5×1.5 *square*, and a square peg needs a round hole ≥ its diagonal, 1.5×√2 = 2.12 — Ø2.10 is a light press fit on the corners, deliberate. Never drill a square post's flat width |

**F1, verified against the Littelfuse drawing** (datasheet p.2, the
`01530008_` panel). The label-to-feature mapping is easy to get
backwards, so it was checked by measuring the drawing's own geometry,
anchored on its 0.300" dimension:

| | Littelfuse drawing | Imported footprint | |
|---|---|---|---|
| Clip hole **X offset** from centre | **±0.068" = ±1.727 mm** | ±1.73 mm | ✅ exact |
| Clip hole **Y offset** from centre | **±0.150" = ±3.81 mm** | ±3.81 mm | ✅ exact |
| Clip hole **diameter** | Ø0.050" = 1.27 mm | Ø1.397 mm | +0.13 mm looser — fine for a soldered clip leg |
| Board-lock peg hole | Ø0.149" = 3.785 mm | Ø3.81 mm | ✅ +0.025 mm |

> **Read the two callouts carefully: `.068" TYP.` dimensions the X
> offset (it appears twice, once per hole) and `.050" TYP.` is the hole
> diameter** — not the other way round, which is the natural misreading
> and would move both holes 0.92 mm and shrink the drill by 0.33 mm.
> Settled by measuring the drawing, not by reading the leaders.

**The one real fix on F1** is construction, not geometry: the centre
board-lock hole is declared as a *plated* through-hole whose pad size
equals its drill, so it has zero annular ring — it renders as nothing
and DRC will object. Change that pad's type to **NPTH, Mechanical**
(`np_thru_hole`), matching KiCad's own `MountingHole_*` footprints.
Still worth measuring a real holder at bring-up: this part has no
second source.

| Ref | Value | Package | Note |
|---|---|---|---|
| L1 | **6.8 µH** | **Shun Xiang Nuo SMMS1050-6R8M — LCSC `C149542`** · 11.5×10 mm molded, **25 mΩ, 13 A Isat**, 8 A rms, $0.26, 1.6 k stock | chosen over the larger SMMS1350 (13.8×12.6, 18 mΩ): **59 mm² smaller, $0.20 cheaper**, and its 11.5×10 mm package is shared with the SMMS1040 series and the widely-cloned "1040" size class — far better substitution options. The 7 mΩ of extra DCR costs 0.06 W, negligible |
| C1 in | **2× 10 µF / 100 V X7R** — **PSA FS32X106K101EGG, LCSC `C5156756`** | 1210 | resolved. **Three ratings hide behind "10 µF":** (a) **voltage ≥63 V, not 50 V** — the SMAJ33A clamps at ~53 V and motors share this rail, so kickback is routine; 100 V chosen for derating headroom, not for the rating itself. (b) **DC-bias derating** — a 10 µF X7R at 24 V bias gives ~half its nameplate on a 63 V part and appreciably more on a 100 V one, which is why **two** are specified. (c) **RMS ripple ≥ half the load** (≥1.5 A): the ceramics carry ~95 % of it, which is why the input cannot lean on the electrolytic alone. |
| C_bulk | **100 µF / 63 V, 105 °C** electrolytic — **KNSCHA 189RV0028, LCSC `C7471890`** | SMD can, 8 × 10.5 mm | resolved. 63 V per the TVS-clamp logic above; **105 °C / 2000 h** → ~15 years at 45 °C ambient (life doubles per 10 °C below rating). Its **135 mA ripple rating looks low but is correct** — see below. $0.09, 19 k in stock |
| C2 out | **2× 22 µF / 16 V X7R** — **Chinocera HGC1206R7226K160NSPJ, LCSC `C7472972`** | 1206 | resolved. Datasheet Table 1 specifies 2×22 µF. 16 V on a 5 V rail = 31 % bias, so expect ~55–70 % retention → **24–31 µF effective**, inside the datasheet's "22–68 µF is sufficient". Unlike C1 this rail sees no TVS clamp, so 16 V needs no uplift. $0.18, 105 k in stock. Same 1210/1206 **flex-crack layout note** as C1 applies |
| C3 | **100 nF / 50 V X7R** | 0603 | BST→SW bootstrap. **The cap only ever sees ~5 V differentially** (BST and SW swing together), so 16 V would be electrically fine — 50 V is specified so **one 100 nF 0603 part number serves the whole board**, including VIN- and VMOT-side decoupling that genuinely needs it. Every part number eliminated is $3/run at prototype quantity (spec §4.3). **Yageo CC0603KRX7R9BB104, LCSC `C14663` — JLC Basic**, 67 M in stock. (The Samsung CL10B104KB8NNNC 50 V sibling, `C1591`, is the same spec but Extended; Basic wins per the picking order.) |
| R1 | **115 kΩ 1%** | 0603 | FB divider top — **Uni-Royal 0603WAF1153T5E, LCSC `C22783`** — **Extended** |
| R2 | **22.1 kΩ 1%** | 0603 | FB divider bottom → Vout = 4.96 V nominal. Uni-Royal `0603WAF2212T5E`, LCSC `C25961` — **Extended** |
| C4 | **OPEN** | 0603 | leave the pad, unpopulated — feedforward if transient response needs it |
| RT | **200 kΩ 1%** | 0603 | RT[kΩ] = 100000 / f_sw[kHz] → 500 kHz. Uni-Royal `0603WAF2003T5E`, LCSC `C25811` — **Basic** |
| R5 | **14 kΩ 1%** | 0603 | COMP network. Uni-Royal `0603WAF1402T5E`, LCSC `C22803` — **Extended** |
| C5 | **3.3 nF / 50 V X7R** | 0603 | COMP network — **Samsung CL10B332KB8NNNC, LCSC `C1613`**. X7R is fine here: see note below |
| C6 | **47 pF / 50 V C0G** | 0603 | optional HF pole — **Samsung CL10C470JB8NNNC, LCSC `C1671`**. **C0G, not X7R** — at 47 pF the dielectric's stability is the whole spec. Place the pad even if unpopulated |

**Why X7R is acceptable for C5 but C6 must be C0G.** C5 sets the
compensation zero at 1/(2π·R5·C5) ≈ **3.4 kHz**. X7R's spread (±10 %
initial, plus temperature and aging) moves that to roughly 2.8–4.3 kHz,
which a peak-current-mode Type II compensator absorbs easily — and for
scale, **the output caps derate ~50 % under DC bias**, so the loop
already tolerates far larger variation there. C6 is different: at 47 pF
it sets a high-frequency pole, small-value caps have no bias derating to
hide behind, and **C0G/NP0 is both stable (±30 ppm/°C) and freely
available at that value** — there is no reason to use anything else.

**Reuse a part number before sourcing a new one.** C_out reuses C2's
1206 22 µF rather than taking an 0805; both rails' 100 nF share one
50 V part; all four resistors are one Uni-Royal series. Each part number
eliminated is **$3 per prototype run** and $1.50/board at qty 100
(§4.3), and it is one less thing to verify. Sheet 01's whole BOM is
~13 distinct line items because of this.

**Resistors — one family for the whole sheet.** All four are
**Uni-Royal 0603WAF series, 1 %, 100 mW, ±100 ppm/°C** (JLC Basic
staples, ~$0.003). The MPN encodes the value: `0603WAF` + 3 significant
digits + decade + `T5E`, so 115 k = `1153`, 22.1 k = `2212`,
200 k = `2003`, 14 k = `1402`. Search the MPN to get each LCSC number.

**Why 1 % and ±100 ppm are enough here**, despite this being the divider
that sets the 5 V rail: worst-case stack-up (resistors ±1 % opposed plus
the AP64350's ±1 % reference) puts Vout at **4.83–5.10 V**, and every
load tolerates it — WS2812 3.5–5.3 V, servos 4.8–6.0 V, MAX98357A and
the TLV62569 input both 2.5–5.5 V. TCR barely matters because **a
divider's ratio drift largely cancels** when both resistors share a
family: ±0.05 V over a 60 °C outdoor swing. Dissipation is 153 µW
against a 100 mW rating. **0.1 % parts would buy nothing.**

**How the input caps connect — all in PARALLEL, rail to ground.** The
datasheet's Figure 1 shows a single C1; this design has three
capacitors on the same net, side by side:

```
VIN_PROT ──┬────────┬────────┬────────► U1 VIN
           │        │        │
        C_bulk     C1a      C1b
        100 µF    10 µF    10 µF
       electro    X7R      X7R
           │        │        │
          GND      GND      GND
```

Parallel capacitance *adds*; series would divide it and is only ever
used to stack voltage ratings. The three have different jobs, which is
why their **placement** differs even though the schematic is identical:
**C1a/C1b sit at U1's VIN pin** (fast switching current — trace
inductance defeats them if they are far away), **C_bulk sits near the
input terminal** after the protection chain (bulk charge for load steps,
and its ESR damps the cable-inductance/ceramic LC tank that otherwise
rings on hot-plug). The same rule applies to the output: C2a and C2b
are parallel at U1's output, and rail 2's C_in/C_out likewise.


**Why 500 kHz:** RT sets it anywhere from 100 kHz to 2.2 MHz. 500 kHz is
the datasheet's characterisation point, keeps switching losses low, and
keeps Frequency Spread Spectrum active (FSS only runs in resistor-timing
mode — an external clock disables it). EMI matters here; leave it.

**Inductor ripple check** across the actual input range, ΔI_L =
Vout(Vin−Vout)/(Vin·L·f_sw), against the datasheet's 30–50 % of the
3.5 A max load:

| Vin | ΔI_L with 6.8 µH | % of 3.5 A |
|---|---|---|
| 12 V | 0.86 A | 25 % |
| 24 V | 1.16 A | 33 % |
| 30 V | 1.23 A | 35 % |

In range everywhere, and comfortably so. For contrast **4.7 µH hits
51 % at 30 V in** — just past the datasheet's 50 % ceiling — with a
4.39 A peak at max load. 6.8 µH is the better value, not a substitute.

**Why "any 6.8 µH inductor" is NOT enough — the three traps:**

1. **Isat vs Irms — the selection rule, explicitly:**

   > **Isat ≥ I_peak, where I_peak = I_load + ΔI_L/2** (datasheet
   > Eq. 9). Here: 3 A + 1.23 A/2 ≈ **3.6 A** at nominal load, and
   > **4.1 A** at the AP64350's 3.5 A max — so spec **Isat ≥ 5 A**.
   > The chosen part's 14 A is generous on purpose: it cannot
   > saturate on a servo-stall or hot-plug surge either.

   An inductor's headline "rated current" is usually **Irms — a
   thermal rating — which is NOT this number.** Many "5 A" parts
   saturate at 4 A. Past saturation, inductance collapses and current
   spikes far beyond the ripple math, heating the part and the
   converter's MOSFETs. Read the *saturation curve* in the inductor
   datasheet, not the title line.
2. **DCR** (winding resistance) is where efficiency goes: at 3 A, a
   cheap 80 mΩ part burns 0.72 W in the inductor alone vs 0.27 W at
   30 mΩ. Datasheet guidance: **DCR < 30 mΩ**.
3. **Shielded vs unshielded** — unshielded parts spray the switching
   field into nearby traces. This board has WS2812 data, I²S, and an
   RF module; shielded is not optional.

   **How to tell on LCSC, where "shielded" is rarely stated outright:
   read the `Type` column.**

   | Type says | Shielded? | What it is |
   |---|---|---|
   | **Molded** / metal-alloy molded | **Yes** | winding pressed inside a metal-powder composite block — closed magnetic circuit by construction |
   | Shielded wirewound / SMD power | Yes | drum core with a ferrite sleeve over it |
   | Semi-shielded | Partial — **avoid** | drum core back-filled with resin; a distinct, cheaper category |
   | Unshielded / drum core / wirewound | No | bare bobbin |
   | Multilayer chip / ceramic / RF | No, and irrelevant | not a power part at all |

   **"Molded inductor" is the answer you want** — it implies shielded,
   so there's no separate flag to hunt for. Visual tell: a molded part
   is a solid brick with no visible winding; an unshielded drum shows
   copper wire wrapped around a bobbin.

**Package size IS the current rating — the fastest sanity check.**
Inductance and current are independent: a 6.8 µH part exists in every
size, and only the big ones carry amps. Rough ladder at 6.8 µH:

| Package | Typical Isat | Typical DCR | Verdict here |
|---|---|---|---|
| 0603 / 0805 (≤2 mm) | 0.1–0.8 A | 200–600 mΩ | signal/filter part — **never** |
| 4×4 mm | ~1.5 A | ~120 mΩ | no |
| 6×6 mm | ~3–4 A | ~60 mΩ | marginal |
| 7×6.6 mm | ~6 A | ~48 mΩ | works, lossy |
| 10.5×10 mm | ~9.6 A | ~25 mΩ | good |
| **13.8×12.6 mm** | **~14 A** | **~18 mΩ** | **the chosen part** |

Price is the same tell: the right part costs $0.20–0.50, a chip
inductor costs $0.02–0.05. **A cheap "6.8 µH" is cheap because it is
small, and small means it cannot carry the current.**

**How to actually find it on LCSC** (verified 2026-09-02 — there is no
"Power Inductors" category; everything is under Fixed Inductors):

> Products → Passives → **Inductors, Coils, Chokes → Fixed Inductors**.
>
> **Filter only on the attributes LCSC populates reliably:**
> **Inductance** = 6.8 µH · **Type** = molded · **In Stock** ·
> optionally **Package** size.
>
> **Then SORT — do not filter — on `Current - Saturation (Isat)`**
> (descending) and read `DC Resistance (DCR)` off the results table.
>
> **Why not filter on Isat/DCR:** those columns are frequently blank or
> wrong in LCSC's data, and a filter silently *drops every part with a
> blank* — including good ones. That is why filtering on all criteria
> at once returns junk or nothing. Sorting tolerates blanks, shows the
> whole range, and lets you see where the cliff is.
>
> Note LCSC lists **`Current Rating`** (thermal/RMS) and
> **`Current - Saturation (Isat)`** as *separate columns with different
> numbers*. Margin is computed against **Isat**. Reading the wrong one
> is how a 110 mA chip inductor survives a search for a 3 A buck.
>
> **Always confirm the final 2–3 candidates against the manufacturer
> datasheet.** Treat the LCSC table as a way to build a shortlist, never
> as the source of truth for a spec the design depends on.

A part that saturates at 3 A doesn't just run hot — inductance
collapses, the buck loses control of its current, and the AP64350
drops into hiccup mode or dies.

The cheapest part matching "6.8 µH, 5 A" typically fails at least two
of these.

**Resolved: Shun Xiang Nuo SMMS1350-6R8M — LCSC `C149517`.** 6.8 µH,
**18 mΩ**, **14 A Isat**, 11 A rms, 13.8×12.6 mm molded (⇒ shielded),
28k in stock, ~$0.46 @1 / ~$0.23 @1k. Loss at 3 A: **0.16 W** — the
lowest of everything evaluated. Isat margin over the 4.1 A worst-case
peak is 3.4×, so it cannot saturate on any transient this board can
produce. ⚠ one check left: **confirm body height against the enclosure
budget** (expect ~5 mm; the 20 mm stepper-heatsink clearance dominates,
so this is a formality).

**Why C_bulk's low ripple rating is fine — and why an electrolytic is
here at all.** At 500 kHz the ceramics present ~32 mΩ while an
electrolytic's ESR is 0.3–1 Ω, so the ceramics carry **90–97 %** of the
1.5 A input ripple and the can sees only ~50–140 mA. The low ripple
rating and high ESR are self-consistent: a part rated 135 mA has high
ESR, which is exactly why it carries so little. That ESR is also doing
useful work — **it damps the LC tank formed by the input cable's
inductance and the ceramic caps**, which otherwise rings on hot-plug.
An all-ceramic input is the classic way to get input-voltage ringing.
So: bulk capacitance and damping are its job, not ripple.

**C1 candidates evaluated** (pass = ≥63 V · X7R · 10 µF · 1210):

| Part | LCSC | V | Dielectric | Price | Verdict |
|---|---|---|---|---|---|
| **PSA FS32X106K101EGG** | **C5156756** | **100 V** | ~$0.40 | 241 k | **use** — best derating, deepest stock |
| muRata GRM32ER71J106KA12L | C437568 | 63 V | $0.38 @100 | 9.9 k | in spec; equally fine. Murata publishes DC-bias curves (SimSurfing) if you want to verify derating rather than estimate it |
| muRata GRM32DR71E106KA12L | C77100 | 25 V | $0.27 | — | **no** — under the 30 V rail |

Price is a wash at qty 100, so it was decided on derating headroom and
stock depth, not cost.

> **Layout note for both (1210 ceramics):** large Class-II ceramics
> crack under board flex. Keep them away from board edges, mounting
> holes, and any depaneling stress, and orient them so the long axis is
> perpendicular to the likely bending line.

**Inductor candidates evaluated** (pass = Isat ≥ 5 A *and* DCR < 30 mΩ):

| Part | LCSC | Size | Isat | DCR | Loss @3 A | Verdict |
|---|---|---|---|---|---|---|
| **SMMS1050-6R8M** | **C149542** | **11.5×10** | 13 A | 25 mΩ | 0.23 W | **use** — best size/footprint/price |
| SMMS1350-6R8M | C149517 | 13.8×12.6 | 14 A | 18 mΩ | 0.16 W | works; 59 mm² larger, $0.20 dearer, odd size |
| MWSA1004S-6R8MT | ⚠ unverified | 10.5×10 | 9.6 A | 25 mΩ | 0.23 W | good fallback |
| MWSA0603S-6R8MT | C408449 | 7×6.6 | 6 A | 48 mΩ | 0.43 W | works, lossy |
| FXL0530-6R8-M | C177249 | 5.4×5.2 | 4 A | 90 mΩ | 0.81 W | **no** — saturates at max load |
| CMP201209XD6R8KT | C139247 | 0805 | ~0.1 A | ~250 mΩ | — | **no** — chip inductor |

The pattern: at 6.8 µH, **only the ≥10 mm class clears 30 mΩ**, and
every part that fails does so on Isat *and* DCR together — they track
package size. If C149517 ever goes out of stock, re-run "6.8 µH,
Isat ≥ 5 A, DCR ≤ 30 mΩ"; survivors will all be 10–14 mm molded parts
(Sunlord MWSA1004S, TDK SPM10040/SPM7054, Chilisin, Bourns SRP1040).
Do **not** trade down on DCR to save board area — there is 13,000 mm²
here and nowhere for the heat to go inside the enclosure.

> **Correction to hardware-spec §2.4**, which lists 4.7 µH: that is the
> datasheet's **3.3 V** value. For 5 V out it specifies 5.5 µH, which
> is not a stocked value in molded power inductors — **6.8 µH is the
> buildable choice and measures better** across the 12–30 V range than
> 4.7 µH does.

## Rail 2 — TLV62569, 5 V → 3.3 V @ 2 A

**Use the `TLV62569DBV` symbol — SOT-23-5, footprint
`Package_TO_SOT_SMD:SOT-23-5`.** The DDC (SOT-23-6, the one with the
Power Good pin) is **not stocked at LCSC — checked 2026-09-02**, so PG
is off the table; see the rail-LED note below for what replaces it.
The three KiCad variants are three different packages, and the footprint
follows the symbol you pick:

| Symbol | Package | Pins |
|---|---|---|
| **TLV62569DBV** ✅ | **SOT-23-5** | EN, GND, SW, VIN, FB |
| TLV62569DDC | SOT-23-6 | EN, GND, SW, VIN, PG, FB — **not stocked** |
| TLV62569DRL | SOT-563 (1.6×1.6 mm) | FB, GND, VIN, SW, EN, NC |

| Ref | Value | Package | Note |
|---|---|---|---|
| L2 | **2.2 µH, ≥2 A Isat, molded** — **Shun Xiang Nuo SMMS0650-2R2M, LCSC `C149580`** (12.5 mΩ, 12.5 A Isat, 6.6×7.1 mm) | 6.6×7.1 mm | same family as L1, so the brand is known-stocked. Over-spec on current, which costs nothing here. **Alternative if size or stock matters:** `C135262` SMNR4020-2.2UH — 4×4 mm, 3.4 A Isat, 46 mΩ, $0.056, 140 k stock, but **⚠ confirm shielding on its datasheet** ('NR' series is often semi-shielded) |
| C in | **10 µF / 16 V X7R** — **Samsung CL21B106KOQNNNE, LCSC `C95841`** | 0805 | on the **5 V rail**, not the raw input — no TVS clamp here, so 16 V is correct (cf. C1 at 100 V). ~6–7 µF effective after bias derating ≈ 19 mΩ at 1.5 MHz |
| C out | **22 µF / 16 V X7R** — **same part as C2: Chinocera HGC1206R7226K160NSPJ, LCSC `C7472972`** | 1206 | deliberately reused rather than finding an 0805: 22 µF/16 V in 0805 is usually X5R anyway, and sharing C2's part number drops a BOM line ($3/run in feeder fees at prototype qty, §4.3). 5 V rail, so 16 V is right |
| **R_FB1** | **453 kΩ 1%** | 0603 | FB divider top — `0603WAF4533T5E`, LCSC `C25818` — **Extended** |
| **R_FB2** | **100 kΩ 1%** | 0603 | FB divider bottom — `0603WAF1003T5E`, LCSC `C25803` — **Basic**. **V_OUT = 0.6 × (1 + R_FB1/R_FB2) = 3.318 V** (+0.5 %). Datasheet §8.2.2.2 caps R_FB2 at **200 kΩ** for low quiescent draw; 100 kΩ is TI's own reference value |
| **C_FF** | **6.8 pF / 50 V C0G** — **Samsung CL10C6R8CB8NNNC, LCSC `C318672`** | 0603 | feed-forward across R_FB1. Datasheet specifies **exactly 6.8 pF for R_FB2 = 100 kΩ** (§8.2.2.2, Fig. 19) — it sets loop bandwidth for transient response, so the value is not a rounding target. C0G for the same reason as C6 |
| — | **R_PG deleted** | — | the pull-up existed only for PG; the DBV has no PG pin |

**Sizing L2 — why the bar is much lower than rail 1.** The TLV62569
switches at **1.5 MHz**, three times the AP64350, so ripple is only
**0.34 A** at 2.2 µH. And the 3V3 load is modest:

| Load | Current |
|---|---|
| ESP32-S3 peak WiFi TX | 350 mA |
| Expansion header 3V3 budget (§2.2) | 500 mA |
| microSD peak | 100 mA |
| PCA9685 + logic | 20 mA |
| **Worst case** | **~970 mA** |

I_peak = 0.97 + 0.34/2 = **1.14 A**, so even a **1.5 A Isat part is
adequate** for the documented load. Specifying **2 A** buys headroom for
the expansion budget without demanding an exotic part.

> **If you cannot find 2.2 µH above 1.5 A Isat, you are looking at too
> small a package.** At 2.2 µH: 0805/1210 and 3×3 mm parts top out near
> 1–1.5 A; **4×4 mm reaches 3–4 A**, 6–7 mm reaches 12 A. Same rule as
> rail 1 — package size *is* the current rating — but the ladder shifts
> down, because lower inductance means fewer turns on the same core.
>
> **Sourcing note:** stay in a series LCSC demonstrably stocks. Sunlord
> MWSA parts appear all over JLCPCB's library and web search results but
> are thin-to-absent on LCSC retail — **the two catalogues share the
> C-number space but not the inventory.** Shun Xiang Nuo's SMMS/SMNR
> series is well stocked at LCSC and covers this whole board's needs.

> **Correction (2026-09-02): the TLV62569 is ADJUSTABLE, not fixed.**
> An earlier draft of this sheet said "R3 preset — FB ties to Vout, no
> divider." That was wrong: the part is adjustable 0.6–5.5 V, the FB pin
> exists precisely to take a divider, and TI's own layout figures show
> R1/R2 on the board. The divider above is required.
>
> **Also explains the stock mystery:** TI's packaging table lists the
> DDC (SOT-23-6, the package with PG) **only as `TLV62569PDDCR`** — the
> "P" variant. A non-P `TLV62569DDC` is not an orderable part, which is
> why LCSC never had it. KiCad's symbol name is misleading here.

**Datasheet-sourced values for this rail** (SLVSDG1C §8.2.2.3–8.2.2.5):

- **Table 4 LC matrix:** for V_OUT ≥ 1.8 V, **L = 2.2 µH with
  C_OUT = 10 µF is the "recommended standard"**; 22 µF is also marked
  proven-by-test. Sticking with 22 µF keeps C2's part number and adds
  margin. TI explicitly anticipates **−50 % bias derating** in that
  table, so nameplate values are the right thing to read off it.
- **Input cap: 4.7 µF is sufficient**; 10 µF simply lowers input ripple
  further — our 10 µF is comfortable, not marginal.
- **X5R is explicitly acceptable** alongside X7R for both caps here.
- **Inductor Isat: 20–30 % above I_L,MAX** — our ≥2 A target against a
  1.14 A peak is well past that.

**Layout notes from §10.1** (carry these to the PCB):

- Input cap, output cap and inductor **as close to the IC as possible**;
  keep those power traces short and wide.
- **FB sense traces are signal traces — route them away from the SW
  node.** The divider's high impedance makes them noise-sensitive.
- Cap low sides go to power GND directly, to avoid GND potential shift.


**Rail LEDs replace Power Good — and are arguably better for
bring-up.** PG would have reported "3.3 V is *in regulation*"; a plain
power LED reports "3.3 V is *present at roughly the right voltage*",
which is 90 % of the bring-up value for a few cents and no dependence on
a part LCSC does not stock. A dead or badly-low rail shows as dark or
visibly dim.

Put one on **each** rail, so §2.6's staged power-up is visual — link in
a stage, see its LED come on, move to the next:

One XINGLIGHT XL-1608 0603 family for both — same footprint, same
polarity marking, same optical package, one datasheet:

| Ref | Part | V_f | Current |
|---|---|---|---|
| **D_5V** | **XL-1608UBC-04** blue, LCSC `C965807` | 3.3 V | ~2.5 mA |
| **D_3V3** | **XL-1608SYGC-06** yellow-green, LCSC `C965805` | 2.2 V | ~1.6 mA |

Both use the **same 680 Ω** (`0603WAF6800T5E`, LCSC `C23228` — **Basic**) — one resistor part
number. ⚠ those two C-numbers came from JLCPCB pages (C965807 /
C965805); **verify them on LCSC** — the red sibling `C965799` is
LCSC-confirmed, so the family is definitely stocked there.

**Why these two colours specifically — forward voltage constrains the
choice, and it is not free:**

| Colour | V_f | on +5 V | on +3V3 |
|---|---|---|---|
| red | 1.9 V | 3.1 mA | 1.4 mA |
| **yellow/amber** | 2.0 V | 3.0 mA | **1.3 mA** ✅ |
| green (standard GaP) | 2.1 V | 2.9 mA | 1.2 mA |
| green (InGaN "pure") | 3.1 V | 1.9 mA | **too dim** |
| **blue** | 3.0 V | **2.0 mA** ✅ | too dim |
| white | 3.1 V | 1.9 mA | too dim |

- **Blue cannot go on the 3.3 V rail.** The actual part measures
  **V_f = 3.3 V — identical to the rail** — so it would draw zero
  current, not merely glow dimly. Blue lands on +5 V by physics, not
  preference. (My earlier 3.0 V estimate was optimistic; always read
  V_f off the specific part.)
- **Avoid red for a healthy rail** — red reads as "fault", and the
  status WS2812 will use red for real errors.
- **Beware "green":** standard GaP green is 2.1 V and fine, but modern
  **InGaN "pure green" is ~3.1 V and will not light on 3.3 V.** If you
  want green on the 3.3 V rail, check V_f on the specific part — amber
  avoids the question entirely.

Blue-over-yellow also reads correctly at a glance during §2.6 staged
power-up: link a stage, watch its colour appear, move on. Both are
invisible in the field (opaque enclosure) and cost ~5 mW total — keep
them populated; during bring-up or a future fault chase they are the
fastest instrument you have.

*(What is genuinely lost with the DBV: firmware cannot read rail health.
Nothing on this board needed that — the ESP32 is powered by the very
rail it would have monitored, so the reading was always going to be
circular.)*

## Protection and input

| Ref | Part | Package | Note |
|---|---|---|---|
| Q1 | **AOS AOD4185** P-channel — LCSC `C400894` ($0.40/1, $0.19/1k, 71 k stock) | TO-252 (DPAK) | **verified against the AOS parametric table:** V_DS −40 V, **V_GS(max) ±20 V** (so the 10 V zener clamp runs at half rating), I_D −40 A, **R_DS(on) 15 mΩ @ V_GS = −10 V**, V_GS(th) −1.7…−3.0 V — fully enhanced well before the clamp, which is why we get 15 mΩ and not the 20 mΩ quoted at −4.5 V. 0.82 W at the 7.4 A worst case, fine in DPAK with pour. Cheaper clone: HXY `C5261064` |
| **D_Z** | **10 V zener, 300 mW** — Vishay BZT52C10-E3-08, LCSC `C5566143` | SOD-123 | **gate clamp, mandatory** — cathode at Q1 source, anode at gate; bounds V_GS at −10 V whatever the input. **Anything 9.1–13 V works** (see below), so substitute freely if stock is thin — this is not a 10.0 V-critical part |
| **R_G** | **100 kΩ 1%** | 0603 | gate→GND, pulls Q1 on. **Same value as R_FB2** — one part number (`0603WAF1003T5E`, LCSC `C25803`) |
| D1 | **SMAJ33A** TVS, unidirectional — **BORN, LCSC `C383696`** | SMA (DO-214AC) | **V_RWM 33 V, clamp 53.3 V, 400 W @10/1000 µs** — datasheet-confirmed. That 53.3 V clamp is what sets the ≥63 V rating on C1 and C_bulk, so the whole input chain is self-consistent. **Unidirectional (`A`), never `SMAJ33CA`** — bidirectional clamps nothing in reverse. Goes *after* Q1 (see order note) |
| F1 | **Littelfuse 01530008Z** MINI-blade holder, THT w/ board-lock, 32 V — LCSC `C206907` — plus a **7.5 A MINI blade fuse** | MINI/ATM blade | chosen for v0.1: **confirmed format, THT anchor, published PCB drawing** (footprint certainty is what matters this week). $3.99 → ~$12 for the prototype run, i.e. noise. **Re-source a generic before production** — MINI terminal pitch is standardised, so a drop-in likely exists. Cheaper alternative now: XFCN `C42419935` SMD, $0.33, but format unconfirmed and SMD takes insertion force on solder alone |

**Why a blade fuse and not a PPTC** (searched 2026-09-02): a 30 V-rated
3 A-hold SMD PPTC **does not exist** — voltage and hold current trade
directly against each other in PPTC chemistry, and Littelfuse's largest
33 V part is the 2920L185 at **1.85 A hold**, which would nuisance-trip
on this board. PPTCs also derate badly with ambient temperature, which
matters inside a sealed IP65 box.

> **Blade fuses are 32 V rated — that caps the input range.** Against a
> 30 V maximum input this is only 6 % margin. It is acceptable, but it
> means **the input range cannot grow past 30 V while using blade
> fuses**; a 36 V or 48 V variant would need a cartridge fuse
> (typically 250 V rated). Worth remembering before anyone proposes a
> wider input on v0.2.

**Sizing (full budget: hardware-spec §2.9).** Worst case is ~89 W with
everything running, and input current is worst at the *bottom* of the
input range:

| Vin | Board only | + steppers | Everything |
|---|---|---|---|
| 12 V | 1.4 A | 3.4 A | 7.4 A |
| 24 V | 0.7 A | 1.7 A | 3.7 A |

**7.5 A** covers the 89 W worst case at 12 V and stays under the 10 A
terminal rating. **Size the input traces for the fuse, not the nominal
load** — ~3 mm on 2 oz copper.

**Design limit worth silkscreening:** at 7 V input a fully loaded board
wants 12.7 A, past the connector. **12 V minimum for motor loads,
24 V preferred.** Higher input voltage is strictly better here — same
power, less current, less I²R everywhere.

Note what the fuse does *not* do: a 7.5 A blade takes seconds to clear
at 15 A, so it protects **wiring and connectors against a sustained
short**, not silicon against a fast fault. Q1 must survive fault current
until it clears.
| J1 | **DEGSON DG128-5.0-02P-14-00A(H) — LCSC `C711349`** · 2-pos, **20 A / 300 V, 12–30 AWG**, side entry, THT | 5.0 mm pitch | resolved. 5.0 vs 5.08 mm is interchangeable at 2 positions — use the footprint matching the ordered part. **Side entry** = wires in from the board edge nearest the cable gland; screws face up. This is the orientation for every field-wiring terminal on the board |

> **Why not the BOM's original AO3401A:** it is a ±12 V V_GS part, and
> in this topology V_GS = −V_IN, so any supply above 12 V destroys the
> gate on connection. It stays correct on the Mini, where both its uses
> are 5 V. The **gate zener below is mandatory regardless of part** —
> it is what bounds V_GS independently of input voltage.
>
> **Gate network:** 10 V zener (BZT52C10-class, SOD-123) across
> gate–source with cathode at source, plus **100 kΩ gate→GND**. This
> clamps V_GS at −10 V at any input voltage, which is also the condition
> the 15 mΩ R_DS(on) figure is specified at.


**Order matters — corrected 2026-09-02:** input terminal → **fuse →
Q1 (P-FET) → TVS** → bulk cap → AP64350 VIN.

An earlier note here said the TVS goes *before* the FET "so a reverse
supply cannot punch through the body diode." **That was wrong on both
counts,** and the correct arrangement is what makes a 40 V part
sufficient:

- **The body diode blocks in reverse.** Wire it **drain → supply,
  source → load**. On correct polarity the body diode conducts first
  (0.7 V), the source rises, V_GS goes strongly negative and the channel
  shorts the diode out. On reverse polarity the diode is reverse-biased
  and V_GS ≈ 0, so the FET is simply off. That is the whole mechanism.
- **A unidirectional TVS placed before the FET would forward-conduct on
  reverse polarity** — a crowbar that blows the fuse on every miswire.
  Placed *after* the FET, reverse polarity is silent and non-destructive:
  nothing works, nothing is damaged, no fuse to replace.

**So Q1 only ever blocks 30 V (reverse), never the 53 V TVS clamp** —
during a forward transient the FET is ON and its V_DS is ~0 while the
TVS clamps everything downstream. 40 V gives 33 % margin on the real
stress case. (C1, C_bulk and the buck's VIN *are* downstream of the TVS,
which is why they still need ≥63 V.)

## KiCad symbols to place

**Search in the Choose Symbol dialog (`A`); do not browse libraries** —
there are 22,864 symbols in 224 libraries. Type the name below.

| Ref(s) | Symbol to search |
|---|---|
| U1 | `AP64350` → **propmesh:AP64350SP-13** (imported) |
| U2 | `TLV62569DBV` → Regulator_Switching |
| L1, L2 | `Device:L` |
| C1, C2, C3, C5, C6, C_in, C_out, C_FF | `Device:C` |
| C_bulk | `Device:C_Polarized` |
| R1, R2, RT, R5, R_FB1, R_FB2, R_G, R_5V, R_3V3 | `Device:R` |
| Q1 | `Transistor_FET:SUD50P04-08` — **not `Device:Q_PMOS`** (changed 2026-09-06): KiCad 10's generic FET symbols number their pins D/G/S, which match no footprint pad, so the part would sit on the board unconnected with no ERC/DRC complaint. Any stock DPAK P-FET symbol numbered 1=G 2=D 3=S works; the Value stays AOD4185 |
| D_Z | `Device:D_Zener` |
| D1 | `Device:D_Zener` — **not** `D_TVS`, which is bidirectional and hides polarity |
| D_5V, D_3V3 | `Device:LED` |
| F1 | `Device:Fuse` |
| J1 | `Connector:Screw_Terminal_01x02` |
| J2 | `Connector:Barrel_Jack_Switch` — **not** plain `Barrel_Jack`, which has only 2 pins and would fail the checker. Pin 1 = tip → `VIN_RAW`; pins **2 AND 3 both** → `GND` (sleeve + its switch contact — vendors disagree which number is which, tying both makes it moot). Footprint pads 4/5 are housing lugs with no symbol pin; KiCad leaves them unconnected, which is correct |

**Power symbols use a different key — `P`, not `A`:** `power:GND`,
`power:+5V`, `power:+3V3`. Also place **`power:PWR_FLAG`** on
`VIN_RAW`, `+5V` and `+3V3` or ERC reports "Input Power pin not driven"
on every rail.

Generic symbols are correct here — `Device:R` *is* the resistor symbol;
the specific part is a field on it, not a different symbol. Only ICs are
searched by part number.

## KiCad symbols already imported

`hardware/lib/propmesh.kicad_sym` holds the parts KiCad does not ship:
**AP64350SP-13** (`C2071691`) for this sheet, plus TPS61023DRLR,
MP4560DN-LF-Z and ESP32-C3-MINI-1U-N4 for the Mini. Everything else on
this sheet uses stock KiCad symbols and footprints — import nothing for
a 0603 resistor.

## Staged bring-up this section is designed for

Per hardware-spec §2.6, put a removable 0 Ω link between each stage so
power comes up incrementally:

1. Input protection only — verify polarity and TVS with a bench supply
2. Link in the AP64350 — verify 5 V unloaded, then loaded
3. Link in the TLV62569 — PG LED should light
4. Only then link in the ESP32 and the rest of the board

---

## Sourcing status

**The per-section tables above are the parts list** — value, package and
LCSC number live there, once. This section tracks only what is still
*missing*, so it holds no duplicate facts.

**Footprint risk on this sheet** — the parts where a future
substitution would cost a layout change, not just a BOM edit:
**L1** (13.8×12.6 mm), **L2** (6.6×7.1 mm), **F1** (blade holder) and
**J1** (terminal body). Everything else uses a standard land pattern
with many vendors, so thin stock on e.g. D_Z is not a concern —
substitute at order time. **L1 = 11.5 × 10 mm, L2 = 7.1 × 6.6 mm** (162 mm² together — the spec's
area estimate assumed 49 mm², now corrected in §2.3).

L1's 11.5×10 package is the **"1040" class** — Shun Xiang Nuo SMMS1040
and SMMS1050 share it, and Bourns SRP1040 plus many generics use the
same size. That is as close to a standard footprint as power inductors
get, and it was the reason to move off the 13.8×12.6 mm part.

Within the SMMS series, other inductance values in the *same* package
share a land pattern — but that only helps if you need a different
inductance, which you do not. **Cross-vendor land patterns at this size
are not standardised**, so the real mitigation is to **draw both
footprints with slightly generous pads** so a substitute from another
maker can still sit down, and to qualify a second source before v0.2.

**Capture status — sheet drawn and verified 2026-09-03.** `checknet.py`
reports *ALL NETS MATCH, footprints OK* (17 nets, 73 pin connections,
32 parts) and `kicad-cli sch erc` reports **no violations**. Re-run both
after any edit; the fix list and the coloured diagram land in
`01-power.check.html`.

## ⚠ Capture task: three staged-power link headers (spec §2.6, 2026-09-07)

Spec §2.6 asks for a removable link between each power stage so the
rails come up one at a time and a bad buck cannot take the MCU with it.
They are in the yaml now, so this sheet's checker is red until drawn:

| Ref | Between | How |
|---|---|---|
| `JP_VIN` | `VIN_PROT` → the 5 V buck's input (`C1a`, `C1b`, `U1` VIN+EN — now net `VIN_BUCK`) | 2-pin header `C124375` + shunt `C100114`, same parts as the MS straps |
| `JP_5V` | the 5 V buck output (`L1`, `C2a/C2b`, the FB divider, `C4` — now net `5V_BUCK`) → the `+5V` rail | same; carries 3 A, pour to it |
| `JP_3V3` | the 3.3 V buck output (`L2`, `C_out`, `R_FB1`, `C_FF` — now `3V3_BUCK`) → the `+3V3` rail | same |

The FB dividers stay on the buck side of the link (they must sense the
regulator's own output). Bring-up: shunts out → power → check `VIN_PROT`
→ shunt `JP_VIN` in → check 5 V → `JP_5V` → `JP_3V3`. A meter across
any pulled shunt reads that rail's current for free.

Two items are deliberately left for layout, not capture:

- [ ] **C4 is not yet flagged "Do not populate"** in KiCad (its Value is
      `OPEN`, which `checknet` honours, but the JLCPCB BOM/position
      export reads the DNP flag). Tick it before the first fab export.
- [ ] **L1, L2 and F1 pads vs the manufacturer drawings** — those three
      land patterns came from LCSC, not from a datasheet. F1's staggered
      pins and centre snap-peg are the ones to measure. J1's pad ring is
      only 0.4 mm; widen it in layout per §2.6.

**Sourcing complete — every part has an LCSC number (2026-09-03).** The
last nine were looked up against JLCPCB's live parts API, which returns
the LCSC C-number, library tier and stock in one call:

```
curl -s -H 'Content-Type: application/json' -X POST \
  -d '{"keyword":"0603WAF2212T5E","currentPage":1,"pageSize":5}' \
  https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList
```

Use this instead of browsing — `lcsc.com/search` is a JavaScript app
that returns an empty page to any fetch, and web search guesses at
neighbouring part numbers (it offered 22 Ω and 22 kΩ for a 22.1 kΩ
query). The API answers by exact MPN and reports `componentLibraryType`
= `base` (Basic) or `expand` (Extended).

**C3 changed on the strength of that lookup:** the specified Samsung
`CL10B104KB8NNNC` (`C1591`) is **Extended**; Yageo's identical-spec
`CC0603KRX7R9BB104` (`C14663`) is **Basic** with 67 M in stock. Same
100 nF / 50 V / X7R / 0603, one tier cheaper to assemble.

**Four resistors are unavoidably Extended: R1 115 k, R2 22.1 k, R5 14 k,
R_FB1 453 k.** JLCPCB's Basic library carries **E24 values only** for
1 % 0603 — there is no Basic part at any E96 value, from any
manufacturer (checked all four). So the picking order's "Basic first"
cannot be satisfied here without changing the divider ratios.

- **v0.1: keep the E96 values.** The board is hand-populated, so
  Extended costs nothing, and these values come straight from the two
  datasheets' worked examples.
- **v0.2, if the board goes to PCBA:** 4 Extended parts ≈ **$12/run** in
  feeder fees. An E24-only rail-1 divider exists and is *better* than
  the datasheet's: **R1 68 k / R2 13 k → 4.985 V** (+0.4 % error at
  V_ref 0.8 V, vs 4.96 V for 115 k/22.1 k). Rail 2 has no comparably
  clean E24 pair — the best, 330 k/75 k, gives 3.24 V (−1.8 %), and
  changing R_FB2 also invalidates the datasheet's exact 6.8 pF C_FF.
  **Decide this once, at the v0.2 sourcing pass, not per-sheet.**

**21 distinct part numbers for 30 placements** — C2a/C2b/C_out share
one, C1a/C1b share one, R_FB2/R_G share one (`C25803`), R_5V/R_3V3
share one (`C23228`). C4 is a pad only.

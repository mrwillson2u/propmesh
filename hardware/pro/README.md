# PropMesh Pro — start here

KiCad project: `propmesh/`. This file is the **map** — if you ever need
two documents open at once to do one task, that's a bug in the docs;
fix the doc, don't cross-reference.

## The four layers

| Layer | Lives in | Open it when |
|---|---|---|
| **WHY** — decisions, costs, schedule | `docs/hardware-spec.md` | you're questioning a choice or pricing something. Its BOM tables are **cost rollups, not orderable specs.** |
| **WHAT** — every pin and net name | `pinmap.yaml` (repo root) | never during capture — each sheet file below already quotes its nets. Edit it only to *change* an assignment (then regenerate + update spec, same commit). |
| **HOW** — drawing each schematic sheet | **`sheets/NN-*.md`** | drawing that sheet. Each is self-contained: parts, selection criteria, supporting passives, exact net names, a done-checklist. |
| **PROCESS** — review, libraries, git | `CLAUDE.md` (review order), `hardware/README.md` (libraries, easyeda2kicad, what's committed) | reviewing, importing a part, committing. |

**The standing rule:** anything learned during capture — a criteria
gotcha, a stock problem, a changed value — goes into the relevant
`sheets/` file the same day. Chat sessions and heads are not storage.

**Connections live in `NN-name.net.yaml`, one line per net — never in
prose or markdown tables — and are DRAWN, not described.**
`tools/checknet.py NN.net.yaml --mermaid` renders it to
`NN.diagram.html` (open in any browser) and `NN.diagram.md`: one
left-to-right wiring diagram per circuit block, every part's GND pin
written in its box, plus a per-net roll-call table. That is the drawing
guide Colin works from — visual, not prose. The markdown says *why*; the
yaml says *what wires to what*, and it is machine-checked:

```
python3 tools/checknet.py hardware/pro/sheets/01-power.net.yaml
```

diffs the spec against `kicad-cli`'s netlist export of the real
schematic **and writes `NN.check.html` — the same diagram coloured by
result** (green ok, red wrong net with a note saying where the pin
actually is, orange wrong value, dashed not placed). Open it in a
browser, not the editor; all green = sheet done. Parts match by
**Value**, and each spec part is paired with one specific KiCad part
(same-value parts are paired by best fit, so a finding names the
actual resistor; boxes show `C_bulk = C11`). A part still carrying its
symbol's default Value is matched by symbol and flagged. Nets match by
membership (internal nodes need no labels), and the named rails are
checked for their label. This closes the "schematic disagrees with the design" bug
class CLAUDE.md ranks first. The markdown keeps only a **designator
cross-reference** where the sheet's names differ from the datasheet
figure's. Sheet 01 is the worked example; **sheets 02–07 need their
`.net.yaml` written before drawing.**

**Every part gets a TABLE ROW, never only prose.** A part described in
a sentence ("plus a 10 kΩ pull-up", "gate network: a zener and 100 kΩ")
is invisible when you work down the table sourcing parts — it was a real
miss on sheet 01's gate clamp. Each sheet ends with a **Complete parts
list**: one row per reference designator, and if it is not in that table
it does not exist.

**One list, not three.** Parts are itemised in **the sheet's
per-section tables and nowhere else** — that is the single source. The
spec's §2.4 carries only a **rolled-up cost** per block and points at
the sheet; a sheet's "Sourcing status" tracks only what is still
*missing*, never a second copy of what is found. This was learned the
hard way: the same 28 parts briefly existed in three places, guaranteed
to drift. **When a sheet is finished, update its §2.4 rollup total and
re-run the cost cascade** — one number to sync, not thirty rows.

## Sheet status

| Sheet | Doc | Drawn | Open ⚠ items in doc |
|---|---|---|---|
| 01 Power | `sheets/01-power.md` — **done: every part has a verified LCSC number, tier and price** | **☑ DONE 2026-09-03** — checknet all green incl. J2, ERC clean, all 5 imported land patterns datasheet-verified, C4 DNP set | for LAYOUT: J1 pad ring ≥2.8 mm; silkscreen `ONE SUPPLY ONLY` / `+ TIP`; measure a real F1 holder at bring-up |
| 02 MCU + USB | `sheets/02-mcu-usb.md` — **fully sourced** | **☑ DONE 2026-09-04** — checknet all nets + footprints green; ERC clean bar the 32 expected one-sided labels | for LAYOUT: USB-C needs its shield vias; TP37 silkscreen |
| 03 Slow outputs | `sheets/03-outputs.md` — **fully sourced**, 6 supply-voltage switch/dim channels + flybacks | **☑ DONE 2026-09-04** — checknet all green, ERC clean | for BRING-UP: relay NO/NC continuity beep; `C723982` stock thin (82); silk: NO\|COM\|NC, 30V warning, V+/SW, `V+ = SUPPLY VOLTAGE` |
| 04 Audio + SD | `sheets/04-audio.md` — **fully sourced**, GAIN/SD_MODE datasheet-exact, line-out via PCM5102A | **☑ DONE 2026-09-04** — checknet all green, ERC clean | for BRING-UP: meter the jack tip/ring/sleeve (three numbering schemes collided — see doc); `C723982` shared stock pool |
| 05 Addressable LED | `sheets/05-led.md` | ☐ | — |
| 06 Motors | `sheets/06-motors.md` | ☐ | socket row spacing (spec open item #3); ILIM values |
| 07 Sensors + expansion | `sheets/07-sensors-expansion.md` | ☐ | — |

Tick boxes as sheets land; clear ⚠ items before layout, never during.

## Rules that apply to every sheet

- **Net names = pinmap signal names, exactly.** That's what lets the
  netlist be checked against `pinmap.yaml` mechanically.
- **Power rails cross sheets by NAME — one canonical name each.** KiCad
  power symbols are global, so `+5V` on one sheet is `+5V` on all of
  them. The board's rails are exactly: **`GND`, `+5V`, `+3V3`,
  `VIN_RAW`, `VIN_PROT`** (all created on sheet 01). A second name for
  the same rail silently produces a second, unpowered net — sheet 06
  briefly called `VIN_PROT` "VMOT" (the stepper-datasheet name) and
  would have left the motor drivers dead. **If a datasheet names a pin
  differently, that goes in a note, never on the label.**
- **Passives: one package — 0603.** Resistors: **1 % thick film,
  1/10 W default** (Basic 1 % 0603 coverage is deep; 5 % saves
  nothing). Caps: **X7R only — never Y5V/Z5U**, whose capacitance
  collapses with temperature and bias; this board lives outdoors in
  late October. **Check DC-bias derating on every MLCC ≥1 µF** (a
  10 µF/16 V part at 12 V is ~3 µF).
- **Screw terminals: one family for the whole board — DEGSON, decided
  2026-09-03.** Every field-wiring terminal on every sheet comes from
  this list; do not browse the category again.

  | Use | Pitch | Part | LCSC |
  |---|---|---|---|
  | DC in (J1), DC motor ×2 | 5.0 | DG128-5.0-**02P**-14-00A(H) | `C711349` |
  | Relay ×3, WS2812 strip | 5.0 | DG128-5.0-**03P**-14-00A(H) | `C691861` |
  | APA102 strip | 5.0 | DG128-5.0-**04P** | ⚠ verify stocked; else 2× 02P |
  | Speaker, LED outputs | 3.5 | DG381S-3.5-**02P**-14-00A(H) | `C723982` |

  All are **fixed, side-entry, THT, 300 V** — 5.0 mm pitch is
  interchangeable with 5.08 at these pin counts. The 3.5 mm family is
  for low-current outputs that take thin wire; consolidating them onto
  5.08 would drop a part family (§4.3) at ~9 mm of board edge — a v0.2
  call.

  **Barrier blocks (Mean Well style) considered 2026-09-03 and
  rejected.** Every 7.62 mm barrier block in the category (KF7.62,
  DBT10/30/50) takes the same **12–22 AWG / 2.5 mm²** as the DG128 —
  the bigger M3 screw does not mean bigger wire. And it terminates
  *worse* for this audience: flat screw heads want crimped fork lugs
  (that is how a Mean Well's own manual wires them), while bare
  stranded wire splays and creeps loose under them; the DG128's rising
  cage clamps bare wire properly, which is what users actually bring.
  Barrier screws also face up, fighting the side-entry gland enclosure.
  The system's lug-friendly barrier block already exists — on the
  Mean Well itself.

  **Pluggable (2EDG) was considered and deferred.** DEGSON's
  2EDGR header (`C699495`, 02P, ~$0.05) + 2EDGK plug is roughly
  cost-neutral and lets a user unplug a whole prop — genuinely better
  for seasonal re-wiring. It was *not* chosen for v0.1 because the
  plugs are friction-fit and the locked decision picked screw terminals
  precisely for cables that get yanked in a yard; a snagged cable can
  unplug a 2EDG. Revisit after a season with the box, with the flanged
  2EDGKM variants in mind if yank-resistance is the only objection.
- **Connector orientation is a decision, not a default.** The enclosure
  (spec §2.3) feeds wires through glands on one edge — pick vertical vs
  right-angle entry per connector *before* layout, because the
  footprints differ and rework means desoldering.
- **You are committing to FOOTPRINTS, not part numbers.** Production is
  a year out; no stock level survives that, and a sourcing pass before
  v0.2 is happening regardless. So judge a part by *what a future
  substitution costs*:
  - **Free swap** (standard land pattern, many vendors): all 0603/0805
    R and C, SOD-123/SMA diodes, SOT-23 / TO-252 semis, EIA-size MLCCs.
    Thin stock here is not worth worrying about — take what is
    available and move on.
  - **Costs a layout change**: **inductors** (molded footprints vary by
    family — the single most under-appreciated respin risk), fuse
    holders, connectors, and anything with a vendor-specific land
    pattern. **Spend the verification effort here**, and prefer a part
    whose footprint matches a family with several members.
- **Part picking order: JLC Basic → in stock in quantity → package.**
  Price is a tiebreaker, not a criterion — an Extended part costs $3/run
  in feeder fees before its unit price matters.
- **Brand tier: generic for commodity, premium only where it earns it.**
  Samsung / Yageo / Fenghua / Uniroyal MLCCs and resistors are 2–3×
  cheaper than Murata / TDK and entirely adequate for decoupling and
  bulk. Pay up only where a spec actually depends on it (tight-tolerance
  feedback dividers, a timing part, low-ESR at high ripple). A Murata
  10 µF is $0.27; the generic equivalent is ~$0.10 and does the same job
  here.
- **Voltage rating is a hard limit, not a derating knob.** Check the
  part's rating against the **maximum** rail it sees (30 V input here,
  not 12 V nominal) before looking at anything else — then apply DC-bias
  derating on top, which is a separate, additional loss of capacitance.
- **LCSC filters: filter on primaries, SORT on secondaries.** Primary
  attributes (value, voltage, package, dielectric, type) are populated
  reliably. Secondary ones (Isat, DCR, ESR, ripple current) are often
  blank or wrong — and **filtering on a blank field silently drops the
  part**, which is why stacking every requirement as a filter returns
  junk or nothing. Filter the primaries, sort by the secondary, read the
  column, then **verify the final 2–3 candidates on the manufacturer
  datasheet**. The distributor table builds a shortlist; it is not the
  source of truth for a spec the design depends on.
- **Check the value actually exists in the family before specifying
  it.** Power inductors ladder on **E6** (1.0/1.5/2.2/3.3/4.7/6.8/10),
  not E12 — a datasheet's "5.5 µH" has no stocked neighbour at 5.6 µH.
  Same trap for electrolytic values and 1 % resistors: pick from what
  the category filter actually returns, then re-run the math on that
  value rather than the ideal one.
- **LCSC navigation, as it actually is** (verified 2026-09-02): there
  is no "Power Inductors" category — inductors are all under
  **Passives → Inductors, Coils, Chokes → Fixed Inductors**, narrowed
  by sortable columns. Two of those columns are **"Current Rating"**
  (thermal/RMS) and **"Current - Saturation (Isat)"** — *different
  numbers*; margin is computed against Isat. Filtering the wrong
  column is how an 0805 110 mA part survives a search for a 3 A buck.
  Generally: **the spec that matters is often a distinct column from
  the one named in the part title.**
- **The MPN suffix IS the package** (AP64350**SP** = SO-8EP,
  PCA9685**PW** = TSSOP-28). For ICs there is no footprint "choice" —
  ordering the part decides it. Choices exist only for generics.
- **Hot air is available** at this bench — TQFN/SOT-563 are buildable.
  Prefer bigger packages anyway when free: v0.1 wants probe access and
  reworkability more than area.
- After every schematic session: **F8** (Update PCB from Schematic),
  save, commit.

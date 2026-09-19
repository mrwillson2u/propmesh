# Hardware

KiCad 10 projects. `pro/propmesh/` is the Pro board (in progress);
`mini/` follows in Nov–Dec. Full spec: `../docs/hardware-spec.md`.

## Shared part library

`lib/propmesh.kicad_sym` (symbols) and `lib/propmesh.pretty/`
(footprints) hold every part KiCad doesn't ship — both boards use them,
and keeping them in-repo is what makes the project build after a clone.
Nothing else should be added to a *global* library.

Register it once per project, with a **relative** path so it survives a
clone or a move:

- Preferences → **Manage Symbol Libraries** → *Project Specific
  Libraries* tab → **+** →
  Nickname `propmesh`, Path `${KIPRJMOD}/../../lib/propmesh.kicad_sym`
- Preferences → **Manage Footprint Libraries** → same tab → **+** →
  Nickname `propmesh`, Path `${KIPRJMOD}/../../lib/propmesh.pretty`

`${KIPRJMOD}` is KiCad's variable for "this project's folder". An
absolute path like `/Users/colin/...` works on one machine only and
breaks for anyone who clones the repo.

**If Assign Footprints shows only `propmesh` in its library pane**, the
*global* footprint table is missing KiCad's built-in libraries (KiCad 10
registers all 155 of them as one nested entry named `KiCad`, type
`Table`, pointing at `…/SharedSupport/template/fp-lib-table`; the
symbol table has the same entry, which is why symbols still worked).
Check Preferences → Manage Footprint Libraries → *Global Libraries*: it
should have that one `KiCad` row. It was missing on Colin's machine
(found 2026-09-03) and fixed by writing the entry into
`~/Library/Preferences/kicad/10.0/fp-lib-table`; ERC's "configuration
does not include the footprint library …" warnings are this problem,
not a headless-run artefact.

## Looking up an LCSC part number

**Do not browse `lcsc.com/search` and do not web-search a part number.**
The search page is a JavaScript app that returns an empty document to
any fetch, and web search answers a query for 22.1 kΩ with 22 Ω and
22 kΩ neighbours — confidently and wrongly. Ask JLCPCB's parts API by
exact MPN instead:

```
curl -s -H 'Content-Type: application/json' -X POST \
  -d '{"keyword":"0603WAF2212T5E","currentPage":1,"pageSize":5}' \
  https://jlcpcb.com/api/overseas-pcb-order/v1/shoppingCart/smtGood/selectSmtComponentList
```

One call returns `componentCode` (the C-number), `stockCount`,
`componentPrices` (the full quantity ladder), the LCSC product URL, and
**`componentLibraryType`: `base` = JLC Basic, `expand` = Extended** —
which is the first thing the picking order asks. Searching a *value*
("100nF 50V X7R 0603") instead of an MPN returns up to 40 candidates,
which is how to find a Basic alternative to an Extended part.

**Known gotcha: JLCPCB's Basic library is E24-only for 1 % 0603
resistors.** No E96 value (22.1 k, 14 k, 115 k, 453 k…) has a Basic part
from any manufacturer. Datasheet-recommended divider values are usually
E96, so expect them to land Extended and decide deliberately — see
sheet 01's Sourcing status for the worked example.

Pulling a part in from LCSC (relay, odd connectors), run from the repo
root:

```
pip install easyeda2kicad
easyeda2kicad --full --lcsc_id=C12345 --output hardware/lib/propmesh
```

**Then fix the 3D model path** — easyeda2kicad writes the `--output`
string verbatim, which KiCad cannot resolve, so the 3D viewer silently
shows nothing:

```
sed -i '' 's|(model "hardware/lib/propmesh.3dshapes/|(model "${KIPRJMOD}/../../lib/propmesh.3dshapes/|' \
  hardware/lib/propmesh.pretty/*.kicad_mod
```

Imported symbols carry `LCSC Part`, `MPN`, and `Datasheet` fields, which
is what makes the JLCPCB BOM export automatic later. **They are
community-contributed: check pin numbers and the footprint's pad pitch
and pin-1 corner against the datasheet before layout.** A wrong symbol
shows up in ERC; a wrong footprint shows up when the board arrives.

**Why import-and-verify beats hand-drawing symbols** (asked and
settled 2026-09-04, with this project's own tally: 9 symbols + 15
footprints imported, defects found = 2 land patterns, 3 plated
mechanical holes, 1 inverted-pin symbol, universal missing pin types —
and **zero pin-number→pad mapping errors among the imports** — the one
such error on the board came from a KiCad-official generic symbol, see
below). A hand-drawn 41-pin symbol has its author's typo rate and no
usage history; verification, not authorship, is what makes a symbol
trustworthy. Trust tier: KiCad-official > high-volume EasyEDA parts
(TF-01A, PJ-320A — millions of boards) > low-volume vendor imports
(both real land-pattern errors were SXN inductors). And "just respin
if it's wrong" prices the board, not the calendar: a quick-turn cycle
is 10–14 October days plus the debugging evening a silent error costs
first — against five scripted minutes of inspection per part.

**This is not theoretical — measure every imported land pattern.** Of
the four footprints imported on 2026-09-03, **the two inductors were
wrong** (L1's pads 27 % undersized and 1.46 mm too far apart, L2's
13 % undersized) while the fuse holder and terminal block were correct.
Pull the real datasheet (see the download note below), find its
recommended-land-pattern table, and compare gap, overall span and pad
width against the `.kicad_mod` before the part reaches layout.

**Check a drawing by measuring it, not by reading its leader lines.**
Dimension callouts on a mechanical drawing are easy to attach to the
wrong feature, and a confident misreading produces a confident wrong
answer — F1 was briefly "corrected" from a correct footprint to a
broken one that way. Both of these datasheets' land patterns are raster
images inside the PDF, so the reliable method is to render the page,
measure the shapes in pixels, and anchor the scale on one *labelled*
dimension; every other number then follows and either agrees with the
table or does not. `pymupdf` + `pillow` do this in a few lines.

**Getting the datasheet PDF:** `lcsc.com/datasheet/...` returns HTML to
a fetch. The actual file is on the mirror —
`https://wmsc.lcsc.com/wmsc/upload/file/pdf/v2/lcsc/<id>_<MPN>_<Cnum>.pdf`
— which serves a real PDF with a `Referer: https://www.lcsc.com/`
header. The `<id>_<MPN>_<Cnum>` string comes from the API's
`dataManualUrl`.

**Imported symbols can arrive with pins INVERTED** — the connection
circle on the body side and a dead decorative stub facing outward, so
wires drawn to the visible tip connect to nothing (HK4100F arrived this
way, caught by Colin 2026-09-04). In the Symbol Editor the circle must
sit at the OUTER end of every pin; if not, flip each pin 180° about its
own stub before first use.

**Two parts can import to the SAME footprint filename.** EasyEDA names
land patterns generically (two different SO-8-EP chips both arrive as
`SO-8_L4.9-W3.9-P1.27-LS6.0-BL-EP`), and `--overwrite` silently
replaces the existing file — nearly clobbered the AP64350's verified
pattern with the DRV8871's (2026-09-04; geometry happened to be
identical, only the embedded LCSC property flipped). After every
import: `git status hardware/lib/` and investigate any MODIFIED
footprint you didn't expect; fork same-named patterns to per-part
filenames. The sixth known import lie.

**A STOCK symbol can connect to nothing: symbol pin NUMBERS must equal footprint pad numbers.** KiCad 10's generic `Device:Q_NMOS` / `Q_PMOS` number their pins D/G/S — they match no footprint's 1/2/3, and KiCad raises no ERC or DRC finding; the part is simply left without tracks. Sheet 01's input FET was drawn that way for three days (caught 2026-09-06 by asking "are we sure the right pin reaches the right pad?"). Use a part-specific `Transistor_FET:` symbol with numbered pins. **`checknet.py` now cross-checks every assigned part's pin numbers against its footprint's pad numbers**, so this class is mechanical from here on. The seventh known lie, and the only one from a KiCad-official symbol.

**An import's pad numbers may not be the datasheet's contact numbers.**
The PJ-320A jack numbers its four contacts 1–4 in the datasheet
schematic; the EasyEDA part numbers the same contacts 2–5. Any pin
mapping quoted from the datasheet is then wrong on the real part.
When schemes disagree, derive the mapping from GEOMETRY (contact depth,
slot positions) and say so in the sheet doc. (Caught by Colin on the
line-out jack, 2026-09-04 — the fifth known way an import lies.)

**Every imported symbol arrives with all pins typed "Unspecified"**, so
ERC throws a "Unspecified and Passive pins are connected" warning for
every wire on it. Set the pin electrical types **in the library** the
first time a part is used: supply and ground pins (incl. the thermal
pad) → *Power input*, enable/logic inputs → *Input*, everything else
(SW, BST, FB, COMP, RT) → *Passive*. Done so far: AP64350SP-13
(2026-09-03). The others still need it when they are first placed.

**How an NPTH looks on screen:** in the default dark theme a mechanical
hole renders as a **solid cyan disc**, not a visible void — that is the
"non-plated holes" object colour. Confirm one by clicking it (pad type
reads *NPTH, Mechanical*) or in the 3D viewer (Alt+3), where a real
hole is unambiguous. easyeda2kicad imports mechanical holes as *plated*
pads with zero annular ring, which render as almost nothing — both
DC-044A (fixed) and 01530008Z (pending) arrived that way; check every
import.

**Two copies of every symbol — edit the library one.** KiCad caches a
copy of each symbol inside the schematic; ERC's "doesn't match copy in
library" only says the two differ, not which is right. Edit the part in
the library (Tools → Symbol Editor, pick `propmesh:…`, save), then in
the schematic run Tools → **Update Symbols from Library** to pull it in.
Editing the schematic's copy (right-click → Edit with Symbol Editor)
and then running Update *discards* that edit — it overwrites with the
library. If you have edited the schematic copy and want to keep it, save
it *to* the library from the Symbol Editor (File → Save As, choose
`propmesh`) before updating.

Already imported: AP64350SP-13 (`C2071691`), TPS61023DRLR (`C919459`),
MP4560DN-LF-Z (`C40133`, the alternate buck), ESP32-C3-MINI-1U-N4
(`C2911374`, for the Mini), WS2812B-MINI-X2 (`C4154873`, status pixel —
symbol arrives named `WS2812B-MINI-X1`, footprint
`LED-SMD_4P-L3.5-W3.5-TL_WS2812B-1`; pins and land pattern verified
against the Worldsemi DS 2026-09-04). **Footprint-only imports** (`--footprint
--3d`, the symbol is a stock KiCad one): L1 SMMS1050 (`C149542` →
`IND-SMD_L11.5-W10.0`), L2 SMMS0650 (`C149580` → `IND-SMD_L7.1-W6.6`),
F1 Littelfuse 01530008Z (`C206907` → `01530008Z`), J1 DEGSON DG128
(`C711349` → `CONN-TH_DG128-5.0-02P-14-00A-H`). Everything else in the
BOM is covered by KiCad's built-in libraries.

**Which footprint each part gets is recorded in the sheet's
`NN.net.yaml` (`footprint:` per part) and verified by `checknet.py`** —
a wrong or missing footprint is reported next to the wiring findings.
Import a vendor land pattern only when the part is vendor-specific
(inductors, fuse holders, connectors); every 0603/SOT/SOD/SMA part uses
the stock KiCad footprint so substitutes stay free.

## What is and isn't committed

Committed: `.kicad_pro`, `.kicad_sch`, `.kicad_pcb`, `sym-lib-table`,
`fp-lib-table`, and `lib/`.

Ignored (see `../.gitignore`): `.history/` — KiCad 10's Local History
(File → Local History), which is a nested git repo and must never be
committed, though it is worth keeping on disk; `_restore_backup_*/`;
`jlcpcb/` and `production_files/` from the JLCPCB plugin; lock files,
autosaves, and `fp-info-cache`.

## Reviewing

`.kicad_sch` is plain text, so schematics can be reviewed in-repo and
checked against `pinmap.yaml` — name every net exactly as its pinmap
signal to make that possible. Review order is in `../CLAUDE.md`.

## 3D model origins — audited 2026-09-08

Imported `.wrl` models carry their own origin, and KiCad applies
`scale → rotate → offset` before placing them at the footprint origin.
Every model in `propmesh.3dshapes` was measured (VRML bounding box ×
2.54) against its footprint's fab outline. **KiCad's 3D Y axis is
inverted relative to board Y** — a model centre of −0.70 matches a
footprint centre of +0.70, which is why most of these look wrong until
you account for it.

Every model is correctly *sized*. Exactly one is misplaced:

| Model | Verdict |
|---|---|
| `AUDIO-TH_XKB_PJ-320A` (`CN1`) | ❌ **misplaced ≈2.1 mm.** The model is drawn tall-and-narrow (6.10 × 14.20 mm) while the footprint is wide-and-short (14.40 × 6.10), so the footprint applies `rotate 0 0 90`. That rotation also swings the model's own −2.10 mm centre offset out of X and into Y. **Fix:** Footprint Properties → *3D Models* → **Offset X `-2.0`, Offset Y `+2.1`**; if it moves the wrong way, negate Y. Cosmetic — pads and courtyard are unaffected |
| `TF-SMD_TF-01A`, `DC-IN-TH_DC-044A-20A`, `CONN-TH_DG128-5.0-02P/03P`, `CONN-TH_DG381S-3.5-02P`, `WIFIM-SMD_61P`, `FUSE-TH_L17.2-*`, and the remaining ten | ✅ within 0.9 mm once the Y inversion is applied |

⚠ **`kicad-cli pcb render` silently omits some of these `.wrl` models**
(`CN1` and `U10` render as bare pads headlessly), so the headless render
is not a valid check for 3D placement. Use the GUI 3D viewer (Alt+3).

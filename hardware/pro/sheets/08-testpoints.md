# Sheet 08 — Test points + spare strap pad
> **Moved 2026-10-02:** `R_STRAP3` (schematic `R53`) is now drawn on sheet 05 with the other four level-shifter pulldowns. Same part, same net; this sheet holds only test points.

> **Revised 2026-09-16** (datasheet review; drawing steps in
> `../schematic-changes-2026-09-16.md`): `R_STRAP3` is **fitted, 10 k** — no longer DNP.

**Everything needed to draw this sheet is in this file.** It exists
because spec §2.6 demands a test point on every GPIO and every rail for
v0.1 — the bodge-wire recovery plan needs somewhere to land a wire and
a probe. Drawing guide: `08-testpoints.diagram.html`; checker:

```
python3 tools/checknet.py hardware/pro/sheets/08-testpoints.net.yaml
```

## What it is

- **33 `Connector:TestPoint` symbols on global labels** — every GPIO net
  in `pinmap.yaml` (repo root; the yaml here already spells every name)
  except `USB_DM`/`USB_DP` (never stub a differential pair) and IO37
  (TP1 already lives on sheet 02).

- **6 rail pads**: `VIN_RAW`, `VIN_PROT`, `+5V`, `+3V3` and two `GND`
  (one for the power corner, one for the module corner), on power
  symbols.
- **`R_STRAP3`**: an unpopulated 0603 pad, 10 k-shaped, from
  `LED_STRIP_1_CLK` (GPIO 3, a strapping pin) to GND. Value `DNP`,
  tick *Do not populate*. It is the spare strap pad §2.6 asks for.

**Rule (asked 2026-09-07): a test point lives with its net's owner
unless the net is already a global label.** `TP1` (IO37, straight off
the module pin) stays on sheet 02 and `TP2` (card detect, internal to
sheet 04) stays there — moving them here would mean adding global
labels to green sheets just to reach across. This sheet only collects
the nets that were global anyway.

**Values are the net names** (`STEPPER_1_STEP`…), so the silkscreen
prints the signal beside the pad and the checker pairs every test point
by its unique Value. The rail pads use `TP_5V`, `TP_GND_A`… as Values
because a Value of `+5V` would collide with the power-symbol name.

## Drawing it

1. New hierarchical sheet `testpoints` on the root, file
   `testpoints.kicad_sch`.
2. Place one `Connector:TestPoint` (A key), set its Value to the net
   name, attach a **global label** (Ctrl+L) with that exact name to its
   pin. Copy-paste for the rest and edit both the Value and the label
   text — 33 times. Reference designators will auto-number `TP3`
   onward.
3. Six more on `+5V`, `+3V3`, `GND`, `GND` power symbols and
   `VIN_RAW`, `VIN_PROT` global labels.
4. One `Device:R`, Value `DNP`, *Do not populate* ticked, between a
   `LED_STRIP_1_CLK` label and GND.

ERC will not complain: every label already has a partner on its home
sheet.

## Top or bottom? — BOTTOM, surface pads (decided by Colin 2026-09-07)

Surface pads on the **bottom** (B.Cu), not through-hole and not on top:

- **v0.1 repairs** are bodge wires, and the bottom is the empty side
  kept for them (spec §2.6) — the pad and the wire are on the same
  face, nothing to thread through the board.
- **Production test** is a bed-of-nails rig: the board sits
  component-side up on the fixture and **pogo pins come from below**.
  Bottom pads are the industry-standard target; the four 3.2 mm
  mounting holes (frozen pattern, 120 × 90) double as the fixture's
  alignment pins.
- Through-hole was considered and rejected: 41 extra holes in the
  ground plane and nothing gained once the rig probes from below.

**Pogo-rig rules for the pad positions** (apply now, the rig is a v0.2
job): pad ≥ 1.5 mm (the `TestPoint_Pad_1.5x1.5mm` already used is
fine; 2.0 mm is more forgiving if space allows); **≥ 2.54 mm centre
to centre** between pads (standard pogo pitch); **≥ 3 mm from the
board edge**; **≥ 2 mm from any through-hole pin** (sockets, XH, screw
terminals, radials) so the fixture plate can be flat around them; keep
the two `GND` pads far apart. The "beside the net's owner" rule of
`layout.md` A18 still applies — these are constraints on top of it.

**Footprint stays `TestPoint:TestPoint_Pad_1.5x1.5mm`**; only the side
changes. `R53` (the DNP strap pad) is a real part and stays on top.

**DONE 2026-09-07 by `tools/placetps.py`** (KiCad's own Python — the flip
is KiCad's flip): all 41 on B.Cu, each beside the pad that carries its
net (most within 0.1–2 mm; the socket and connector ones 3–4 mm out,
past the pin keep-out), spacing rules above enforced, the net name on
the bottom silk at 0.8 mm and the `TPnn` reference hidden. Render:
`layout-placement-bottom.png`. Colin's edit pass follows; to re-run
after moving parts (PCB editor closed):

```
/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 tools/placetps.py hardware/pro/propmesh/propmesh.kicad_pcb
```

**Doing it by hand instead (PCB editor):** right-click any `TP` pad → **Select →
Items in Same Hierarchical Sheet** (all 39 test points + `R53` are
selected) → **Shift+click `R53`** to drop it from the selection → press
**F** (Change Side / Flip). They flip in place: pads to B.Cu, labels to
B.Silkscreen mirrored so they read correctly from the bottom. Then
`TP1` (sheet 02) and `TP2` (sheet 04): click each, press **F**. Cmd+S;
`python3 tools/checksetup.py` counts the pads on the bottom.

## Layout placement (see `layout.md` A18)

Pads go in the gaps **near the net's owner** — the stepper pads by the
sockets, the SD pads by the card slot, the I²S pads between the module
and the audio block — never in a row along an edge, which puts them
where the wires aren't. The rail pads sit beside the staged-power link
headers on sheet 01. Every pad gets its net name on silk (the Value
does this if the footprint's value text is set visible).

## Parts

| Ref(s) | Part | LCSC | Note |
|---|---|---|---|
| TP_* ×39 | `TestPoint:TestPoint_Pad_1.5x1.5mm`, **on B.Cu** | copper only | no BOM line; bottom side for bodge wires + pogo rig |
| R_STRAP3 | 0603 pad, DNP | none | position file excludes DNP |

## Checklist

- [ ] 33 GPIO pads, names exactly as `pinmap.yaml`
- [ ] 6 rail pads
- [ ] R_STRAP3 DNP flag ticked in KiCad (Value `DNP` is what the checker sees; the flag is what the position export sees)
- [ ] checknet green (sheet 02's checker stays green — extra members on named nets are expected)

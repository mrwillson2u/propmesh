# Sheet 08 — Test points + spare strap pad

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

## Layout placement (see `layout.md` §3, sheet 08)

Pads go in the gaps **near the net's owner** — the stepper pads by the
sockets, the SD pads by the card slot, the I²S pads between the module
and the audio block — never in a row along an edge, which puts them
where the wires aren't. The rail pads sit beside the staged-power link
headers on sheet 01. Every pad gets its net name on silk (the Value
does this if the footprint's value text is set visible).

## Parts

| Ref(s) | Part | LCSC | Note |
|---|---|---|---|
| TP_* ×39 | `TestPoint:TestPoint_Pad_1.5x1.5mm` | copper only | no BOM line |
| R_STRAP3 | 0603 pad, DNP | none | position file excludes DNP |

## Checklist

- [ ] 33 GPIO pads, names exactly as `pinmap.yaml`
- [ ] 6 rail pads
- [ ] R_STRAP3 DNP flag ticked in KiCad (Value `DNP` is what the checker sees; the flag is what the position export sees)
- [ ] checknet green (sheet 02's checker stays green — extra members on named nets are expected)

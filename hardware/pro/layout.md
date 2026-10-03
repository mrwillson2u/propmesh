# PropMesh Pro v0.1 — layout guide

**One document for the whole layout, in the order you do it.** Part A is
the procedure: numbered steps, top to bottom, each one complete in
itself — the dialog, the page in its left tree, the row, the field name
exactly as KiCad prints it, and the value to type. Part B is reference
the steps point at only for the "why". **Every coordinate in this guide is measured from the board's top-left
corner** — X to the right, Y downward, in mm — and step A3 makes KiCad
count the same way, so the numbers go straight into the **Position X**
and **Position Y** fields of the *Footprint Properties* dialog
(double-click a part). (Before A3 is done KiCad counts from the page
corner instead; `tools/checksetup.py` prints where the board corner
currently is on the page.)

> ### ▶ Where you are: **board cleaned up, parity 0** (Fri 2 Oct). Left before routing: 8 courtyard overlaps in the sensor corner (list in `finish-v0.1.md`), then Claude re-places the test points. 3 terminal-gang overlaps are accepted by design.
> (updated 2026-10-02 23:40)

**The two checkers**, run from the repo root, after **Cmd+S** in KiCad
(KiCad writes the files only on save):

```
python3 tools/checksetup.py        # Board Setup, outline, mounting holes
python3 tools/checknet.py hardware/pro/sheets/NN-*.net.yaml   # a sheet, if the schematic changes
```

---

# Part A — The procedure

## A0. Done before layout (record, 2026-09-07)

Commit `dacce25`; sheet 08 test points drawn; three staged-power link
headers on sheet 01; references renumbered to `R1…`; **F8 done — all
239 footprints are on the board** in a heap beside the outline; Board
Setup entered and verified green by `checksetup.py`.

## A1. Board Setup — DONE 2026-09-07 (kept so v0.2 can repeat it)

All of it is in one dialog: **File → Board Setup…** Pages are in the
tree on the left.

1. **Board Stackup → Physical Stackup.** Field **Copper layers:** `4`.
   Then in the table, column **Thickness**, row by row (JLCPCB's
   standard 4-layer "JLC7628", 1.6 mm):

   | Row (as printed) | Type | **Thickness** |
   |---|---|---|
   | F.Cu | Copper | 0.035 |
   | Dielectric 1 | PrePreg | 0.2104 |
   | In1.Cu | Copper | 0.0152 |
   | Dielectric 2 | Core | 1.065 |
   | In2.Cu | Copper | 0.0152 |
   | Dielectric 3 | PrePreg | 0.2104 |
   | B.Cu | Copper | 0.035 |

   Leave **Impedance controlled** unticked; *Material* may stay "Not
   specified". These numbers feed only the impedance calculator and the
   3D model — the design rules below are what constrain the layout.
2. **Board Stackup → Board Editor Layers.** Row **In1.Cu**: name `GND`,
   type *power plane*. Row **In2.Cu**: name `PWR`, type *power plane*.
3. **Design Rules → Constraints.** Section *Copper*: **Minimum
   clearance** `0.2`, **Minimum track width** `0.25`, **Minimum via
   diameter** `0.6`, **Copper to hole clearance** `0.25`, **Copper to
   edge clearance** `0.5`. Section *Holes*: **Minimum drill size** `0.2` (0.3 until 2026-10-02 — the ESP32 module's own footprint has twelve 0.2 mm thermal vias in 0.6 mm pads, standard cost at JLCPCB when the pad is ≥ 0.45 mm; routing vias stay 0.3 from the net classes),
   **Hole to hole clearance** `0.25`. Section *Silk*: **Minimum text
   thickness** `0.15` (JLC's silk printer needs ≈0.15 mm strokes),
   **Minimum text height** `0.8`.
4. **Design Rules → Net Classes.** Top table *Netclasses*:

   | Row | **Clearance** | **Track Width** | **Via Size** | **Via Hole** | **DP Width** | **DP Gap** | other cells |
   |---|---|---|---|---|---|---|---|
   | Default | 0.2 | **0.25** (KiCad pre-fills 0.2 — below the constraint above) | 0.6 | 0.3 | **0.3** (pre-fills 0.2) | **0.2** (pre-fills 0.25) | as pre-filled |
   | Power | empty | 1.0 | empty | empty | empty | empty | empty |
   | HighCurrent | 0.3 | 3.0 | 0.8 | 0.4 | empty | empty | empty |

   DP Width / DP Gap set the **USB pair** (`USB_DP`/`USB_DM`): 0.3 mm
   tracks, 0.2 mm apart ≈ 90 Ω on this stackup (added 2026-09-16).

   Bottom table *Netclass Assignments*, one row per line, column
   **Pattern** then column **Net Class**. Patterns match the *full* net
   name including the sheet path; the *Nets matching…* panel on the
   right must list at least one net for every row.

   | **Pattern** | **Net Class** | What it is |
   |---|---|---|
   | `VIN_*` | HighCurrent | connector → fuse → FET (`VIN_RAW`, `VIN_FUSED`, `VIN_PROT`) |
   | `/Power/VIN_BUCK` | HighCurrent | buck input past `JP_VIN` |
   | `/Power/VIN_FUSED` | HighCurrent | fuse → FET drain, the 10 A segment. A *local* label is named with its sheet path, so `VIN_*` cannot match it (added 2026-09-16) |
   | `+5V` | Power | 3 A rail |
   | `+3V3` | Power | |
   | `/Power/5V_BUCK` | Power | buck output before its jumper |
   | `/Power/3V3_BUCK` | Power | |
   | `/Motors/M?_OUT?` | Power | `MA_OUT1/2`, `MB_OUT1/2` — DRV8871 outputs, 2.13 A |
   | `/Motors/S?_??` | Power | 8 coil lines `S1_1A…S2_2B`, up to 2 A/phase |
   | `/Outputs/LED?_K` | Power | 6 DC-output switched returns, 2 A each |
   | `/Outputs/REL?_*` | Power | 9 relay contact nets, user loads to 3 A |
   | `/Audio/SPK_?` | Power | speaker lines |
   | `Net-(U9-OUT?)` | Power | amp outputs before the beads |

5. **Text & Graphics → Defaults.** Table *Default Properties for New
   Graphics and Text*, row **Silk Layers**: **Line Thickness** `0.15`,
   **Text Width** `1`, **Text Height** `1`, **Text Thickness** `0.15`.
6. **OK**, **Cmd+S**, then `python3 tools/checksetup.py` — it prints
   every cell that differs as the page → row → column to click.

## A2. Outline — round the corners — DONE 2026-09-07 except item 4

The rectangle was drawn on `Edge.Cuts` (2026-09-07), 130 × 100 mm. Two right-click menus turn
it into a rounded outline; both names verified against your KiCad 10
menu. **New objects always land on the *active* layer**, so:

0. In the **Appearance** panel on the right, tab *Layers*, click the
   row **Edge.Cuts** so it is highlighted — it is now the active layer.
1. Click the rectangle once so it highlights. Right-click →
   **Create from Selection → Create Lines from Selection…**. In the
   *Conversion Settings* dialog tick **Delete source objects after
   conversion** → OK. The rectangle is now four separate lines.
2. Drag a selection box around the whole outline so all four lines
   highlight. Right-click → **Shape Modification → Fillet Lines…** →
   field **Fillet radius:** `3` → OK. Each corner becomes a 3 mm arc.
3. **Cmd+S**, then `python3 tools/checksetup.py`. If it says the
   outline is on another layer (it happened 2026-09-07: the eight
   pieces landed on `F.Cu` because that was active), fix each piece:
   double-click a line or arc → in the properties dialog that opens,
   dropdown **Layer:** → choose **Edge.Cuts** → OK. Eight times: four
   lines, four arcs. Cmd+S, run the checker again.
4. **Lock the outline** so it can never slide while you select things
   around it (it slid 11.75 mm on 2026-09-07 during the layer fix):
   drag a box around the whole outline → right-click → **Locking →
   Lock**. Cmd+S.

## A3. Make KiCad count from the board corner

KiCad normally measures from the corner of the drawing sheet, which
puts the board's top-left corner at **X 69.75, Y 46.25** (where the
outline sits as saved 2026-09-07 19:10; `tools/checksetup.py` prints
the current value). Move the origin to the board's top-left corner
once and every readout, every *Position X / Y* field and the
fabrication position file become board coordinates.

*Where the controls are in KiCad 10 on a Mac (checked against the
KiCad 10 manual and your screen, 2026-09-07):* the origin tools are a
**button on the vertical toolbar at the right edge of the window**,
not a menu item; the grid is chosen from the **right-click menu**; the
settings dialog opens with **Cmd+,** — the *Preferences* menu in the
menu bar holds only Configure Paths / Manage Libraries / Set Language.

1. **Grid 0.25 mm.** Right-click on an empty part of the canvas →
   submenu **Grid** → pick the **0.25 mm** entry. (The corner point sits
   on a 0.25 mm multiple, so the cursor must be able to snap there.)
2. **Drill/place origin.** On the right-hand vertical toolbar find the
   button whose tooltip is **Set grid origin or drill/place origin
   (used for fabrication outputs)** — a small axis-cross icon, near the
   bottom of that toolbar. It is a *palette* button: only one of its
   two tools shows at a time. **Click and hold** it until the palette
   expands, then choose **Drill/Place File Origin**. Now move the
   cursor toward the outline's top-left corner until the status bar at
   the bottom of the window reads **X 69.7500 Y 46.2500**, and click.
   (The corner is rounded, so nothing is drawn exactly there — you are
   clicking the point where the top and left edges would meet.)
3. **Grid origin.** Same button: click and hold, choose **Grid
   Origin**, same point, same readout, click — so the grid also snaps
   from the board corner from now on.
4. **Display origin.** Press **Cmd+,** (the settings dialog; on the
   Mac it is in the application menu next to the Apple logo, not in the
   *Preferences* menu). Left tree **PCB Editor → Origins & Axes**.
   Section **Display Origin**: choose **Drill/place file origin**. Leave
   *X axis* at **Increases right** and *Y axis* at **Increases down**.
   OK.
5. **Check:** hover the top-left corner — the status bar reads X 0
   Y 0; hover the bottom-right corner — X 130 Y 100. **Cmd+S**, then
   `python3 tools/checksetup.py` verifies both origins from the saved
   file (the Display Origin choice is a preference, not in the file —
   the hover check is its test).

## A4. Mounting holes

Press **A** (same as Place → Add Footprint). In the search box of the
dialog that opens type `MountingHole_3.2mm_M3` and pick the entry that
is exactly **MountingHole:MountingHole_3.2mm_M3** — not `_Pad`, not a
DIN/ISO suffix: the plain unplated hole the printed plate's screws pass
through. OK, click anywhere on the board to drop it, press **Esc** to
leave the tool. Double-click the hole → *Footprint Properties* → fields
**Position X** and **Position Y** → type the numbers → OK. Four times:

| Hole | **Position X** | **Position Y** |
|---|---|---|
| top-left | 5 | 5 |
| top-right | 125 | 5 |
| bottom-left | 5 | 95 |
| bottom-right | 125 | 95 |

**This 120 × 90 mm pattern is frozen** (CLAUDE.md, 2026-09-07): the
printed mounting plate in spec §2.3 is designed to it. Nothing may be
placed within **7 mm** of a hole centre (screw head + plate boss); the
coordinates in this guide already respect that.

## A5. Save and check

**Cmd+S**, then `python3 tools/checksetup.py`. It verifies A1, the
130 × 100 outline, the four rounded corners, the origin (A3) and the
four hole positions. Green = go on to A6.

## A6. Working in the heap — the six things you'll do 500 times

The 239 footprints are already on the board, in a heap beside the
outline, *grouped by schematic sheet*. Every placement step below
works the same way:

| Action | How |
|---|---|
| Find a part by reference | press **Ctrl+F**, type the reference (`J17`), Enter — the view jumps to it and selects it |
| Select a whole sheet's parts | right-click any part of that sheet → **Select → Items in Same Hierarchical Sheet** |
| Carry a selection as a block | with it selected press **P** (Pack and Move Footprints): the parts bunch up on the cursor; click to drop them in the region the step names, then spread them inside it |
| Put a part at exact coordinates | double-click it → *Footprint Properties* → **Position X**, **Position Y** → OK |
| Rotate | select, press **R** (90° each press) |
| **Snap parts onto the grid** (Eagle's realign) | The PCB editor has **no align-to-grid command** (KiCad 10.0.6, checked 2026-09-14). Warp-on-move plus *Snap to grid: Always* is **not enough**: KiCad 10 also snaps a moving part into line with other parts' pads and anchors, so a part aligned with an off-grid neighbour inherits the neighbour's error. Measured on this board 2026-09-14: X on grid, Y copied from neighbours (8.925, 8.85, 9.025). **Fix all at once:** close KiCad and run `tools/snapgrid.py` (below). **Fix a row by hand:** select the parts, right-click the one to line up with → **Align/Distribute** → **Align to Top** (full align/distribute table below). **Or move them together:** select all the parts that should line up and press **M** once — as a group they have no neighbour pads of their own to snap to, so the whole selection lands on the same grid (found by Colin 2026-09-14; it is also why a lone relay kept jumping to its neighbour's off-grid pads 1/2). **Fix one exactly:** double-click → *Footprint Properties* → type a round **Position X / Y** |
| Lock a placed part so nothing later drags it | right-click → **Locking → Lock** (select several first to lock them all) |

**Align and distribute, Illustrator-style (KiCad 10 manual, checked
2026-09-14).** Select the parts, **right-click the part you want the
others to line up with**, then **Align/Distribute** → the command.
That right-clicked part is the key object and does not move. If you
right-click empty space instead, KiCad picks the part furthest in the
alignment direction (leftmost for Left, topmost for Top). Parts move on
one axis only.

| Illustrator | KiCad 10 command | Result |
|---|---|---|
| Horizontal Align Left | **Align to Left** | left edges share one X |
| Horizontal Align Center | **Align to Horizontal Center** | centres share one X — a vertical column |
| Horizontal Align Right | **Align to Right** | right edges share one X |
| Vertical Align Top | **Align to Top** | top edges share one Y |
| Vertical Align Center | **Align to Vertical Center** | centres share one Y — a horizontal row |
| Vertical Align Bottom | **Align to Bottom** | bottom edges share one Y |
| Horizontal Distribute | **Distribute Horizontally** (by centers, or with even gaps) | the two outermost stay put, the rest are spaced evenly between them |
| Vertical Distribute | **Distribute Vertically** (by centers, or with even gaps) | same, top to bottom |

Edges and centres are the parts' **bounding boxes**, so identical parts
line up pad-for-pad but different parts line up by body, not by pad.
To put one part at an exact offset from another's pad, use
**Position Relative To…** (**Shift+P**, or right-click → **Position**);
to nudge by an exact amount, **Move Exactly…** (**Shift+M**, same
submenu). The manual does not say whether aligning snaps to grid: parts
line up with the key object, so align to a part that is already on grid
(every part is, since `tools/snapgrid.py` ran) and, if a result looks
off, move the whole selection once with **M**.

**Why parts end up off grid, and the one-pass fix (2026-09-14).** The
first placement script packed parts from each region's edge plus half
the part's width, which put **145 of 243 anchors off the 0.25 mm grid**.
Warp-on-move (*Warp mouse to anchor of moved object*, already on) and
*Snap to grid: Always* (already on) do not cure it, because KiCad also
aligns a moving part to nearby pads and anchors — so every alignment
copies an existing error. Remove the seeds once and both kinds of
snapping agree from then on:

```
/Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 tools/snapgrid.py hardware/pro/propmesh/propmesh.kicad_pcb 0.25
```

Run it with the **PCB editor closed**. It moves each footprint's anchor
to the nearest 0.25 mm grid point measured from the Grid Origin (A3) —
never more than 0.125 mm — and changes nothing else. Tested on a copy
2026-09-14: 145 parts moved, DRC afterwards adds one courtyard touch
(`D14`/`J45`, beside the known `J44`/`J45` overlap). Run DRC after, and
re-run it whenever parts have drifted.

Never press **F** (flip to the back side) on a *component*: all
components stay on the top. The one exception is the test points —
bare pads, no part — which go to the bottom (A7 item 4). Grid: the **Grid:** dropdown in the top toolbar — `1.0 mm` for
placing, `0.5 mm` for passives, `0.1 mm` when routing. Undo is
**Cmd+Z**. The 3D view is **Alt+3** — the quickest way to see which
way a connector's wire holes face.

**Orientation rule for every edge connector:** after typing its
position, press **Alt+3**; the wire entry (screw-terminal holes, jack
opening, USB opening, card slot) must face *outward across the board
edge*. If it doesn't, close the 3D view, press **R** until it does.
Then zoom in: the thin courtyard outline around the part should sit
just inside the board outline; if it crosses, nudge with the arrow
keys (they move by one grid step).

## A7. Placement — DONE 2026-09-07 by `tools/placeboard.py`; now REVIEW and nudge

Every one of the 239 parts is on the board (`hardware/pro/layout-placement.png`
is the render). Nothing to type in this step: open the board, look, and
move what you disagree with. How each part got its place:

- **82 parts at exact coordinates** (the tables below — these are the
  numbers you will see in *Footprint Properties*).
- **117 parts packed into their block's region** (A8 table) by a
  first-fit packer: *inside the right block, but not yet at the pin*.
  Steps A9–A18 are now the refinement list — each row says where the
  part should end up relative to its chip or connector.
- **39 test points beside the peripheral end of their net** (a socket, a
  connector, the chip that owns it).

DRC after placement: **zero** clearance, courtyard, edge or short
violations. What DRC does report (pre-existing, not placement): F1's
centre mechanical hole (annular width 0 / "padstack questionable" —
the fuse holder's peg), the 9 thermal-via holes in U2's centre pad
(resolved 2026-10-02: minimum drill set to 0.2), silkscreen of edge connectors clipped by the board edge, and
~180 reference-designator overlaps (silk text on top of neighbours —
tidy at the silkscreen step, A24).

**Review checklist (3D viewer, Alt+3):**
1. **Orientation of parts that have no 3D model** — the screw terminals,
   the barrel jack `J18`, relays `K1–K3`, buttons, fuse holder. They
   render as silk outlines only, so their orientation was decided from
   the footprint drawings: DG128/DG381S wire-entry notches drawn on the
   +y side (→ facing the edge), the barrel drawn on `J18`'s −x side (→
   rot 90 puts it at the bottom edge with the pins inboard), `CN1`'s
   nose at −x (→ left edge). The terminals are pin-symmetric, so a wrong
   guess costs only silkscreen; `J18` is not — **compare its silk to the
   physical jack before ordering**. Parts *with* models (USB-C, microSD,
   module, JST-XH, Qwiic, radials, chips) were checked in the render and
   face the right way.
2. **Gang the screw terminals — the spacing is exact (2026-09-08).**
   Degson's DG128 housings "can be combined through the side lock":
   each body has a dovetail lug on one side and a matching recess on
   the other, so butted blocks lock together and read as one strip.
   The lug is the 0.59 mm asymmetry visible in the fab outline
   (`-5.59` one side, `+5.00` the other) — it does **not** add width, it
   drops into the neighbour's recess. Centre-to-centre spacing is
   therefore exactly the body width:

   | Family | Poles | Body width | Butt them at |
   |---|---|---|---|
   | DG128-5.0 | 2 | 10.0 mm | **10.0 mm** centres |
   | DG128-5.0 | 3 | 15.0 mm | **15.0 mm** centres |
   | DG128-5.0 | 2 beside a 3 | — | **12.5 mm** centres |
   | DG381S-3.5 | 2 | 7.5 mm | **7.5 mm** centres |

   Anything else leaves the gap seen in the 3D view. The strip pairs
   were placed 11.0 mm apart (1.0 mm too far) and the relay column
   16 mm apart (1.0 mm too far).
3. **Edge connectors flush with the edge** — courtyards sit 0.5 mm
   inside; nudge outward if you want the terminal faces proud.
4. **Each block's "at the pin" rules** (A9–A18): decoupling caps at
   their pins, the FB parts away from the inductors, series resistors at
   the terminals. The packer only guarantees "in the block".
5. ~~Flip the test points to the bottom~~ **DONE by `tools/placetps.py`
   2026-09-07**: all 41 on B.Cu beside the pad carrying their net, net
   name on the bottom silk (`layout-placement-bottom.png`). Review them
   with the board flipped in the 3D view; the rig spacing rules are in
   `sheets/08-testpoints.md`.
6. When happy: drag a box around each edge's connectors → right-click →
   **Locking → Lock**, then Cmd+S and `python3 tools/checksetup.py`.

**Exact placements** (Position X / Y are board coordinates, per A3):

Bottom edge, left → right (yard wiring)

| Part | What | **Position X** | **Position Y** | **Orientation** |
|---|---|---|---|---|
| `J18` | DC barrel jack | 18.00 | 93.21 | 90 |
| `J17` | DC in screw terminal | 29.30 | 94.40 | 0 |
| `J38` | strip 1 power | 44.30 | 94.40 | 0 |
| `J37` | strip 1 data/clk | 55.30 | 94.40 | 0 |
| `J39` | strip 2 power | 66.30 | 94.40 | 0 |
| `J36` | strip 2 data/clk | 77.30 | 94.40 | 0 |
| `J23` | motor A | 90.30 | 94.40 | 0 |
| `J28` | motor B | 101.30 | 94.40 | 0 |

Left edge, top → bottom

| Part | What | **Position X** | **Position Y** | **Orientation** |
|---|---|---|---|---|
| `CN1` | 3.5 mm line-out jack | 9.50 | 24.00 | 0 |
| `J35` | speaker terminal | 6.20 | 32.00 | 270 |
| `J8` | DC output 1 | 6.20 | 40.00 | 270 |
| `J9` | DC output 2 | 6.20 | 48.00 | 270 |
| `J10` | DC output 3 | 6.20 | 56.00 | 270 |
| `J11` | DC output 4 | 6.20 | 64.00 | 270 |
| `J12` | DC output 5 | 6.20 | 72.00 | 270 |
| `J13` | DC output 6 | 6.20 | 80.00 | 270 |

Right edge, top → bottom

| Part | What | **Position X** | **Position Y** | **Orientation** |
|---|---|---|---|---|
| `J47` | Qwiic (side-entry JST-SH) | 126.50 | 24.00 | 90 |
| `J14` | relay 1 contacts | 124.45 | 47.70 | 90 |
| `J15` | relay 2 contacts | 124.45 | 63.70 | 90 |
| `J16` | relay 3 contacts | 124.45 | 79.70 | 90 |

Top edge, left → right (service items — no yard wiring here)

| Part | What | **Position X** | **Position Y** | **Orientation** |
|---|---|---|---|---|
| `U2` | ESP32-S3 module (U.FL end at the edge) | 25.00 | 10.77 | 0 |
| `J1` | USB-C | 42.00 | 4.24 | 180 |
| `Card1` | microSD | 56.00 | 9.32 | 180 |
| `SW1` | RESET | 68.00 | 5.00 | 0 |
| `SW2` | BOOT | 76.00 | 5.00 | 0 |
| `LED1` | status pixel | 84.00 | 4.99 | 0 |
| `D10` | 5 V LED | 90.00 | 5.00 | 0 |
| `D11` | 3.3 V LED | 94.00 | 5.00 | 0 |

Inboard anchors

| Part | What | **Position X** | **Position Y** | **Orientation** |
|---|---|---|---|---|
| `J19` | socket 1 EN row (pin 1) | 64.00 | 43.00 | 0 |
| `J20` | socket 1 VMOT row (pin 1) | 76.70 | 43.00 | 0 |
| `J24` | socket 2 EN row (pin 1) | 84.00 | 43.00 | 0 |
| `J22` | socket 2 VMOT row (pin 1) | 96.70 | 43.00 | 0 |
| `K1` | relay 1 | 108.15 | 48.00 | 0 |
| `K2` | relay 2 | 108.15 | 64.00 | 0 |
| `K3` | relay 3 | 108.15 | 80.00 | 0 |
| `U3` | ULN2003 | 112.00 | 91.00 | 90 |
| `U7` | DRV8871 A | 84.50 | 86.50 | 90 |
| `U8` | DRV8871 B | 95.00 | 86.50 | 90 |
| `U11` | 74AHCT541 | 55.00 | 79.00 | 0 |
| `C43` | strip 1 bulk 1000 µF | 40.61 | 80.00 | 0 |
| `C45` | strip 2 bulk 1000 µF | 64.61 | 80.00 | 0 |
| `J42` | expansion 2×5 | 98.22 | 2.92 | 0 |
| `J40` | analog in 1 | 107.50 | 8.47 | 0 |
| `J41` | digital in 1 | 103.00 | 18.48 | 0 |
| `J44` | digital in 2 | 114.50 | 17.48 | 0 |
| `J46` | PIR header | 96.50 | 21.46 | 0 |
| `J43` | analog in 2 | 103.00 | 27.48 | 0 |
| `J45` | digital in 3 | 114.50 | 27.48 | 0 |

Other exact parts: `C44`, `D2`, `D3`, `D4`, `D5`, `D6`, `D7`, `J2`, `J3`, `J4`, `J5`, `J6`, `J7`, `J21`, `J26`, `J29`, `J30`, `J31`, `J32`, `J33`, `J34`, `Q1`, `Q2`, `Q3`, `Q4`, `Q5`, `Q6`, `R18`, `R20`, `R34`, `R35`, `R36`, `R37`, `R38` — output
FET/flyback pairs beside `J8–J13`, servo headers `J2–J7` in a row, MS
straps `J29–J34` and DIAG aux `J21`/`J26` under the sockets, strip series
resistors `R34–R37` at `J37`/`J36`, top-edge passives.

Packed (in region, refine per A9–A18):
- **Audio**: `C24`, `C25`, `C26`, `C27`, `C28`, `C29`, `C30`, `C31`, `C32`, `C33`, `C34`, `C35`, `C36`, `C37`, `C38`, `C39`, `C40`, `C41`, `FB1`, `FB2`, `R27`, `R28`, `R29`, `R30`, `R31`, `R32`, `R33`, `TP2`, `U9`, `U10`
- **LEDs**: `C42`
- **MCU and USB**: `C1`, `C2`, `C3`, `D1`, `R1`, `R2`, `R3`, `R4`, `TP1`, `U1`
- **Motors**: `C18`, `C19`, `C20`, `C21`, `C22`, `C23`, `J25`, `J27`, `JP1`, `JP2`, `Q8`, `R22`, `R23`, `R24`, `R25`, `R26`
- **Outputs**: `C4`, `C5`, `R5`, `R6`, `R7`, `R8`, `R9`, `R10`, `R11`, `R12`, `U4`
- **Power**: `C6`, `C7`, `C8`, `C9`, `C10`, `C11`, `C12`, `C13`, `C14`, `C15`, `C16`, `C17`, `D8`, `D9`, `F1`, `J48`, `J49`, `J50`, `L1`, `L2`, `Q7`, `R13`, `R14`, `R15`, `R16`, `R17`, `R19`, `R21`, `U5`, `U6`
- **Sensor Expansion**: `C46`, `C47`, `D12`, `D13`, `D14`, `R39`, `R40`, `R41`, `R42`, `R43`, `R44`, `R45`, `R46`, `R47`, `R48`, `R49`, `R50`, `R51`, `R52`

Test points by owner: `TP3`→SW2, `TP4`→R41, `TP5`→R50, `TP6`→U11, `TP7`→U11, `TP8`→U11, `TP9`→U11, `TP10`→U10, `TP11`→J42, `TP12`→J42, `TP13`→R39, `TP14`→R48, `TP15`→R52, `TP16`→J19, `TP17`→J19, `TP18`→U10, `TP19`→U10, `TP20`→R25, `TP21`→J24, `TP22`→J24, `TP23`→U8, `TP24`→U8, `TP25`→U11, `TP26`→Card1, `TP27`→Card1, `TP28`→Card1, `TP29`→J42, `TP30`→R23, `TP31`→U7, `TP32`→R46, `TP33`→R45, `TP34`→J24, `TP35`→U7, `TP36`→J18, `TP37`→J20, `TP38`→U11, `TP39`→J42, `TP40`→U11, `TP41`→U11.

**To re-run the placer** (after changing a coordinate in
`tools/placeboard.py`, with KiCad's PCB editor **closed**):

```
python3 tools/placeboard.py hardware/pro/propmesh/propmesh.kicad_pcb /tmp/placed.kicad_pcb /tmp/report.md
# inspect, then copy /tmp/placed.kicad_pcb over the board file
```

It edits footprint positions/rotations only (pad and field angles are
rotated with the part — KiCad 10 stores them as absolute angles), locks
the outline, and never touches nets or tracks.

## A8. Block regions — where each sheet's parts go (the packer used exactly these)

Each of the following steps names its region as a range of **Position
X** and **Position Y** (board coordinates, per A3). All of them in one
table:

| Step | Block | **Position X** range | **Position Y** range |
|---|---|---|---|
| A9 | MCU + USB support parts | 14–60 | 1–22 |
| A10 | Power chain | 15–42 | 58–89 |
| A11 | DC-output switches (column) | 8–15 | 36–84 |
| A12 | Audio | 14–42 | 22–48 |
| A13 | PCA9685 + servos + ULN2003 | 42–62 | 22–70 |
| A14 | Stepper sockets + straps | 60–100 | 26–70 |
| A15 | DRV8871 pair | 82–102 | 74–88 |
| A16 | Relays (coils) + ULN2003 | 100–118 | 32–80 |
| A17 | LED shifter | 42–82 | 72–90 |
| A18 | Sensors + expansion | 94–123 | 2–36 |
| A19 | Test points | gaps everywhere | |

The picture (board as it lies in the box, lid above the top edge):

```
        U2 module   J1 USB  Card1 SD  SW1 SW2  LED1 D10 D11      [sensors J42 J40 / J41 J44 / J43 J45  J46]
  ┌────────────────────────────────────────────────────────────────────────────────┐
CN1│  ▲ U.FL      MCU support C1-C3 R3 R4 U1 D1 R1 R2 TP1          J47 Qwiic ─────┤
J35│  AUDIO U9 U10 + caps        PCA9685 U4 + straps                              │J14
J8 │  FB1 FB2 C30 C31            servos J2–J7      STEPPER SOCKETS      K1 K2 K3 │J15
J9 │  Q1..Q6                     ULN2003 U3        J19/J20   J24/J22            │
J10│  D2..D7                                       (rows 12.70 mm apart)        │J16
J11│  (output FETs)                                straps J29–J34, J21 J26, JP1/2│
J12│  POWER  F1 Q7 D8 D9 C11                  DRV8871 U7 U8 + C20–C23   U3 →K   │
J13│         U5 L1 C7 C12 C9 C10   LED U11 C42  C43 ▪ C45 ▪   R22 R24            │
   │         U6 L2 C15 C16  J48 J49 J50  R34–R37 at terminals                    │
  └────────────────────────────────────────────────────────────────────────────────┘
     J18 J17     J38 J37  J39 J36              J23 J28
     DC in       strip 1  strip 2              motors
```

**Placement rule behind every row of the tables below: a decoupling
cap belongs at the pin it serves, on the same layer, with the shortest
possible loop to that chip's ground pin** — not "somewhere on the
rail". Distances are edge-to-edge. Spec names are in parentheses where
the sheet docs use them.

## A9. MCU + USB — a suggested arrangement (`hardware/pro/placement-mcu.csv`, apply only if you want it)

Why these moved after the first placement: the module's USB pins (13,
14) are on its **left** side, and the connector had been put on its
right — the D+/D− pair would have had to go under the module. Now the
connector is left of the module and the pair runs 12 mm on the top
layer through the ESD chip.

| Part | **Position X** | **Position Y** | **Orientation** | Why there |
|---|---|---|---|---|
| `J1` | 17 | 4.8 | 180 | USB-C at the top edge; opening across the edge; 0.5 mm overhang is normal |
| `U2` | 36 | 11 | 0 | ESP32-S3 module; U.FL end at the top edge; left-side pins at x 27.25 |
| `U1` | 22.5 | 14.5 | 0 | USBLC6 ESD between J1 and the module USB pins; flow-through (1/6 D- and 3/4 D+) |
| `C2` | 24.5 | 3.7 | 0 | 100 nF at module pin 2 (3V3) - nearest |
| `C3` | 24.5 | 6.2 | 0 | 10 uF at module pin 2 (3V3) |
| `R3` | 24.5 | 8.7 | 0 | EN pull-up at module pin 3 |
| `C1` | 24.5 | 10.7 | 0 | EN cap at module pin 3 |
| `D1` | 16 | 12.5 | 0 | SS34 VBUS -> +5V under the connector |
| `R1` | 13.5 | 16.5 | 0 | CC1 5.1k pulldown |
| `R2` | 17 | 16.5 | 0 | CC2 5.1k pulldown |
| `R4` | 76 | 9.5 | 0 | BOOT pull-up beside SW2 (was under the module after the move) |

Rules the table already obeys: the 100 nF nearest the pin, the 10 µF
behind it; the ESD chip flow-through in the pair's path; CC pulldowns
at the connector; nothing under the U.FL end. **3V3 feed to pin 2:
≥ 0.64 mm wide** with the 10 µF before the pin. **Centre ground pad
(pin 41): the footprint already carries 9 thermal vias** (DRC flags
their 0.2 mm drill — A25).

## A10. Power chain — a suggested arrangement (`hardware/pro/placement-power.csv`, apply only if you want it)

The packer left the power parts in the block in no useful order. This
table is one arrangement that makes the two buck loops and the 10 A
input path short (DRC-clean on a copy, 2026-09-07). Use it, or place
the block your own way keeping the loop rule: input caps at the VIN
pins, inductor at the SW pin, output caps at the inductor's far end,
feedback parts away from the inductor. (The servo row moved
up 3.5 mm and `C43`, `C42`, `R53` moved a few mm to make the room.)

| Part | **Position X** | **Position Y** | **Orientation** | Why there |
|---|---|---|---|---|
| `F1` | 28.5 | 83 | 90 | fuse holder horizontal just above J17/J18; pin 1 VIN_RAW toward J17 |
| `Q7` | 25 | 74.5 | 0 | P-FET: tab (drain) toward F1 pin 2; source pin 3 feeds VIN_PROT |
| `D8` | 33.5 | 73 | 0 | zener gate clamp beside Q7 |
| `R13` | 34 | 76 | 0 | gate resistor beside Q7 |
| `D9` | 33 | 66 | 90 | TVS on VIN_PROT right after Q7 - short loop to GND pour |
| `C11` | 24.5 | 66 | 0 | 100 uF bulk on VIN_PROT |
| `J48` | 21 | 52 | 0 | link VIN_PROT -> VIN_BUCK |
| `U5` | 42 | 57 | 0 | AP64350: VIN pins 2-3 at the bottom edge (y 60) SW pin 8 top-left (y 54) |
| `C7` | 41 | 63 | 0 | 10 uF at U5 VIN - 2 mm below pins 2-3 |
| `C12` | 46 | 62.5 | 0 | 10 uF at U5 VIN |
| `L1` | 33 | 50 | 180 | pin 1 (SW) at the right end next to U5 pin 8 |
| `C10` | 33 | 58 | 0 | 22 uF at L1 output |
| `C9` | 28 | 58 | 0 | 22 uF at L1 output |
| `C6` | 37 | 61 | 90 | bootstrap cap between BST (pin 1) and SW |
| `R15` | 46.5 | 55 | 90 | FB divider lower at FB pin 5 |
| `R14` | 46.5 | 59 | 90 | FB divider upper |
| `J49` | 46.5 | 48.5 | 0 | link 5V_BUCK -> +5V |
| `R16` | 20.5 | 44 | 0 | RT (freq) resistor - small-signal corner |
| `R17` | 23.5 | 44 | 0 | COMP network |
| `C13` | 20.5 | 46.5 | 0 | COMP network |
| `C14` | 23.5 | 46.5 | 0 | COMP network |
| `C8` | 26.5 | 44 | 0 | DNP FB feed-forward pad |
| `U6` | 40 | 67 | 0 | SOT-23-5: pin 1 VIN(+5V) / 2 GND / 3 SW |
| `C15` | 39.5 | 72 | 90 | 10 uF at U6 VIN |
| `L2` | 46.5 | 68.5 | 0 | 2.2 uH at U6 SW |
| `C16` | 37 | 72 | 90 | 22 uF at L2 output |
| `J50` | 53 | 67 | 0 | link 3V3_BUCK -> +3V3 |
| `R19` | 56.5 | 66 | 0 | U6 FB divider |
| `R21` | 56.5 | 63.5 | 0 | U6 FB divider |
| `C17` | 56.5 | 68.5 | 0 | U6 feed-forward cap |
| `C42` | 56.5 | 71.2 | 0 | U11 VCC decoupling at pin 20 (top-right corner of U11) |
| `C43` | 41 | 80 | 0 | strip 1 bulk 1000 uF (origin = pin 1; body spans x 38-49) clear of U11 at x 49 |
| `J2` | 36.5 | 38 | 0 | servo row up 3.5 mm |
| `J3` | 40.5 | 38 | 0 | servo row |
| `J4` | 44.5 | 38 | 0 | servo row |
| `J5` | 48.5 | 38 | 0 | servo row |
| `J6` | 52.5 | 38 | 0 | servo row |
| `J7` | 56.5 | 38 | 0 | servo row |
| `R53` | 59 | 88 | 0 | DNP strap pad on LED_STRIP_1_CLK beside the strip 1 series resistors |

Loop geometry that results (top layer, pad coordinates): `U5` VIN pins
2–3 at (41.4–42.6, 60) with `C7`/`C12` 2 mm below; SW pin 8 at
(40.1, 54) with `L1` pin 1 at (37.75, 50) — 4.6 mm; `L1` pin 2 (28.25,
50) with `C9`/`C10` 6 mm below and the FB divider top `R14` on the
5V_BUCK side. `U6` pin 3 (SW) to `L2` pin 1: 4 mm. `C11`/`D9` sit on
the VIN_PROT pour right after `Q7`'s source pin 3 at (19.9, 76.8).

## A11. DC-output switches — column X 8–15, Y 36–84

Sheet 03's six FET/flyback pairs. **Each `Q1–Q6` SI2356DS with its
`D2–D7` SS34 right at its own terminal `J8–J13`**, SS34 cathode to the
VIN_PROT pour; 2 A per channel → 1 mm traces. Silk `V+ / SW`,
`V+ = SUPPLY VOLTAGE`.

## A12. Audio — region X 14–42, Y 22–48

Sheet 04 (`CN1`, `J35` already at the left edge; `Card1` at the top).

| Part(s) | Put it | Why |
|---|---|---|
| `C28` (C_A1) 10 µF + `C29` (C_A2) 100 nF | at U9 VDD pins 7/8 | |
| `U9` exposed pad | **to the GND layer with vias** | ADI: EP not internally connected; tie to a solid ground plane for heat |
| `U9` outputs → `FB1`/`FB2` → `J35` | **wide, short traces** (100 mΩ costs ~5 % of 2 W) but not long — parasitic C raises quiescent current | ADI "Layout and Grounding" |
| `FB1`/`FB2` beads + `C30`/`C31` 100 pF | **at J35, beads first then caps to GND** | EMI snubber at the cable end |
| `R27` (R_SDM) 620 k | at U9 SD_MODE, short | high-impedance node |
| `U10` supplies | **10 µF + 100 nF at each pin, 100 nF nearest**: `C40`/`C41` at CPVDD (1), `C38`/`C39` at AVDD (8), `C36`/`C37` at DVDD (20), `C25`/`C26` at LDOO (18) | TI Fig. 33 |
| `C24` (C_CP) flying cap | **between CAPP (2) and CAPM (4), as short as physically possible** | charge-pump loop |
| `C27` (C_VNEG) | at VNEG (5) to GND | |
| `R29`/`C32`, `R30`/`C33` output RC | at `CN1`, R first then C to GND | output filter at the connector |
| `R28` (R_XSMT) | at pin 17 | bodge target |
| `C34`/`C35`, `R31–R33`, `TP2` | at `Card1` (top edge): caps at VDD (4), pull-ups beside it, card-detect pad | short SD traces, kept together |
| Whole block | ground fill around all signal traces; **keep digital clock traces away from U10's analog outputs**; keep the block away from the buck SW nodes and the stepper sockets | ADI, TI §12.1 |

## A13. PCA9685, servos, ULN2003 — region X 42–62, Y 22–70

| Part(s) | Put it | Why |
|---|---|---|
| `C5` (C_P1) 100 nF + `C4` (C_P2) 10 µF | at U4 VDD (pin 28) | |
| `R5`/`R6` I²C pull-ups | near U4 | the board's only I²C pull-ups |
| `R7–R12` address straps | beside U4 | rework target if a Qwiic device conflicts |
| `J2–J7` servo headers | in one row along y ≈ 66, on the +5V pour; silk `GND 5V SIG` | 3 A shared rail |
| `U3` ULN2003 | **not here — it goes with the relays (A16)** so its nine coil traces stay short | |

## A14. Stepper sockets and straps — region X 60–100, Y 26–70

| Part(s) | Put it | Why |
|---|---|---|
| Socket 1 = `J19` + `J20`, socket 2 = `J24` + `J22` | rows vertical, **exactly 12.70 mm apart, pin 1 to pin 1**: socket 1 rows at Position X 64 and 76.7, socket 2 rows at Position X 84 and 96.7, each row's pin 1 at Position Y 38. **20 mm of air above** — no tall part within a StepStick's outline plus 3 mm | Pololu md09b geometry; heatsink and airflow |
| `C18` / `C19` 100 µF/63 V | at `J20` / `J22` pin 1 (VMOT), below the sockets | per-socket bulk |
| `J29–J34` MS straps, `J21`/`J26` DIAG aux, `JP1`/`JP2` | in a row below the sockets, reachable with a module inserted. **They interleave: `J29`/`J31`/`J33` belong to socket 1, `J30`/`J32`/`J34` to socket 2** — group them by socket, not by number (verified 2026-09-08) | user-set; silk the defaults from `sheets/06-motors.md` |
| `J25`/`J27` coil XH | above each socket (y ≈ 30), pins order 2B 2A 1A 1B | NEMA17 pigtails; **1.5–2 A per phase → 1 mm** |
| `Q8`, `R26`, `R25`, `R23` | between the sockets | EN inverter, UART, DIAG series R |

## A15. DRV8871 pair — region X 82–102, Y 74–88

| Part(s) | Put it | Why |
|---|---|---|
| `U7`/`U8` | between the sockets and `J23`/`J28`; **`C20`+`C21` at U7 VM (pin 5), `C22`+`C23` at U8 VM, 100 nF nearest**; **`R22`/`R24` at ILIM (pin 4)** | TI: bulk + ceramic at VM, ILIM short |
| exposed pads | **top GND pour under and around each, a 3 × 3 grid of 0.3 mm vias through the pad, and a GND pour on B.Cu beneath** (copper on the bottom is fine — it is *components* the bottom must not carry). *Verify EP paste vs TI's 2.29 × 3.05 mm first — A20* | TI §10.1 |
| `MA_OUT1/2`, `MB_OUT1/2` | 1 mm to `J23`/`J28` | 2.13 A trip |

## A16. Relays and ULN2003 — region X 100–118, Y 32–80

| Part(s) | Put it | Why |
|---|---|---|
| `K1`, `K2`, `K3` HK4100F | inboard of `J14`/`J15`/`J16`, contacts toward the terminals, coils inward; Position X 108, Position Y 40 / 56 / 72 | contacts carry the user's 30 V/3 A — **NO/COM/NC copper ≥ 1 mm and ≥ 2 mm from logic**; silk `NO\|COM\|NC`, `DRY CONTACT 30V MAX` |
| `U3` ULN2003 | just below K3, about (108, 78) | outputs straight to the coils; internal flyback diodes — COM pin (9) to +5V |

## A17. LED shifter — region X 42–82, Y 72–90

| Part(s) | Put it | Why |
|---|---|---|
| `C43`, `C45` 1000 µF radials | **directly above `J38` and `J39`**, (44, 80) and (66, 80); +/− on silk, pin 1 = + | hot-plug inrush; tall THT — keep them off the stepper heatsink footprint |
| `U11` 74AHCT541 + `C42` (C_LS) 100 nF | about (55, 79) between the radials; C42 at VCC (pin 20) | one cap, one supply pin |
| `R35`, `R34`, `R36`, `R37` 330 Ω | **at the strip terminals `J37` (strip 1) and `J36` (strip 2)**, not at the chip | they damp reflections into the cable |
| `R38` 330 Ω, `C44` (C_ST) | R38 between U11 Y4 and `LED1`; C44 at LED1's VDD (pin 2), up at the top edge | |
| 5 V to the strips | pour from the +5V region to J38/J39 pin 1 | silk **`> 50 px: inject 5 V externally, data only from board`** |

## A18. Sensors, Qwiic, expansion — region X 94–123, Y 2–36

`J47` is at the right edge (A7). The top-entry connectors:

| Part | What | **Position X** | **Position Y** |
|---|---|---|---|
| `J42` | expansion 2×5 header | 98 | 8 |
| `J40` | analog in 1 XH | 109 | 9 |
| `J41` | digital in 1 XH | 106 | 19 |
| `J44` | digital in 2 XH | 116 | 18 |
| `J46` | PIR 3-pin header (parallel to input 1) | 97 | 24 |
| `J43` | analog in 2 XH | 106 | 28 |
| `J45` | digital in 3 XH | 117 | 28 |

Then the protection, at the point of entry:

| Part(s) | Put it | Why |
|---|---|---|
| `D12`/`D13`/`D14` BAT54S + `R40`/`R47`/`R52` 1 k | **at `J41`/`J44`/`J45`** — clamp first, then the series R, then the trace to the MCU | protect where the wire comes in |
| `R39`/`R48`/`R51` 10 k pull-ups | beside the series Rs | |
| `R42`/`R41`, `R50`/`R49` dividers | at `J40`/`J43`; **`C46`/`C47` at the MCU end of the tap trace** | filter where the ADC samples |
| `R43`/`R45` 100 Ω + `R46`/`R44` 10 k | at `J42`; silk **`KEEP LOW AT RESET`** at pins 4/5 | strapping pins |
| All six sensor headers | silk **`5V\|GND\|SIG`** | |

## A19. Test points — DONE, on the bottom beside their nets

`tools/placetps.py` put all 41 on B.Cu beside the pad that carries
their net, net name on the bottom silk, spacing per the pogo-rig rules
in `sheets/08-testpoints.md`. They are re-placed automatically whenever
that script is re-run after parts move. Each one needs a **via** at
routing time (A23 step 14).

## A20. Before routing — four things, in this order

1. **Finish the placement by hand.** If you want either suggested
   block (A9, A10) applied as-is, close KiCad and say so — otherwise
   they stay on paper. When the board is the way you want it, close
   KiCad and say so once: `tools/placetps.py` re-places the test
   points beside their nets on the bottom, and the A22 zone corners
   get re-derived from the real positions.
2. **One schematic label.** The net between `F1` pin 2 and `Q7`'s tab
   (drain) is auto-named `Net-(Q7-D)`; the HighCurrent net class only
   catches `VIN_*`. Schematic sheet 01: place a **local label** (hotkey
   **L**) reading `VIN_FUSED` on that wire, save, **F8** (Update PCB
   from Schematic). Nothing moves; the net gets its 3 mm class.
3. **The ⚠ list** (each is a footprint check, not a move):
   - [ ] `J47` Qwiic clone (ZX-SH1.0-4PWT) drawing measured against the
         `JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal` footprint
   - [ ] `U7`/`U8` DRV8871 exposed-pad paste opening vs TI's 2.29 × 3.05 mm
   - [ ] `J17` pad ring ≥ 2.8 mm (edit the footprint copy in `propmesh.pretty`)
   - [ ] Socket rows exactly 12.70 mm — **Ctrl+Shift+M** (Measure): J19→J20 and J24→J22 pin 1 to pin 1
   - [ ] **Alt+3** pass: nothing tall inside the socket outlines, the module's U.FL at the edge, radials upright
4. **Lock** the edge connectors, the module, the sockets and the relays
   (drag-select each group → right-click → **Locking → Lock**), **Cmd+S**,
   `python3 tools/checksetup.py`.

## A21. Pre-defined track and via sizes (once)

**File → Board Setup… → Design Rules → Pre-defined Sizes.** Two tables.
In *Track Widths* add rows **0.5**, **1.0**, **1.5**, **3.0** (mm). In
*Via Sizes* add one row: **Via Size 0.8**, **Via Hole 0.4**. OK. These
appear in the top toolbar's **Track:** and **Via:** dropdowns while
routing; the first entry, *use netclass width*, is what you leave
selected for everything not listed as a special width in A23.

## A22. Zones (the pours)

A zone is a copper area on one net that floods everything inside its
outline except other nets' copper (clearance is automatic). All the
board's power distribution is zones; tracks are for signals and for
the short buck loops.

**How to draw one.** Right toolbar, button with tooltip **Add filled
zone**. Click the first corner: the *Copper Zone Properties* dialog
opens first. Set the fields below, OK, then click the remaining
corners in order and double-click the last one to close the outline.
Corners are typed as board coordinates by watching the status bar (grid
**0.5 mm**, A3 origin). Fill with **B** (Edit → Fill All Zones);
**re-fill after every move**. To edit later: double-click the zone's
edge (Edit Zone Properties).

Common fields for every zone: **Fill type:** Solid fill; **Clearance:**
0.3; **Minimum width:** 0.25; **Remove islands:** Always; **Thermal
relief gap:** 0.3; **Thermal spoke width:** 0.5. The two that change
per zone are **Pad connections:** and **Zone Priority** (higher wins
where two zones overlap).

**The corner lists below were computed for the placement as it stood
on 2026-09-07 night.** What each zone must *reach* is the fixed part;
the corners get re-derived after your edit pass (say so and they are).

| # | **Layer:** | **Net:** | **Zone name:** | **Pad connections:** | **Zone Priority** | Corners, in order (board mm) |
|---|---|---|---|---|---|---|
| Z1 | GND (In1.Cu) | `GND` | GND_plane | Thermal reliefs | 0 | (0.5,0.5) (129.5,0.5) (129.5,99.5) (0.5,99.5) — **the whole board, never split** |
| Z2 | PWR (In2.Cu) | `VIN_PROT` | VINPROT_region | Solid | 1 | (0.5,34) (19,34) (19,42) (44,42) (44,49) (60,49) (60,20) (100,20) (100,99.5) (74,99.5) (74,71) (48,71) (48,74) (38,74) (38,86) (0.5,86) |
| Z3 | PWR (In2.Cu) | `+5V` | 5V_region | Solid | 1 | (27.5,0.5) (129.5,0.5) (129.5,99.5) (100.5,99.5) (100.5,19.5) (60.5,19.5) (60.5,48.5) (44.5,48.5) (44.5,41.5) (19.5,41.5) (19.5,34.5) (27.5,34.5) |
| Z4 | PWR (In2.Cu) | `+3V3` | 3V3_region | Solid | 1 | (0.5,0.5) (27,0.5) (27,33.5) (0.5,33.5) |
| Z5 | PWR (In2.Cu) | `+5V` | 5V_south | Solid | 1 | (38.5,74.5) (73.5,74.5) (73.5,99.5) (38.5,99.5) — an island; stitched to Z9 with vias (A23 step 4) |
| Z6 | F.Cu | `GND` | GND_top | Thermal reliefs | 0 | (0.5,0.5) (129.5,0.5) (129.5,99.5) (0.5,99.5) |
| Z7 | F.Cu | `VIN_PROT` | VINPROT_top | Solid | 2 | (0.5,34) (19,34) (19,48) (38,48) (38,78) (19,78) (19,84) (0.5,84) — the 10 A path: `Q7` source, `D9`, `C11`, `J48` pin 1, all six `J8–J13` pin 1 |
| Z8 | F.Cu | `VIN_RAW` | VINRAW_top | Solid | 3 | (12,84.5) (36,84.5) (36,99.5) (12,99.5) — `J17` pin 1, `J18` pin 1, `F1` pin 1 |
| Z9 | F.Cu | `+5V` | 5V_top | Solid | 2 | (44,47.5) (58,47.5) (58,74) (73.5,74) (73.5,99.5) (38.5,99.5) (38.5,66) (48,66) (48,52) (44,52) — `J49` pin 1 down under `U11` to `C43`, `C45`, `J38`/`J39` pin 1, and west to `C15`/`U6` |

Why the In2 map looks like that: VIN_PROT must reach the six output
switches (left column), the input parts (bottom-left), both stepper
VMOT pins and both DRV8871 VM pins (centre/right) as one piece; +5V
gets the top band, the whole east (relay coils, sensor 5 V pins, U3)
and the LED block; +3V3 gets the module corner. Parts sitting over the
"wrong" region (U4, Card1, the sockets' VDD pins, the sensor pull-ups,
J47) are fed by 1.0 mm tracks — In2 is distribution, not the last
hop. Solid vs thermal reliefs: the through-hole pins that land in Z7/Z8
(`J8–J13` pin 1, `J17`, `J18`, `F1`) will need a hot iron — that is the
price of the 10 A path.

**Exposed pads.** `U5` (pin 9), `U7`, `U8`: a **3 × 3 grid of vias,
0.6 / 0.3**, inside each pad, 1.0 mm pitch — A23 step 3 says how to
place a via. **`U9` is the exception (corrected 2026-09-16): its pad is
only 1.5 × 1.5 mm, so a 3 × 3 grid does not fit — use ONE 0.6/0.3 via
in the pad centre.**

## A23. Routing — order, layer, width

The order, layers and widths here are the fixed part. **Pad
coordinates and via positions quoted in the steps are from the
2026-09-07 placement** — read them as "which pad", and take the numbers
from the board in front of you.

The router: press **X** on a pad (Route Single Track), click to lay
corners, click the destination pad. **V** mid-route places a via and
switches layer; **+ / −** switch the active layer; **Esc** abandons.
The width comes from the net class (**Track:** dropdown at *use
netclass width*); where a step says "1.5 mm" or "3 mm", pick that
entry in the **Track:** dropdown for those tracks only, then put it
back. **Route → Interactive Router Settings…**: mode **Walk around**
(politer than Shove for a first board). **`** (backtick) with a pad
selected highlights its whole net; **Show Ratsnest** (Appearance panel,
Objects tab) draws the unrouted lines. A free via: right toolbar button
**Add Vias** (tooltip *Place free-standing vias*), click to drop.
Rules that never bend: nothing routed on **In1 (GND)**; no track under
`L1`/`L2` or across the SW pads on any layer; relay contact copper
≥ 2 mm from logic; bottom copper stays sparse (bodge canvas).

1. **5 V buck loop, top layer, first.** `C7` pin 1 and `C12` pin 1 →
   `U5` pins 2 and 3 (VIN_BUCK), **1.0 mm**, straight up. `C7`/`C12`
   pin 2 → `U5` pin 7 and pad 9 (GND) — `Z6` does this; add one **0.6/0.3
   via** at each of those cap GND pads to `Z1`. `U5` pin 8 (SW) → `L1`
   pin 1: **1.5 mm**, the shortest straight line; nothing else touches
   this node except `C6` pin 2. `C6` pin 1 → `U5` pin 1 (BST): 0.25.
   `L1` pin 2 → `C10` pin 1 → `C9` pin 1 → `J49` pin 2 (5V_BUCK):
   **1.5 mm**; `R14` pin 1 taps this at `C9`. `C9`/`C10` pin 2: GND via
   each. `R15` pin 1 / `R14` pin 2 junction → `U5` pin 5 (FB): 0.25,
   routed up the right side of `U5`, never near `L1`. `R16` → pin 4
   (RT/CLK), `R17`/`C13`/`C14` → pin 6 (COMP): 0.25, on **B.Cu** with a
   via at each end (they sit in the corner at x 20–27, y 44–47).
2. **3V3 buck loop.** `Z9` feeds `C15` pin 1; `C15` pin 1 → `U6` pins 1
   and 4 (+5V), 0.5. `U6` pin 3 (SW) → `L2` pin 1: **1.0 mm** short. `L2`
   pin 2 → `C16` pin 1 → `J50` pin 2 (3V3_BUCK): 1.0. `R19`/`R21`/`C17`
   → `U6` pin 5 (FB): 0.25, away from `L2`. `C15`/`C16` pin 2: GND vias.
3. **Input path.** `Z8` joins `J17` pin 1, `J18` pin 1 and `F1` pin 1.
   `F1` pin 2 → `Q7` tab (pin 2, VIN_FUSED): **3.0 mm**, 8 mm long.
   `Q7` pin 3 (source) is inside `Z7`; `Q7` pin 1 (gate) → `R13` → the
   source, `D8` across gate–source: 0.25. `Z7` to `Z2` stitching:
   **eight 0.8/0.4 vias** in the pour at (10,44) (10,52) (10,60) (10,68)
   (10,76) (30,60) (30,66) (24,70) — all inside both zones.
4. **+5V stitching.** `J49` pin 1 is in `Z9`; drop **four 0.8/0.4 vias**
   at (50,50) (56,50) (50,52) (56,52) to reach `Z3`, and **six** at
   (45,90) (52,90) (62,90) (69,90) (45,76) (69,76) to tie `Z5` to `Z9`.
   +3V3: `J50` pin 1 → **1.0 mm on B.Cu** from (55,67) to a via at
   (26,33) inside `Z4` — the one rail that crosses the board as a track.
5. **USB, top layer, 0.3 mm, 0.2 mm gap, no vias.** At `J1` the pad
   rows interleave: D+ on **B6 (16.25, 8.84)** and **A6 (17.25, 8.84)**,
   D− on **A7 (16.75)** and **B7 (17.75)**. Join B6 to A6 with a 0.25
   loop that goes *up* (toward the shell, y ≈ 7.9) and over A7's pad
   end; join A7 to B7 with a loop that goes *down* (y ≈ 9.8) under A6.
   Then D+ from A6 → `U1` pin 3 (21.36, 15.45) and on from pin 4 (23.64,
   15.45) → `U2` pin 14 (27.25, 19.1); D− from B7 → `U1` pin 1 (21.36,
   13.55) → pin 6 → `U2` pin 13 (27.25, 17.83). Side by side the whole
   way, over solid `Z1`. `U1` pin 5 → `D1` → `Z9` is the VBUS path
   (0.5 mm); `R1`/`R2` → CC pads A5/B5 (0.25).
6. **I²S.** `U2` pins 7, 8, 9 (27.25, 10.0–12.5) → `U9` and `U10` below:
   0.25, top layer, three parallel tracks, ≤ 20 mm.
7. **SD.** `U2` pins 32–34 (44.75, 10–12.5) → `Card1` pads: 0.25, top,
   bundled; `R31–R33` pull-ups at the card end.
8. **LED data/clock.** `U2` pins 4, 5, 6 and 15 → `U11` inputs A0–A3
   (55, 79): these cross the board — **B.Cu**, one via at each end,
   straight runs, staying ≥ 3 mm from `L1`/`L2`. `U11` Y outputs →
   `R34–R37` → `J37`/`J36` pins: top, 0.25. `U11` Y4 → `R38` → `LED1`:
   B.Cu run to the top edge.
9. **Steppers.** `U2` → `J19`/`J24` control pins (STEP, DIR, EN, MS,
   UART, DIAG) and the strap headers: **B.Cu** straight runs, vias at
   the socket end. Coils: `J20` pins 3–6 → `J25`, `J22` pins 3–6 → `J27`:
   **1.0 mm**, top layer, running up the 9 mm gap between the two rows
   of each socket. `J20`/`J22` pin 7 (+3V3): 1.0 from the B.Cu 3V3
   track (step 4).
10. **DRV8871.** `U7`/`U8` pin 5 (VM): two **0.8/0.4 vias** each straight
    into `Z2` beside the pin; `C20`/`C22` pin 1 the same; `C21`/`C23`
    tight to pins 5/6. Outputs pins 6/8 → `J23`/`J28`: **1.0 mm**, top.
    IN1/IN2 from `U2`: B.Cu.
11. **Relays.** `U3` pins 16, 15, 14 → `K1–K3` pin 3 (coil): 0.5, top;
    `K` pin 4 → `Z3` via. `K` pins 1, 2, 5/6 → `J14–J16` pins: **1.0 mm**,
    top, and keep every other net 2 mm away from these.
12. **Outputs.** `Q1–Q6` drain → `J8–J13` pin 2 and the `D2–D7` anode:
    **1.0 mm** top; gates ← `U4` pins: 0.25 on **B.Cu** (six parallel
    runs from (46,27) down the left). `D2–D7` cathode is in `Z7`.
13. **Servos, sensors, I²C, expansion, audio out, Qwiic.** 0.25
    signals, top where short, B.Cu where they cross. The servo +5V bus
    is a **1.5 mm** top track from `Z9` along the row to `J2–J7` pin 2.
    The XH 5 V pins in the north-east tap `Z3` with a via each. The
    north-east 3V3 users (`J42` pin 1, `J47` pin 2, `R39`/`R48`/`R51`,
    `D11`) get their own feed: a **1.0 mm B.Cu** track from `J50` pin 1
    to a via near `J42`, then 0.5 mm top spurs.
14. **Test points last.** Each bottom pad → one **0.6/0.3 via** within
    2 mm → the net (for the ones under a chip pin, the via sits beside
    the top pad and a 0.25 stub joins it). 41 vias.
15. **B** to re-fill, then A25.

## A24. Silkscreen

Right toolbar **Add Text** (or **Draw Text**), layer **F.Silkscreen**
chosen in the *Appearance* panel. Height 1 mm, thickness 0.15 (A1's
defaults). The list is B6 — every line — plus every reference
designator readable and every connector's pin 1 marked. Move the
reference texts DRC complains about (silk over copper/overlaps).

## A25. DRC, 3D, export

- **Inspect → Design Rules Checker → Run DRC.** Zero errors is the bar;
  read each warning individually. Do this before every save you care
  about. Known baseline (not placement/routing problems): `F1`'s
  centre mechanical hole (annular width / padstack), `U2`'s nine 0.2 mm
  thermal-via holes (resolved 2026-10-02: minimum drill 0.2), edge-connector silk clipped by the edge.
- **Alt+3** for the last look (heights, orientation, silk).
- **File → Fabrication Outputs → Gerbers (.gbr)…** (all copper, silk,
  mask, paste, Edge.Cuts; tick *Subtract soldermask from silkscreen*),
  **Drill Files (.drl)…** (Excellon, PTH and NPTH merged), **Component
  Placement (.pos, .gbr)…**; BOM via the JLCPCB plugin — it reads the
  `LCSC Part` field the sheet specs put on every symbol.

---

# Part B — Reference

## B1. Decisions behind the frame

| Item | Decision |
|---|---|
| Outline | **130 × 100 mm**, 3 mm corner radius, `Edge.Cuts` |
| Layers | **4-layer, JLC7628, 1.6 mm, 1 oz outer / 0.5 oz inner**: F.Cu = components + signals + power pours; **In1 `GND` = solid, never split**; In2 `PWR` = `VIN_PROT` / `+5V` / `+3V3` regions; B.Cu = sparse signals only — the bodge canvas (spec §2.6) |
| Mounting holes | **4 × M3 3.2 mm unplated, 5 mm in from each corner → 120 × 90 mm — FROZEN 2026-09-07**; 7 mm keep-out around each |
| Edges | Bottom: DC in, both strips, motors. Left: audio jacks, six DC outputs. Right: Qwiic, relays. Top: USB-C, microSD, buttons, status pixel, U.FL — nothing carrying yard wiring on the top edge (A7 has the fit arithmetic) |
| Component sides | **All parts on the top. Never flip a footprint.** THT parts are top-inserted |
| Antenna | The -1U has **no keep-out zone** (module DS §3.1); keep all copper on all layers clear under the U.FL; that end at the top edge so the pigtail reaches the box wall |
| Design-rule numbers | conservative for JLC 4-layer: 0.25/0.2 signal, 0.6/0.3 via, 0.5 copper-to-edge, 0.15 silk (JLC allows 0.09/0.09 — don't go there on v0.1) |

## B2. Trace widths (IPC-2221, 1 oz outer copper; inner 0.5 oz needs ≈2.5×)

| Current | 10 °C rise | 20 °C rise | Where |
|---|---|---|---|
| 0.5 A | 0.12 mm | 0.08 mm | any signal (use 0.25 anyway) |
| 1 A | 0.30 | 0.20 | +3V3 branches |
| 2 A | 0.78 | 0.51 | DC output channels, coil lines, motor outputs, 5 V branches |
| 3 A | 1.37 | 0.90 | the +5V trunk (buck → J49 → strips/servos) — 1.5 mm or a pour |
| 5 A | 2.77 | 1.82 | VIN_PROT aggregate to the six outputs |
| 7.5 A | 4.84 | 3.18 | worst-case input at 12 V |
| **10 A** | **7.19** | **4.72** | **the input path, sized for the 10 A fuse option — pours** |

Return paths: the buck SW loops must close on the top layer or through
vias directly under the parts — never around the board through the GND
layer alone. Inner-layer copper is half thickness: that is why the
rails are *regions*, not traces, on `PWR`.

## B3. Thermal

| Source | Heat | Treatment |
|---|---|---|
| `U5` AP64350 (5 V at up to 3 A) | ~1.5 W | EP via grid + top pour; no electrolytics touching it |
| `U7`/`U8` DRV8871 (2 A each) | **~2.3 W each at 2 A** (0.565 Ω HS+LS typical → I²R = 2.26 W; was wrongly listed as ~1 W — corrected 2026-09-16) | EP via grids **plus real copper**: top GND pour around each, ≥ 9 vias, and a GND pour on B.Cu under both (exception to "sparse bottom"). Rate the channels **1.5 A continuous / 2 A peak** in the spec until measured in the box |
| Stepper driver modules | user parts with their own heatsinks | the 20 mm air column above the sockets; no THT parts inside a socket's outline |
| `Q1–Q6` SI2356DS at 2 A | **up to 0.28 W each** (70 mΩ max at 2.5 V gate; 40 V part since 2026-09-16) | drain pad on a copper area of ~1 cm² — Vishay's 175 °C/W steady-state figure assumes 1 in² of FR4; ≈ 50 °C rise at 2 A continuous |
| `C43`/`C45` 1000 µF radials | none, but 13 mm tall | keep them and the sockets apart |
| Whole board in a closed box | ~15 W typical | module at the top edge, buck and DRVs bottom — already separated |

## B4. Noise — what must not be near what (by net name)

**The aggressors on this board**, worst first: the two switch nodes
`SW_5V` (`U5` pin 8 → `L1` pin 1) and `SW_3V3` (`U6` pin 3 → `L2` pin 1)
and the bootstrap node `Net-(U5-BST)`/`C6` — fast 12–24 V edges at
~500 kHz–1 MHz; the inductor bodies `L1`, `L2` (magnetic field, all
layers); the stepper drivers in `J19–J22` (choppers at 20–40 kHz, up to
2 A); `U7`/`U8` outputs `MA_OUT1/2`, `MB_OUT1/2` and the coil lines
`S1_*`/`S2_*` (25 kHz at amps); the speaker lines `SPK_P`/`SPK_N`
(300 kHz class-D at amps); the WS2812 lines (MHz square waves).

**Keep-away distances**, edge of copper to edge of copper, and "under"
means any layer including the bottom — the GND plane does not stop the
inductors' magnetic field:

| Victim nets (ours) | Why sensitive | From `SW_*`, `L1`, `L2` | From sockets / `U7` `U8` / `SPK_*` |
|---|---|---|---|
| `ANALOG_IN_1`, `ANALOG_IN_2`, `AN1_RAW`, `AN2_RAW` | ADC inputs, 50 kΩ source impedance — every mV shows | **≥ 10 mm, never under** | ≥ 10 mm |
| `LINE_L`, `LINE_R` (`U10` → `R29`/`R30` → `CN1`) | audio line out, you will *hear* it | ≥ 10 mm, never under | ≥ 8 mm |
| `Net-(U5-FB)`, `Net-(U6-FB)`, `Net-(U5-COMP)`, `Net-(U5-RT/CLK)` | the regulators' own sense nodes; noise here = output ripple | **≥ 3 mm and on the far side of the chip from the inductor** (A10 puts them there) | — |
| `USB_DP`, `USB_DM` | 12 Mbit/s pair, 90 Ω | ≥ 8 mm, never under; over solid GND only | ≥ 8 mm |
| `I2C_SDA`, `I2C_SCL` | open-drain, 4.7 kΩ pull-ups, slow edges | ≥ 5 mm, never under | ≥ 5 mm |
| `I2S_BCLK`, `I2S_LRCLK`, `I2S_DOUT` | clocks into the DAC and amp; also *keep them ≥ 3 mm from `LINE_L/R`* | ≥ 5 mm | ≥ 5 mm |
| `EN` net (`R3`/`C1`), `BOOT_BUTTON`, `LED_STRIP_1_CLK` (GPIO 3 strap), `EXP1_HDR`/`EXP2_HDR` (GPIO 45/46 straps) | a glitch at reset changes boot mode | ≥ 5 mm, never under | ≥ 5 mm |
| `DIGITAL_IN_1..3`, `DI*_RAW` | 10 kΩ pull-ups, long sensor cables | ≥ 5 mm | ≥ 5 mm |
| `TMC_UART_RX`/`TX`, `STEPPER_*_DIAG` | UART and StallGuard flags | ≥ 3 mm | they live there — keep them short |
| `SD_CLK`, `SD_CMD`, `SD_D0`, `Net-(Card1-CD)` | 20–40 MHz bus | ≥ 5 mm; bundled, over GND | ≥ 5 mm |
| `+3V3` into `U2` pin 2 and `U10` pins 1/8/20 | supply to the radio and the DAC's analog side | fed from the plane, with the 10 µF + 100 nF *at the pin* — the ripple filter is the cap, not distance | — |

Not sensitive (route as convenient, even next to the buck): `LED_STRIP_*`
outputs, `STATUS_LED`, `SERVO_*`, `STEPPER_*_STEP/DIR/EN`, `S?_MS?`,
`MOTOR_?_IN?`, `RELAY_?`, relay contact nets, `LED?_K` output returns,
`VIN_*`, `+5V`, `GND`.

**Where that lands on the current placement:** the audio block sits
directly *above* the power block (audio y 22–48, `L1` top at y 45) —
the 8 mm between `L1` and the lowest audio parts is the tightest spot
on the board; nothing from the table's first two rows may be placed or
routed in the band y 42–48, x 27–48. Sensors and USB are at the top
edge, far away. The speaker path `U9` → `FB1`/`FB2` → `J35` runs west at
y ≈ 28–32; keep `LINE_L/R` (`U10` → `CN1`) north of it, not interleaved.
## B5. Patchability (spec §2.6) — the concrete list

- [ ] Sheet 08 test points placed and labelled (A19)
- [ ] `J48`/`J49`/`J50` link headers with shunts: rails come up one at a time
- [ ] `R53` DNP pad on GPIO 3; `R4`/`R46`/`R44` give GPIO 0/45/46 their strap parts
- [ ] `JP1`/`JP2` DIAG solder jumpers reachable with a knife
- [ ] Bottom copper sparse; **no components on the bottom**
- [ ] 0603 minimum; annular rings ≥ 0.15 mm; `J17` ring ≥ 2.8 mm
- [ ] Silk **`PropMesh Pro v0.1  2026-09`**
- [ ] `C8` flagged DNP in KiCad (checked: yes)

## B6. Silkscreen list

| Where | Text |
|---|---|
| `J17`/`J18` | `ONE SUPPLY ONLY`, `12–24V DC`, `+ TIP` at J18, `+`/`−` at J17 |
| `F1` | `7.5A MINI  (10A max)` |
| `J14–J16` | `NO\|COM\|NC`, `DRY CONTACT 30V MAX` |
| `J8–J13` | `V+ / SW`, `V+ = SUPPLY VOLTAGE` |
| `J2–J7` | `GND 5V SIG` |
| `J38`/`J39` | `5V GND`; `J37`/`J36`: `DATA CLK`; beside them: `>50px: inject 5V externally` |
| `C43`/`C45` | `+` at pin 1 |
| `J25`/`J27` | `2B 2A 1A 1B` |
| `J29–J34` | `3V3` at pin 1, `GND` at pin 3, the MS number, and the **default end marked** — socket 1 (`J29`,`J31`,`J33`) all GND; socket 2 `J30` = **3V3**, `J32`/`J34` GND (UART addresses 0 and 1, stealthChop) |
| `J21`/`J26` | `DIAG GND`; `JP1`/`JP2`: `cut = free GPIO42/43` |
| `J23`/`J28` | `MOTOR A`, `MOTOR B` |
| `J40/J41/J43/J44/J45/J46` | `5V GND SIG`, and `AN1 AN2 DI1 DI2 DI3 PIR` |
| `J42` | pin 1 mark, `KEEP LOW AT RESET` at pins 4/5, `3V3 5V GND` |
| `J47` | `QWIIC  GND 3V3 SDA SCL` |
| `J35` | `SPK 4Ω 3W`; `CN1`: `LINE OUT` |
| `SW1`/`SW2` | `RST` / `BOOT` |
| `LED1` | `STATUS`; `D10`/`D11`: `5V` / `3V3` |
| `TP*` | the net name |
| Every connector | pin 1 mark |
| Board | `PropMesh Pro v0.1`, date, `propmesh` URL when there is one |

## B7. Datasheet layout guidance — what was actually read (2026-09-07)

| Part | Source | Verified | Says |
|---|---|---|---|
| AP64350 (`U5`) | DS §10.1 | ✅ | caps + inductor at the IC, FB away from SW, cap grounds to power GND |
| TLV62569 (`U6`) | DS §10.1 | ✅ | same, plus "GND layers might be used for shielding" |
| DRV8871 (`U7`,`U8`) | DS §10.1–10.4 | ✅ | bulk cap on the shortest high-current path; wide traces, many vias; ceramics at pins; thermal pad to top GND + vias to a large bottom GND plane |
| PCM5102A (`U10`) | DS §12.1 | ✅ | shared GND fine; digital clocks away from analog outputs; caps as close as possible |
| ESP32-S3-WROOM-1U (`U2`) | module DS §3.1/§7 + Espressif HW design guidelines | ✅ | **no keep-out on the -1U**; all layers clear under the U.FL; ≥ 9 vias on pin 41; 3V3 ≥ 25 mil with 10 µF; USB 90 Ω diff |
| USBLC6-2SC6 (`U1`) | ST AN §2.3 | ✅ | at the connector; shortest tracks to I/O, VBUS and GND pins |
| PCA9685 (`U4`) | DS | ✅ (nothing to apply) | no layout section; address pins tied by the 10 k straps |
| SN74AHCT541 (`U11`) | DS | ✅ (nothing to apply) | no layout section; one bypass cap at VCC |
| WS2812B-MINI (`LED1`) | DS (measured) | ✅ | "no external components needed"; we keep the 100 nF; land pattern measured |
| MAX98357A (`U9`) | DS "Layout and Grounding" | ✅ | wide output/supply/ground copper; short outputs; EP to a solid GND plane; ground fill around signals; 10 µF + 0.1 µF at VDD |
| HK4100F, DG128/DG381S, XH, SH, TO-252, SOT-23 | — | n/a | mechanical only; footprints verified in the sheet docs |

## B8. Keys (the full list)

| Key | Does |
|---|---|
| `M` | move (pick up on the cursor) — does **not** by itself put a part on grid; see A6 and `tools/snapgrid.py` |
| `R` / `Shift+R` | rotate 90° cw / ccw |
| `F` | flip to the other side — **only for test points** on this board |
| `E` | properties (reference, footprint, lock) |
| `P` | Pack and Move Footprints (selection bunches on the cursor) |
| `L` | lock/unlock the selection |
| `X` | route a track; `V` mid-route drops a via and switches layer |
| `` ` `` | highlight a net (click a pad) |
| `B` / `Ctrl+B` | fill / unfill all zones |
| `Alt+3` | 3D viewer |
| `N` | cycle grid |
| `+` / `-` | switch the active copper layer while routing |
| `Ctrl+F` | find a part by reference |
| `Ctrl+Shift+M` | measure |
| Shift+click a part in the schematic | cross-probe — it highlights on the PCB (and vice versa) |
| **Inspect → Design Rules Checker** | DRC |

**Checker + ERC still apply:** any time the schematic changes during
layout (a missing pull-up, a net renamed), re-run `tools/checknet.py`
for that sheet and ERC, then **F8** (Update PCB from Schematic) again.

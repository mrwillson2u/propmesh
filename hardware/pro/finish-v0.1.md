# Pro v0.1 — finish and order

**Target: order by Sun 5 Oct.** JLCPCB is **closed 1–4 October** (their
September/October 2026 holiday notice) and warns that lead times right
after the closure run longer than usual. Ordering by the 5th puts boards
in the post ≈9–12 Oct and on the bench ≈14–17 Oct: enough to populate,
bring up, and still have a prop in the yard for Halloween if bring-up
behaves. Slipping past mid-October turns the v0.1 field test into a
post-Halloween exercise. **Halloween itself is not at risk either way** —
CLAUDE.md already has the 2026 show running on the old painlessMesh rig
and devkits.

## Where things stand

**Fri 2 Oct, 23:00 — schematic COMPLETE**: eight sheets green, ERC 0/0.

**Fri 2 Oct, 23:40 — board cleanup DONE** (steps 3–4): Board Setup
green; F8 done, schematic parity **0**; orphan `R53` removed; mounting
holes named `H1`–`H4` (board-only, out of BOM/position files); minimum
drill 0.2 mm (clears U2's 12 thermal-via errors at no extra cost); `J17`
and the other DG128-02P terminals widened to 2.8 mm pads; DRV8871 exposed
pads given a 0.1 mm paste inset; 43 parts snapped to grid (socket rows
exempt, still 12.70 mm); library footprints edited to match.

**DRC now: 0 errors except 11 courtyard overlaps.**
- **3 accepted, by design:** `J14`/`J15`, `J15`/`J16`, `J16`/`J28` —
  ganged screw terminals at exact body pitch; the dovetail lugs overlap.
- **8 to fix in placement, all in the sensor corner (top right):** the
  three sensor series resistors grew from 0603 to 1206 (`R40`, `R47`,
  `R52`) and now touch `R39`, `R48`, `R51`, `J41`, `J45`; plus `J44`/`J45`
  and `D14`/`J45`.
- Silkscreen items (≈350) are tidied at step 9.

**Sat 3 Oct, 00:06:** resistor-to-resistor overlaps fixed; 5 left, each
a part touching the bottom of an XH connector (connector courtyards end
at Y 7.20). Exact fixes, typed into *Footprint Properties*:

| Part | Field | Now | Type |
|---|---|---|---|
| `R40` | Position Y | 9.00 | **9.75** |
| `R47` | Position Y | 9.25 | **9.75** |
| `R52` | Position Y | 9.25 | **9.75** |
| `D14` | Position Y | 9.00 | **9.25** |
| `J45` | Position X | 112.75 | **113.00** |

**Sat 3 Oct, 00:15 — PLACEMENT DONE.** The five moves made; test points
re-placed beside their nets (41/41 on B.Cu, farthest 4.5 mm from its pad;
`placetps.py` now finds mounting holes by footprint since they became
`H1`–`H4`). DRC: only the 3 accepted terminal-gang overlaps + silkscreen;
parity 0; setup green.

**Sat 3 Oct, 00:35 — POURS DONE.** Ten zones installed by
`tools/makezones.py` (inner GND plane; inner PWR split into 24 V / 5 V /
3.3 V regions; top GND + 10 A input-path pours; bottom GND under the
motor drivers; U.FL keep-out). DRC: no new errors; unrouted 499 → 383;
parity 0. Backup of the pre-zone board kept.

**Sat 3 Oct, 21:20 — pours re-cut with 0/45/90° outlines** at Colin's
request (the first draft's smoothed curves had 200–380 corners per
region). `tools/makezones.py` now traces the inner split on a 2 mm
grid with straight/diagonal edges only, flips back any pad the coarser
grid lost (`J49` pin 1), and writes `zones-In2-split.png` from the
installed zones. DRC unchanged: 3 accepted courtyard overlaps, parity
0, 383 unrouted. Rule and command in layout.md A22.

Next: **step 6, critical routing** (layout.md A23, and A22's "what the
planes do not reach" track list). Note `layout.md` A22's zone
corner lists were computed for the 7 Sep placement and are stale — the
*what each zone must reach* column still holds.

### As measured Tue 29 Sep

| Area | State |
|---|---|
| Sheets 01, 06 | ✅ green |
| Sheet 03 | nearly done. Remaining: rename the copied strap labels **`A1_STRAP`–`A5_STRAP` on the new chip to `B1_STRAP`–`B5_STRAP`** (the checker sees both chips on one net); place the missing **`R_B0`** (10 k, A0 → **+3V3**); create **`PCA_OE`** — both `~OE` pins still sit on GND and `R_OE` (`R54`) is unconnected; delete the two extra 4.7 k (**`R59`, `R61`**) and the copied `STEPPER_EN_RAW` label on **`U12` pin 22** (the one ERC error) |
| Sheets 02, 04, 05, 07, 08 | not started — `schematic-changes-2026-09-16.md`, ≈50 min total |
| Board Setup | still the same 3 cells |
| Board | 243 footprints, **0 tracks, 0 vias, 0 zones** — placement pass unfinished, nothing routed |
| Git | Pro committed at `0b72f81`; **11 files uncommitted**, mostly the Mini session's work |
| Mini | another session chose the module and started an 8-sheet KiCad project. Per the schedule that is Nov–Dec work; it competes with Pro for the only hours that matter right now |

**Remaining effort on Pro: roughly 8–12 hours of your time.** Split over
the evenings to Sunday, the 5 Oct order holds.

## The list, in order

**Tonight / Wednesday (≈1.5 h) — finish the schematic**

1. ✅ **DONE Sat 19 Sep (`0b72f81`) — unblock git.** Terminal: `sudo xcodebuild -license
   accept` (asks for your Mac password). Tell Claude; Claude commits
   everything since 7 Sep. Two weeks of work is currently one disk
   failure from gone.
2. **Colin, ~1 h — finish the schematic** from
   `schematic-changes-2026-09-16.md` (sheet 03's two deletions above
   first). Then **Claude** runs ERC + all eight checkers.
3. **Colin, 5 min — the three Board Setup cells.** Claude runs `checksetup.py`.
4. **Colin — F8, save, close KiCad.** Then **Claude**, KiCad closed:
   mounting holes renamed `H1`–`H4`; minimum drill set to 0.2 mm (JLC's
   4-layer via drill; clears U2's twelve thermal-via errors); `J17` pad
   ring and the `J47`/DRV8871 footprint checks from A20; everything
   snapped to grid; DRC baseline.
5. **Colin, 2–3 h — placement.** New parts per the changes doc's last
   table; the power block (use `placement-power.csv` or your own, keeping
   the loop rule); USB corner; decoupling at the pins; lock the socket
   rows; gang the screw terminals at exact pitch. Then **Claude**
   re-places the test points and runs DRC.

**Thursday–Saturday (≈6–9 h) — the board**

6. **Colin, 3–5 h — pours and critical routing** (layout.md A22–A23):
   zones; the two buck loops; the 10 A input path; USB pair; motor and
   relay power. These are the nets where layout decides whether the
   board works.
7. **The remaining ~300 signal connections** — the step that decides
   whether this weekend holds. Options:
   - hand-route (a first KiCad board: realistically another full day), or
   - **autoroute the rest with Freerouting**, the open-source router
     KiCad's community uses. It needs Java, which this Mac doesn't have;
     installing it is your call (admin prompt). Claude then runs it on a
     copy with your critical routes locked, and you review the result
     before it touches the real board.
8. **Claude — DRC punch list; Colin fixes.**
9. **Colin, ~1 h — silkscreen** (layout.md B6).
10. **Claude — the order package**, headless: Gerbers, drill files,
    zipped for JLCPCB; plus a **BOM with LCSC numbers and quantities**
    for the parts order (the specs carry every C-number; the schematic
    symbols mostly don't, so it's built from the specs). **Colin** uploads
    and orders: 4 layers, 1.6 mm, stackup JLC7628 (the one in Board
    Setup). A cheap framework-less **stencil** is worth adding for the
    0.5 mm-pitch QFN (U9), the TSSOPs and the module.

**Sunday 5 Oct — order.** Claude produces the Gerbers, drill files and
the LCSC BOM; you upload and order boards + a stencil, and place the
parts order.

**If routing is the thing that slips**, say so on Friday and we take the
autorouter path for the non-critical signals rather than pushing the
order into the post-holiday queue. Cutting board features to save a day
is not needed and not recommended.

# Pro v0.1 — finish and order (weekend of Sat 19 – Sun 20 Sep 2026)

**Why this weekend matters.** CLAUDE.md's schedule puts the Rev-B
decision at about **Oct 10**. A 4-layer JLCPCB order placed Sunday takes
roughly a week to make and ship, so boards land around the start of
October, leaving about a week to populate and bring up before the
decision. Every day of slip comes straight out of bring-up.

## Where things stand (measured Sat 19 Sep)

| Area | State |
|---|---|
| Sheets 01, 06 | ✅ green |
| Sheet 03 | **half-drawn**: the second PCA9685 (`U12`) is placed, but copying `U4`'s block brought its labels along. ERC's one error is the copied `STEPPER_EN_RAW` label now on **`U12` pin 22 (LED15)** — delete it (only `U4` drives stepper enable). Also delete the copied **4.7 k `R59`** (the board has exactly one I²C pull-up pair). Then finish per the changes doc |
| Sheets 02, 04, 05, 07, 08 | not started — `schematic-changes-2026-09-16.md` |
| Board Setup | 3 cells: `/Power/VIN_FUSED` → HighCurrent row; Default **DP Width** 0.3, **DP Gap** 0.2 (`tools/checksetup.py` lists them) |
| Board | last saved 16 Sep; placement pass in progress; **0 tracks, 0 zones** |
| Git | **nothing committed since 7 Sep** — blocked by the Xcode licence prompt |

## The list, in order

**Saturday**

1. **Colin, 2 min — unblock git.** Terminal: `sudo xcodebuild -license
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

**Sunday**

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

**Honest estimate:** 12–18 hours of your time, most of it steps 5–7. If
Sunday night arrives with routing unfinished, ordering Monday or Tuesday
still leaves bring-up before Oct 10. Cutting features to save a day is
not needed.

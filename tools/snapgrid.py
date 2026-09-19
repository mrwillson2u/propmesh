#!/usr/bin/env python3
"""Snap every footprint's anchor onto the grid, measured from the board's Grid Origin.

KiCad's PCB editor has no align-to-grid command, and its object snapping copies
a neighbour's off-grid coordinate into anything aligned with it, so one off-grid
part spreads. This moves each anchor to the nearest grid point (max shift = half
a step) and leaves rotation, side and everything else untouched.

usage (KiCad's python, PCB editor CLOSED):
  /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 \
      tools/snapgrid.py hardware/pro/propmesh/propmesh.kicad_pcb [STEP_MM=0.25] [OUT.kicad_pcb]
"""
import sys
import pcbnew
SRC = sys.argv[1]
STEP = float(sys.argv[2]) if len(sys.argv) > 2 else 0.25
DST = sys.argv[3] if len(sys.argv) > 3 else SRC
b = pcbnew.LoadBoard(SRC); MM = pcbnew.ToMM
go = b.GetDesignSettings().GetGridOrigin(); gx, gy = MM(go.x), MM(go.y)
moved, worst = [], 0.0
for f in b.GetFootprints():
    x, y = MM(f.GetPosition().x) - gx, MM(f.GetPosition().y) - gy
    nx, ny = round(x / STEP) * STEP, round(y / STEP) * STEP
    d = max(abs(nx - x), abs(ny - y))
    if d > 1e-4:
        f.SetPosition(pcbnew.VECTOR2I_MM(nx + gx, ny + gy))
        moved.append((f.GetReference(), x, y, nx, ny)); worst = max(worst, d)
pcbnew.SaveBoard(DST, b)
print(f"{len(moved)} of {len(b.GetFootprints())} footprints moved onto the {STEP} mm grid; largest shift {worst:.3f} mm; saved {DST}")
for r, x, y, nx, ny in sorted(moved)[:400]:
    print(f"  {r:6} ({x:8.3f},{y:8.3f}) -> ({nx:8.3f},{ny:8.3f})")

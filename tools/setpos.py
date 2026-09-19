#!/usr/bin/env python3
"""Apply a placement table (CSV) to the board: ref, x, y, rot  (board coordinates, mm).

Runs on KiCad's own Python so rotations are KiCad's (pads, fields, courtyards all
follow). Only the listed parts move; everything else is left exactly as saved.
Board coordinates = measured from the drill/place origin (layout.md step A3).

usage (PCB editor CLOSED unless writing to a copy):
  /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 \
      tools/setpos.py hardware/pro/propmesh/propmesh.kicad_pcb hardware/pro/placement-power.csv [OUT.kicad_pcb]

CSV: header line, then `ref,x,y,rot,note`; lines starting with # are comments.
"""
import csv, sys
import pcbnew

SRC, CSV = sys.argv[1], sys.argv[2]
DST = sys.argv[3] if len(sys.argv) > 3 else SRC
board = pcbnew.LoadBoard(SRC)
MM = pcbnew.ToMM
ao = board.GetDesignSettings().GetAuxOrigin()
OX, OY = MM(ao.x), MM(ao.y)
fps = {f.GetReference(): f for f in board.GetFootprints()}

moved, missing = [], []
with open(CSV) as fh:
    for row in csv.DictReader(l for l in fh if not l.startswith("#")):
        ref = row["ref"].strip()
        f = fps.get(ref)
        if f is None:
            missing.append(ref); continue
        x, y, rot = float(row["x"]), float(row["y"]), float(row.get("rot") or 0)
        f.SetOrientationDegrees(rot)
        f.SetPosition(pcbnew.VECTOR2I_MM(x + OX, y + OY))
        moved.append((ref, x, y, rot))
pcbnew.SaveBoard(DST, board)
print(f"moved {len(moved)} parts; saved {DST}" + (f"; NOT FOUND: {missing}" if missing else ""))
for ref, x, y, rot in moved:
    print(f"  {ref:5} Position X {x:6.2f}  Position Y {y:6.2f}  Orientation {rot:g}")

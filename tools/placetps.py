#!/usr/bin/env python3
"""Move every test point to the bottom side and beside the pad that carries its net.

Runs on KiCad's own Python (the pcbnew module), so the flip is KiCad's flip.
Rules (hardware/pro/sheets/08-testpoints.md, decision 2026-09-07): bottom-side
surface pads for bodge wires and a pogo-pin rig; >= 2.54 mm between pads,
>= 3 mm from the board edge, >= 2 mm from any through-hole pin, clear of
the mounting holes (fixture alignment pins) and of the U.FL area.

usage (KiCad's python, PCB editor CLOSED):
  /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3 \
      tools/placetps.py hardware/pro/propmesh/propmesh.kicad_pcb [OUT.kicad_pcb]
Without OUT the board is rewritten in place.
"""
import math, sys
import pcbnew

SRC = sys.argv[1]
DST = sys.argv[2] if len(sys.argv) > 2 else SRC
board = pcbnew.LoadBoard(SRC)
MM = pcbnew.ToMM
def V(x, y): return pcbnew.VECTOR2I_MM(x, y)

# mounting holes found by footprint, not reference (they were REF** until 2026-10-02, now H1-H4)
is_hole = lambda f: "MountingHole" in f.GetFPIDAsString()
fps = {f.GetReference(): f for f in board.GetFootprints() if not is_hole(f)}
holes = [f for f in board.GetFootprints() if is_hole(f)]
bb = board.GetBoardEdgesBoundingBox()
X0, Y0, X1, Y1 = MM(bb.GetLeft()), MM(bb.GetTop()), MM(bb.GetRight()), MM(bb.GetBottom())

# ---------------------------------------------------------------- obstacles on the bottom
tht = []   # (x, y, radius) of every through-hole pad / hole
for f in board.GetFootprints():
    for p in f.Pads():
        if p.GetAttribute() in (pcbnew.PAD_ATTRIB_PTH, pcbnew.PAD_ATTRIB_NPTH):
            tht.append((MM(p.GetPosition().x), MM(p.GetPosition().y), max(MM(p.GetSizeX()), MM(p.GetSizeY())) / 2))
hole_centres = [(MM(h.GetPosition().x), MM(h.GetPosition().y)) for h in holes]
u2 = fps["U2"]
u2x, u2y = MM(u2.GetPosition().x), MM(u2.GetPosition().y)
UFL = (u2x - 10, Y0, u2x + 10, u2y - 3)      # antenna/U.FL end of the module: keep all layers clear

TP_HALF, EDGE, PIN_GAP, TP_PITCH, HOLE_KEEP = 0.75, 3.0, 2.0, 2.6, 5.5
placed = []  # (x, y) of placed test points

def ok(x, y):
    if x - TP_HALF < X0 + EDGE or x + TP_HALF > X1 - EDGE or y - TP_HALF < Y0 + EDGE or y + TP_HALF > Y1 - EDGE: return False
    if UFL[0] <= x <= UFL[2] and UFL[1] <= y <= UFL[3]: return False
    for hx, hy in hole_centres:
        if math.hypot(x - hx, y - hy) < HOLE_KEEP: return False
    for tx, ty, r in tht:
        if math.hypot(x - tx, y - ty) < r + TP_HALF + PIN_GAP: return False
    for px, py in placed:   # square courtyards: keep the pitch on both axes
        if abs(x - px) < TP_PITCH and abs(y - py) < TP_PITCH: return False
    return True

# ---------------------------------------------------------------- who owns each net
OVERRIDE = {  # by Value: the part whose pad the test point should sit beside
    "TP_VIN_RAW": "J17", "TP_VIN_PROT": "C11", "TP_5V": "J49", "TP_3V3": "J50",
    "TP_GND_A": "J17", "TP_GND_B": "U2", "TP_CD": "Card1",
}
def pad_on_net(f, net):
    for p in f.Pads():
        if p.GetNetname() == net: return p
    return None

def target_for(tp):
    pad = list(tp.Pads())[0]; net = pad.GetNetname()
    own = OVERRIDE.get(tp.GetValue())
    if own and own in fps:
        f = fps[own]; p = pad_on_net(f, net)
        pos = p.GetPosition() if p else f.GetPosition()
        return own, MM(pos.x), MM(pos.y)
    cands = []
    for ref, f in fps.items():
        if ref.startswith("TP") or f is tp: continue
        p = pad_on_net(f, net)
        if p is None: continue
        area = MM(f.GetCourtyard(pcbnew.F_CrtYd).BBox().GetWidth()) * MM(f.GetCourtyard(pcbnew.F_CrtYd).BBox().GetHeight()) if f.GetCourtyard(pcbnew.F_CrtYd).OutlineCount() else 1
        cands.append(((1 if ref == "U2" else 0, 0 if ref[0] in "JU" else 1, -area), ref, p))
    if not cands:
        return None, MM(tp.GetPosition().x), MM(tp.GetPosition().y)
    cands.sort(key=lambda c: c[0]); _, ref, p = cands[0]
    return ref, MM(p.GetPosition().x), MM(p.GetPosition().y)

def nearest_free(tx, ty):
    for r in [i * 0.5 for i in range(0, 200)]:
        n = max(8, int(2 * math.pi * r / 0.5))
        for k in range(n):
            a = 2 * math.pi * k / n
            x, y = round((tx + r * math.cos(a)) * 2) / 2, round((ty + r * math.sin(a)) * 2) / 2
            if ok(x, y): return x, y
    return None

# ---------------------------------------------------------------- do it
tps = sorted((f for r, f in fps.items() if r.startswith("TP")), key=lambda f: int(f.GetReference()[2:]))
report = []
for tp in tps:
    owner, tx, ty = target_for(tp)
    spot = nearest_free(tx, ty)
    if spot is None:
        report.append((tp.GetReference(), tp.GetValue(), owner, None)); continue
    x, y = spot
    if tp.GetLayer() != pcbnew.B_Cu:
        tp.Flip(tp.GetPosition(), pcbnew.FLIP_DIRECTION_TOP_BOTTOM)
    tp.SetPosition(V(x, y))
    # label: the net name (Value) on the bottom silk, small; hide the meaningless TPnn
    tp.Reference().SetVisible(False)
    val = tp.Value(); val.SetVisible(True)
    val.SetTextSize(pcbnew.VECTOR2I_MM(0.8, 0.8)); val.SetTextThickness(pcbnew.FromMM(0.15))
    val.SetPosition(V(x, y + 1.6))
    placed.append((x, y))
    report.append((tp.GetReference(), tp.GetValue(), owner, (x - X0, y - Y0, math.hypot(x - tx, y - ty))))

pcbnew.SaveBoard(DST, board)
print(f"{len(placed)} of {len(tps)} test points on B.Cu, saved {DST}")
for ref, val, owner, r in report:
    if r is None: print(f"  {ref:5} {val:18} NOT PLACED (owner {owner})")
    else: print(f"  {ref:5} {val:18} by {owner or '-':6} at board ({r[0]:6.2f}, {r[1]:6.2f})  {r[2]:4.1f} mm from its pad")

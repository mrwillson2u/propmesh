#!/usr/bin/env python3
"""Draft the copper zones (pours) for PropMesh Pro v0.1 from the board as placed.

Inner PWR layer (In2): split between VIN_PROT / +5V / +3V3 by where each rail's
real loads are (labels.json from the partition step: nearest heavy load, smoothed,
islands absorbed). Inner GND layer (In1): one uncut plane. Top: GND everywhere
(lowest priority) plus local power pours on the 10 A input path. Bottom: GND only
under the two DRV8871s (heat). Rule area: nothing under the module's U.FL.

usage (KiCad's python, PCB editor CLOSED):
  makezones.py hardware/pro/propmesh/propmesh.kicad_pcb hardware/pro/zones-labels.json [OUT]
The split itself comes from tools/zonesplit.py.
"""
import json, sys
import pcbnew
SRC, LAB = sys.argv[1], sys.argv[2]
DST = sys.argv[3] if len(sys.argv) > 3 else SRC

# Remove zones from an earlier run (name ends "_draft") from the FILE TEXT before KiCad
# loads it. Doing it in-process with BOARD.Remove() corrupts SWIG's type table and later
# lookups return raw pointers (found 2026-10-03). A top-level zone block is "\n\t(zone"
# up to the next "\n\t)" — everything inside is indented deeper.
text = open(SRC).read(); out, pos, dropped = [], 0, 0
while True:
    s = text.find("\n\t(zone", pos)
    if s < 0: out.append(text[pos:]); break
    e = text.find("\n\t)", s) + 3
    blk = text[s:e]
    out.append(text[pos:s])
    if '_draft")' in blk: dropped += 1
    else: out.append(blk)
    pos = e
open(DST, "w").write("".join(out))
print(f"removed {dropped} old _draft zones")

b = pcbnew.LoadBoard(DST); MM = pcbnew.ToMM; F = pcbnew.FromMM
go = b.GetDesignSettings().GetGridOrigin(); GX, GY = go.x, go.y
def P(x, y): return (GX + F(x), GY + F(y))
def rect(x0, y0, x1, y1):
    s = pcbnew.SHAPE_POLY_SET(); s.NewOutline()
    for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)): s.Append(*P(x, y))
    return s
def net(name):
    for n in (name, "/Power/" + name):
        ni = b.FindNet(n)
        if ni: return ni
    raise SystemExit(f"net {name} not found")
def pads(netname, refs=None):
    out = []
    for f in b.GetFootprints():
        if refs and f.GetReference() not in refs: continue
        for p in f.Pads():
            if p.GetNetname().split("/")[-1] == netname:
                bb = p.GetBoundingBox()
                out.append((MM(bb.GetLeft() - GX), MM(bb.GetTop() - GY), MM(bb.GetRight() - GX), MM(bb.GetBottom() - GY)))
    return out
def bbox_of(pp, m):
    return (min(p[0] for p in pp) - m, min(p[1] for p in pp) - m, max(p[2] for p in pp) + m, max(p[3] for p in pp) + m)

made = []
def zone(name, layer, netname, poly, prio, conn):
    z = pcbnew.ZONE(b)
    z.SetLayer(layer); z.SetNet(net(netname)); z.SetZoneName(name)
    z.SetOutline(poly)
    poly.thisown = False      # ZONE::SetOutline keeps the pointer, it does not copy:
                              # let Python free it and SaveBoard crashes (found 2026-10-03)
    z.SetLocalClearance(F(0.3)); z.SetMinThickness(F(0.25))
    z.SetPadConnection(conn); z.SetThermalReliefGap(F(0.3)); z.SetThermalReliefSpokeWidth(F(0.5))
    z.SetAssignedPriority(prio); z.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
    b.Add(z); made.append((name, pcbnew.BOARD.GetStandardLayerName(layer), netname, prio))


FULL, THT = pcbnew.ZONE_CONNECTION_FULL, pcbnew.ZONE_CONNECTION_THT_THERMAL
SMOOTH = 2.0     # mm: octagon radius for the In2 outlines
W, H = 130.0, 100.0

# ---- In1: GND, whole board
zone("GND_In1_draft", pcbnew.In1_Cu, "GND", rect(0, 0, W, H), 0, THT)

# ---- In2: the three-way split
L = json.load(open(LAB)); S = L["S"]; lab = L["lab"]
FORCE = [("+5V", (52, 62, 61, 68))]           # J49 (+5V source, THT) joins the +5V region
for n, (x0, y0, x1, y1) in FORCE:
    for j in range(int(y0 / S), int(y1 / S)):
        for i in range(int(x0 / S), int(x1 / S)): lab[j][i] = n
G = 2.0                                       # mm: outline grid (coarser = straighter edges)
NY, NX = len(lab), len(lab[0]); k = int(round(G / S))
GY_, GX_ = NY // k, NX // k
import collections
coarse = [[collections.Counter(lab[j * k + a][i * k + c] for a in range(k) for c in range(k)).most_common(1)[0][0]
           for i in range(GX_)] for j in range(GY_)]
for _ in range(2):                            # majority smoothing at the coarse grid
    nxt = [row[:] for row in coarse]
    for j in range(GY_):
        for i in range(GX_):
            c = collections.Counter(coarse[jj][ii] for jj in range(max(0, j - 2), min(GY_, j + 3))
                                    for ii in range(max(0, i - 2), min(GX_, i + 3)))
            nxt[j][i] = c.most_common(1)[0][0]
    coarse = nxt

# pads the 1 mm split gave to their own rail but the 2 mm grid took away: flip the cell back
RAILS = ("VIN_PROT", "+5V", "+3V3"); recovered = []
for f in b.GetFootprints():
    for pd in f.Pads():
        nn = pd.GetNetname()
        if nn not in RAILS: continue
        x, y = MM(pd.GetPosition().x) - MM(GX), MM(pd.GetPosition().y) - MM(GY)
        j, i = int(y / G), int(x / G); jf, if_ = int(y / S), int(x / S)
        if not (0 <= j < GY_ and 0 <= i < GX_ and 0 <= jf < NY and 0 <= if_ < NX): continue
        if lab[jf][if_] == nn and coarse[j][i] != nn:
            coarse[j][i] = nn; recovered.append(f"{f.GetReference()}.{pd.GetNumber()} {nn}")
if recovered: print("cells flipped back for pads:", ", ".join(recovered))

def octilinear_loops(n):
    """Marching squares on cell centres: every boundary step is straight across a square
    or diagonal across its corner, so edges can only be 0/45/90/135 degrees.
    Coordinates in half-cells (integers); cell centres sit at odd half-cells, so the
    midpoint between an edge cell and the (empty) outside lands exactly on the board edge."""
    def inside(j, i):                         # outside the board = outside every region,
        if not (0 <= j < GY_ and 0 <= i < GX_): return False   # so outlines close along the edge
        return coarse[j][i] == n
    segs = []
    for j in range(-1, GY_):
        for i in range(-1, GX_):
            a, b2, c, d = inside(j, i), inside(j, i + 1), inside(j + 1, i + 1), inside(j + 1, i)
            # square corners (half-cell units): TL (2i+1,2j+1) TR (2i+3,2j+1) BR (2i+3,2j+3) BL (2i+1,2j+3)
            T, R, B, L = (2*i+2, 2*j+1), (2*i+3, 2*j+2), (2*i+2, 2*j+3), (2*i+1, 2*j+2)
            case = a * 8 + b2 * 4 + c * 2 + d
            table = {1: [(L, B)], 2: [(B, R)], 3: [(L, R)], 4: [(T, R)], 5: [(L, T), (B, R)],
                     6: [(T, B)], 7: [(L, T)], 8: [(T, L)], 9: [(T, B)], 10: [(T, R), (L, B)],
                     11: [(T, R)], 12: [(L, R)], 13: [(B, R)], 14: [(L, B)]}
            segs += table.get(case, [])
    adj = collections.defaultdict(list)
    for p0, p1 in segs: adj[p0].append(p1); adj[p1].append(p0)
    loops, used = [], set()
    for p0, p1 in segs:
        if (p0, p1) in used or (p1, p0) in used: continue
        loop, prev, cur = [p0], p0, p1; used.add((p0, p1))
        while cur != p0:
            loop.append(cur)
            nxt_ = [q for q in adj[cur] if q != prev and (cur, q) not in used and (q, cur) not in used]
            if not nxt_: raise SystemExit(f"{n}: open outline at {cur} - boundary tracing bug")
            used.add((cur, nxt_[0])); prev, cur = cur, nxt_[0]
        out = []                              # drop collinear points
        for q in range(len(loop)):
            a0, a1, a2 = loop[q - 1], loop[q], loop[(q + 1) % len(loop)]
            if (a1[0] - a0[0]) * (a2[1] - a1[1]) != (a1[1] - a0[1]) * (a2[0] - a1[0]): out.append(a1)
        if len(out) >= 3: loops.append([(x * G / 2.0, y * G / 2.0) for x, y in out])
    return loops

def area(l): return sum(l[q - 1][0] * l[q][1] - l[q][0] * l[q - 1][1] for q in range(len(l))) / 2.0
def contains(l, pt):
    x, y = pt; c = False
    for q in range(len(l)):
        (xa, ya), (xb, yb) = l[q - 1], l[q]
        if (ya > y) != (yb > y) and x < xa + (y - ya) * (xb - xa) / (yb - ya): c = not c
    return c
KEPT = {z.GetNetname() for z in b.Zones() if z.GetLayer() == pcbnew.In2_Cu and not z.GetIsRuleArea()}
if KEPT: print("hand-edited In2 zones kept (not rebuilt):", ", ".join(sorted(KEPT)))
for prio, n in ((3, "VIN_PROT"), (2, "+5V"), (1, "+3V3")):
    if n in KEPT: continue                    # a zone renamed away from _draft is Colin's now
    loops = sorted(octilinear_loops(n), key=lambda l: -abs(area(l)))
    loops = [l for l in loops if abs(area(l)) >= 4]
    if not loops: continue
    poly = pcbnew.SHAPE_POLY_SET()
    # a loop inside an odd number of bigger loops is a hole of the nearest one; even = another outer
    depth = [sum(contains(big, l[0]) for big in loops[:q]) for q, l in enumerate(loops)]
    outer_idx = {}
    for q, l in enumerate(loops):
        ch = pcbnew.SHAPE_LINE_CHAIN()
        for x, y in l: ch.Append(*P(x, y))
        ch.SetClosed(True)
        if depth[q] % 2 == 0: outer_idx[q] = poly.AddOutline(ch)
        else:
            parent = max(k for k in outer_idx if contains(loops[k], l[0]))
            poly.AddHole(ch, outer_idx[parent])
    if len(loops) > 1: print(f"  {n}: {len(loops)} loops, depths {depth}")
    # pull back 0.25 mm with MITRED corners, which keep every edge at its angle
    poly.Deflate(F(0.25), pcbnew.CORNER_STRATEGY_ALLOW_ACUTE_CORNERS, F(0.01))
    poly.Simplify()
    for q in range(poly.OutlineCount()):
        one = pcbnew.SHAPE_POLY_SET(); one.AddOutline(poly.Outline(q))
        for hh in range(poly.HoleCount(q)): one.AddHole(poly.Hole(q, hh))
        zone(f"{n.strip('+')}_In2_{q}_draft", pcbnew.In2_Cu, n, one, prio, FULL)

# ---- F.Cu: GND everywhere, lowest priority
zone("GND_top_draft", pcbnew.F_Cu, "GND", rect(0, 0, W, H), 0, THT)
# ---- F.Cu: the 10 A input path as pours
zone("VINRAW_top_draft", pcbnew.F_Cu, "VIN_RAW", rect(*bbox_of(pads("VIN_RAW", {"J17", "J18", "F1"}), 1.5)), 6, FULL)
zone("VINFUSED_top_draft", pcbnew.F_Cu, "VIN_FUSED", rect(*bbox_of(pads("VIN_FUSED", {"F1", "Q7"}), 1.5)), 5, FULL)
zone("VINPROT_top_draft", pcbnew.F_Cu, "VIN_PROT", rect(*bbox_of(pads("VIN_PROT", {"Q7", "C11"}), 2.0)), 4, FULL)
# ---- B.Cu: GND under both DRV8871s for heat (the exception to "sparse bottom")
dd = []
for r in ("U7", "U8"):
    bb = b.FindFootprintByReference(r).GetBoundingBox(False, False)
    dd.append((MM(bb.GetLeft() - GX), MM(bb.GetTop() - GY), MM(bb.GetRight() - GX), MM(bb.GetBottom() - GY)))
zone("GND_bot_DRV_draft", pcbnew.B_Cu, "GND", rect(*bbox_of(dd, 3.0)), 0, FULL)

# ---- rule area: no copper under the module's U.FL, any layer (Espressif -1U guidance)
u2 = b.FindFootprintByReference("U2"); ox, oy = MM(u2.GetPosition().x - GX), MM(u2.GetPosition().y - GY)
ka = pcbnew.ZONE(b); ka.SetIsRuleArea(True); ka.SetZoneName("UFL_keepout_draft")
ka.SetLayerSet(pcbnew.LSET.AllCuMask())
kpoly = rect(ox + 4.7 - 0.5, oy - 8.44 - 0.5, ox + 7.3 + 0.5, oy - 5.84 + 0.5)   # U.FL body + 0.5 mm; clear of pins 37-40 at x +8.3
ka.SetOutline(kpoly); kpoly.thisown = False
ka.SetDoNotAllowTracks(True); ka.SetDoNotAllowVias(True); ka.SetDoNotAllowZoneFills(True)
ka.SetDoNotAllowPads(False); ka.SetDoNotAllowFootprints(False)   # the module itself sits here
b.Add(ka); made.append(("UFL_keepout_draft", "all copper", "-", "-"))

pcbnew.ZONE_FILLER(b).Fill(b.Zones())
pcbnew.SaveBoard(DST, b)
print(f"{len(made)} zones written to {DST}")
for m in made: print("  ", *m)

# ---- picture of the inner split, drawn from the zones just written so it can never drift
# from the board: In2 copper + board edge + top silk, the three rails recoloured.
import os, re, shutil, subprocess, tempfile
KICLI = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
PIC = os.path.join(os.path.dirname(os.path.abspath(LAB)), "zones-In2-split.png")
COLOUR = {"VIN_PROT": "#d04030", "+5V": "#e8b400", "+3V3": "#3070d0"}   # red / yellow / blue
tmp = tempfile.mkdtemp(); svg = os.path.join(tmp, "zones-In2-split.svg")
subprocess.run([KICLI, "pcb", "export", "svg", "--layers", "In2.Cu,Edge.Cuts,F.SilkS", "--page-size-mode", "2",
                "--exclude-drawing-sheet", "-o", svg, DST], check=True, capture_output=True)
bb = b.GetBoardEdgesBoundingBox(); L0, T0 = MM(bb.GetLeft()), MM(bb.GetTop())
zb = []                                       # (net, left, top, right, bottom) in SVG mm
for z in b.Zones():
    if z.GetLayer() == pcbnew.In2_Cu and not z.GetIsRuleArea():
        o = z.Outline().BBox()
        zb.append((z.GetNetname(), MM(o.GetLeft()) - L0, MM(o.GetTop()) - T0, MM(o.GetRight()) - L0, MM(o.GetBottom()) - T0))
def recolour(m):
    nums = [float(v) for v in re.findall(r"-?\d+\.\d+", m.group(2))]
    xs, ys = nums[0::2], nums[1::2]
    if not xs or (max(xs) - min(xs)) * (max(ys) - min(ys)) < 50: return m.group(0)
    for netn, l, tt, r, bt in zb:
        if min(xs) >= l - 0.5 and max(xs) <= r + 0.5 and min(ys) >= tt - 0.5 and max(ys) <= bt + 0.5 \
           and (max(xs) - min(xs)) * (max(ys) - min(ys)) > 0.5 * (r - l) * (bt - tt):
            return m.group(0).replace(m.group(1), COLOUR[netn])
    return m.group(0)
s = open(svg).read()
s = re.sub(r'<path style="fill:(#[0-9A-Fa-f]{6});[^"]*"\s*d="([^"]*)"', recolour, s)
open(svg, "w").write(s)
subprocess.run(["qlmanage", "-t", "-s", "1800", "-o", tmp, svg], capture_output=True)   # macOS QuickLook rasteriser
png = svg + ".png"
if os.path.exists(png): shutil.move(png, PIC); print(f"picture: {PIC}")
else: print(f"picture NOT made (qlmanage); svg kept at {svg}")

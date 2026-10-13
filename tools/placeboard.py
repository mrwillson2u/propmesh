#!/usr/bin/env python3
"""Place every footprint of propmesh.kicad_pcb per hardware/pro/layout.md Part A.

Board coordinates (origin = outline top-left corner) throughout; converted to
page coordinates on write.  Explicit parts get exact centre + rotation; the
rest of each sheet is packed first-fit into that sheet's region rectangles;
test points go beside the part that owns their net.  Also locks the outline
and normalises field text angles for rotated parts.

usage: place.py IN.kicad_pcb OUT.kicad_pcb [report.md]
"""
import math, re, sys
from collections import defaultdict

SRC, DST = sys.argv[1], sys.argv[2]
REPORT = sys.argv[3] if len(sys.argv) > 3 else None
pcb = open(SRC).read()

# ---------------------------------------------------------------- board frame
edge_pts = []
for kind, body in re.findall(r"\n\t\((gr_line|gr_arc)\b(.*?)\n\t\)", pcb, re.S):
    if 'layer "Edge.Cuts"' in body:
        edge_pts += [(float(x), float(y)) for x, y in re.findall(r"\((?:start|end)\s+([0-9.\-]+)\s+([0-9.\-]+)\)", body)]
OX, OY = min(p[0] for p in edge_pts), min(p[1] for p in edge_pts)      # page coords of board corner
BW, BH = max(p[0] for p in edge_pts) - OX, max(p[1] for p in edge_pts) - OY
assert abs(BW - 130) < 0.01 and abs(BH - 100) < 0.01, (BW, BH)

# ---------------------------------------------------------------- footprints
class FP:
    pass

parts = {}
blocks = pcb.split("\n\t(footprint ")
head, fp_blocks = blocks[0], blocks[1:]
for i, b in enumerate(fp_blocks):
    f = FP()
    f.idx = i
    f.name = b.split('"', 2)[1]
    f.ref = re.search(r'\(property "Reference" "([^"]+)"', b).group(1)
    m = re.search(r'\(sheetname "([^"]*)"', b)
    f.sheet = m.group(1) if m else ""
    m = re.search(r"\n\t\t\(at ([0-9.\-]+) ([0-9.\-]+)(?: ([0-9.\-]+))?\)", b)
    f.rot0 = float(m.group(3) or 0)
    pts = []
    for blk in re.findall(r"\(fp_(?:rect|line|poly|circle|arc)\b(.*?)\(layer \"F\.CrtYd\"\)", b, re.S):
        pts += [(float(x), float(y)) for x, y in re.findall(r"\((?:start|end|xy|center)\s+([0-9.\-]+)\s+([0-9.\-]+)\)", blk)]
    if not pts:  # fall back to pad extents
        for blk in re.findall(r"\(pad \"[^\"]*\"(.*?)\n\t\t\)", b, re.S):
            m1 = re.search(r"\(at ([0-9.\-]+) ([0-9.\-]+)", blk); s = re.search(r"\(size ([0-9.\-]+) ([0-9.\-]+)", blk)
            x, y, w, h = float(m1.group(1)), float(m1.group(2)), float(s.group(1)), float(s.group(2))
            pts += [(x - w / 2, y - h / 2), (x + w / 2, y + h / 2)]
    for blk in re.findall(r"\(pad \"[^\"]*\"(.*?)\n\t\t\)", b, re.S):   # pads always count, courtyard or not
        m1 = re.search(r"\(at ([0-9.\-]+) ([0-9.\-]+)", blk); s = re.search(r"\(size ([0-9.\-]+) ([0-9.\-]+)", blk)
        if m1 and s:
            x, y, w, h = float(m1.group(1)), float(m1.group(2)), float(s.group(1)), float(s.group(2))
            d = max(w, h)  # pad may be rotated: use the larger dimension both ways
            pts += [(x - d / 2, y - d / 2), (x + d / 2, y + d / 2)]
    if not pts:
        pts = [(-1, -1), (1, 1)]
    f.bb = (min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts))
    f.nets = []
    for blk in re.findall(r"\(pad \"[^\"]*\"(.*?)\n\t\t\)", b, re.S):
        n = re.search(r'\(net "([^"]*)"\)', blk)
        if n: f.nets.append(n.group(1))
    f.place = None  # (cx, cy, rot) board coords of courtyard centre, or None
    parts[i] = f
byref = {f.ref: f for f in parts.values() if not f.name.startswith('MountingHole')}
assert len(byref) == len(parts) - 4, 'reference collision among placed parts'

def rot_pt(x, y, deg):
    a = math.radians(deg); c, s = math.cos(a), math.sin(a)
    return (x * c + y * s, -x * s + y * c)

def bbox_at(f, cx, cy, rot):
    """world bbox of courtyard when its centre is at (cx, cy), rotated rot."""
    x0, y0, x1, y1 = f.bb
    lcx, lcy = (x0 + x1) / 2, (y0 + y1) / 2
    corners = [rot_pt(x - lcx, y - lcy, rot) for x in (x0, x1) for y in (y0, y1)]
    return (cx + min(c[0] for c in corners), cy + min(c[1] for c in corners),
            cx + max(c[0] for c in corners), cy + max(c[1] for c in corners))

def origin_for(f, cx, cy, rot):
    """footprint origin (board coords) that puts the courtyard centre at (cx, cy)."""
    x0, y0, x1, y1 = f.bb
    dx, dy = rot_pt((x0 + x1) / 2, (y0 + y1) / 2, rot)
    return (cx - dx, cy - dy)

# ---------------------------------------------------------------- explicit placements (centre x, centre y, rotation)
E = {}
def put(ref, cx, cy, rot=0): E[ref] = (cx, cy, rot)

# bottom edge (DG128/DG381S imports: wire entry drawn at +y at rotation 0; barrel jack opening at -x -> rot 90)
put("J18", 18, 94, 90); put("J17", 29, 94.5)
for ref, x in (("J38", 44), ("J37", 55), ("J39", 66), ("J36", 77), ("J23", 90), ("J28", 101)): put(ref, x, 94.5)
# left edge (entry faces -x): PJ-320A nose is at -x at rot 0; DG381S entry +y -> rot 270
put("CN1", 7.5, 24, 0); put("J35", 5.5, 32, 270)
for k, ref in enumerate(("J8", "J9", "J10", "J11", "J12", "J13")): put(ref, 5.5, 40 + 8 * k, 270)
# output FET + flyback stacked beside each terminal (SOT-23 3.9x3.4 over SMA 7.0x3.5, 8 mm pitch)
for k, (q, d) in enumerate((("Q1", "D2"), ("Q2", "D3"), ("Q3", "D4"), ("Q4", "D5"), ("Q5", "D6"), ("Q6", "D7"))):
    yj = 40 + 8 * k
    put(q, 13, yj - 1.9); put(d, 14.5, yj + 2.0)
# right edge (entry faces +x): JST-SH opening is +y at rot 0 -> rot 90; DG128 3P entry +y -> rot 90
put("J47", 126.5, 24, 90)
for k, ref in enumerate(("J14", "J15", "J16")): put(ref, 124.5, 48 + 16 * k, 90)
# top edge
put("U2", 25, 11, 0)                        # U.FL end (-y) toward the top edge
put("J1", 42, 4.8, 180)                     # pins at -y at rot 0 -> opening +y -> flip
put("Card1", 56, 7.5, 180)                  # pins at -y -> card enters from +y -> flip
put("SW1", 68, 5); put("SW2", 76, 5); put("LED1", 84, 5); put("D10", 90, 5); put("D11", 94, 5)
put("R38", 84, 9.5); put("C44", 87.5, 9.5); put("R18", 91, 9.5); put("R20", 94.5, 9.5)
# stepper sockets: origin = pin 1 (EN rows J19/J24 left, VMOT rows J20/J22 right, 12.70 apart)
ORIGIN = {"J19": (64, 43, 0), "J20": (76.7, 43, 0), "J24": (84, 43, 0), "J22": (96.7, 43, 0)}
# straps row under the sockets (1x3 headers, pins along y), DIAG aux 1x2
for ref, x in (("J29", 63), ("J30", 67), ("J31", 71), ("J32", 83), ("J33", 87), ("J34", 91)): put(ref, x, 69)
put("J21", 77, 69); put("J26", 97, 69)
# DRV8871 pair: below their bulk caps, at the motor terminals
put("U7", 84.5, 86.5, 90); put("U8", 95, 86.5, 90)
# relays + ULN2003 (contacts toward the terminals; U3 under K3 by the motor terminal)
for k, ref in enumerate(("K1", "K2", "K3")): put(ref, 108, 48 + 16 * k)
put("U3", 112, 91, 90)
# servo row (top-entry headers, between audio and PCA9685)
for k, ref in enumerate(("J2", "J3", "J4", "J5", "J6", "J7")): put(ref, 36.5 + 4 * k, 44)
# LED block: radials above their power terminals, shifter between them, series Rs at the signal terminals
put("C43", 43, 80); put("C45", 67, 80); put("U11", 55, 79)
put("R35", 52, 88); put("R34", 55.5, 88); put("R36", 75, 88); put("R37", 78.5, 88)
# sensors (top-entry connectors; centre coordinates)
put("J42", 99.5, 8); put("J40", 110, 9); put("J41", 105.5, 19); put("J44", 117, 18)
put("J46", 96.5, 24); put("J43", 105.5, 28); put("J45", 117, 28)

# ---------------------------------------------------------------- occupancy
MARGIN = 0.3
occ = []  # world bboxes (board coords) that are taken
def add_occ(bb): occ.append((bb[0] - MARGIN, bb[1] - MARGIN, bb[2] + MARGIN, bb[3] + MARGIN))
def free(bb):
    if bb[0] < 1.0 or bb[1] < 1.0 or bb[2] > BW - 1.0 or bb[3] > BH - 1.0: return False
    for o in occ:
        if bb[0] < o[2] and bb[2] > o[0] and bb[1] < o[3] and bb[3] > o[1]: return False
    return True
# hole keep-outs (7 mm radius, boxed)
for hx, hy in ((5, 5), (125, 5), (5, 95), (125, 95)):
    occ.append((hx - 7, hy - 7, hx + 7, hy + 7))
# mounting-hole footprints keep their place
for f in parts.values():
    if f.name.startswith("MountingHole"):
        m = re.search(r"\n\t\t\(at ([0-9.\-]+) ([0-9.\-]+)", fp_blocks[f.idx])
        f.keep = True
    else:
        f.keep = False

placed_how = {}
for ref, (cx, cy, rot) in E.items():
    f = byref[ref]; f.place = (cx, cy, rot); add_occ(bbox_at(f, cx, cy, rot)); placed_how[ref] = "exact"
for ref, (ox, oy, rot) in ORIGIN.items():
    f = byref[ref]
    dx, dy = rot_pt((f.bb[0] + f.bb[2]) / 2, (f.bb[1] + f.bb[3]) / 2, rot)
    f.place = (ox + dx, oy + dy, rot); add_occ(bbox_at(f, *f.place)); placed_how[ref] = "exact"

# ---------------------------------------------------------------- packing regions per sheet (board coords)
REGIONS = {
    "/MCU and USB/":      [(36, 10, 50, 22)],
    "/Audio/":            [(50, 16, 64, 22), (19, 22, 42, 42)],
    "/Power/":            [(19, 42, 48, 74), (19, 74, 37.4, 88.2)],
    "/Outputs/":          [(42, 22, 62, 50)],
    "/Motors/":           [(60, 24, 100, 40.9)],
    "/LEDs/":             [(42, 70, 82, 90)],
    "/Sensor Expansion/": [(93, 30, 116, 42.2)],
}
# Card1 support parts belong with the card slot (audio sheet) -> first audio rect is that strip
SD_SUPPORT = {"C34", "C35", "R31", "R32", "R33", "TP2"}
DRV_GROUP = {"U7", "U8", "C20", "C21", "C22", "C23", "R22", "R24"}

def size_key(f):
    return -((f.bb[2] - f.bb[0]) * (f.bb[3] - f.bb[1]))

unplaced = []
def pack(f, rects, rot=0, step=0.5):
    w = f.bb[2] - f.bb[0]; h = f.bb[3] - f.bb[1]
    if rot % 180: w, h = h, w
    for (rx0, ry0, rx1, ry1) in rects:
        y = ry0 + h / 2
        while y + h / 2 <= ry1 + 1e-6:
            x = rx0 + w / 2
            while x + w / 2 <= rx1 + 1e-6:
                bb = bbox_at(f, x, y, rot)
                if free(bb):
                    f.place = (x, y, rot); add_occ(bb); return True
                x += step
            y += step
    return False

for sheet, rects in REGIONS.items():
    todo = [f for f in parts.values() if f.sheet == sheet and f.place is None and not f.keep]
    for f in sorted(todo, key=size_key):
        r = rects
        if sheet == "/Audio/":
            r = [rects[0]] if f.ref in SD_SUPPORT else rects[1:]
        if f.ref in DRV_GROUP:
            r = [(73, 73.5, 100, 88.8)]
        # try the part's natural orientation, then rotated 90
        if pack(f, r, 0) or pack(f, r, 90):
            placed_how[f.ref] = "packed"
        else:
            unplaced.append(f.ref)
            print(f"  could not pack {f.ref} ({f.bb[2]-f.bb[0]:.1f} x {f.bb[3]-f.bb[1]:.1f}) into {r}")

# ---------------------------------------------------------------- test points: beside the owner of their net
def owner_of(tp):
    nets = [n for n in tp.nets if n not in ("GND", "+5V", "+3V3")]
    for n in nets or tp.nets:
        cands = [g for g in parts.values() if g is not tp and g.place and n in g.nets and not g.ref.startswith("TP")]
        if cands:
            # prefer chips / connectors over passives
            # the peripheral end of the net, not the MCU: sockets/connectors/chips first, U2 last
            cands.sort(key=lambda g: (1 if g.ref == "U2" else 0, 0 if g.ref[0] in "JU" else 1, size_key(g)))
            return cands[0]
    return None

tps = [f for f in parts.values() if f.sheet == "/Test Points/" and f.place is None]
for f in sorted(tps, key=lambda f: f.ref):
    own = owner_of(f)
    tx, ty = (own.place[0], own.place[1]) if own else (65, 50)
    w = f.bb[2] - f.bb[0]; h = f.bb[3] - f.bb[1]
    done = False
    for r in [x * 0.5 for x in range(2, 120)]:
        for k in range(0, 36):
            a = 2 * math.pi * k / 36
            x, y = tx + r * math.cos(a), ty + r * math.sin(a)
            x = round(x * 2) / 2; y = round(y * 2) / 2
            bb = bbox_at(f, x, y, 0)
            if free(bb):
                f.place = (x, y, 0); add_occ(bb); placed_how[f.ref] = f"by {own.ref if own else '?'}"; done = True; break
        if done: break
    if not done and pack(f, [(2, 2, 128, 98)]): placed_how[f.ref] = f"anywhere (owner {own.ref if own else 'none'} at {tx:g},{ty:g})"; done = True
    if not done: unplaced.append(f.ref)

# anything still unplaced from other sheets (should be none)
for f in parts.values():
    if f.place is None and not f.keep and f.ref not in unplaced:
        unplaced.append(f.ref)

# ---------------------------------------------------------------- write
def norm_text_angle(a):
    a = a % 360
    if 90 < a <= 270: a -= 180
    return a

out_blocks = []
for f in sorted(parts.values(), key=lambda f: f.idx):
    b = fp_blocks[f.idx]
    if f.place is not None:
        cx, cy, rot = f.place
        ox, oy = origin_for(f, cx, cy, rot)
        px, py = ox + OX, oy + OY
        at = f"\n\t\t(at {px:.4f} {py:.4f}{'' if rot % 360 == 0 else f' {rot % 360:g}'})"
        b, n = re.subn(r"\n\t\t\(at [0-9.\-]+ [0-9.\-]+(?: [0-9.\-]+)?\)", lambda m: at, b, count=1)
        assert n == 1, f.ref
        # field / text angles: absolute in the file -> add the rotation delta, keep readable
        delta = (rot - f.rot0)
        if delta % 360:
            lines = b.split("\n"); in_text = False; in_pad = False
            for j, ln in enumerate(lines):
                if ln.startswith("\t\t(pad "):
                    in_pad = True; continue
                if in_pad and ln.startswith("\t\t\t(at "):
                    m = re.match(r"\t\t\t\(at ([0-9.\-]+) ([0-9.\-]+)(?: ([0-9.\-]+))?\)", ln)
                    a = (float(m.group(3) or 0) + delta) % 360
                    lines[j] = f"\t\t\t(at {m.group(1)} {m.group(2)}{'' if a == 0 else f' {a:g}'})"
                    in_pad = False; continue
                if ln.startswith("\t\t(property ") or ln.startswith("\t\t(fp_text "):
                    in_text = True; continue
                if in_text and ln.startswith("\t\t\t(at "):
                    m = re.match(r"\t\t\t\(at ([0-9.\-]+) ([0-9.\-]+)(?: ([0-9.\-]+))?\)", ln)
                    if m:
                        a = norm_text_angle(float(m.group(3) or 0) + delta)
                        lines[j] = f"\t\t\t(at {m.group(1)} {m.group(2)}{'' if a == 0 else f' {a:g}'})"
                    in_text = False
                elif in_text and ln.startswith("\t\t("):
                    in_text = False
            b = "\n".join(lines)
    out_blocks.append(b)
assert len(out_blocks) == len(fp_blocks), (len(out_blocks), len(fp_blocks))
new = head + "".join("\n\t(footprint " + b for b in out_blocks)
assert new.count("\n\t(footprint ") == pcb.count("\n\t(footprint "), "footprint count changed"

# lock the outline
def lock(m):
    body = m.group(0)
    if "(locked yes)" in body or 'layer "Edge.Cuts"' not in body: return body
    return re.sub(r"(\n\t\t\(end [^)]*\))", r"\1\n\t\t(locked yes)", body, count=1)
new = re.sub(r"\n\t\((?:gr_line|gr_arc)\b.*?\n\t\)", lock, new, flags=re.S)
open(DST, "w").write(new)

# ---------------------------------------------------------------- report
lines = [f"# Placement report\n", f"board corner at page ({OX:g}, {OY:g}); {len(parts)} footprints; unplaced: {unplaced or 'none'}\n"]
lines.append("\n| Ref | Sheet | How | Position X | Position Y | Rot |\n|---|---|---|---|---|---|")
for f in sorted(parts.values(), key=lambda f: (f.sheet, f.ref)):
    if f.place is None: continue
    ox, oy = origin_for(f, *f.place)
    lines.append(f"| {f.ref} | {f.sheet.strip('/')} | {placed_how.get(f.ref,'')} | {ox:.2f} | {oy:.2f} | {f.place[2]:g} |")
if REPORT: open(REPORT, "w").write("\n".join(lines) + "\n")
print(f"placed {sum(1 for f in parts.values() if f.place)} of {len(parts)}; unplaced: {unplaced or 'none'}")

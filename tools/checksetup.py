#!/usr/bin/env python3
"""Verify KiCad Board Setup against hardware/pro/layout.md Part A steps A1–A5.

    python3 tools/checksetup.py            # checks hardware/pro/propmesh

Reads the saved .kicad_pro (rules, net classes, text defaults) and the
.kicad_pcb (stackup, layer names). Every mismatch is printed as the
click-path in the Board Setup dialog: page → table/row → column or
field label exactly as printed on screen → expected vs found. KiCad
only writes these files on save, so save the board first (Cmd+S).
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRO  = ROOT / "hardware/pro/propmesh/propmesh.kicad_pro"
PCB  = ROOT / "hardware/pro/propmesh/propmesh.kicad_pcb"

# ---- expected values: the same numbers as layout.md §1 / §11 -----------
CONSTRAINTS = {  # Design Rules → Constraints: json key -> (section, field label, value)
    "min_clearance":            ("Copper", "Minimum clearance",        0.2),
    "min_track_width":          ("Copper", "Minimum track width",      0.25),
    "min_via_diameter":         ("Copper", "Minimum via diameter",     0.6),
    "min_hole_clearance":       ("Copper", "Copper to hole clearance", 0.25),
    "min_copper_edge_clearance":("Copper", "Copper to edge clearance", 0.5),
    "min_through_hole_diameter":("Holes",  "Minimum drill size",       0.2),   # 0.3 until 2026-10-02: U2's own thermal vias are 0.2/0.6, standard at JLC
    "min_hole_to_hole":         ("Holes",  "Hole to hole clearance",   0.25),
    "min_text_thickness":       ("Silk",   "Minimum text thickness",   0.15),
    "min_text_height":          ("Silk",   "Minimum text height",      0.8),
}
NETCLASSES = {  # Design Rules → Net Classes, table "Netclasses": row -> {column: value}; None = cell must be empty
    "Default":     {"Clearance": 0.2, "Track Width": 0.25, "Via Size": 0.6, "Via Hole": 0.3, "DP Width": 0.3, "DP Gap": 0.2},
    "Power":       {"Clearance": None, "Track Width": 1.0, "Via Size": None, "Via Hole": None},
    "HighCurrent": {"Clearance": 0.3, "Track Width": 3.0, "Via Size": 0.8, "Via Hole": 0.4},
}
COLKEY = {"Clearance": "clearance", "Track Width": "track_width",
          "Via Size": "via_diameter", "Via Hole": "via_drill", "DP Width": "diff_pair_width", "DP Gap": "diff_pair_gap"}
PATTERNS = {  # table "Netclass Assignments": pattern -> net class
    "VIN_*": "HighCurrent", "/Power/VIN_BUCK": "HighCurrent", "/Power/VIN_FUSED": "HighCurrent",
    "+5V": "Power", "+3V3": "Power", "/Power/5V_BUCK": "Power", "/Power/3V3_BUCK": "Power",
    "/Motors/M?_OUT?": "Power", "/Motors/S?_??": "Power",
    "/Outputs/LED?_K": "Power", "/Outputs/REL?_*": "Power",
    "/Audio/SPK_?": "Power", "Net-(U9-OUT?)": "Power",
}
TRACK_WIDTHS = [0.5, 1.0, 1.5, 3.0]          # Design Rules → Pre-defined Sizes → table "Track Widths" (layout.md A21)
VIA_SIZES    = [(0.8, 0.4)]                    # table "Via Sizes": (Via Size, Via Hole)
SILK_DEFAULTS = {  # Text & Graphics → Defaults, row "Silk Layers": json key -> (column, value)
    "silk_line_width":     ("Line Thickness", 0.15),
    "silk_text_size_h":    ("Text Width",     1.0),
    "silk_text_size_v":    ("Text Height",    1.0),
    "silk_text_thickness": ("Text Thickness", 0.15),
}
STACKUP = [  # Board Stackup → Physical Stackup, top to bottom: (layer as printed, thickness mm)
    ("F.Cu", 0.035), ("dielectric 1", 0.2104), ("In1.Cu", 0.0152),
    ("dielectric 2", 1.065), ("In2.Cu", 0.0152), ("dielectric 3", 0.2104), ("B.Cu", 0.035),
]
LAYERS = {  # Board Editor Layers: layer -> (name, type)
    "In1.Cu": ("GND", "power"), "In2.Cu": ("PWR", "power"),
}

def num(v):
    return None if v in (None, "") else float(v)

def main():
    bad = []
    def X(path, expected, found):
        bad.append(f"  {path}\n      expected: {expected}\n      found:    {found}")

    pro = json.loads(PRO.read_text())
    ds  = pro["board"]["design_settings"]
    rules = ds.get("rules", {})
    for k, (sec, label, want) in CONSTRAINTS.items():
        got = num(rules.get(k))
        if got != want:
            X(f"Design Rules → Constraints → section {sec} → field \"{label}\"", want, got)

    d = ds.get("defaults", {})
    for k, (col, want) in SILK_DEFAULTS.items():
        got = num(d.get(k))
        if got != want:
            X(f"Text & Graphics → Defaults → row \"Silk Layers\" → column \"{col}\"", want, got)

    ns = pro.get("net_settings", {})
    classes = {c["name"]: c for c in ns.get("classes", [])}
    for row, cols in NETCLASSES.items():
        c = classes.get(row)
        if c is None:
            X(f"Design Rules → Net Classes → table \"Netclasses\" → row \"{row}\"", "a row with this name", "no such row")
            continue
        for col, want in cols.items():
            got = num(c.get(COLKEY[col]))
            if got != want:
                X(f"Design Rules → Net Classes → table \"Netclasses\" → row \"{row}\" → column \"{col}\"",
                  "(empty)" if want is None else want, "(empty)" if got is None else got)
    for extra in set(classes) - set(NETCLASSES):
        X(f"Design Rules → Net Classes → table \"Netclasses\" → row \"{extra}\"", "not in the guide", "present (delete it or add it to layout.md)")

    have = {a["pattern"]: a["netclass"] for a in ns.get("netclass_patterns", [])}
    for pat, cls in PATTERNS.items():
        if pat not in have:
            X(f"Design Rules → Net Classes → table \"Netclass Assignments\" → column \"Pattern\"", f"a row reading {pat} (Net Class {cls})", "no such row")
        elif have[pat] != cls:
            X(f"Design Rules → Net Classes → table \"Netclass Assignments\" → row \"{pat}\" → column \"Net Class\"", cls, have[pat])
    for pat in set(have) - set(PATTERNS):
        X(f"Design Rules → Net Classes → table \"Netclass Assignments\" → row \"{pat}\"", "not in the guide", f"present ({have[pat]}) — delete it or add it to layout.md")

    tw = sorted(num(w) for w in ds.get("track_widths", []))
    for w in TRACK_WIDTHS:
        if w not in tw:
            X("Design Rules → Pre-defined Sizes → table \"Track Widths\"", f"a row reading {w}", f"rows {tw or '(none — the Track: dropdown then has only \'use netclass width\')'}")
    vs = sorted((num(v.get("diameter")), num(v.get("drill"))) for v in ds.get("via_dimensions", []))
    for d, h in VIA_SIZES:
        if (d, h) not in vs:
            X("Design Rules → Pre-defined Sizes → table \"Via Sizes\"", f"a row with Via Size {d}, Via Hole {h}", f"rows {vs or '(none)'}")

    pcb = PCB.read_text()
    m = re.search(r"\(stackup(.*?)\n\t\t\)\n", pcb, re.S)
    got_stack = []
    for chunk in (m.group(1).split('(layer "')[1:] if m else []):
        name = chunk.split('"', 1)[0]
        th = re.search(r"\(thickness ([0-9.]+)\)", chunk)
        if name in dict(STACKUP):
            got_stack.append((name, num(th.group(1)) if th else None))
    if [n for n, _ in got_stack] != [n for n, _ in STACKUP]:
        X("Board Stackup → Physical Stackup → \"Copper layers\"", "4 (rows F.Cu, In1.Cu, In2.Cu, B.Cu)", [n for n, _ in got_stack] or "no stackup saved")
    else:
        for (n, want), (_, got) in zip(STACKUP, got_stack):
            if got != want:
                X(f"Board Stackup → Physical Stackup → row \"{n}\" → column \"Thickness\"", want, got)
    for lyr, (name, typ) in LAYERS.items():
        mm = re.search(rf'\(\d+ "{re.escape(lyr)}" (\w+)(?: "([^"]*)")?\)', pcb)
        got = (mm.group(2), mm.group(1)) if mm else None
        if got != (name, typ):
            X(f"Board Editor Layers → row \"{lyr}\"", f"name \"{name}\", type \"{typ}\"", got)

    # ---- outline + mounting holes (layout.md §1, §11 steps 7-8) ----
    pts, arcs = [], 0
    for kind, body in re.findall(r"\((gr_line|gr_arc|gr_rect)\b(.*?)\(layer \"Edge.Cuts\"\)", pcb, re.S):
        pts += [(float(x), float(y)) for x, y in re.findall(r"\((?:start|end)\s+([0-9.\-]+)\s+([0-9.\-]+)\)", body)]
        arcs += kind == "gr_arc"
    if not pts:
        # the classic slip: the outline exists but on the layer that was active when it was drawn/converted
        elsewhere = {}
        for kind, body in re.findall(r"\n\t\((gr_line|gr_arc|gr_rect)\b(.*?)\n\t\)", pcb, re.S):
            lm = re.search(r'\(layer "([^"]+)"\)', body)
            if lm:
                elsewhere.setdefault(lm.group(1), []).extend([(float(x), float(y)) for x, y in re.findall(r"\((?:start|end)\s+([0-9.\-]+)\s+([0-9.\-]+)\)", body)])
        hit = [(l, q) for l, q in elsewhere.items() if q and abs(max(x for x, _ in q) - min(x for x, _ in q) - 130) < 0.01 and abs(max(y for _, y in q) - min(y for _, y in q) - 100) < 0.01]
        if hit:
            X("Edge.Cuts outline — every line and arc of it → properties dialog → dropdown \"Layer:\"", "Edge.Cuts",
              f"the 130 x 100 outline is on layer {hit[0][0]} (that layer was active when it was drawn or converted)")
        else:
            X("Edge.Cuts outline", "a 130 x 100 mm rectangle", "nothing drawn on Edge.Cuts")
    else:
        x0, y0 = min(x for x, _ in pts), min(y for _, y in pts)
        w, h = max(x for x, _ in pts) - x0, max(y for _, y in pts) - y0
        if abs(w - 130) > 0.01 or abs(h - 100) > 0.01:
            X("Edge.Cuts outline size", "130 x 100 mm", f"{w:g} x {h:g} mm")
        if arcs != 4:
            X("Edge.Cuts corners (right-click outline → Fillet Lines… → Fillet radius: 3)", "4 arcs (rounded corners)", f"{arcs} arcs" + (" — still a square rectangle" if arcs == 0 else ""))
        edge = [b for k, b in re.findall(r"\n\t\((gr_line|gr_arc)\b(.*?)\n\t\)", pcb, re.S) if 'layer "Edge.Cuts"' in b]
        unlocked = sum("(locked yes)" not in b for b in edge)
        if unlocked:
            X("Outline lock (drag a box around the outline → right-click → Locking → Lock)", "all 8 pieces locked", f"{unlocked} of {len(edge)} pieces unlocked")
        ao = re.search(r"\(aux_axis_origin ([0-9.\-]+) ([0-9.\-]+)\)", pcb)
        if not ao or abs(float(ao.group(1)) - x0) > 0.01 or abs(float(ao.group(2)) - y0) > 0.01:
            X("Drill/place origin (Place → Drill/Place File Origin, click where the status bar reads X %g Y %g)" % (x0, y0),
              f"{x0:g}, {y0:g} (the outline's top-left corner)", "not set — page corner" if not ao else f"{ao.group(1)}, {ao.group(2)}")
        go = re.search(r"\(grid_origin ([0-9.\-]+) ([0-9.\-]+)\)", pcb)
        if not go or abs(float(go.group(1)) - x0) > 0.01 or abs(float(go.group(2)) - y0) > 0.01:
            X("Grid origin (Place → Grid Origin, same point)", f"{x0:g}, {y0:g}", "not set" if not go else f"{go.group(1)}, {go.group(2)}")
        holes = [(float(x), float(y)) for x, y in re.findall(r'\(footprint "MountingHole:MountingHole_3\.2mm_M3".*?\(at ([0-9.\-]+) ([0-9.\-]+)', pcb, re.S)]
        for name, (dx, dy) in {"top-left": (5, 5), "top-right": (125, 5), "bottom-left": (5, 95), "bottom-right": (125, 95)}.items():
            want = (round(x0 + dx, 3), round(y0 + dy, 3))
            if not any(abs(hx - want[0]) < 0.01 and abs(hy - want[1]) < 0.01 for hx, hy in holes):
                near = min(holes, key=lambda h: (h[0]-want[0])**2 + (h[1]-want[1])**2) if holes else None
                X(f"Mounting hole {name} → Footprint Properties → Position X / Position Y (board coordinates, origin at the corner per A3)",
                  f"{dx} / {dy}",
                  "no MountingHole_3.2mm_M3 footprint on the board" if not holes else f"nearest hole at {near[0]-x0:g} / {near[1]-y0:g}")
        if len(holes) > 4:
            X("Mounting holes", "exactly 4 MountingHole_3.2mm_M3 footprints", f"{len(holes)} placed")

    # ---- stepper socket rows: 12.70 mm pin 1 to pin 1 (sheet 06); 12.70 is NOT on a 0.25 grid,
    # so any grid-snap pass silently makes it 12.75 (it did, 2026-09-14)
    rows = {}
    for blk in re.findall(r'\n\t\(footprint "[^"]*PinSocket_1x08[^"]*"(.*?)\n\t\)', pcb, re.S):
        at = re.search(r"\n\t\t\(at ([0-9.\-]+) ([0-9.\-]+)", blk); ref = re.search(r'\(property "Reference" "([^"]+)"', blk)
        if at and ref: rows[ref.group(1)] = (float(at.group(1)), float(at.group(2)))
    for a, b, name in (("J19", "J20", "socket 1"), ("J24", "J22", "socket 2")):
        if a in rows and b in rows:
            d = ((rows[b][0]-rows[a][0])**2 + (rows[b][1]-rows[a][1])**2) ** 0.5
            if abs(d - 12.70) > 0.005:
                X(f"Stepper {name} rows {a}→{b} (Footprint Properties → Position of {b}: {a}'s position + 12.70 along the row axis)", "12.700 mm", f"{d:.3f} mm")

    # ---- test points on the bottom (sheet 08 decision 2026-09-07)
    tps = re.findall(r'\n\t\(footprint "TestPoint:[^"]*"\s*\(layer "([^"]+)"\).*?\(property "Reference" "(TP\d+)"', pcb, re.S)
    top = [r for l, r in tps if l != "B.Cu"]
    if top:
        X("Test points on the bottom (select them → press F)", f"all {len(tps)} on B.Cu", f"{len(top)} still on F.Cu: {' '.join(sorted(top, key=lambda s: int(s[2:])))}")

    if bad:
        print(f"{len(bad)} item(s) differ from layout.md steps A1–A5 (Board Setup cells are under File → Board Setup…; outline and holes are on the board). Fix, Cmd+S, re-run:")
        print("\n".join(bad)); sys.exit(1)
    print("Board matches layout.md steps A1–A5: constraints, 3 net classes, 12 assignments, silk defaults, JLC7628 stackup, GND/PWR inner layers, 130 x 100 outline with rounded corners, origin at the board corner, 4 mounting holes, all test points on the bottom.")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Check a sheet's connection spec against the real KiCad schematic.

    python3 tools/checknet.py hardware/pro/sheets/01-power.net.yaml            # report + NN.check.html
    python3 tools/checknet.py hardware/pro/sheets/01-power.net.yaml --lint     # spec only, no KiCad
    python3 tools/checknet.py hardware/pro/sheets/01-power.net.yaml --mermaid  # write NN.diagram.{md,html}

The spec lists nets as lists of `ref.pin`. Parts are matched to the
schematic BY VALUE (KiCad assigns its own reference designators) and
identical-value parts are interchangeable — which they are. A part still
carrying its symbol's default value (Q_PMOS, Fuse, D_Zener) is matched by
symbol instead, choosing among same-symbol candidates by net overlap, and
reported so the Value gets set. Nets are matched by membership, so
internal nodes need no labels; the named rails are also checked for their
label.

Every run against a schematic also writes NN.check.html: the wiring
diagram coloured by result — green ok, red on the wrong net (the label
says where it actually is), orange right place / wrong value, dashed not
found. Exit 1 on any mismatch, so it can gate a commit.
"""
import argparse, html as _h, itertools, pathlib, re, subprocess, sys, tempfile
from collections import Counter
import xml.etree.ElementTree as ET
import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
KICAD_CLI = "/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli"
DEFAULT_SCH = ROOT / "hardware/pro/propmesh/propmesh.kicad_sch"

# Nets whose NAME must appear in the schematic (power symbols / global labels).
# These span sheets, so the spec lists only THIS sheet's members and the checker
# treats them as a SUBSET of the schematic net — extra members belong to other
# sheets. A sheet's yaml adds its own with a top-level `named:` list (GPIO nets
# carried by global labels). Internal nets stay exact-membership.
POWER_RAILS = frozenset({"GND", "+5V", "+3V3", "VIN_RAW", "VIN_PROT"})
NAMED = set(POWER_RAILS)
DNP_VALUES = {"dnp", "open", "nc", "", "~"}


def norm(v):
    """Normalise a value so '10 µF/100V', '10uF', '10u' all compare equal.
    Numeric values keep only number + SI prefix; part numbers pass through."""
    v = v.strip().lower().replace("µ", "u").replace("ω", "").replace("ohm", "")
    v = re.sub(r"\s+", "", v)
    m = re.match(r"^(\d+(?:\.\d+)?)([pnumkr]?)", v)
    if m and v[0].isdigit():                       # numeric value: keep number + SI prefix
        num, pre = m.group(1), m.group(2)
        return num + ("" if pre == "r" else pre)   # 680R->680, 115k->115k, 10uF/100V->10u
    return v                                        # part number: as-is


def family(symbol):
    """'Device:C_Polarized' -> 'c', 'Device:Q_PMOS' -> 'q': same-family parts can stand in
    for each other with the wrong value (a 22u drawn where the 100u belongs)."""
    return symbol.rsplit(":", 1)[-1].split("_")[0].lower()


def short(net):
    return net.rsplit("/", 1)[-1] if net else "?"


# ---------------------------------------------------------------- inputs
def load_spec(path):
    d = yaml.safe_load(pathlib.Path(path).read_text())
    parts = {r: {**p, "label": str(p["value"]), "value": norm(str(p["value"])),
                 "symbol": p.get("symbol", "")} for r, p in d["parts"].items()}
    nets, errs, seen = {}, [], {}
    for net, pins in d["nets"].items():
        members = []
        for item in pins:
            ref, _, pin = item.partition(".")
            if ref not in parts:
                errs.append(f"net {net}: unknown part '{ref}'"); continue
            if seen.get(item, net) != net:      # same item twice in ONE net is fine
                errs.append(f"{item} is on both {seen[item]} and {net}")  # (multi-pad pins like a USB-C's 4x VBUS)
            seen[item] = net
            members.append((ref, pin.upper()))
        nets[net] = members
    blocks = d.get("blocks") or {"All nets": [n for n in nets if n != "GND"]}
    for title, ns in blocks.items():
        for n in ns:
            if n not in nets: errs.append(f"block '{title}': unknown net '{n}'")
    named = set(d.get("named") or [])
    for n in named:
        if n not in nets: errs.append(f"named: unknown net '{n}'")
    return d["sheet"], parts, nets, blocks, named, errs


def export_netlist(sch):
    out = pathlib.Path(tempfile.mkdtemp()) / "net.xml"
    r = subprocess.run([KICAD_CLI, "sch", "export", "netlist", "--format", "kicadxml",
                        "-o", str(out), str(sch)], capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"kicad-cli failed:\n{r.stderr}")
    return out


def load_schematic(xml_path):
    root = ET.parse(xml_path).getroot()
    comps = {}
    for c in root.findall(".//components/comp"):
        ls = c.find("libsource")
        sp = c.find("sheetpath")
        raw = c.findtext("value") or ""
        comps[c.get("ref")] = {"raw": raw, "value": norm(raw), "footprint": c.findtext("footprint") or "",
                               "sheet": sp.get("names") if sp is not None else "/",
                               "lib": f'{ls.get("lib")}:{ls.get("part")}' if ls is not None else ""}
    nets = {}
    for n in root.findall(".//nets/net"):
        members = []
        for node in n.findall("node"):
            ref = node.get("ref"); num = (node.get("pin") or "").upper()
            pin = (node.get("pinfunction") or "").upper()
            # KiCad 10 emits pinfunction as NAME_<PADNUMBER> ('GND_7', 'VBUS_A4',
            # 'SHIELD_SH', 'S_S') — strip exactly the pad-number suffix, nothing else
            if pin.endswith("_" + num) and len(pin) > len(num) + 1: pin = pin[:-(len(num) + 1)]
            if not pin: pin = num
            if pin.startswith("PIN_") and pin[4:].isdigit(): pin = pin[4:]
            if comps.get(ref, {}).get("value", "") in DNP_VALUES:
                continue                         # unpopulated pads are not connections
            members.append((ref, pin))
        nets[n.get("name")] = members
    return comps, nets


# --------------------------------------------------------------- compare
def overlap(parts, spec_nets, eff, sch_nets):
    scs = [Counter((eff.get(r, "?"), p) for r, p in mem) for mem in sch_nets.values()]
    total = 0
    for want in spec_nets.values():
        wc = Counter((parts[r]["value"], p) for r, p in want if not parts[r].get("dnp"))
        total += max((sum((wc & c).values()) for c in scs), default=0)
    return total


def resolve_parts(parts, spec_nets, comps, sch_nets):
    """sch ref -> the spec value it stands for. By value; else by symbol for parts whose
    Value is still the symbol default, picking among same-symbol candidates by net overlap."""
    spec_vals = {p["value"] for p in parts.values() if not p.get("dnp")}
    eff = {r: c["value"] for r, c in comps.items()}
    renamed = {}
    sch_vals = {c["value"] for c in comps.values()}
    unmatched_spec = [r for r, p in parts.items() if not p.get("dnp") and p["value"] not in sch_vals]
    unmatched_sch = [r for r, c in comps.items() if c["value"] not in spec_vals and c["value"] not in DNP_VALUES]
    by_sym = {}
    for r in unmatched_spec: by_sym.setdefault(parts[r]["symbol"].lower(), []).append(r)
    for sym, srefs in by_sym.items():
        cands = [r for r in unmatched_sch if comps[r]["lib"].lower() == sym]
        if not cands: continue
        slots = cands + [None] * max(0, len(srefs) - len(cands))
        best, best_score = None, -1
        for assign in (itertools.permutations(slots, len(srefs)) if len(srefs) <= 6 else [tuple(slots[:len(srefs)])]):
            trial = dict(eff)
            for sr, cr in zip(srefs, assign):
                if cr: trial[cr] = parts[sr]["value"]
            s = overlap(parts, spec_nets, trial, sch_nets)
            if s > best_score: best, best_score = assign, s
        for sr, cr in zip(srefs, best):
            if cr:
                eff[cr] = parts[sr]["value"]; renamed[cr] = sr; unmatched_sch.remove(cr)
    return eff, renamed


# two-terminal parts with no orientation: spec pin 1/2 may land either way round
SYMMETRIC = {"device:r", "device:c", "device:l", "device:fuse", "switch:sw_push"}


def compare(parts, spec_nets, all_comps, sch_nets):
    """Pair every spec part with ONE schematic part, then compare pin by pin.
    Same-value parts (two 100 k, ten 100 nF) are paired by which assignment puts the
    most pins on the right nets — so a finding names the actual part, not the first
    one with that value. Pairing is SCOPED to the spec's home KiCad sheet (found by
    voting with parts whose value is unique in the schematic), so one sheet's spec
    never pairs with — or reports on — another sheet's components."""
    spec_vals_all = {p["value"] for p in parts.values() if not p.get("dnp")}
    val_count = Counter(c["value"] for c in all_comps.values())
    votes = Counter(c["sheet"] for c in all_comps.values()
                    if c["value"] in spec_vals_all and val_count[c["value"]] <= 2)
    home = votes.most_common(1)[0][0] if votes else None
    comps = {r: c for r, c in all_comps.items() if home is None or c["sheet"] == home}

    eff, renamed = resolve_parts(parts, spec_nets, comps, sch_nets)
    pin_locs = {}                    # (ref, pin-name) -> [net, ...]  (multi-pad pins collect several)
    for n, mem in sch_nets.items():
        if n.startswith("unconnected-"): continue
        for r, p in mem: pin_locs.setdefault((r, p), []).append(n)
    pin_net = {k: v[0] for k, v in pin_locs.items()}
    spec_pins = {}
    for net, want in spec_nets.items():
        for r, p in want: spec_pins.setdefault(r, []).append((net, p))

    def find_named(net):
        """A NAMED net is looked up by its label, exact first, then as a sheet-local path."""
        if net in sch_nets: return net
        return next((n for n in sch_nets if n.endswith("/" + net)), None)

    # value-level guess of which schematic net each spec net is (assignment-independent)
    sch_counters = {n: Counter((eff.get(r, "?"), p) for r, p in mem) for n, mem in sch_nets.items()}
    vclosest = {}
    for net, want in spec_nets.items():
        wc = Counter((parts[r]["value"], p) for r, p in want if not parts[r].get("dnp"))
        best, score = None, -1
        for name, c in sch_counters.items():
            s = sum((wc & c).values())
            if s > score or (s == score and name == net): best, score = name, s
        vclosest[net] = best

    def flip(r, p):
        return ("2" if p == "1" else "1") if parts[r]["symbol"].lower() in SYMMETRIC and p in ("1", "2") else None

    def pscore(r, c):
        ok = 0
        for net, p in spec_pins.get(r, []):
            tgt = vclosest[net]
            if pin_net.get((c, p)) == tgt or (flip(r, p) and pin_net.get((c, flip(r, p))) == tgt): ok += 1
        return ok

    assign = {}                                   # spec ref -> sch ref | None
    for v in {p["value"] for p in parts.values() if not p.get("dnp")}:
        S = [r for r, p in parts.items() if p["value"] == v and not p.get("dnp")]
        C = [c for c in comps if eff[c] == v]
        if len(S) <= 6:
            slots = C + [None] * max(0, len(S) - len(C))
            best, bs = None, -1
            for perm in itertools.permutations(slots, len(S)):
                s = sum(pscore(r, c) for r, c in zip(S, perm) if c)
                if s > bs: best, bs = perm, s
            assign.update(zip(S, best))
        else:                                     # big groups: greedy best-pair-first
            for s, r, c in sorted(((pscore(r, c), r, c) for r in S for c in C), reverse=True):
                if r not in assign and c not in assign.values(): assign[r] = c
            for r in S: assign.setdefault(r, None)

    # an unplaced spec part may be drawn with the WRONG VALUE: an unassigned same-family
    # schematic part sitting on that spec part's nets stands in for it (a 22u where 100u belongs)
    valued = {}
    for r, c in list(assign.items()):
        if c: continue
        fam = family(parts[r]["symbol"])
        cands = [x for x in comps if x not in assign.values() and comps[x]["value"] not in DNP_VALUES
                 and family(comps[x]["lib"]) == fam]
        best, bs = None, 0
        for x in cands:
            s = sum(1 for net, p in spec_pins.get(r, []) if pin_net.get((x, p)) == vclosest[net])
            if s > bs: best, bs = x, s
        if best: assign[r] = best; valued[r] = best

    claimed = {(assign[r], p) for r, pl in spec_pins.items() if assign.get(r) for _, p in pl}
    res = {}
    budget = {k: Counter(v) for k, v in pin_locs.items()}   # consumed as spec pins claim locations
    for net, want in spec_nets.items():
        if net in NAMED:
            best = find_named(net)
        else:
            cnt = Counter(pin_net.get((assign[r], p)) for r, p in want if not parts[r].get("dnp") and assign.get(r))
            cnt.pop(None, None)
            best = max(cnt, key=lambda n: (cnt[n], n == net)) if cnt else (net if net in sch_nets else None)
        pins, score = [], 0
        for r, p in want:
            if parts[r].get("dnp"): pins.append((r, p, "dnp", "")); continue
            c = assign.get(r)
            if not c: pins.append((r, p, "absent", "")); continue
            pool = budget.get((c, p), Counter())
            if best is not None and pool[best] <= 0 and flip(r, p) and budget.get((c, flip(r, p)), Counter())[best] > 0:
                pool = budget[(c, flip(r, p))]        # orientation-free two-terminal part
            if best is not None and pool[best] > 0:
                pool[best] -= 1; score += 1
                if r in valued: pins.append((r, p, "value", f"{c} is {comps[c]['raw']}, spec says {parts[r]['label']}"))
                else: pins.append((r, p, "ok", ""))
            else:
                at = next((n for n, k in pool.items() if k > 0), None)
                if at: pool[at] -= 1
                pins.append((r, p, "wrong", f"on {short(at)}" if at else "unconnected"))
        # extras: only meaningful on exact-membership (unnamed) nets — a NAMED net's
        # surplus members belong to other sheets by design
        extras = [] if net in NAMED or best is None else \
                 [(c, eff.get(c, "?"), p) for c, p in sch_nets[best] if (c, p) not in claimed]
        res[net] = {"closest": best, "score": score, "pins": pins, "extras": extras}

    absent = {r for r, c in assign.items() if not c}
    foreign = [c for c in comps if c not in assign.values() and comps[c]["value"] not in DNP_VALUES]

    # footprints: where the spec gives `footprint:`, the schematic part must carry exactly that
    fps = []
    dnp_pool = [c for c in comps if comps[c]["value"] in DNP_VALUES]
    for r, p in parts.items():
        want = p.get("footprint")
        if not want: continue
        c = assign.get(r)
        if p.get("dnp"):                       # DNP pads are not in the nets; pair by symbol family
            c = next((x for x in dnp_pool if family(comps[x]["lib"]) == family(p["symbol"])), None)
            if c: dnp_pool.remove(c); assign[r] = c
        if c and comps[c]["footprint"].lower() != want.lower():
            fps.append((r, c, comps[c]["footprint"], want))
    return {"nets": res, "renamed": renamed, "absent": absent, "comps": comps, "foreign": foreign,
            "sch": assign, "footprints": fps}


def tag(res, ref):
    """Name a part the way it is labelled ON THE SCHEMATIC — KiCad's own reference
    designator, with the spec's descriptive name after it. KiCad auto-annotates, so
    'C8' is what you can actually find on the sheet; 'C_FF' is only the spec's name."""
    c = res.get("sch", {}).get(ref)
    return f"{c} ({ref})" if c and c != ref else ref


def label_problem(net, closest):
    if closest is None: return "no such net"
    if closest.endswith("/" + net): return "LOCAL label — make it global (Ctrl+L)"
    if net in POWER_RAILS: return f"drawn as {closest} — use the {net} symbol"
    return f"drawn as {closest} — global label must read exactly {net}"


def net_ok(net, r):
    return (not (net in NAMED and r["closest"] != net) and not r["extras"]
            and all(x[2] in ("ok", "dnp") for x in r["pins"]))


def report(parts, res):
    out = []
    for cr, sr in res["renamed"].items():
        out.append(f"!  {cr} has Value '{res['comps'][cr]['raw']}' — that is {sr}; set its Value to {parts[sr]['label']}")
    for net, r in res["nets"].items():
        if net_ok(net, r): out.append(f"✓ {net}"); continue
        head = f"✗ {net}"
        if net in NAMED and r["closest"] != net: head += f" — {label_problem(net, r['closest'])}"
        elif r["score"] <= 0: head += " — nothing matching found"
        out.append(head)
        for ref, pin, st, note in r["pins"]:
            c = res.get("sch", {}).get(ref)
            name = f"{c}.{pin} ({ref})" if c and c != ref else f"{ref}.{pin}"
            if st == "wrong": out.append(f"      {name:<20} ✗ {note}")
            elif st == "value": out.append(f"      {name:<20} ⚠ {note}")
            elif st == "absent": out.append(f"      {name:<20} — {ref} not placed")
        for ref, v, pin in r["extras"]:
            out.append(f"      extra {ref}.{pin} ({res['comps'][ref]['raw']}) — spec has nothing like it here")
    for ref in sorted(res["absent"]):
        out.append(f"✗ {ref} ({parts[ref]['label']}) is not in the schematic — place it")
    for ref in res["foreign"]:
        out.append(f"?  {ref} = '{res['comps'][ref]['raw']}' is not in the spec")
    fps = res.get("footprints", [])
    for r, c, have, want in fps:
        out.append(f"✗ {tag(res, r):<12} footprint " + (f"missing — set {want}" if not have else f"{have} → should be {want}"))
    bad = sum(1 for n, r in res["nets"].items() if not net_ok(n, r))
    clean = not (bad or res["absent"] or res["renamed"] or fps)
    checked_fp = any(p.get("footprint") for p in parts.values())
    out.append("")
    out.append(("ALL NETS MATCH" + (", footprints OK" if checked_fp else "")) if clean
               else f"{bad} net(s) differ" + (f", {len(res['absent'])} part(s) missing" if res["absent"] else "")
               + (f", {len(res['renamed'])} Value(s) unset" if res["renamed"] else "")
               + (f", {len(fps)} footprint(s) wrong or missing" if fps else ""))
    return out, not clean


# ---------------------------------------------------------------- render
CLASSES = """  classDef part fill:#eef3ff,stroke:#2b5fd9,stroke-width:1.5px,color:#111
  classDef net fill:#fff8e1,stroke:#b7791f,color:#111
  classDef rail fill:#ffe0b2,stroke:#e65100,stroke-width:3px,color:#111,font-weight:bold
  classDef badnet fill:#ffe0e0,stroke:#c00,stroke-width:3px,color:#111,font-weight:bold
  classDef absent fill:#fff,stroke:#c00,stroke-width:2px,stroke-dasharray:6 4,color:#c00
  classDef extra fill:#ffecec,stroke:#c00,stroke-width:2px,color:#111
  classDef dnp fill:#f5f5f5,stroke:#999,stroke-dasharray:3 3,color:#666"""
LINK = {"ok": "stroke:#2e8b57,stroke-width:2px", "wrong": "stroke:#c00,stroke-width:3px",
        "value": "stroke:#e08a00,stroke-width:3px", "absent": "stroke:#c00,stroke-dasharray:5 4",
        "extra": "stroke:#c00,stroke-width:2px,stroke-dasharray:5 4", "dnp": "stroke:#999,stroke-dasharray:3 3"}
LEGEND = ("<b>Green</b> = matches the schematic. <b>Red</b> = on the wrong net (the label says where it "
          "actually is). <b>Orange</b> = right place, wrong value. <b>Dashed</b> = not found — place it. "
          "<b>Red box</b> = something on this net the spec does not have.")


def render(sheet, parts, nets, blocks, res=None):
    """Per-block wiring diagrams that read left-to-right along the signal path.
    Nets are processed in yaml order; a part is drawn ENTERING from the first net it
    appears on and LEAVING to later ones, so series parts chain and shunt parts hang
    off their net. A part's GND pin is written into its label instead of drawing GND.
    With a compare result, every edge and box is coloured by status."""
    nid = lambda s: re.sub(r"\W", "_", s)
    gnd = dict(nets.get("GND", []))
    status = {(n, x[0], x[1]): (x[2], x[3]) for n, r in (res or {}).get("nets", {}).items() for x in r["pins"]}
    netnote = {n: label_problem(n, r["closest"]) for n, r in (res or {}).get("nets", {}).items()
               if n in NAMED and r["closest"] != n}
    absent = res["absent"] if res else set()
    has_value_issue = {x[0] for n, r in (res or {}).get("nets", {}).items() for x in r["pins"] if x[2] == "value"}

    def plabel(ref):
        cls = "absent" if ref in absent else "dnp" if parts[ref].get("dnp") else "part"
        g = ""
        if ref in gnd:
            st, note = status.get(("GND", ref, gnd[ref]), (None, ""))
            g = f"<br/><i>pin {gnd[ref]} → GND</i>"
            if st == "wrong" and ref not in has_value_issue:
                g = f'<br/><i style="color:#c00">pin {gnd[ref]} → GND ✗ {note}</i>'
        miss = "<br/>✗ not found" if cls == "absent" else ""
        # on a check page the KiCad reference leads — that is what is printed on the sheet
        c = res["sch"].get(ref) if res else None
        head = f'<b>{c}</b> <span style="color:#666">{ref}</span>' if c and c != ref else f"<b>{ref}</b>"
        return f'P_{nid(ref)}["{head}<br/>{parts[ref]["label"]}{g}{miss}"]:::{cls}'

    out = []
    for title, ns in blocks.items():
        lines = ["graph LR", CLASSES]; edges = []
        entered, declared = set(), set()
        def edge(a, b, text, key): lines.append(f'  {a} --"{text}"--> {b}'); edges.append(key)
        for i, n in enumerate(ns):
            lab = n + (f"<br/>✗ {netnote[n]}" if n in netnote else "")
            lines.append(f'  N_{nid(n)}(["{lab}"]):::{"badnet" if n in netnote else "rail" if n in POWER_RAILS else "net"}')
            for j, (ref, pin) in enumerate(nets[n]):
                if ref not in declared: lines.append("  " + plabel(ref)); declared.add(ref)
                st, note = status.get((n, ref, pin), (None, ""))
                text = pin + {"wrong": f" ✗ {note}", "value": f" ⚠ {note}"}.get(st, "")
                P, N = f"P_{nid(ref)}", f"N_{nid(n)}"
                if (i == 0 and j == 0) or ref in entered: edge(P, N, text, st); entered.add(ref)
                else: edge(N, P, text, st); entered.add(ref)
            if res and res["nets"][n]["score"] > 0:
                for ref, v, pin in res["nets"][n]["extras"]:
                    alias = f" (= spec {res['renamed'][ref]})" if ref in res["renamed"] else ""
                    x = f"X_{nid(n)}_{nid(ref)}"
                    lines.append(f'  {x}["<b>{ref}</b>{alias}<br/>{res["comps"][ref]["raw"]}<br/>✗ not in spec here"]:::extra')
                    edge(f"N_{nid(n)}", x, pin, "extra")
        for key, style in LINK.items():
            idx = [str(k) for k, e in enumerate(edges) if e == key]
            if idx: lines.append(f"  linkStyle {','.join(idx)} {style}")
        out.append((title, ns, "\n".join(lines)))
    return out


def write_pages(spec, sheet, parts, nets, blocks, res=None):
    """--mermaid: NN.diagram.md + NN.diagram.html (clean guide). With res: NN.check.html only."""
    diagrams = render(sheet, parts, nets, blocks, res)
    intro = ("Read each diagram left to right along the signal path. <b>Boxes are parts, rounded nodes "
             "are nets, the label on a line is the pin.</b> A part's ground pin is written inside its box.")
    gnd_items = [f"{r}.{p}" for r, p in nets.get("GND", [])]
    page = ['<!doctype html><meta charset="utf-8"><title>' + _h.escape(sheet) + (" check" if res else " wiring") + '</title>',
            '<style>body{font:14px system-ui;margin:24px;background:#fff;color:#111}h2{margin:32px 0 8px}'
            'table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ccc;padding:4px 8px}'
            'code{background:#f3f3f3;padding:1px 4px}pre.report{background:#f7f7f7;padding:12px;font-size:13px}</style>',
            '<script src="https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.3/mermaid.min.js"></script>',
            f'<h1>{_h.escape(sheet)} — {"check" if res else "wiring"}</h1><p>{intro}</p>']
    md = [f"# {sheet} — wiring diagrams\n",
          f"Generated from `{spec.name}` by `tools/checknet.py --mermaid`. " + re.sub(r"</?b>", "**", intro) +
          " Open the `.html` next to this file in any browser to see it rendered.\n"]
    if res:
        lines, _ = report(parts, res)
        page.append(f"<p>{LEGEND}</p><h2>Fix list</h2><pre class='report'>{_h.escape(chr(10).join(lines))}</pre>")
    for title, ns, code in diagrams:
        page.append(f"<h2>{_h.escape(title)}</h2><pre class='mermaid'>{_h.escape(code)}</pre>")
        md.append(f"## {title}\n\n```mermaid\n{code}\n```\n")
        md.append("| Net | connect every one of these |\n|---|---|")
        for n in ns: md.append(f"| **{n}** | " + ", ".join(f"`{r}.{p}`" for r, p in nets[n]) + " |")
        md.append("")
    page.append("<h2>GND</h2><p>" + ", ".join(f"<code>{_h.escape(i)}</code>" for i in gnd_items) + "</p>")
    md.append("## GND\n\nEvery pin below goes to the ground symbol:\n\n" + ", ".join(f"`{i}`" for i in gnd_items) + "\n")
    page.append("<script>mermaid.initialize({startOnLoad:true,securityLevel:'loose',flowchart:{useMaxWidth:false,nodeSpacing:22,rankSpacing:50,htmlLabels:true}});</script>")
    if res:
        p = spec.with_name(spec.name.replace(".net.yaml", ".check.html")); p.write_text("\n".join(page)); return [p]
    p1 = spec.with_name(spec.name.replace(".net.yaml", ".diagram.html")); p1.write_text("\n".join(page))
    p2 = spec.with_name(spec.name.replace(".net.yaml", ".diagram.md")); p2.write_text("\n".join(md))
    return [p1, p2]


# ------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("--sch", default=str(DEFAULT_SCH))
    ap.add_argument("--lint", action="store_true", help="validate the spec only")
    ap.add_argument("--mermaid", action="store_true", help="write the clean NN.diagram.{md,html} guide")
    a = ap.parse_args()
    spec = pathlib.Path(a.spec).resolve()

    sheet, parts, nets, blocks, named, errs = load_spec(spec)
    NAMED.update(named)          # this sheet's global-label nets join the by-name set
    if errs:
        print("spec errors:"); [print("  -", e) for e in errs]; return 1
    live = sum(1 for n in nets.values() for r, _ in n if not parts[r].get("dnp"))
    print(f"spec: {len(parts)} parts, {len(nets)} nets, {live} pin connections")
    if a.mermaid:
        for p in write_pages(spec, sheet, parts, nets, blocks): print(f"wrote {p.relative_to(ROOT)}")
    if a.lint or (a.mermaid and not pathlib.Path(a.sch).exists()):
        print("lint OK"); return 0

    comps, sch_nets = load_schematic(export_netlist(a.sch))
    if not sch_nets:
        print("schematic has no nets yet (unsaved, or empty) — nothing to compare"); return 0
    res = compare(parts, {n: m for n, m in nets.items()}, comps, sch_nets)
    lines, failed = report(parts, res)
    print("\n".join(lines))
    for p in write_pages(spec, sheet, parts, nets, blocks, res): print(f"→ {p.relative_to(ROOT)}  (open in a browser)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())

// Yard on real data: the mesh the bridge reports, in the same two
// projections as the design preview. Topology is arranged by hops from
// the conductor and needs no setup. Map is wherever you drag the nodes —
// positions are remembered per browser, since a board knows nothing
// about where it sits in the yard.
import { useEffect, useMemo, useRef, useState } from "react";
import { C, MONO } from "../../lib/tokens";
import { mono, sys, Toggle } from "../../ui";
import { BOARDS } from "../../lib/boards_gen";
import { counts, getConnection, useConnection, type Connection } from "../../lib/connection";
import { buildTopology, type TopoLink, type TopoNode } from "../../lib/topology";
import { PropIcon } from "../../lib/propIcons";
import { useProps } from "../../lib/propStore";
import { FLOODS, deriveFloods } from "../../lib/floods";
import { directLabel, target } from "../../lib/transport";
import type { NodeConfig } from "../../lib/nodeConfig";
import { useBlueprint, toMap } from "./Blueprint";

type Layout = "topology" | "map";
const W = 1000, H = 640;

const stroke = (n: TopoNode) => (n.missing ? C.red : C.green);

function age(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
}

function uptime(s?: number) {
  if (s === undefined) return "—";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
}

// Map positions live in the shared map document (lib/yardMap.ts, Blueprint.tsx).

// ---- topology layout ------------------------------------------------------

// Rows by hop depth (unreachable nodes last), fixed spacing, centered
// on x = 0. The canvas then fits its viewBox to these, so three nodes
// and thirty both fill the view at a readable size.
const COL = 210, ROW = 150;

function topoPositions(nodes: TopoNode[], maxDepth: number) {
  const rows = new Map<number, TopoNode[]>();
  for (const n of nodes) {
    const d = n.depth < 0 ? maxDepth + 1 : n.depth;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d)!.push(n);
  }
  const depths = [...rows.keys()].sort((a, b) => a - b);
  const pos = new Map<string, { x: number; y: number }>();
  depths.forEach((d, i) => {
    const row = rows.get(d)!;
    row.forEach((n, j) => pos.set(n.id, { x: (j - (row.length - 1) / 2) * COL, y: i * ROW }));
  });
  return pos;
}

// viewBox around the nodes: room for labels, never zoomed in so far
// that one node fills the screen.
function fitBox(pos: Map<string, { x: number; y: number }>) {
  const ps = [...pos.values()];
  if (!ps.length) return { x: 0, y: 0, w: W, h: H };
  const x0 = Math.min(...ps.map((p) => p.x)) - 110, x1 = Math.max(...ps.map((p) => p.x)) + 110;
  const y0 = Math.min(...ps.map((p) => p.y)) - 90, y1 = Math.max(...ps.map((p) => p.y)) + 110;
  const w = Math.max(760, x1 - x0), h = Math.max(520, y1 - y0);
  return { x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2 + 20, w, h };
}

// ---- floods -----------------------------------------------------------------

// BRMesh floods on the yard: not mesh nodes (they never transmit), so they
// get their own glyph — filled with the color the boards last sent — and
// dotted lines to every board that sends to them (two lines = either board
// can drive it). docs/generic-boards.md §6a-ii.
export interface YardFlood { id: string; number: number; label: string; value: number; senders: string[] }

const floodId = (n: number) => `flood:${n}`;

// What a light should look like, from its last-sent value (0xWWRRGGBB).
function floodPaint(v: number): { fill: string; glow: string } | null {
  const w = (v >>> 24) & 0x7f;
  if (w) return { fill: `rgba(255,238,205,${(0.35 + 0.65 * w / 127).toFixed(2)})`, glow: "#ffeecd" };
  const rgb = v & 0xffffff;
  if (!rgb) return null;
  const hex = "#" + rgb.toString(16).padStart(6, "0");
  return { fill: hex, glow: hex };
}

// Which floods exist (the senders' configs, re-read when boards come and
// go) and what was last sent to them (one sender's `state`, every 3 s).
function useFloods(conn: Connection): YardFlood[] {
  const [cfgs, setCfgs] = useState<Record<string, NodeConfig>>({});
  const [values, setValues] = useState<Record<number, number>>({});
  const known = Object.values(conn.entries).filter((e) => e.hello);
  const knownKey = known.map((e) => e.node).sort().join(",");
  useEffect(() => {
    let live = true;
    (async () => {
      const out: Record<string, NodeConfig> = {};
      for (const en of known) {
        if (en.hello?.bridge) continue;
        try {
          const r = await target(conn.link, en.usb ? null : en.node).request("get_config");
          if (r.ok) out[en.node] = r.config as NodeConfig;
        } catch { /* not answering: its lights still show through another sender */ }
      }
      if (live) setCfgs(out);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.link, knownKey]);
  const st = useMemo(() => deriveFloods(cfgs), [cfgs]);
  const sendersKey = st.senders.join(",");
  useEffect(() => {
    if (!st.senders.length) return;
    let live = true, turn = 0;
    const poll = async () => {
      // Ask the senders in turn: whichever answers is good enough (they all
      // hold the same last-sent colors).
      const n = st.senders[turn++ % st.senders.length];
      const en = conn.entries[n];
      if (!en || isMissingEntry(en)) return;
      try {
        const r = await target(conn.link, en.usb ? null : n).request("state");
        if (!r.ok || !live) return;
        const v: Record<number, number> = {};
        for (const c of r.channels as { kind: string; index: number; value: number }[]) if (c.kind === "BLE_LIGHT") v[c.index] = c.value;
        setValues(v);
      } catch { /* next round */ }
    };
    void poll();
    const t = setInterval(() => void poll(), 3000);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.link, sendersKey]);
  return st.lights.map((l) => ({
    id: floodId(l.number), number: l.number, label: l.label || `flood ${l.number}`, value: values[l.number] ?? 0,
    senders: st.senders.filter((n) => cfgs[n]?.channels.some((c) => c.kind === "BLE_LIGHT" && c.light === l.number)),
  }));
}
// The tag for the board the console talks to directly (WIFI / USB / SIM).
const directTag = () => { const c = getConnection(); return c ? directLabel(c.link) : "USB"; };
const isMissingEntry = (en: { usb: boolean; seen: number }) => !en.usb && Date.now() - en.seen > 16000;

// ---- view -----------------------------------------------------------------

export default function RealYard({ onOpenNode, onConnect }: {
  onOpenNode: (id: string) => void;
  onConnect: () => void;
}) {
  const conn = useConnection();
  const [layout, setLayout] = useState<Layout>("topology");
  const [sel, setSel] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(true);
  const [, bump] = useState(0); // re-render after a drag saves a position

  if (!conn) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <div style={sys(700, 15, C.t1)}>No mesh connected</div>
          <div style={{ ...sys(400, 12.5, C.t3), marginTop: 8, lineHeight: 1.55 }}>
            Connect your bridge (WiFi or USB) in Nodes &amp; Channels. The yard then draws every node it hears
            and the radio links between them, live.
          </div>
          <button onClick={onConnect} style={{ marginTop: 16, height: 32, padding: "0 14px", background: C.emberBg, border: `1px solid ${C.ember}`, borderRadius: 6, ...sys(600, 12, C.emberT) }}>
            Go to Nodes &amp; Channels
          </button>
        </div>
      </div>
    );
  }

  return <Live conn={conn} layout={layout} setLayout={setLayout} sel={sel} setSel={setSel}
    showLinks={showLinks} setShowLinks={setShowLinks} onOpenNode={onOpenNode} bump={() => bump((n) => n + 1)} />;
}

function Live({ conn, layout, setLayout, sel, setSel, showLinks, setShowLinks, onOpenNode, bump }: {
  conn: Connection; layout: Layout; setLayout: (l: Layout) => void;
  sel: string | null; setSel: (s: string | null) => void;
  showLinks: boolean; setShowLinks: (b: boolean) => void;
  onOpenNode: (id: string) => void; bump: () => void;
}) {
  const now = Date.now();
  const svgRef = useRef<SVGSVGElement>(null);
  const bp = useBlueprint(conn, layout === "map", svgRef);
  // The Map's view: scroll to zoom around the pointer, drag empty ground
  // to pan (Select tool), +/−/fit buttons. Topology always fits.
  const [view, setView] = useState({ x: 0, y: 0, w: W, h: H });
  const zoomBy = (f: number, at?: { x: number; y: number }) => setView((v) => {
    const w = Math.max(W / 5, Math.min(W * 2.5, v.w / f)), h = w * (H / W);
    const a = at ?? { x: v.x + v.w / 2, y: v.y + v.h / 2 };
    const fx = (a.x - v.x) / v.w, fy = (a.y - v.y) / v.h;
    return { x: a.x - fx * w, y: a.y - fy * h, w, h };
  });
  const topo = useMemo(() => buildTopology(conn, now), [conn, Math.floor(now / 1000)]);
  const floods = useFloods(conn);
  const c = counts(conn, now);
  const weak = topo.links.filter((l) => !l.lost && l.rssi <= -75).length;
  const selNode = topo.nodes.find((n) => n.id === sel) ?? null;

  const pos = layout === "topology"
    ? topoPositions(topo.nodes, topo.maxDepth)
    : new Map([...topo.nodes.map((n) => n.id), ...floods.map((f) => f.id)].map((id) => [id, bp.pos(id)] as const)
        .filter((e): e is [string, { x: number; y: number }] => !!e[1]));
  if (layout === "topology" && floods.length) {
    // A row of lights under the deepest boards.
    const bottom = Math.max(0, ...[...pos.values()].map((p) => p.y)) + ROW * 0.85;
    floods.forEach((f, i) => pos.set(f.id, { x: (i - (floods.length - 1) / 2) * COL * 0.62, y: bottom }));
  }
  const unplaced = layout === "map" ? topo.nodes.filter((n) => !pos.has(n.id)) : [];
  const unplacedFloods = layout === "map" ? floods.filter((f) => !pos.has(f.id)) : [];
  const selFlood = floods.find((f) => f.id === sel) ?? null;

  const chip = (id: Layout, text: string) => {
    const on = layout === id;
    return (
      <span onClick={() => setLayout(id)} style={{
        padding: "3px 10px", borderRadius: 5, cursor: "pointer",
        background: on ? C.emberBg2 : "transparent", border: `1px solid ${on ? C.emberB2 : "transparent"}`,
        ...sys(on ? 600 : 500, 11.5, on ? C.emberT : C.t3),
      }}>{text}</span>
    );
  };

  const health = c.missing ? { t: "DEGRADED", fg: C.amber, bg: C.amberBg, b: C.amberB }
    : weak ? { t: "WEAK LINK", fg: C.amber, bg: C.amberBg, b: C.amberB }
    : { t: "HEALTHY", fg: C.green, bg: C.greenBg, b: C.greenB };

  return (
    <>
      <div style={{ flex: 1, minWidth: 0, position: "relative", backgroundColor: C.bg, backgroundImage: layout === "map" ? undefined : `radial-gradient(${C.grid} 1px,transparent 1px)`, backgroundSize: "24px 24px" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 4, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "linear-gradient(rgba(11,13,16,.95),rgba(11,13,16,0))", pointerEvents: "none", flexWrap: "wrap" }}>
          <span style={sys(700, 13, C.t1)}>Yard</span>
          <div style={{ display: "flex", gap: 2, padding: 2, background: "rgba(20,23,28,.9)", border: `1px solid ${C.b2}`, borderRadius: 7, pointerEvents: "auto" }}>
            {chip("topology", "Topology")}
            {chip("map", "Map")}
          </div>
          <span style={{ padding: "3px 9px", borderRadius: 4, background: health.bg, border: `1px solid ${health.b}`, ...mono(700, 10.5, health.fg) }}>{health.t}</span>
          <span style={mono(500, 11, C.t5)}>
            {c.online} online{c.missing ? ` · ✕ ${c.missing} missing` : ""}{weak ? ` · ⚠ ${weak} weak link${weak > 1 ? "s" : ""}` : ""}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ display: "flex", alignItems: "center", gap: 6, ...mono(500, 11, C.t5) }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: now - conn.lastEvent < 8000 ? C.green : C.amber, animation: "livedot 2s infinite" }} />
            live · last heartbeat {age(now - conn.lastEvent)} ago
          </span>
        </div>

        {layout === "map" && (
          <div style={{ position: "absolute", top: 50, left: 68, zIndex: 3, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(16,19,24,.92)", border: `1px solid ${C.b2}`, borderRadius: 7 }}>
            <span style={sys(600, 11.5, C.t2)}>Mesh links</span>
            <Toggle on={showLinks} small onClick={() => setShowLinks(!showLinks)} />
          </div>
        )}
        {bp.rail}

        <Canvas topo={topo.nodes} links={topo.links} floods={floods} pos={pos} sel={sel} onSelect={setSel}
          box={layout === "topology" ? fitBox(pos) : view}
          onWheel={layout === "map" ? (f, at) => zoomBy(f, at) : undefined}
          onPan={layout === "map" && !bp.drawing ? (dx, dy) => setView((v) => ({ ...v, x: v.x - dx, y: v.y - dy })) : undefined}
          draggable={layout === "map" && !bp.drawing} showLinks={layout === "topology" || showLinks}
          onDrop={(id, p) => { bp.setPos(id, p); bump(); }}
          svgRef={svgRef} under={layout === "map" ? bp.layer : null} nodesInert={layout === "map" && bp.drawing}
          onBgDown={layout === "map" ? bp.onBgDown : undefined} onMove={layout === "map" ? bp.onMove : undefined}
          onUp={layout === "map" ? bp.onUp : undefined} onBgDouble={layout === "map" ? bp.onBgDouble : undefined} />

        {(unplaced.length > 0 || unplacedFloods.length > 0) && (
          <div style={{ position: "absolute", top: 96, left: 68, right: 14, zIndex: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 12px", background: "rgba(16,19,24,.95)", border: `1px dashed ${C.b3}`, borderRadius: 7 }}>
            <span style={sys(600, 11.5, C.t3)}>Not on the map yet — drag each onto the yard where it sits:</span>
            {unplaced.map((n) => (
              <span key={n.id} draggable
                onDragStart={(e) => e.dataTransfer.setData("text/propmesh-node", n.id)}
                onClick={() => setSel(n.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 6, cursor: "grab", background: C.card, border: `1px solid ${sel === n.id ? C.emberB : C.b2}`, ...sys(600, 11.5, n.missing ? C.red : C.t1) }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: stroke(n) }} />{n.name}
              </span>
            ))}
            {unplacedFloods.map((f) => (
              <span key={f.id} draggable
                onDragStart={(e) => e.dataTransfer.setData("text/propmesh-node", f.id)}
                onClick={() => setSel(f.id)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: 6, cursor: "grab", background: C.card, border: `1px solid ${sel === f.id ? C.emberB : C.b2}`, ...sys(600, 11.5, C.t1) }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: floodPaint(f.value)?.fill ?? "transparent", border: `1px solid ${C.b3}` }} />{f.label}
              </span>
            ))}
          </div>
        )}

        {layout !== "map" && <div style={{ position: "absolute", left: 14, bottom: 14, display: "flex", gap: 12, padding: "8px 12px", background: "rgba(11,13,16,.9)", border: `1px solid ${C.b2}`, borderRadius: 6, ...mono(500, 10.5, C.t4) }}>
          <span><span style={{ color: C.green }}>━</span> strong ≥−60</span>
          <span><span style={{ color: C.linkGray }}>━</span> ok</span>
          <span><span style={{ color: C.amber }}>╌</span> weak ≤−75</span>
          <span><span style={{ color: C.red }}>╌</span> lost</span>
          <span style={{ color: C.t5 }}>· dBm, the weaker direction</span>
          {floods.length > 0 && <span><span style={{ color: C.bluetooth }}>┈</span> Bluetooth to a flood</span>}
        </div>}
        {bp.panel}
        {layout === "map" && (
          <div style={{ position: "absolute", left: 14, bottom: 14, zIndex: 3, display: "flex", flexDirection: "column", gap: 4, padding: 4, background: "rgba(16,19,24,.92)", border: `1px solid ${C.b2}`, borderRadius: 7 }}>
            {[["+", () => zoomBy(1.4), "Zoom in (scroll)"], ["−", () => zoomBy(1 / 1.4), "Zoom out (scroll)"], ["⛶", () => setView({ x: 0, y: 0, w: W, h: H }), "Fit the whole yard"]].map(([t, fn, title]) => (
              <button key={t as string} title={title as string} onClick={fn as () => void} style={{ width: 28, height: 26, borderRadius: 5, cursor: "pointer", background: C.raised, border: `1px solid ${C.b3}`, color: C.t3, font: "600 13px system-ui" }}>{t as string}</button>
            ))}
          </div>
        )}
      </div>

      {selNode && <Detail n={selNode} links={topo.links} nodes={topo.nodes} now={now}
        onClose={() => setSel(null)} onOpen={() => onOpenNode(selNode.id)} />}
      {selFlood && <FloodDetail f={selFlood} nameOf={(id) => topo.nodes.find((n) => n.id === id)?.name ?? id}
        onClose={() => setSel(null)} onOpen={() => onOpenNode(FLOODS)} />}
    </>
  );
}

// ---- canvas -----------------------------------------------------------------

function Canvas({ topo, links, floods, pos, box, sel, onSelect, draggable, showLinks, onDrop, svgRef, under, nodesInert, onBgDown, onMove, onUp, onBgDouble, onWheel, onPan }: {
  topo: TopoNode[]; links: TopoLink[]; floods: YardFlood[]; pos: Map<string, { x: number; y: number }>;
  box: { x: number; y: number; w: number; h: number };
  sel: string | null; onSelect: (id: string) => void;
  draggable: boolean; showLinks: boolean;
  onDrop: (id: string, p: { x: number; y: number }) => void;
  // The Map's drawing layer (Blueprint.tsx): drawn under everything, fed the
  // background's pointer events; boards ignore the pointer while drawing.
  svgRef?: React.RefObject<SVGSVGElement>;
  under?: React.ReactNode; nodesInert?: boolean;
  onBgDown?: (p: { x: number; y: number }) => void; onMove?: (p: { x: number; y: number }) => void;
  onUp?: () => void; onBgDouble?: () => void;
  onWheel?: (factor: number, at: { x: number; y: number }) => void;  // zoom around a map point
  onPan?: (dx: number, dy: number) => void;  // map units; set = dragging empty ground pans
}) {
  const props = useProps();
  const own = useRef<SVGSVGElement>(null);
  const svg = svgRef ?? own;
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const pan = useRef<{ x: number; y: number } | null>(null);  // last pointer position while panning, map units
  const isBg = (t: EventTarget | null) => t === svg.current || !!(t as Element)?.getAttribute?.("data-bg");

  const toSvg = (cx: number, cy: number) => {
    const m = svg.current?.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
    return { x: Math.max(30, Math.min(W - 30, p.x)), y: Math.max(30, Math.min(H - 30, p.y)) };
  };
  const at = (id: string) => (drag?.id === id ? drag : pos.get(id));

  return (
    <svg ref={svg} width="100%" height="100%" viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} style={{ display: "block", touchAction: "none" }}
      onDragOver={(e) => { if (draggable) e.preventDefault(); }}
      onDrop={(e) => {
        const id = e.dataTransfer.getData("text/propmesh-node");
        if (id) onDrop(id, toSvg(e.clientX, e.clientY));
      }}
      onWheel={(e) => { if (onWheel) { e.preventDefault(); onWheel(Math.exp(-e.deltaY * 0.0015), toMap(svg.current, e.clientX, e.clientY)); } }}
      onPointerDown={(e) => {
        if (!isBg(e.target)) return;
        onBgDown?.(toMap(svg.current, e.clientX, e.clientY));
        if (onPan && (e.button === 0 || e.button === 1)) { pan.current = toMap(svg.current, e.clientX, e.clientY); (e.target as Element).setPointerCapture?.(e.pointerId); }
      }}
      onDoubleClick={() => onBgDouble?.()}
      onPointerMove={(e) => {
        const p = toMap(svg.current, e.clientX, e.clientY);
        onMove?.(p);
        if (drag) setDrag({ id: drag.id, ...toSvg(e.clientX, e.clientY) });
        // While panning the view moves under the pointer, so measure against the start of this step.
        if (pan.current && onPan) { onPan(p.x - pan.current.x, p.y - pan.current.y); }
      }}
      onPointerUp={() => { onUp?.(); pan.current = null; if (drag) { onDrop(drag.id, { x: drag.x, y: drag.y }); setDrag(null); } }}
      onPointerLeave={() => { setDrag(null); pan.current = null; }}>
      {under}
      {showLinks && links.map((l) => {
        const A = at(l.a), B = at(l.b);
        if (!A || !B) return null;
        // Label beside the line (perpendicular offset), not on it, so it
        // never lands on a node's caption.
        const len = Math.hypot(B.x - A.x, B.y - A.y) || 1;
        const ox = (-(B.y - A.y) / len) * 16, oy = ((B.x - A.x) / len) * 16;
        return (
          <g key={l.k}>
            <line x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={l.color} strokeWidth={l.w} strokeDasharray={l.dash} opacity=".75" />
            <text x={(A.x + B.x) / 2 + ox} y={(A.y + B.y) / 2 + oy + 4} fontFamily={MONO} fontSize="11" fontWeight="600" textAnchor="middle" fill={l.color} style={{ paintOrder: "stroke", stroke: C.bg, strokeWidth: "6px", pointerEvents: "none" }}>
              {l.lost ? "lost" : l.rssi}
            </text>
          </g>
        );
      })}
      {showLinks && floods.flatMap((f) => f.senders.map((s) => {
        const A = at(s), B = at(f.id);
        if (!A || !B) return null;
        return <line key={`${s}>${f.id}`} x1={A.x} y1={A.y} x2={B.x} y2={B.y} stroke={C.bluetooth} strokeWidth="1.4" strokeDasharray="2 5" opacity=".8" />;
      }))}
      {floods.map((f) => {
        const p = at(f.id);
        if (!p) return null;
        const paint = floodPaint(f.value);
        return (
          <g key={f.id} style={{ cursor: draggable ? "grab" : "pointer", pointerEvents: nodesInert ? "none" : undefined }}
            onClick={() => onSelect(f.id)}
            onPointerDown={(e) => { if (draggable) { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ id: f.id, x: p.x, y: p.y }); onSelect(f.id); } }}>
            {sel === f.id && <circle cx={p.x} cy={p.y} r={23} fill="none" stroke={C.ember} strokeWidth="2" strokeDasharray="4 4" />}
            {paint && <circle cx={p.x} cy={p.y} r={22} fill={paint.glow} opacity=".22" style={{ filter: "blur(6px)" }} />}
            <circle cx={p.x} cy={p.y} r={13} fill={paint?.fill ?? C.raised2} stroke={paint ? "rgba(255,255,255,.35)" : C.t5} strokeWidth="1.5" strokeDasharray={paint ? "" : "3 3"} />
            <text x={p.x} y={p.y + 32} fontSize="12" fontWeight="600" textAnchor="middle" fontFamily="system-ui" fill={sel === f.id ? C.emberT : C.t2}>{f.label}</text>
            <text x={p.x} y={p.y + 46} fontSize="10" textAnchor="middle" fontFamily={MONO} fill={C.t5}>light #{f.number}{paint ? "" : " · off"}</text>
          </g>
        );
      })}
      {topo.map((n) => {
        const p = at(n.id);
        if (!p) return null;
        const big = n.bridge;
        const r = big ? 22 : 17;
        return (
          <g key={n.id} style={{ cursor: draggable ? "grab" : "pointer", pointerEvents: nodesInert ? "none" : undefined }}
            onClick={() => onSelect(n.id)}
            onPointerDown={(e) => { if (draggable) { (e.target as Element).setPointerCapture?.(e.pointerId); setDrag({ id: n.id, x: p.x, y: p.y }); onSelect(n.id); } }}>
            {sel === n.id && <circle cx={p.x} cy={p.y} r={r + 9} fill="none" stroke={C.ember} strokeWidth="2" strokeDasharray="4 4" />}
            {big
              ? <rect x={p.x - 26} y={p.y - 20} width="52" height="40" rx="8" fill={C.raised2} stroke={stroke(n)} strokeWidth="2" strokeDasharray={n.missing ? "3 3" : ""} />
              : <circle cx={p.x} cy={p.y} r={r} fill={C.raised2} stroke={stroke(n)} strokeWidth="2" strokeDasharray={n.missing ? "3 3" : ""} />}
            {(() => {
              const s = big ? 30 : 24;
              const type = big ? "hub" : props.get(n.id);
              return <PropIcon type={type} size={s} x={p.x - s / 2} y={p.y - s / 2} color={big ? C.emberT : stroke(n)} opacity={n.missing ? 0.7 : 1} />;
            })()}
            <text x={p.x} y={p.y + r + 20} fontSize="12.5" fontWeight="600" textAnchor="middle" fontFamily="system-ui"
              fill={n.missing ? C.red : sel === n.id ? C.emberT : C.t1}>{n.name}</text>
            <text x={p.x} y={p.y + r + 35} fontSize="10.5" textAnchor="middle" fontFamily={MONO} fill={C.t4}>
              {n.bridge ? "BRIDGE · ⏱ clock" : n.missing ? "missing" : `${n.usb ? directTag() : n.depth >= 0 ? `H${n.depth}` : "—"}${n.conductor ? " · ⏱" : ""}`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---- detail panel -------------------------------------------------------------

const label = { font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5 } as const;

function Stat({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ background: C.panel, padding: "10px 14px" }}>
      <div style={label}>{k}</div>
      <div style={{ ...mono(600, 12.5, color ?? C.t1), marginTop: 3 }}>{v}</div>
    </div>
  );
}

function Detail({ n, links, nodes, now, onClose, onOpen }: {
  n: TopoNode; links: TopoLink[]; nodes: TopoNode[]; now: number;
  onClose: () => void; onOpen: () => void;
}) {
  const e = n.entry;
  const hb = e.hb;
  const board = e.hello ? BOARDS[e.hello.board]?.name ?? e.hello.board : "—";
  const name = (id: string) => nodes.find((x) => x.id === id)?.name ?? id;
  const nbrs = links.filter((l) => l.a === n.id || l.b === n.id).map((l) => {
    const other = l.a === n.id ? l.b : l.a;
    const heardBy = l.a === n.id ? l.rssiAB : l.rssiBA; // as this node hears the other
    const heardOther = l.a === n.id ? l.rssiBA : l.rssiAB;
    return { id: other, l, heardBy, heardOther };
  }).sort((x, y) => (y.l.rssi) - (x.l.rssi));
  const pill = n.missing ? [C.redBg, C.redB, C.red, "✕ MISSING"] : [C.greenBg, C.greenB, C.green, "ONLINE"];

  return (
    <div style={{ width: 330, flex: "none", borderLeft: `1px solid ${C.b2}`, background: C.panel, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${C.b1}` }}>
        <span style={{ ...sys(700, 13, C.t1), flex: 1 }}>{n.name}</span>
        <span style={{ padding: "2px 8px", borderRadius: 99, background: pill[0], border: `1px solid ${pill[1]}`, ...mono(700, 10, pill[2]), letterSpacing: ".06em" }}>{pill[3]}</span>
        <span onClick={onClose} style={{ color: C.t5, fontSize: 13, cursor: "pointer", padding: "2px 4px" }}>✕</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: C.b1, borderBottom: `1px solid ${C.b1}` }}>
        <Stat k="ROLE" v={n.bridge ? "Bridge" : (e.hb && !(e.hb.role & 1)) ? "Leaf (battery)" : "Relay"} color={n.bridge ? C.emberT : undefined} />
        <Stat k="MESH CLOCK" v={n.conductor ? "⏱ keeps it" : "follows"} />
        <Stat k="CONNECTION" v={n.usb ? directTag() : n.depth === 1 ? "direct" : n.depth > 1 ? `${n.depth} hops` : "—"} />
        <Stat k="LAST HEARD" v={n.usb ? "on the cable" : `${age(now - e.seen)} ago`} color={n.missing && e.hello?.power !== "battery" ? C.red : undefined} />
        {e.hello?.power === "battery" && <Stat k="SLEEP" v={n.missing ? `asleep · checks in every ${e.hello.checkin_ms ? Math.round(e.hello.checkin_ms / 60000) : "?"} min` : hb?.listen ? `listening ${hb.listen} ms windows` : e.hello.awake ? "awake (held)" : "awake"} />}
        <Stat k="UPTIME" v={uptime(hb?.up)} />
        {hb && hb.batt > 0 && <Stat k="BATTERY" v={`${(hb.batt / 1000).toFixed(2)} V`} color={hb.batt < 3500 ? C.amber : undefined} />}
        <Stat k="FREE MEMORY" v={hb ? `${hb.heap} KB` : "—"} />
        <Stat k="FIRMWARE" v={e.hello ? `fw ${e.hello.fw}` : hb ? `fw ${hb.fw}` : "—"} />
        <Stat k="NODE ID" v={n.id} />
      </div>
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${C.b1}`, ...mono(500, 11, C.t4) }}>{board}</div>
      <div style={{ padding: "12px 14px", flex: 1 }}>
        <div style={{ ...label, marginBottom: 8 }}>HEARS DIRECTLY</div>
        {nbrs.length === 0 && <div style={mono(500, 11, C.t5)}>no neighbor reports yet — they arrive with the next heartbeat</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {nbrs.map(({ id, l, heardBy, heardOther }) => (
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...sys(500, 12, C.t2), flex: 1 }}>{name(id)}</span>
              <span title="as this node hears it / as it hears this node" style={{ padding: "2px 7px", borderRadius: 4, background: C.raised, ...mono(600, 11, l.color === C.linkGray ? C.t3 : l.color) }}>
                {l.lost ? "lost" : `${heardBy ?? "?"} / ${heardOther ?? "?"} dBm`}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.b1}` }}>
        <button onClick={onOpen} style={{ width: "100%", height: 36, background: C.emberBg, border: `1px solid ${C.ember}`, borderRadius: 6, ...sys(700, 12, C.emberT) }}>
          {n.bridge ? "Open in Nodes & Channels →" : "Edit pins →"}
        </button>
      </div>
    </div>
  );
}


function FloodDetail({ f, nameOf, onClose, onOpen }: {
  f: YardFlood; nameOf: (id: string) => string; onClose: () => void; onOpen: () => void;
}) {
  const paint = floodPaint(f.value);
  const w = (f.value >>> 24) & 0x7f;
  const shown = !paint ? "off" : w ? `warm white ${Math.round(w * 100 / 127)} %` : "#" + (f.value & 0xffffff).toString(16).padStart(6, "0");
  return (
    <div style={{ width: 330, flex: "none", borderLeft: `1px solid ${C.b2}`, background: C.panel, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${C.b1}` }}>
        <span style={{ width: 14, height: 14, borderRadius: "50%", background: paint?.fill ?? "transparent", border: `1px solid ${C.b3}` }} />
        <span style={{ ...sys(700, 13, C.t1), flex: 1 }}>{f.label}</span>
        <span onClick={onClose} style={{ color: C.t5, fontSize: 13, cursor: "pointer", padding: "2px 4px" }}>✕</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: C.b1, borderBottom: `1px solid ${C.b1}` }}>
        <Stat k="LIGHT" v={`#${f.number}`} />
        <Stat k="LAST SENT" v={shown} />
      </div>
      <div style={{ padding: "12px 14px", flex: 1 }}>
        <div style={{ ...label, marginBottom: 8 }}>SENT BY</div>
        {f.senders.length === 0 && <div style={mono(500, 11, C.amber)}>no board holds this light — tick a sender in the Floods tab</div>}
        {f.senders.map((s) => <div key={s} style={{ ...sys(500, 12, C.t2), marginBottom: 4 }}>{nameOf(s)}</div>)}
        <div style={{ ...sys(400, 11.5, C.t4), lineHeight: 1.5, marginTop: 12 }}>
          The light never answers, so this is what the boards last sent — not proof it's on or showing it.
        </div>
      </div>
      <div style={{ padding: "12px 14px", borderTop: `1px solid ${C.b1}` }}>
        <button onClick={onOpen} style={{ width: "100%", height: 36, background: C.emberBg, border: `1px solid ${C.ember}`, borderRadius: 6, ...sys(700, 12, C.emberT) }}>
          Open the Floods tab →
        </button>
      </div>
    </div>
  );
}

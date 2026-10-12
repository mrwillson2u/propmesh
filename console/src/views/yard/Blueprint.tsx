// The Map's drawing layer (handoff 1e "Blueprint"): tools to draw the
// yard — areas (house, garage), paths (driveway, sidewalk), lines
// (property line, fence) — under the boards and floods, plus the shared
// map document (lib/yardMap.ts) that also holds where each board sits.
//
// useBlueprint() owns the document, the tool and the drawing in progress;
// RealYard renders what it returns: `layer` inside the map's <svg> (under
// the nodes), `rail` (tools), `panel` (the selected shape) and `status`.
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { C, MONO } from "../../lib/tokens";
import { mono, sys } from "../../ui";
import type { Connection } from "../../lib/connection";
import {
  COLORS, GRID, MAX_BYTES, PROP_SIZE, SHAPE_DEFAULT, loadYard, saveYard, shapeId, size, snap, stamp,
  type Shape, type ShapeKind, type YardDoc,
} from "../../lib/yardMap";
import { PROP_TYPES, PropIcon, type PropType } from "../../lib/propIcons";

export type Tool = "select" | ShapeKind | "erase";
type Pt = { x: number; y: number };
export type View = { x: number; y: number; w: number; h: number };

// 16 px line icons in the current color.
const Icon = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" style={{ display: "block" }}>
    <path d={d} />
  </svg>
);
const ICONS: Record<Tool | "undo", ReactNode> = {
  select: <Icon d="M3.5 2.5 L3.5 13 L6.5 10.5 L8.5 14.5 L10.5 13.5 L8.5 9.5 L12.5 9.5 Z" fill />,
  area: <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}><path d="M3 4 L13 3 L12 13 L4 12 Z" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="3" cy="4" r="1.6" fill="currentColor" /><circle cx="13" cy="3" r="1.6" fill="currentColor" /><circle cx="12" cy="13" r="1.6" fill="currentColor" /><circle cx="4" cy="12" r="1.6" fill="currentColor" /></svg>,
  path: <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}><path d="M5.5 2 L3 14 M10.5 2 L13 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M8 3.5 V5.5 M8 7.5 V9.5 M8 11.5 V13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" /></svg>,
  line: <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}><path d="M2 12 L14 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 2.5" /><path d="M4 13.5 V10 M12 6 V2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  erase: <svg width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}><path d="M9.5 2.5 L14 7 L8 13 L4.5 13 L2 10.5 Z" fill="currentColor" fillOpacity=".25" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M6 6 L11 11" stroke="currentColor" strokeWidth="1.5" /><path d="M3 14.5 H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  prop: <PropIcon type="tombstone" size={16} />,
  undo: <Icon d="M6 3.5 L3 6.5 L6 9.5 M3 6.5 H10 A3 3 0 0 1 10 12.5 H7" />,
};
const TOOLS: { id: Tool; name: string; title: string }[] = [
  { id: "select", name: "Select", title: "Select — drag a shape to move it, drag an edge to push it out (it stays straight), drag a corner to reshape; double-click an edge to add a corner there, double-click a corner to remove it. Drag empty ground to pan." },
  { id: "area", name: "Area", title: "Area — a building, bed or lawn: click its corners, then click the first corner (or double-click) to close it" },
  { id: "path", name: "Walkway", title: "Walkway — a driveway, sidewalk or path: a wide band. Click along it, double-click to finish" },
  { id: "line", name: "Border", title: "Border — a property line or fence: a thin dashed line. Click along it, double-click to finish" },
  { id: "prop", name: "Prop", title: "Prop — place a tombstone, skeleton, spider… where a prop stands (one without a board of its own, or just to dress the map). Pick the picture, then click to place; Esc when done" },
  { id: "erase", name: "Erase", title: "Erase — click a shape to remove it" },
];
const PATH_WIDTHS: { w: number; label: string }[] = [
  { w: 10, label: "sidewalk" }, { w: 16, label: "path" }, { w: 30, label: "driveway" }, { w: 45, label: "street" },
];

const pts = (s: Shape): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < s.pts.length; i += 2) out.push({ x: s.pts[i], y: s.pts[i + 1] });
  return out;
};
const flat = (ps: Pt[]) => ps.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
const centroid = (ps: Pt[]) => ps.reduce((a, p) => ({ x: a.x + p.x / ps.length, y: a.y + p.y / ps.length }), { x: 0, y: 0 });
const midOf = (ps: Pt[]) => {
  if (ps.length < 2) return ps[0];
  const k = Math.floor((ps.length - 1) / 2);
  return { x: (ps[k].x + ps[k + 1].x) / 2, y: (ps[k].y + ps[k + 1].y) / 2 };
};

export function toMap(svg: SVGSVGElement | null, cx: number, cy: number): Pt {
  const m = svg?.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

export function useBlueprint(conn: Connection, active: boolean, svgRef: RefObject<SVGSVGElement>, view: View) {
  const [doc, setDoc] = useState<YardDoc | null>(null);
  const [propIcon, setPropIcon] = useState<PropType>("tombstone");  // what the Prop tool places
  const [onBoard, setOnBoard] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; verts: number[] | null; from: Pt; orig: number[] } | null>(null);
  const history = useRef<YardDoc[]>([]);
  const [undoable, setUndoable] = useState(0);  // history length, so the button re-renders
  const saveT = useRef<ReturnType<typeof setTimeout>>();
  const docRef = useRef<YardDoc | null>(null);
  docRef.current = doc;

  useEffect(() => {
    let live = true;
    void loadYard(conn.link).then(({ doc, onBoard }) => { if (live) { setDoc(doc); setOnBoard(onBoard); } });
    return () => { live = false; };
  }, [conn.link]);

  // Every change: into history, stamped, saved after a short pause.
  const commit = useCallback((next: YardDoc, undoable = true) => {
    const cur = docRef.current;
    if (cur && undoable) history.current = [...history.current.slice(-29), cur];
    setUndoable(history.current.length);
    docRef.current = next;
    setDoc(next);
    clearTimeout(saveT.current);
    saveT.current = setTimeout(async () => {
      const err = await saveYard(conn.link, stamp(next));
      setStatus(err ? { text: err, bad: true } : { text: onBoard ? `saved on ${conn.hello.name || "the board"}` : "saved in this browser" });
    }, 600);
  }, [conn.link, conn.hello.name, onBoard]);

  const setPos = useCallback((id: string, p: Pt) => {
    const cur = docRef.current;
    if (!cur) return;
    commit({ ...cur, pos: { ...cur.pos, [id]: [Math.round(p.x), Math.round(p.y)] as [number, number] } });
  }, [commit]);

  const undo = useCallback(() => {
    const prev = history.current.pop();
    setUndoable(history.current.length);
    if (prev) commit(prev, false);
  }, [commit]);

  const finish = useCallback(() => {
    if (!doc) return;
    const need = tool === "area" ? 3 : 2;
    // A double-click to finish also lands as two clicks: drop repeated points.
    const ps = draft.filter((p, i) => i === 0 || p.x !== draft[i - 1].x || p.y !== draft[i - 1].y);
    if ((tool === "area" || tool === "path" || tool === "line") && ps.length >= need) {
      const s: Shape = { id: shapeId(), kind: tool, pts: flat(ps), ...SHAPE_DEFAULT[tool] };
      commit({ ...doc, shapes: [...doc.shapes, s] });
      setSel(s.id);
      setTool("select");
    }
    setDraft([]);
  }, [doc, draft, tool, commit]);

  const drawing = tool === "area" || tool === "path" || tool === "line";
  const placing = tool === "prop";

  // Keys: Enter finishes, Escape cancels, ⌘/ctrl-Z undoes, Delete removes the selected shape.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      if (e.key === "Escape") { setDraft([]); setSel(null); if (placing) setTool("select"); }
      else if (e.key === "Enter" && draft.length) finish();
      else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !typing) { e.preventDefault(); undo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel && !typing && doc) {
        commit({ ...doc, shapes: doc.shapes.filter((s) => s.id !== sel) });
        setSel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, draft, finish, undo, sel, doc, commit, placing]);

  // Background pointer events, from the map's <svg>.
  const onBgDown = (p: Pt) => {
    if (placing && doc) {
      const q = { x: snap(p.x), y: snap(p.y) };
      const sh: Shape = { id: shapeId(), kind: "prop", pts: flat([q]), ...SHAPE_DEFAULT.prop, icon: propIcon };
      commit({ ...doc, shapes: [...doc.shapes, sh] });
      setSel(sh.id);
      return;
    }
    if (!drawing) { setSel(null); return; }
    const q = { x: snap(p.x), y: snap(p.y) };
    // Click the first corner again to close an area.
    if (tool === "area" && draft.length >= 3 && Math.hypot(q.x - draft[0].x, q.y - draft[0].y) < GRID * 0.6) { finish(); return; }
    setDraft([...draft, q]);
  };
  const onMove = (p: Pt) => {
    if (drawing || placing) setHover({ x: snap(p.x), y: snap(p.y) });
    if (drag && doc) {
      const dx = snap(p.x - drag.from.x), dy = snap(p.y - drag.from.y);
      const moved = drag.orig.map((v, i) => (drag.verts === null || drag.verts.includes(Math.floor(i / 2)) ? v + (i % 2 ? dy : dx) : v));
      setDoc({ ...doc, shapes: doc.shapes.map((s) => (s.id === drag.id ? { ...s, pts: moved } : s)) });
    }
  };
  const onUp = () => {
    if (drag && doc) {
      const shape = doc.shapes.find((s) => s.id === drag.id);
      const moved = shape && shape.pts.some((v, i) => v !== drag.orig[i]);
      if (moved) {
        const before = history.current;
        commit(doc, false);  // the drag's start already went into history
        history.current = before;
      } else {
        history.current.pop();  // a plain click: nothing to undo, nothing to save
        setUndoable(history.current.length);
      }
      setDrag(null);
    }
  };

  // Start moving a whole shape (verts null), one corner ([i]) or one edge
  // ([i, j] — both ends together, so the edge stays straight: push a wall out).
  const startDrag = (e: React.PointerEvent, s: Shape, verts: number[] | null) => {
    e.stopPropagation();
    if (tool === "erase" && doc) { commit({ ...doc, shapes: doc.shapes.filter((x) => x.id !== s.id) }); return; }
    if (tool !== "select" || !doc) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSel(s.id);
    history.current = [...history.current.slice(-29), doc];
    setUndoable(history.current.length);
    setDrag({ id: s.id, verts, from: toMap(svgRef.current, e.clientX, e.clientY), orig: [...s.pts] });
  };
  // Double-click an edge: a new corner right there (on the edge, snapped),
  // which then drags like any other.
  const insertOnEdge = (e: React.MouseEvent, s: Shape, i: number) => {
    e.stopPropagation();
    if (tool !== "select" || !doc) return;
    const ps = pts(s);
    const a = ps[i], b = ps[(i + 1) % ps.length];
    const p = toMap(svgRef.current, e.clientX, e.clientY);
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
    const t = Math.max(0.05, Math.min(0.95, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
    const q = { x: snap(a.x + t * (b.x - a.x)), y: snap(a.y + t * (b.y - a.y)) };
    update(s.id, { pts: flat([...ps.slice(0, i + 1), q, ...ps.slice(i + 1)]) });
    setSel(s.id);
  };
  // The edges of a shape, each grabbable on its own (Select tool).
  const edgeHits = (s: Shape, closed: boolean) => {
    if (tool !== "select") return null;
    const ps = pts(s);
    const n = closed ? ps.length : ps.length - 1;
    return Array.from({ length: n }, (_, i) => {
      const a = ps[i], b = ps[(i + 1) % ps.length];
      return <line key={`e${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="12" strokeLinecap="round"
        style={{ cursor: "move" }} onPointerDown={(e) => startDrag(e, s, [i, (i + 1) % ps.length])} onDoubleClick={(e) => insertOnEdge(e, s, i)} />;
    });
  };
  // Double-click a corner to remove it (an area keeps 3, a line 2).
  const removeVertex = (s: Shape, i: number) => {
    const ps = pts(s);
    if (ps.length <= (s.kind === "area" ? 3 : 2)) return;
    update(s.id, { pts: flat(ps.filter((_, k) => k !== i)) });
  };

  const update = (id: string, patch: Partial<Shape>) => doc && commit({ ...doc, shapes: doc.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const setIcon = (nodeId: string, type: PropType) => doc && commit({ ...doc, icons: { ...doc.icons, [nodeId]: type } });

  // Everything on the map, for "fit": shapes and placed boards.
  const bounds = (): View | null => {
    if (!doc) return null;
    const xs: number[] = [], ys: number[] = [];
    for (const sh of doc.shapes) for (let i = 0; i + 1 < sh.pts.length; i += 2) { xs.push(sh.pts[i]); ys.push(sh.pts[i + 1]); }
    for (const p of Object.values(doc.pos)) { xs.push(p[0]); ys.push(p[1]); }
    if (!xs.length) return null;
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };

  // ---- the layer: grid, shapes, the drawing in progress ----------------------
  const selected = doc?.shapes.find((s) => s.id === sel) ?? null;
  const layer: ReactNode = !active || !doc ? null : (
    <g>
      <defs>
        {/* One grid: a dot at every square's corner, a faint line every five. */}
        <pattern id="yard-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <circle cx={0.5} cy={0.5} r={0.9} fill={C.b3} />
        </pattern>
        <pattern id="yard-grid5" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`} fill="none" stroke={C.grid} strokeWidth="1" />
        </pattern>
      </defs>
      {/* The ground goes on forever: the grid is drawn over whatever is in view (and a view's worth around it). */}
      <rect data-bg="1" x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill={C.bg} />
      <rect data-bg="1" x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="url(#yard-grid5)" />
      <rect data-bg="1" x={view.x - view.w} y={view.y - view.h} width={view.w * 3} height={view.h * 3} fill="url(#yard-grid)" />
      {/* paths first (under), then areas, then lines on top */}
      {doc.shapes.filter((s) => s.kind === "path").map((s) => {
        const ps = pts(s), m = midOf(ps), on = s.id === sel;
        return (
          <g key={s.id} onPointerDown={(e) => startDrag(e, s, null)} style={{ cursor: tool === "erase" ? "not-allowed" : tool === "select" ? "move" : undefined }}>
            <polyline points={ps.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={s.color ? s.color : on ? "#2c3240" : "#22262d"} strokeWidth={s.w ?? 16} strokeLinejoin="round" strokeLinecap="round" opacity={on ? 1 : 0.9} />
            {edgeHits(s, false)}
            {s.label && m && <text x={m.x} y={m.y + 4} textAnchor="middle" fontFamily={MONO} fontSize="11" fill={C.t5} style={{ pointerEvents: "none" }}>{s.label}</text>}
          </g>
        );
      })}
      {doc.shapes.filter((s) => s.kind === "area").map((s) => {
        const ps = pts(s), c = centroid(ps), on = s.id === sel;
        return (
          <g key={s.id} onPointerDown={(e) => startDrag(e, s, null)} style={{ cursor: tool === "erase" ? "not-allowed" : tool === "select" ? "move" : undefined }}>
            <polygon points={ps.map((p) => `${p.x},${p.y}`).join(" ")} fill={s.color ?? C.card} stroke={on ? C.t3 : C.wire} strokeWidth="1.5" />
            {edgeHits(s, true)}
            {s.label && <text x={c.x} y={c.y + 4} textAnchor="middle" fontFamily={MONO} fontSize="12" letterSpacing="1.5" fill={C.t5} style={{ pointerEvents: "none" }}>{s.label.toUpperCase()}</text>}
          </g>
        );
      })}
      {doc.shapes.filter((s) => s.kind === "line").map((s) => {
        const ps = pts(s), m = midOf(ps), on = s.id === sel;
        return (
          <g key={s.id} onPointerDown={(e) => startDrag(e, s, null)} style={{ cursor: tool === "erase" ? "not-allowed" : tool === "select" ? "move" : undefined }}>
            <polyline points={ps.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={s.color ?? (on ? C.t4 : C.b3)} strokeWidth="1.5" strokeDasharray="7 6" />
            {edgeHits(s, false)}
            {s.label && m && <text x={m.x} y={m.y - 6} textAnchor="middle" fontFamily={MONO} fontSize="11" fill={C.t5} style={{ pointerEvents: "none" }}>{s.label}</text>}
          </g>
        );
      })}
      {/* clip-art props */}
      {doc.shapes.filter((s) => s.kind === "prop").map((s) => {
        const p = pts(s)[0], sz = PROP_SIZE[s.size ?? 2], on = s.id === sel;
        if (!p) return null;
        return (
          <g key={s.id} onPointerDown={(e) => startDrag(e, s, null)} style={{ cursor: tool === "erase" ? "not-allowed" : tool === "select" ? "move" : undefined }}>
            {on && <circle cx={p.x} cy={p.y} r={sz * 0.7} fill="none" stroke={C.ember} strokeWidth="1.5" strokeDasharray="4 4" />}
            <circle cx={p.x} cy={p.y} r={sz * 0.62} fill={C.bg} opacity=".01" />
            <PropIcon type={s.icon ?? "generic"} size={sz} x={p.x - sz / 2} y={p.y - sz / 2} color={s.color ?? C.t3} />
            {s.label && <text x={p.x} y={p.y + sz / 2 + 13} textAnchor="middle" fontFamily="system-ui" fontSize="11" fontWeight="600" fill={on ? C.emberT : C.t3} style={{ pointerEvents: "none" }}>{s.label}</text>}
          </g>
        );
      })}
      {/* the prop about to be placed */}
      {placing && hover && <g style={{ pointerEvents: "none" }} opacity=".55"><PropIcon type={propIcon} size={PROP_SIZE[2]} x={hover.x - PROP_SIZE[2] / 2} y={hover.y - PROP_SIZE[2] / 2} color={C.emberT} /></g>}
      {/* the selected shape's corners */}
      {selected && tool === "select" && selected.kind !== "prop" && pts(selected).map((p, i) => (
        <rect key={i} x={p.x - 4} y={p.y - 4} width={8} height={8} fill={C.bg} stroke={C.ember} strokeWidth="1.5" style={{ cursor: "crosshair" }}
          onPointerDown={(e) => startDrag(e, selected, [i])} onDoubleClick={(e) => { e.stopPropagation(); removeVertex(selected, i); }} />
      ))}
      {/* the drawing in progress */}
      {drawing && draft.length > 0 && (
        <g style={{ pointerEvents: "none" }}>
          <polyline points={[...draft, ...(hover ? [hover] : [])].map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={C.ember} strokeWidth="1.5" strokeDasharray="5 4" />
          {draft.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={i === 0 && tool === "area" && draft.length >= 3 ? 6 : 3.5} fill={i === 0 ? C.ember : C.bg} stroke={C.ember} strokeWidth="1.5" />)}
        </g>
      )}
      {drawing && hover && <circle cx={hover.x} cy={hover.y} r={3} fill={C.ember} opacity=".6" style={{ pointerEvents: "none" }} />}
    </g>
  );

  // ---- the tool rail -----------------------------------------------------------
  const rail: ReactNode = !active ? null : (
    <div style={{ position: "absolute", top: 50, left: 14, zIndex: 3, display: "flex", flexDirection: "column", gap: 6, padding: 6, background: "rgba(16,19,24,.92)", border: `1px solid ${C.b2}`, borderRadius: 8 }}>
      {TOOLS.map((t) => {
        const on = tool === t.id;
        return (
          <button key={t.id} title={t.title} onClick={() => { setTool(t.id); setDraft([]); if (t.id !== "select") setSel(null); }} style={{
            width: 58, height: 42, borderRadius: 7, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, padding: 0,
            background: on ? C.emberBg : C.raised, border: `1px solid ${on ? C.ember : C.b3}`, color: on ? C.emberT : C.t3,
          }}>{ICONS[t.id]}<span style={{ font: "600 9px system-ui", letterSpacing: ".02em" }}>{t.name}</span></button>
        );
      })}
      {placing && (
        <div style={{ position: "absolute", left: 66, top: 0, zIndex: 6, width: 232, padding: 8, background: "rgba(16,19,24,.98)", border: `1px solid ${C.b2}`, borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.5)" }}>
          <div style={{ font: "600 9.5px system-ui", letterSpacing: ".1em", color: C.t5, marginBottom: 6 }}>PLACE A…</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
            {PROP_TYPES.filter((p) => p.id !== "hub" && p.id !== "generic").map((p) => {
              const on = p.id === propIcon;
              return <div key={p.id} title={p.label} onClick={() => setPropIcon(p.id)} style={{ height: 38, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 6, cursor: "pointer", background: on ? C.emberBg2 : C.card, border: `1px solid ${on ? C.emberB : C.b2}` }}>
                <PropIcon type={p.id} size={20} color={on ? C.emberT : C.t3} />
              </div>;
            })}
          </div>
          <div style={{ ...sys(500, 11, C.t4), marginTop: 6 }}>{PROP_TYPES.find((p) => p.id === propIcon)?.label} — click the map to place it</div>
        </div>
      )}
      <button title="Undo (⌘/ctrl-Z)" onClick={undo} disabled={!undoable} style={{
        width: 58, height: 32, borderRadius: 7, cursor: undoable ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: 0,
        background: C.raised, border: `1px solid ${C.b3}`, color: C.t4, opacity: undoable ? 1 : 0.4,
      }}>{ICONS.undo}<span style={{ font: "600 9px system-ui" }}>Undo</span></button>
    </div>
  );

  // ---- the selected shape's panel, the hints, the scale ---------------------
  const field: React.CSSProperties = { height: 26, padding: "0 7px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 5, outline: "none", ...sys(500, 11.5, C.t1) };
  const panel: ReactNode = !active || !doc ? null : (
    <div style={{ position: "absolute", right: 14, bottom: 14, zIndex: 3, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", background: "rgba(16,19,24,.95)", border: `1px solid ${C.b2}`, borderRadius: 7, maxWidth: 640 }}>
      {selected ? (
        <>
          <span style={{ ...mono(700, 10, C.t5), letterSpacing: ".08em" }}>{selected.kind === "path" ? "WALKWAY" : selected.kind === "line" ? "BORDER" : selected.kind.toUpperCase()}</span>
          {selected.kind === "prop" && (
            <select value={selected.icon ?? "generic"} onChange={(e) => update(selected.id, { icon: e.target.value as PropType })} style={field}>
              {PROP_TYPES.filter((p) => p.id !== "hub").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          )}
          {selected.kind === "prop" && (
            <select value={selected.size ?? 2} onChange={(e) => update(selected.id, { size: Number(e.target.value) as 1 | 2 | 3 })} style={field}>
              <option value={1}>small</option><option value={2}>medium</option><option value={3}>large</option>
            </select>
          )}
          <input autoFocus value={selected.label ?? ""} placeholder={selected.kind === "area" ? "house, garage…" : selected.kind === "path" ? "driveway, sidewalk…" : selected.kind === "prop" ? "name it…" : "property line…"}
            maxLength={24} onChange={(e) => update(selected.id, { label: e.target.value })} style={{ ...field, width: 150 }} />
          <span style={{ display: "flex", gap: 4 }} title="Color">
            {COLORS.map((o) => {
              const on = (selected.color ?? COLORS[0].c) === o.c;
              return <span key={o.c} title={o.name} onClick={() => update(selected.id, { color: o.c === COLORS[0].c ? undefined : o.c })}
                style={{ width: 16, height: 16, borderRadius: 4, cursor: "pointer", background: o.c, border: `1px solid ${on ? C.ember : C.b3}`, boxShadow: on ? `0 0 0 1px ${C.ember}` : undefined }} />;
            })}
          </span>
          {selected.kind === "path" && (
            <select value={selected.w ?? 16} onChange={(e) => update(selected.id, { w: Number(e.target.value) })} style={field}>
              {PATH_WIDTHS.map((o) => <option key={o.w} value={o.w}>{o.label} · {((o.w / GRID) * doc.scale_ft).toFixed(0)} ft</option>)}
            </select>
          )}
          <button onClick={() => { commit({ ...doc, shapes: doc.shapes.filter((s) => s.id !== selected.id) }); setSel(null); }} style={{ ...field, cursor: "pointer", color: C.red }}>Remove</button>
          {selected.kind !== "prop" && <span style={mono(500, 10.5, C.t5)}>drag an edge to push it · double-click an edge for a new corner · double-click a corner to remove it</span>}
        </>
      ) : placing ? (
        <span style={sys(500, 11.5, C.t3)}>Click where the prop stands · pick another picture on the left · Esc or Select when done</span>
      ) : drawing ? (
        <span style={sys(500, 11.5, C.t3)}>
          {draft.length === 0 ? `Click to start the ${tool === "path" ? "walkway" : tool === "line" ? "border" : tool}.` : tool === "area" ? "Click the next corner · click the first corner or double-click to close · Esc cancels" : "Click the next point · double-click or Enter to finish · Esc cancels"}
        </span>
      ) : (
        <span style={mono(500, 10.5, C.t5)}>drag boards to where they sit · draw the yard with the tools on the left · scroll to zoom, drag empty ground to pan</span>
      )}
      <span style={{ display: "flex", alignItems: "center", gap: 5, ...mono(500, 10.5, C.t5) }}>
        · 1 square =
        <input type="number" min={1} max={50} value={doc.scale_ft} onChange={(e) => commit({ ...doc, scale_ft: Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 5)) })}
          style={{ ...field, width: 46, height: 22, ...mono(500, 11, C.t1) }} /> ft
      </span>
      {status && <span style={mono(500, 10.5, status.bad ? C.amber : C.t5)} title={status.text}>· {status.bad ? "⚠ " : ""}{status.text.length > 60 && status.bad ? status.text.slice(0, 58) + "…" : status.text}</span>}
      {doc && size(doc) > MAX_BYTES * 0.8 && !status?.bad && <span style={mono(500, 10.5, C.amber)}>· map {Math.round((size(doc) / MAX_BYTES) * 100)}% full</span>}
    </div>
  );

  return {
    doc, layer, rail, panel, setPos, setIcon, bounds,
    icon: (nodeId: string): PropType | undefined => doc?.icons?.[nodeId],
    drawing, placing,
    pos: (id: string): Pt | null => { const p = doc?.pos[id]; return p ? { x: p[0], y: p[1] } : null; },
    onBgDown, onMove, onUp, onBgDouble: () => { if (drawing) finish(); },
  };
}

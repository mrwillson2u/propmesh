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
  GRID, MAP_H, MAP_W, MAX_BYTES, SHAPE_DEFAULT, loadYard, saveYard, shapeId, size, snap, stamp,
  type Shape, type ShapeKind, type YardDoc,
} from "../../lib/yardMap";

export type Tool = "select" | ShapeKind | "erase";
type Pt = { x: number; y: number };

const TOOLS: { id: Tool; icon: string; title: string }[] = [
  { id: "select", icon: "➤", title: "Select — drag boards and shapes; drag a shape's corners to reshape it" },
  { id: "area", icon: "▱", title: "Area — click the corners of a building, bed or lawn; click the first corner (or double-click) to close it" },
  { id: "path", icon: "▬", title: "Path — a driveway or sidewalk: click along it, double-click to finish" },
  { id: "line", icon: "╱", title: "Line — a property line or fence: click along it, double-click to finish" },
  { id: "erase", icon: "⌫", title: "Erase — click a shape to remove it" },
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
const clampPt = (p: Pt): Pt => ({ x: Math.max(0, Math.min(MAP_W, p.x)), y: Math.max(0, Math.min(MAP_H, p.y)) });

export function toMap(svg: SVGSVGElement | null, cx: number, cy: number): Pt {
  const m = svg?.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(cx, cy).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}

export function useBlueprint(conn: Connection, active: boolean, svgRef: RefObject<SVGSVGElement>) {
  const [doc, setDoc] = useState<YardDoc | null>(null);
  const [onBoard, setOnBoard] = useState(false);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<Pt[]>([]);
  const [hover, setHover] = useState<Pt | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; vertex: number | null; from: Pt; orig: number[] } | null>(null);
  const history = useRef<YardDoc[]>([]);
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

  // Keys: Enter finishes, Escape cancels, ⌘/ctrl-Z undoes, Delete removes the selected shape.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      if (e.key === "Escape") { setDraft([]); setSel(null); }
      else if (e.key === "Enter" && draft.length) finish();
      else if ((e.metaKey || e.ctrlKey) && e.key === "z" && !typing) { e.preventDefault(); undo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel && !typing && doc) {
        commit({ ...doc, shapes: doc.shapes.filter((s) => s.id !== sel) });
        setSel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, draft, finish, undo, sel, doc, commit]);

  const drawing = tool === "area" || tool === "path" || tool === "line";

  // Background pointer events, from the map's <svg>.
  const onBgDown = (p: Pt) => {
    if (!drawing) { setSel(null); return; }
    const q = clampPt({ x: snap(p.x), y: snap(p.y) });
    // Click the first corner again to close an area.
    if (tool === "area" && draft.length >= 3 && Math.hypot(q.x - draft[0].x, q.y - draft[0].y) < GRID * 0.6) { finish(); return; }
    setDraft([...draft, q]);
  };
  const onMove = (p: Pt) => {
    if (drawing) setHover(clampPt({ x: snap(p.x), y: snap(p.y) }));
    if (drag && doc) {
      const dx = snap(p.x - drag.from.x), dy = snap(p.y - drag.from.y);
      const moved = drag.orig.map((v, i) => (drag.vertex === null || Math.floor(i / 2) === drag.vertex ? v + (i % 2 ? dy : dx) : v));
      setDoc({ ...doc, shapes: doc.shapes.map((s) => (s.id === drag.id ? { ...s, pts: moved.map((v, i) => Math.max(0, Math.min(i % 2 ? MAP_H : MAP_W, v))) } : s)) });
    }
  };
  const onUp = () => {
    if (drag && doc) {
      const before = history.current;
      commit(doc, false);
      history.current = before;
      setDrag(null);
    }
  };

  const startDrag = (e: React.PointerEvent, s: Shape, vertex: number | null) => {
    e.stopPropagation();
    if (tool === "erase" && doc) { commit({ ...doc, shapes: doc.shapes.filter((x) => x.id !== s.id) }); return; }
    if (tool !== "select" || !doc) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setSel(s.id);
    history.current = [...history.current.slice(-29), doc];
    setDrag({ id: s.id, vertex, from: toMap(svgRef.current, e.clientX, e.clientY), orig: [...s.pts] });
  };

  const update = (id: string, patch: Partial<Shape>) => doc && commit({ ...doc, shapes: doc.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) });

  // ---- the layer: grid, shapes, the drawing in progress ----------------------
  const selected = doc?.shapes.find((s) => s.id === sel) ?? null;
  const layer: ReactNode = !active || !doc ? null : (
    <g>
      <defs>
        <pattern id="yard-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke={C.grid} strokeWidth="1" />
        </pattern>
      </defs>
      <rect data-bg="1" x={0} y={0} width={MAP_W} height={MAP_H} fill="url(#yard-grid)" />
      {/* paths first (under), then areas, then lines on top */}
      {doc.shapes.filter((s) => s.kind === "path").map((s) => {
        const ps = pts(s), m = midOf(ps), on = s.id === sel;
        return (
          <g key={s.id} onPointerDown={(e) => startDrag(e, s, null)} style={{ cursor: tool === "erase" ? "not-allowed" : tool === "select" ? "move" : undefined }}>
            <polyline points={ps.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={on ? "#2c3240" : "#22262d"} strokeWidth={s.w ?? 16} strokeLinejoin="round" />
            {s.label && m && <text x={m.x} y={m.y + 4} textAnchor="middle" fontFamily={MONO} fontSize="11" fill={C.t5} style={{ pointerEvents: "none" }}>{s.label}</text>}
          </g>
        );
      })}
      {doc.shapes.filter((s) => s.kind === "area").map((s) => {
        const ps = pts(s), c = centroid(ps), on = s.id === sel;
        return (
          <g key={s.id} onPointerDown={(e) => startDrag(e, s, null)} style={{ cursor: tool === "erase" ? "not-allowed" : tool === "select" ? "move" : undefined }}>
            <polygon points={ps.map((p) => `${p.x},${p.y}`).join(" ")} fill={C.card} stroke={on ? C.t4 : C.wire} strokeWidth="1.5" />
            {s.label && <text x={c.x} y={c.y + 4} textAnchor="middle" fontFamily={MONO} fontSize="12" letterSpacing="1.5" fill={C.t5} style={{ pointerEvents: "none" }}>{s.label.toUpperCase()}</text>}
          </g>
        );
      })}
      {doc.shapes.filter((s) => s.kind === "line").map((s) => {
        const ps = pts(s), m = midOf(ps), on = s.id === sel;
        return (
          <g key={s.id} onPointerDown={(e) => startDrag(e, s, null)} style={{ cursor: tool === "erase" ? "not-allowed" : tool === "select" ? "move" : undefined }}>
            <polyline points={ps.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="transparent" strokeWidth="12" />
            <polyline points={ps.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={on ? C.t4 : C.b3} strokeWidth="1.5" strokeDasharray="7 6" />
            {s.label && m && <text x={m.x} y={m.y - 6} textAnchor="middle" fontFamily={MONO} fontSize="11" fill={C.t5} style={{ pointerEvents: "none" }}>{s.label}</text>}
          </g>
        );
      })}
      {/* the selected shape's corners */}
      {selected && tool === "select" && pts(selected).map((p, i) => (
        <rect key={i} x={p.x - 4} y={p.y - 4} width={8} height={8} fill={C.bg} stroke={C.ember} strokeWidth="1.5" style={{ cursor: "crosshair" }}
          onPointerDown={(e) => startDrag(e, selected, i)} />
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
            width: 36, height: 36, borderRadius: 7, cursor: "pointer", fontSize: 14,
            background: on ? C.emberBg : C.raised, border: `1px solid ${on ? C.ember : C.b3}`, color: on ? C.emberT : C.t3,
          }}>{t.icon}</button>
        );
      })}
      <button title="Undo (⌘/ctrl-Z)" onClick={undo} disabled={!history.current.length} style={{
        width: 36, height: 30, borderRadius: 7, cursor: "pointer", background: C.raised, border: `1px solid ${C.b3}`, color: C.t4, fontSize: 13, opacity: history.current.length ? 1 : 0.4,
      }}>↶</button>
    </div>
  );

  // ---- the selected shape's panel, the hints, the scale ---------------------
  const field: React.CSSProperties = { height: 26, padding: "0 7px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 5, outline: "none", ...sys(500, 11.5, C.t1) };
  const panel: ReactNode = !active || !doc ? null : (
    <div style={{ position: "absolute", right: 14, bottom: 14, zIndex: 3, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", background: "rgba(16,19,24,.95)", border: `1px solid ${C.b2}`, borderRadius: 7, maxWidth: 640 }}>
      {selected ? (
        <>
          <span style={{ ...mono(700, 10, C.t5), letterSpacing: ".08em" }}>{selected.kind.toUpperCase()}</span>
          <input autoFocus value={selected.label ?? ""} placeholder={selected.kind === "area" ? "house, garage…" : selected.kind === "path" ? "driveway, sidewalk…" : "property line…"}
            maxLength={24} onChange={(e) => update(selected.id, { label: e.target.value })} style={{ ...field, width: 150 }} />
          {selected.kind === "path" && (
            <select value={selected.w ?? 16} onChange={(e) => update(selected.id, { w: Number(e.target.value) })} style={field}>
              {PATH_WIDTHS.map((o) => <option key={o.w} value={o.w}>{o.label} · {((o.w / GRID) * doc.scale_ft).toFixed(0)} ft</option>)}
            </select>
          )}
          <button onClick={() => { commit({ ...doc, shapes: doc.shapes.filter((s) => s.id !== selected.id) }); setSel(null); }} style={{ ...field, cursor: "pointer", color: C.red }}>Remove</button>
        </>
      ) : drawing ? (
        <span style={sys(500, 11.5, C.t3)}>
          {draft.length === 0 ? `Click to start the ${tool}.` : tool === "area" ? "Click the next corner · click the first corner or double-click to close · Esc cancels" : "Click the next point · double-click or Enter to finish · Esc cancels"}
        </span>
      ) : (
        <span style={mono(500, 10.5, C.t5)}>drag boards to where they sit · draw the yard with the tools on the left</span>
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
    doc, layer, rail, panel, setPos,
    drawing,
    pos: (id: string): Pt | null => { const p = doc?.pos[id]; return p ? { x: p[0], y: p[1] } : null; },
    onBgDown, onMove, onUp, onBgDouble: () => { if (drawing) finish(); },
  };
}

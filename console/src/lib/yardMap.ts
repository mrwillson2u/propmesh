// The Yard's Map (handoff 1e "Blueprint"): a drawing of the yard — areas
// (house, garage, beds), paths (driveway, sidewalk), lines (property line,
// fence) — with every board and flood placed where it physically sits.
//
// One document, kept ON THE BOARD the console is connected to (normally
// the bridge: `get_yard` / `set_yard`, firmware /yard.json), so the phone
// in the yard and the laptop indoors see the same map. Newest edit wins
// (`at`, as everywhere else — docs §6k). The browser keeps a copy for when
// no board is connected, and positions placed before 2026-10-12 (browser
// only) are folded in on first load.
//
// Coordinates are map units in a 1000 × 640 frame; GRID units make one
// grid square, which is `scale_ft` feet. Everything is whole numbers and
// points are flat [x, y, x, y, …] so the document fits one 4 KB request.
import { target, type NodeLink } from "./transport";

export const MAP_W = 1000, MAP_H = 640, GRID = 20;
export const MAX_BYTES = 3800;  // a set_yard request must fit the board's 4 KB line

export type ShapeKind = "area" | "path" | "line";
export interface Shape {
  id: string;
  kind: ShapeKind;
  pts: number[];   // x0, y0, x1, y1, …
  label?: string;
  w?: number;      // path: width in map units (a sidewalk ~ half a square, a driveway ~ 1.5)
}
export interface YardDoc {
  v: 1;
  at: number;                          // UTC s of the last edit
  scale_ft: number;                    // feet per grid square
  shapes: Shape[];
  pos: Record<string, [number, number]>;  // board / flood id → where it sits
}

export const EMPTY_YARD: YardDoc = { v: 1, at: 0, scale_ft: 5, shapes: [], pos: {} };
export const SHAPE_DEFAULT: Record<ShapeKind, Partial<Shape>> = {
  area: { label: "" },
  path: { w: 16 },
  line: {},
};

const LOCAL = "propmesh.yard.doc";
const OLD_POS = "propmesh.yard.pos.";  // per-id browser positions, before 2026-10-12

let seq = 0;
export const shapeId = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;
export const snap = (v: number) => Math.round(v / (GRID / 4)) * (GRID / 4);
export const size = (d: YardDoc) => JSON.stringify(d).length;

function localDoc(): YardDoc | null {
  try { const d = JSON.parse(localStorage.getItem(LOCAL) ?? "null"); return d && d.v === 1 ? d : null; } catch { return null; }
}
function saveLocal(d: YardDoc) {
  try { localStorage.setItem(LOCAL, JSON.stringify(d)); } catch { /* private mode */ }
}
// Positions the old Map kept per browser, keyed by id.
function oldPositions(): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(OLD_POS)) continue;
      const p = JSON.parse(localStorage.getItem(k) ?? "null");
      if (p && typeof p.x === "number") out[k.slice(OLD_POS.length)] = [Math.round(p.x), Math.round(p.y)];
    }
  } catch { /* private mode */ }
  return out;
}

// The board's copy if it has one, else the browser's, newest first; old
// browser positions fill in anything neither has placed.
export async function loadYard(link: NodeLink | null): Promise<{ doc: YardDoc; onBoard: boolean }> {
  let board: YardDoc | null = null, onBoard = false;
  if (link) {
    try {
      const r = await target(link, null).request("get_yard");
      if (r.ok) { onBoard = true; if (r.yard && (r.yard as YardDoc).v === 1) board = r.yard as YardDoc; }
    } catch { /* an older firmware: no get_yard */ }
  }
  const local = localDoc();
  const best = board && local ? (local.at > board.at ? local : board) : board ?? local ?? { ...EMPTY_YARD };
  const doc: YardDoc = { ...EMPTY_YARD, ...best, pos: { ...oldPositions(), ...best.pos } };
  return { doc, onBoard };
}

// Stamp, keep in the browser, and write to the board. Returns an error to
// show, or null.
export async function saveYard(link: NodeLink | null, d: YardDoc): Promise<string | null> {
  saveLocal(d);
  if (size(d) > MAX_BYTES) return `The map is too detailed to store on the board (${size(d)} of ${MAX_BYTES} bytes) — kept in this browser only. Remove a shape or some points.`;
  if (!link) return null;
  try {
    const r = await target(link, null).request("set_yard", { yard: d, at: d.at });
    if (!r.ok) return r.error === "unknown command" ? "This board's firmware can't store the map yet — kept in this browser. Update it to share the map with other devices." : `Not saved on the board: ${r.error}`;
  } catch (e) {
    return `Not saved on the board: ${(e as Error).message}`;
  }
  return null;
}

export const stamp = (d: YardDoc): YardDoc => ({ ...d, at: Math.floor(Date.now() / 1000) });

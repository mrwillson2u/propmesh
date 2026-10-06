// Timeline editor: time across, value up, one track per output. Drag a
// keyframe to move it (live preview follows); double-click a track to
// add one; click the line into a keyframe to switch it between a ramp
// and a jump; drag in the ruler to scrub every output to that moment.
// It edits the same steps the list below shows — lib/timeline.ts holds
// the model, so the two can't disagree.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { C, MONO } from "../../lib/tokens";
import { mono, sys } from "../../ui";
import type { ChannelKindName } from "../../lib/boards_gen";
import { canRamp, lengthMs, type Sequence, type Step } from "../../lib/show";
import {
  addKey, moveKey, range, segmentPoints, snapT, snapV, toggleRamp, tracks, valueAt, type Track,
} from "../../lib/timeline";

const LABEL_W = 180, PAD_R = 18, RULER_H = 26, GAP = 6;
const H_VALUE = 76, H_SWITCH = 34;
const COLORS = [C.emberT, C.green, "#7d87b8", C.amber, "#c678dd", "#56b6c2", "#e06c75", "#98c379"];
const LIVE_KINDS: ChannelKindName[] = ["SERVO", "LED", "LED_STRIP"];

// Keep receiving moves after the pointer leaves the element. Must never
// abort the handler: it throws for a pointer the browser isn't tracking.
const capture = (e: React.PointerEvent) => {
  try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* fine */ }
};

const hex = (v: number) => "#" + (v & 0xffffff).toString(16).padStart(6, "0");
const trackH = (kind: ChannelKindName) => (kind === "RELAY" || kind === "LED_STRIP" ? H_SWITCH : H_VALUE);

export interface Output { node: string; kind: ChannelKindName; index: number; label: string }

export default function Timeline({ seq, onChange, selected, onSelect, nameOf, outputs, live, onLive, playingFrom }: {
  seq: Sequence;
  onChange: (s: Sequence) => void;
  selected: number | null; // step index
  onSelect: (i: number | null) => void;
  nameOf: (node: string) => string;
  outputs: Output[]; // every output on the mesh, for Add track
  live: boolean;
  onLive: (st: Step) => void;
  playingFrom: number | null; // Date.now() at which t = 0 of a playback, for the moving playhead
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  // `D` is the visible span at drag start: the scale must not change
  // under the pointer while a key is dragged past the current end.
  const [drag, setDrag] = useState<{ idx: number; D: number } | { scrub: true; D: number } | null>(null);
  const [scrubT, setScrubT] = useState<number | null>(null);
  const [playT, setPlayT] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (!wrap.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(480, e.contentRect.width)));
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const trs = tracks(seq);
  const length = lengthMs(seq);
  const fitD = Math.max(2000, Math.ceil((length * 1.15) / 500) * 500); // visible span, ms
  const D = drag ? drag.D : fitD;
  const plotW = width - LABEL_W - PAD_R;
  const tx = (t: number) => LABEL_W + (t / D) * plotW;
  const xt = (x: number) => ((x - LABEL_W) / plotW) * D;
  const tops: number[] = [];
  let y = RULER_H + GAP;
  for (const tr of trs) { tops.push(y); y += trackH(tr.kind) + GAP; }
  const height = y + 4;

  const vy = (tr: Track, top: number, v: number) => {
    const [lo, hi] = range(tr.kind);
    const h = trackH(tr.kind), pad = tr.kind === "RELAY" ? 9 : 10;
    return top + h - pad - ((v - lo) / (hi - lo)) * (h - 2 * pad);
  };
  const yv = (tr: Track, top: number, py: number) => {
    const [lo, hi] = range(tr.kind);
    const h = trackH(tr.kind), pad = tr.kind === "RELAY" ? 9 : 10;
    return lo + ((top + h - pad - py) / (h - 2 * pad)) * (hi - lo);
  };

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  // Moving playhead while a playback runs.
  useEffect(() => {
    if (playingFrom === null) { setPlayT(null); return; }
    let raf = 0;
    const tick = () => {
      const t = Date.now() - playingFrom;
      if (t > length + 300) { setPlayT(null); return; }
      setPlayT(Math.max(0, t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playingFrom, length]);

  // ---- interaction ------------------------------------------------------

  const scrubTo = (t: number) => {
    const tt = Math.max(0, Math.min(D, t));
    setScrubT(tt);
    if (!live) return;
    for (const tr of trs) {
      if (!LIVE_KINDS.includes(tr.kind)) continue;
      const v = valueAt(seq, tr, tt);
      if (v !== null) onLive({ t_ms: tt, node: tr.node, kind: tr.kind, index: tr.index, value: Math.round(v) });
    }
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const { x, y: py } = toLocal(e);
    if ("scrub" in drag) { scrubTo(xt(x)); return; }
    const s = seq.steps[drag.idx];
    const ti = trs.findIndex((tr) => tr.steps.includes(drag.idx));
    if (ti < 0) return;
    const tr = trs[ti];
    const t = Math.max(0, Math.min(D, snapT(xt(x))));
    const v = tr.kind === "LED_STRIP" ? s.value : snapV(yv(tr, tops[ti], py), tr.kind);
    if (t === s.t_ms && v === s.value) return;
    onChange(moveKey(seq, drag.idx, t, v));
    if (live && v !== s.value && LIVE_KINDS.includes(s.kind)) onLive({ ...s, value: v });
  };
  const endDrag = () => { setDrag(null); setScrubT(null); };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y: py } = toLocal(e);
    const ti = tops.findIndex((top, i) => py >= top && py <= top + trackH(trs[i].kind));
    if (ti < 0 || x < LABEL_W) return;
    const tr = trs[ti];
    const t = Math.max(0, snapT(xt(x)));
    const v = tr.kind === "LED_STRIP" ? (valueAt(seq, tr, t) ?? 0xff5500) : snapV(yv(tr, tops[ti], py), tr.kind);
    const r = addKey(seq, tr, t, Math.round(v));
    onChange(r.seq);
    onSelect(r.index);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
      e.preventDefault();
      onChange({ ...seq, steps: seq.steps.filter((_, i) => i !== selected) });
      onSelect(null);
    }
  };

  const addTrack = (key: string) => {
    const o = outputs.find((x) => `${x.node}/${x.kind}_${x.index}` === key);
    if (!o) return;
    const v = o.kind === "RELAY" ? 1 : o.kind === "LED_STRIP" ? 0xff5500 : 500;
    const r = addKey(seq, o, 0, v);
    onChange(r.seq);
    onSelect(r.index);
  };
  const free = outputs.filter((o) => !trs.some((tr) => tr.node === o.node && tr.kind === o.kind && tr.index === o.index));

  // ---- ruler ------------------------------------------------------------

  const tick = D <= 4000 ? 500 : D <= 12000 ? 1000 : D <= 40000 ? 5000 : 10000;
  const ticks: number[] = [];
  for (let t = 0; t <= D; t += tick) ticks.push(t);
  const cursorT = scrubT ?? playT;

  return (
    <div ref={wrap} tabIndex={0} onKeyDown={onKey} style={{ outline: "none", borderRadius: 8, border: `1px solid ${C.b2}`, background: C.card, overflow: "hidden" }}>
      <svg ref={svg} width={width} height={height} style={{ display: "block", userSelect: "none", touchAction: "none", cursor: drag ? ("scrub" in drag ? "ew-resize" : "grabbing") : "default" }}
        onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag} onDoubleClick={onDoubleClick}>
        {/* ruler */}
        <rect x={0} y={0} width={width} height={RULER_H} fill={C.panel} />
        <rect x={LABEL_W} y={0} width={plotW} height={RULER_H} fill="transparent" style={{ cursor: "ew-resize" }}
          onPointerDown={(e) => { capture(e); setDrag({ scrub: true, D }); scrubTo(xt(toLocal(e).x)); }} />
        {ticks.map((t) => (
          <g key={t} style={{ pointerEvents: "none" }}>
            <line x1={tx(t)} y1={RULER_H - 6} x2={tx(t)} y2={height} stroke={C.b1} />
            <text x={tx(t) + 3} y={RULER_H - 9} fontFamily={MONO} fontSize="10" fill={C.t5}>{t / 1000}s</text>
          </g>
        ))}
        <text x={8} y={RULER_H - 9} fontFamily="system-ui" fontSize="10" fontWeight="600" letterSpacing=".08em" fill={C.t5}>
          {trs.length ? "DRAG RULER TO SCRUB" : ""}
        </text>

        {/* tracks */}
        {trs.map((tr, ti) => {
          const top = tops[ti], h = trackH(tr.kind), color = COLORS[ti % COLORS.length];
          const chLabel = outputs.find((o) => o.node === tr.node && o.kind === tr.kind && o.index === tr.index)?.label;
          const last = seq.steps[tr.steps[tr.steps.length - 1]];
          return (
            <g key={tr.key}>
              <rect x={LABEL_W} y={top} width={plotW} height={h} fill={C.panel} opacity=".6" />
              {tr.kind === "MOTOR" && <line x1={LABEL_W} y1={vy(tr, top, 0)} x2={width - PAD_R} y2={vy(tr, top, 0)} stroke={C.b3} strokeDasharray="2 4" />}
              {/* label */}
              <circle cx={14} cy={top + 14} r={4} fill={color} />
              <text x={24} y={top + 18} fontFamily="system-ui" fontSize="12" fontWeight="600" fill={C.t1}>{nameOf(tr.node)}</text>
              <text x={24} y={top + 32} fontFamily={MONO} fontSize="10.5" fill={C.t4}>{tr.kind}_{tr.index}{chLabel ? ` · ${chLabel}` : ""}</text>
              {tr.kind !== "RELAY" && tr.kind !== "LED_STRIP" && (
                <>
                  <text x={LABEL_W - 6} y={top + 13} textAnchor="end" fontFamily={MONO} fontSize="9" fill={C.t6}>{tr.kind === "MOTOR" ? "+100" : "100%"}</text>
                  <text x={LABEL_W - 6} y={top + h - 5} textAnchor="end" fontFamily={MONO} fontSize="9" fill={C.t6}>{tr.kind === "MOTOR" ? "−100" : "0%"}</text>
                </>
              )}

              {/* lines into each key */}
              {tr.steps.map((idx, k) => {
                const s = seq.steps[idx];
                if (tr.kind === "LED_STRIP") {
                  const prev = k > 0 ? seq.steps[tr.steps[k - 1]] : null;
                  return prev ? <rect key={"bar" + idx} x={tx(prev.t_ms)} y={top + 10} width={Math.max(0, tx(s.t_ms) - tx(prev.t_ms))} height={h - 20} fill={hex(prev.value)} opacity=".8" /> : null;
                }
                const pts = segmentPoints(seq, tr, idx);
                const d = pts.map((p, i) => `${i ? "L" : "M"}${tx(p.t).toFixed(1)},${vy(tr, top, p.v).toFixed(1)}`).join(" ");
                const firstRamp = k === 0 && (s.dur_ms ?? 0) > 0; // from wherever the output is
                return (
                  <g key={"seg" + idx}>
                    <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={firstRamp ? "4 4" : ""} opacity={k === 0 && !firstRamp ? 0 : 0.9} />
                    {canRamp(tr.kind) && k > 0 && (
                      <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); onChange(toggleRamp(seq, idx)); onSelect(idx); }}>
                        <title>{(s.dur_ms ?? 0) > 0 ? "Ramp — click to make it a jump" : "Jump — click to make it a ramp"}</title>
                      </path>
                    )}
                  </g>
                );
              })}
              {/* hold after the last key */}
              {last && tr.kind !== "LED_STRIP" && (
                <line x1={tx(last.t_ms)} y1={vy(tr, top, last.value)} x2={width - PAD_R} y2={vy(tr, top, last.value)} stroke={color} strokeWidth={1.5} strokeDasharray="2 5" opacity=".6" />
              )}
              {last && tr.kind === "LED_STRIP" && (
                <rect x={tx(last.t_ms)} y={top + 10} width={Math.max(0, width - PAD_R - tx(last.t_ms))} height={h - 20} fill={hex(last.value)} opacity=".35" />
              )}

              {/* keys */}
              {tr.steps.map((idx) => {
                const s = seq.steps[idx];
                const cx = tx(s.t_ms), cy = tr.kind === "LED_STRIP" ? top + h / 2 : vy(tr, top, s.value);
                const on = selected === idx;
                return (
                  <g key={"key" + idx} style={{ cursor: "grab" }}
                    onPointerDown={(e) => { e.stopPropagation(); capture(e); setDrag({ idx, D }); onSelect(idx); }}
                    onDoubleClick={(e) => e.stopPropagation()}>
                    {on && <circle cx={cx} cy={cy} r={11} fill="none" stroke={C.ember} strokeWidth={1.5} strokeDasharray="3 3" />}
                    {tr.kind === "LED_STRIP"
                      ? <rect x={cx - 7} y={cy - 7} width={14} height={14} rx={3} fill={hex(s.value)} stroke={on ? C.ember : C.t1} strokeWidth={1.5} />
                      : <circle cx={cx} cy={cy} r={on ? 6.5 : 5.5} fill={C.card} stroke={on ? C.ember : color} strokeWidth={2.5} />}
                    <title>{`${(s.t_ms / 1000).toFixed(2)} s · ${tr.kind === "RELAY" ? (s.value ? "on" : "off") : tr.kind === "LED_STRIP" ? hex(s.value) : `${Math.round(s.value / 10)}%`}${(s.dur_ms ?? 0) ? ` · ramp over ${(s.dur_ms! / 1000).toFixed(2)} s (${s.ease ?? "inout"})` : ""}\nDrag to move · Delete to remove`}</title>
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* cursor */}
        {cursorT !== null && (
          <g style={{ pointerEvents: "none" }}>
            <line x1={tx(cursorT)} y1={0} x2={tx(cursorT)} y2={height} stroke={C.ember} strokeWidth={1.5} />
            <rect x={tx(cursorT) - 22} y={2} width={44} height={16} rx={3} fill={C.ember} />
            <text x={tx(cursorT)} y={14} textAnchor="middle" fontFamily={MONO} fontSize="10" fontWeight="700" fill={C.onEmber}>{(cursorT / 1000).toFixed(2)}s</text>
          </g>
        )}

        {trs.length === 0 && (
          <text x={LABEL_W + plotW / 2} y={RULER_H + 30} textAnchor="middle" fontFamily="system-ui" fontSize="12" fill={C.t4}>
            Add a track below — then double-click it to place keyframes.
          </text>
        )}
      </svg>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderTop: `1px solid ${C.b1}`, flexWrap: "wrap" }}>
        <select value="" onChange={(e) => addTrack(e.target.value)} disabled={!free.length}
          style={{ height: 26, padding: "0 8px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 5, ...sys(600, 11.5, C.t2) }}>
          <option value="">+ Add track…</option>
          {free.map((o) => <option key={`${o.node}/${o.kind}_${o.index}`} value={`${o.node}/${o.kind}_${o.index}`}>{nameOf(o.node)} · {o.kind}_{o.index}{o.label ? ` (${o.label})` : ""}</option>)}
        </select>
        <span style={mono(500, 10.5, C.t5)}>
          double-click a track: add keyframe · drag: move · click a line: ramp ⇄ jump · Delete: remove · snaps to 50 ms / 1 %
        </span>
      </div>
    </div>
  );
}

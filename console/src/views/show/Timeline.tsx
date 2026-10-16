// Timeline editor: time across, value up, one track per output. Drag a
// keyframe to move it (live preview follows); double-click a track to
// add one; click the line into a keyframe to switch it between a ramp
// and a jump; drag in the ruler to scrub every output to that moment.
// It edits the same steps the list below shows — lib/timeline.ts holds
// the model, so the two can't disagree.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { C, MONO } from "../../lib/tokens";
import { mono, sys } from "../../ui";
import type { ChannelKindName } from "../../lib/boards_gen";
import { isColor } from "../../lib/nodeConfig";
import { canRamp, lengthMs, type Sequence, type Step } from "../../lib/show";
import {
  addKey, moveKey, range, segmentPoints, snapT, snapV, toggleRamp, tracks, valueAt, type Track,
} from "../../lib/timeline";

const LABEL_W = 180, PAD_R = 18, RULER_H = 26, GAP = 6, SCROLL_H = 12;
// Zoom limits, in pixels per second: two minutes across, or 50 ms per 100 px.
const MIN_PPS = 4, MAX_PPS = 2000;
const TICKS = [100, 200, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000];
const fmtT = (ms: number) => ms >= 60000 ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}` : `${ms / 1000}s`;
const H_VALUE = 76, H_SWITCH = 34;
const COLORS = [C.emberT, C.green, "#7d87b8", C.amber, "#c678dd", "#56b6c2", "#e06c75", "#98c379"];
const LIVE_KINDS: ChannelKindName[] = ["SERVO", "LED", "CANDLE", "LED_STRIP", "SPI_STRIP", "BLE_LIGHT"];

// Keep receiving moves after the pointer leaves the element. Must never
// abort the handler: it throws for a pointer the browser isn't tracking.
const capture = (e: React.PointerEvent) => {
  try { (e.target as Element).setPointerCapture?.(e.pointerId); } catch { /* fine */ }
};

// Zoom (px/s) is remembered per browser; absent = Fit.
const ZOOM_KEY = "propmesh.timeline.zoom";

const zbtn: React.CSSProperties = {
  width: 26, height: 26, padding: 0, borderRadius: 5, background: C.raised, border: `1px solid ${C.b3}`,
  font: `600 13px ${MONO}`, color: C.t2, cursor: "pointer",
};

const hex = (v: number) => "#" + (v & 0xffffff).toString(16).padStart(6, "0");
const trackH = (kind: ChannelKindName) => (kind === "RELAY" || isColor(kind) ? H_SWITCH : H_VALUE);

export interface Output { node: string; kind: ChannelKindName; index: number; label: string }

export default function Timeline({ seq, onChange, selected, onSelect, nameOf, outputs, live, onLive, playingFrom }: {
  seq: Sequence;
  onChange: (s: Sequence) => void;
  selected: number | null; // step uid
  onSelect: (uid: number | null) => void;
  nameOf: (node: string) => string;
  outputs: Output[]; // every output on the mesh, for Add track
  live: boolean;
  onLive: (st: Step) => void;
  playingFrom: number | null; // Date.now() at which t = 0 of a playback, for the moving playhead
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  // Zoom in px/s (null = fit the sequence) and the time at the plot's
  // left edge. Both are frozen in `drag` while something is dragged: in
  // fit mode the scale would otherwise change under the pointer as a
  // key is dragged past the end.
  const [zoom, setZoomState] = useState<number | null>(() => {
    try { const z = Number(localStorage.getItem(ZOOM_KEY)); return z > 0 ? z : null; } catch { return null; }
  });
  const setZoom = (z: number | null) => {
    setZoomState(z);
    try { z ? localStorage.setItem(ZOOM_KEY, String(z)) : localStorage.removeItem(ZOOM_KEY); } catch { /* private mode */ }
  };
  const [scrollMs, setScrollMs] = useState(0);
  // A different sequence starts at its beginning; the zoom is kept.
  // (The parent also remounts this per sequence it opens — an id can be
  // reused after a delete, so seq.id alone isn't enough.)
  useEffect(() => { setScrollMs(0); }, [seq.id]);
  type Drag = { pps: number; scroll: number } & ({ uid: number } | { scrub: true } | { bar: true; startX: number });
  const idxOf = (uid: number | null | undefined) => (uid == null ? -1 : seq.steps.findIndex((s) => s.uid === uid));
  const [drag, setDrag] = useState<Drag | null>(null);
  const clipId = useId();
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
  const plotW = width - LABEL_W - PAD_R;
  // Fit is measured when the sequence opens (or Fit is pressed) and then
  // held: re-fitting on every edit rescaled the view under the pointer
  // as soon as a key went past the end (2026-10-06).
  const fitSpanFor = (len: number) => Math.max(2000, Math.ceil((len * 1.15) / 500) * 500);
  const [fitSpan, setFitSpan] = useState(() => fitSpanFor(lengthMs(seq)));
  const fitPps = (plotW / fitSpan) * 1000;
  const pps = drag ? drag.pps : Math.min(MAX_PPS, Math.max(MIN_PPS, zoom ?? fitPps));
  const visibleMs = (plotW / pps) * 1000;
  // Scrollable span: the sequence plus half a screen to add keys beyond its end.
  const totalMs = Math.max(visibleMs, length + visibleMs / 2);
  const maxScroll = Math.max(0, totalMs - visibleMs);
  const scroll = drag ? drag.scroll : Math.min(scrollMs, maxScroll);
  const tx = (t: number) => LABEL_W + ((t - scroll) * pps) / 1000;
  const xt = (x: number) => scroll + ((x - LABEL_W) * 1000) / pps;
  const tops: number[] = [];
  let y = RULER_H + GAP;
  for (const tr of trs) { tops.push(y); y += trackH(tr.kind) + GAP; }
  const height = y + 4 + (maxScroll > 0 ? SCROLL_H : 0);
  const D = scroll + visibleMs; // right edge, for clamps

  const setScrollClamped = (ms: number) => setScrollMs(Math.max(0, Math.min(maxScroll, ms)));
  const zoomBy = (factor: number, aroundX = LABEL_W + plotW / 2) => {
    const tAt = xt(aroundX);
    const next = Math.min(MAX_PPS, Math.max(MIN_PPS, pps * factor));
    setZoom(next);
    setScrollMs(Math.max(0, tAt - ((aroundX - LABEL_W) * 1000) / next));
  };

  // Wheel: ctrl/⌘ zooms around the pointer; otherwise horizontal (or
  // shift+vertical) scrolls. A native listener — React's onWheel is
  // passive, so it couldn't stop the page scrolling too.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (x < LABEL_W) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(e.deltaY < 0 ? 1.25 : 1 / 1.25, x);
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        e.preventDefault();
        setScrollClamped(scroll + ((e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * 1000) / pps);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  });

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
    if ("bar" in drag) {
      const next = Math.max(0, Math.min(maxScroll, drag.scroll + ((x - drag.startX) / plotW) * totalMs));
      setScrollMs(next);
      setDrag({ ...drag, scroll: next, startX: x });
      return;
    }
    if ("scrub" in drag) { scrubTo(xt(x)); return; }
    // Dragging a key past the right edge scrolls the view along with it.
    if (x > width - PAD_R && scroll < maxScroll) {
      const next = Math.min(maxScroll, scroll + ((x - (width - PAD_R)) * 1000) / pps / 4);
      setScrollMs(next);
      setDrag({ ...drag, scroll: next });
    }
    const idx = idxOf(drag.uid);
    if (idx < 0) return;
    const s = seq.steps[idx];
    const ti = trs.findIndex((tr) => tr.steps.includes(idx));
    if (ti < 0) return;
    const tr = trs[ti];
    const t = Math.max(0, Math.min(D + 50, snapT(xt(x))));
    const v = isColor(tr.kind) ? s.value : snapV(yv(tr, tops[ti], py), tr.kind);
    if (t === s.t_ms && v === s.value) return;
    onChange(moveKey(seq, idx, t, v));
    if (live && v !== s.value && LIVE_KINDS.includes(s.kind)) onLive({ ...s, value: v });
  };
  const endDrag = () => { setDrag(null); setScrubT(null); };

  const onDoubleClick = (e: React.MouseEvent) => {
    const { x, y: py } = toLocal(e);
    const ti = tops.findIndex((top, i) => py >= top && py <= top + trackH(trs[i].kind));
    if (ti < 0 || x < LABEL_W) return;
    const tr = trs[ti];
    const t = Math.max(0, snapT(xt(x)));
    const v = isColor(tr.kind) ? (valueAt(seq, tr, t) ?? 0xff5500) : snapV(yv(tr, tops[ti], py), tr.kind);
    const r = addKey(seq, tr, t, Math.round(v));
    onChange(r.seq);
    onSelect(r.uid);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === "r" || e.key === "R") && selected !== null) {
      const i = idxOf(selected);
      if (i >= 0) { e.preventDefault(); onChange(toggleRamp(seq, i)); }
      return;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) {
      e.preventDefault();
      onChange({ ...seq, steps: seq.steps.filter((s) => s.uid !== selected) });
      onSelect(null);
    }
  };

  const addTrack = (key: string) => {
    const o = outputs.find((x) => `${x.node}/${x.kind}_${x.index}` === key);
    if (!o) return;
    const v = o.kind === "RELAY" ? 1 : isColor(o.kind) ? 0xff5500 : 500;
    const r = addKey(seq, o, 0, v);
    onChange(r.seq);
    onSelect(r.uid);
  };
  const free = outputs.filter((o) => !trs.some((tr) => tr.node === o.node && tr.kind === o.kind && tr.index === o.index));
  const addTrackSelect = (
    <select value="" onChange={(e) => addTrack(e.target.value)} disabled={!free.length}
      style={{ height: trs.length ? 26 : 32, padding: "0 10px", background: trs.length ? C.raised : C.emberBg, border: `1px solid ${trs.length ? C.b3 : C.ember}`, borderRadius: 5, ...sys(600, trs.length ? 11.5 : 12.5, trs.length ? C.t2 : C.emberT) }}>
      <option value="">{trs.length ? "+ Add track…" : "+ Add first track…"}</option>
      {free.map((o) => <option key={`${o.node}/${o.kind}_${o.index}`} value={`${o.node}/${o.kind}_${o.index}`}>{nameOf(o.node)} · {o.kind}_{o.index}{o.label ? ` (${o.label})` : ""}</option>)}
    </select>
  );

  // ---- ruler ------------------------------------------------------------

  // Tick spacing: the smallest step that leaves ~70 px between labels.
  const tick = TICKS.find((t) => (t * pps) / 1000 >= 70) ?? TICKS[TICKS.length - 1];
  const ticks: number[] = [];
  for (let t = Math.floor(scroll / tick) * tick; t <= scroll + visibleMs; t += tick) if (t >= 0) ticks.push(t);
  const cursorT = scrubT ?? playT;
  const barX = LABEL_W + (scroll / totalMs) * plotW;
  const barW = Math.max(24, (visibleMs / totalMs) * plotW);
  const barY = height - SCROLL_H + 2;

  return (
    <div ref={wrap} tabIndex={0} onKeyDown={onKey} style={{ outline: "none", borderRadius: 8, border: `1px solid ${C.b2}`, background: C.card, overflow: "hidden" }}>
      {trs.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "34px 16px" }}>
          <div style={sys(600, 13, C.t1)}>No tracks yet</div>
          <div style={{ ...sys(400, 12, C.t3), textAlign: "center", maxWidth: 440, lineHeight: 1.5 }}>
            A track is one output on one board — a servo, a relay, a light. Pick the first one; it starts with a keyframe at 0 s.
          </div>
          {addTrackSelect}
        </div>
      )}
      {trs.length > 0 && <svg ref={svg} width={width} height={height} style={{ display: "block", userSelect: "none", touchAction: "none", cursor: drag ? ("scrub" in drag ? "ew-resize" : "grabbing") : "default" }}
        onPointerMove={onMove} onPointerUp={endDrag} onPointerLeave={endDrag} onDoubleClick={onDoubleClick}>
        {/* ruler */}
        <rect x={0} y={0} width={width} height={RULER_H} fill={C.panel} />
        <rect x={LABEL_W} y={0} width={plotW} height={RULER_H} fill="transparent" style={{ cursor: "ew-resize" }}
          onPointerDown={(e) => { capture(e); setDrag({ scrub: true, pps, scroll }); scrubTo(xt(toLocal(e).x)); }} />
        <clipPath id={clipId}><rect x={LABEL_W} y={0} width={plotW} height={height} /></clipPath>
        <g clipPath={`url(#${clipId})`} style={{ pointerEvents: "none" }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={tx(t)} y1={RULER_H - 6} x2={tx(t)} y2={height - (maxScroll > 0 ? SCROLL_H : 0)} stroke={C.b1} />
              <text x={tx(t) + 3} y={RULER_H - 9} fontFamily={MONO} fontSize="10" fill={C.t5}>{fmtT(t)}</text>
            </g>
          ))}
        </g>
        <text x={8} y={RULER_H - 9} fontFamily="system-ui" fontSize="10" fontWeight="600" letterSpacing=".08em" fill={C.t5}>
          {trs.length ? "DRAG RULER TO SCRUB" : ""}
        </text>

        {/* track labels (outside the clip, so they stay put when scrolled) */}
        {trs.map((tr, ti) => {
          const top = tops[ti], h = trackH(tr.kind), color = COLORS[ti % COLORS.length];
          const chLabel = outputs.find((o) => o.node === tr.node && o.kind === tr.kind && o.index === tr.index)?.label;
          return (
            <g key={"lbl" + tr.key}>
              <circle cx={14} cy={top + 14} r={4} fill={color} />
              <text x={24} y={top + 18} fontFamily="system-ui" fontSize="12" fontWeight="600" fill={C.t1}>{nameOf(tr.node)}</text>
              <text x={24} y={top + 32} fontFamily={MONO} fontSize="10.5" fill={C.t4}>{tr.kind}_{tr.index}{chLabel ? ` · ${chLabel}` : ""}</text>
              {tr.kind !== "RELAY" && !isColor(tr.kind) && (
                <>
                  <text x={LABEL_W - 6} y={top + 13} textAnchor="end" fontFamily={MONO} fontSize="9" fill={C.t6}>{tr.kind === "MOTOR" ? "+100" : "100%"}</text>
                  <text x={LABEL_W - 6} y={top + h - 5} textAnchor="end" fontFamily={MONO} fontSize="9" fill={C.t6}>{tr.kind === "MOTOR" ? "−100" : "0%"}</text>
                </>
              )}
            </g>
          );
        })}

        {/* tracks */}
        <g clipPath={`url(#${clipId})`}>
        {trs.map((tr, ti) => {
          const top = tops[ti], h = trackH(tr.kind), color = COLORS[ti % COLORS.length];
          const last = seq.steps[tr.steps[tr.steps.length - 1]];
          return (
            <g key={tr.key}>
              <rect x={LABEL_W} y={top} width={plotW} height={h} fill={C.panel} opacity=".6" />
              {tr.kind === "MOTOR" && <line x1={LABEL_W} y1={vy(tr, top, 0)} x2={width - PAD_R} y2={vy(tr, top, 0)} stroke={C.b3} strokeDasharray="2 4" />}

              {/* lines into each key */}
              {tr.steps.map((idx, k) => {
                const s = seq.steps[idx];
                if (isColor(tr.kind)) {
                  // Color bar: the previous color held, then (for a ramp) a
                  // gradient into this key's color over the ramp.
                  const prev = k > 0 ? seq.steps[tr.steps[k - 1]] : null;
                  if (!prev) return null;
                  const dur = Math.min(s.dur_ms ?? 0, s.t_ms - prev.t_ms);
                  const x0 = tx(prev.t_ms), x1 = tx(s.t_ms - dur), x2 = tx(s.t_ms);
                  const gid = `fade-${tr.key}-${idx}`;
                  return (
                    <g key={"bar" + idx}>
                      {x1 > x0 && <rect x={x0} y={top + 10} width={x1 - x0} height={h - 20} fill={hex(prev.value)} opacity=".8" />}
                      {dur > 0 && (
                        <>
                          <defs>
                            <linearGradient id={gid} x1="0" x2="1" y1="0" y2="0">
                              <stop offset="0" stopColor={hex(prev.value)} />
                              <stop offset="1" stopColor={hex(s.value)} />
                            </linearGradient>
                          </defs>
                          <rect x={x1} y={top + 10} width={Math.max(0, x2 - x1)} height={h - 20} fill={`url(#${gid})`} opacity=".8"
                            style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); onSelect(s.uid ?? null); }}>
                            <title>Fade into this color — R makes it a jump</title>
                          </rect>
                        </>
                      )}
                    </g>
                  );
                }
                const pts = segmentPoints(seq, tr, idx);
                const d = pts.map((p, i) => `${i ? "L" : "M"}${tx(p.t).toFixed(1)},${vy(tr, top, p.v).toFixed(1)}`).join(" ");
                const firstRamp = k === 0 && (s.dur_ms ?? 0) > 0; // from wherever the output is
                return (
                  <g key={"seg" + idx}>
                    <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray={firstRamp ? "4 4" : ""} opacity={k === 0 && !firstRamp ? 0 : 0.9} />
                    {canRamp(tr.kind) && k > 0 && (
                      <path d={d} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }}
                        onClick={(e) => { e.stopPropagation(); onSelect(s.uid ?? null); }}>
                        {/* Select only. Clicking used to toggle ramp/jump, and the first
                            click of a double-click (to add a key on the line) wiped the
                            later key's ramp and easing (2026-10-06). R toggles now. */}
                        <title>{(s.dur_ms ?? 0) > 0 ? "Ramp into this key — R makes it a jump" : "Jump into this key — R makes it a ramp"}</title>
                      </path>
                    )}
                  </g>
                );
              })}
              {/* hold after the last key */}
              {last && !isColor(tr.kind) && (
                <line x1={tx(last.t_ms)} y1={vy(tr, top, last.value)} x2={width - PAD_R} y2={vy(tr, top, last.value)} stroke={color} strokeWidth={1.5} strokeDasharray="2 5" opacity=".6" />
              )}
              {last && isColor(tr.kind) && (
                <rect x={tx(last.t_ms)} y={top + 10} width={Math.max(0, width - PAD_R - tx(last.t_ms))} height={h - 20} fill={hex(last.value)} opacity=".35" />
              )}

              {/* keys */}
              {tr.steps.map((idx) => {
                const s = seq.steps[idx];
                const cx = tx(s.t_ms), cy = isColor(tr.kind) ? top + h / 2 : vy(tr, top, s.value);
                const on = selected !== null && s.uid === selected;
                return (
                  <g key={"key" + idx} style={{ cursor: "grab" }}
                    onPointerDown={(e) => { e.stopPropagation(); capture(e); if (s.uid != null) { setDrag({ uid: s.uid, pps, scroll }); onSelect(s.uid); } }}
                    onDoubleClick={(e) => e.stopPropagation()}>
                    {on && <circle cx={cx} cy={cy} r={11} fill="none" stroke={C.ember} strokeWidth={1.5} strokeDasharray="3 3" />}
                    {isColor(tr.kind)
                      ? <rect x={cx - 7} y={cy - 7} width={14} height={14} rx={3} fill={hex(s.value)} stroke={on ? C.ember : C.t1} strokeWidth={1.5} />
                      : <circle cx={cx} cy={cy} r={on ? 6.5 : 5.5} fill={C.card} stroke={on ? C.ember : color} strokeWidth={2.5} />}
                    <title>{`${(s.t_ms / 1000).toFixed(2)} s · ${tr.kind === "RELAY" ? (s.value ? "on" : "off") : isColor(tr.kind) ? hex(s.value) : `${Math.round(s.value / 10)}%`}${(s.dur_ms ?? 0) ? ` · ramp over ${(s.dur_ms! / 1000).toFixed(2)} s, ease in ${s.ease_in ?? 50} % / out ${s.ease_out ?? 50} %` : ""}\nDrag to move · Delete to remove`}</title>
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
        </g>

        {/* scrollbar */}
        {maxScroll > 0 && (
          <g>
            <rect x={LABEL_W} y={barY} width={plotW} height={SCROLL_H - 4} rx={4} fill={C.panel}
              onPointerDown={(e) => {  // click the trough: jump there
                const x = toLocal(e).x;
                setScrollClamped(((x - LABEL_W - barW / 2) / plotW) * totalMs);
              }} />
            <rect x={barX} y={barY} width={barW} height={SCROLL_H - 4} rx={4} fill={C.b3} style={{ cursor: "grab" }}
              onPointerDown={(e) => { e.stopPropagation(); capture(e); setDrag({ bar: true, startX: toLocal(e).x, pps, scroll }); }} />
          </g>
        )}

        {trs.length === 0 && (
          <text x={LABEL_W + plotW / 2} y={RULER_H + 30} textAnchor="middle" fontFamily="system-ui" fontSize="12" fill={C.t4}>
            Add a track below — then double-click it to place keyframes.
          </text>
        )}
      </svg>}

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 10px", borderTop: `1px solid ${C.b1}`, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button onClick={() => zoomBy(1 / 1.5)} title="Zoom out (⌘/ctrl + scroll)" style={zbtn}>−</button>
          <button onClick={() => zoomBy(1.5)} title="Zoom in (⌘/ctrl + scroll)" style={zbtn}>+</button>
          <button onClick={() => { setZoom(null); setFitSpan(fitSpanFor(length)); setScrollMs(0); }} title="Fit the whole sequence" style={{ ...zbtn, width: "auto", padding: "0 8px", opacity: zoom === null && fitSpan === fitSpanFor(length) ? 0.5 : 1 }}>Fit</button>
          <span style={{ ...mono(500, 10.5, C.t5), marginLeft: 4 }}>{fmtT(Math.round(scroll / 10) * 10)} – {fmtT(Math.round((scroll + visibleMs) / 10) * 10)}</span>
        </span>
        {trs.length > 0 && addTrackSelect}
        <span style={mono(500, 10.5, C.t5)}>
          double-click: add keyframe · drag: move · R: ramp ⇄ jump · Delete: remove · scroll sideways / shift+scroll: pan · snaps 50 ms / 1 %
        </span>
      </div>
    </div>
  );
}

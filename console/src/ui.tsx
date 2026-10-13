// Small shared pieces from the handoff's component sheet.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { C, MONO } from "./lib/tokens";

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 5L5 17h14z" stroke={C.ember} strokeWidth="1.4" fill="none" opacity=".5" />
      <circle cx="12" cy="5" r="2.6" fill={C.ember} />
      <circle cx="5" cy="17" r="2.6" fill={C.ember} />
      <circle cx="19" cy="17" r="2.6" fill={C.ember} />
    </svg>
  );
}

export function StopOctagon({ size = 16 }: { size?: number }) {
  return (
    <svg style={{ position: "relative" }} width={size} height={size} viewBox="0 0 16 16">
      <path d="M5 1.5h6L15 5v6l-4 3.5H5L1 11V5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="7" width="6" height="2" fill="currentColor" />
    </svg>
  );
}

export function Toggle({ on, small, onClick }: { on: boolean; small?: boolean; onClick?: () => void }) {
  const w = small ? 36 : 40, h = small ? 20 : 22, k = h - 6;
  return (
    <div
      onClick={onClick}
      style={{
        width: w, height: h, borderRadius: 99, flex: "none", position: "relative",
        background: on ? C.ember : "#232833",
        boxShadow: on ? "0 0 10px rgba(255,107,44,.35)" : undefined,
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      <div style={{
        position: "absolute", top: 3, width: k, height: k, borderRadius: "50%",
        ...(on ? { right: 3, background: C.onEmber } : { left: 3, background: C.t5 }),
      }} />
    </div>
  );
}

// A yes/no question in front of everything. Click outside or Cancel to say no.
export function Confirm({ title, children, okLabel = "OK", onOk, onCancel }: {
  title: string; children: ReactNode; okLabel?: string; onOk: () => void; onCancel: () => void;
}) {
  const b = (primary: boolean): CSSProperties => ({
    height: 30, padding: "0 14px", borderRadius: 6, cursor: "pointer",
    background: primary ? C.ember : C.card,
    border: `1px solid ${primary ? C.ember : C.b2}`, ...sys(600, 12, primary ? C.onEmber : C.t2),
  });
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: "90vw", background: C.panel, border: `1px solid ${C.b2}`, borderRadius: 10, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 12px 40px rgba(0,0,0,.5)" }}>
        <div style={sys(700, 14, C.t1)}>{title}</div>
        <div style={{ ...sys(400, 12.5, C.t3), lineHeight: 1.55 }}>{children}</div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={b(false)}>Cancel</button>
          <button onClick={onOk} style={b(true)}>{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

export const mono = (weight: number, size: number, color: string) =>
  ({ font: `${weight} ${size}px ${MONO}`, color }) as const;

export const sys = (weight: number, size: number, color: string) =>
  ({ font: `${weight} ${size}px system-ui`, color }) as const;

// "Still waiting on the mesh" — used wherever the console has sent a
// request and nothing has come back yet, so a slow reply never looks
// like nothing happening.
export function Spinner({ size = 12, color = C.t4 }: { size?: number; color?: string }) {
  return (
    <span className="pm-spin" aria-label="loading" style={{
      display: "inline-block", width: size, height: size, flex: "none", borderRadius: "50%",
      border: `1.5px solid ${C.b3}`, borderTopColor: color,
      animation: "pm-spin .8s linear infinite",
    }} />
  );
}

// Color for strips and BLE floods: hue + brightness sliders that work by
// dragging. The browser's own picker can't leave black — its hue slider
// keeps brightness at 0 — so it only gets the color at full brightness.
// Values are 0xWWRRGGBB: W (1–127) puts an RGBW flood in warm-white mode at
// that level (the lights can't mix white with a color), shown as a third
// slider when `white` is set; moving it clears the color, and vice versa.
const hex6 = (v: number) => "#" + (v & 0xffffff).toString(16).padStart(6, "0");
export const WHITE_MAX = 127;
export const colorWhite = (v: number) => (v >>> 24) & WHITE_MAX;
function toHsv(v: number) {
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x / 255);
  const mx = Math.max(r, g, b), d = mx - Math.min(r, g, b);
  let h = 0;
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: mx ? d / mx : 0, v: mx };
}
function fromHsv(h: number, s: number, v: number) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return (f(5) << 16) | (f(3) << 8) | f(1);
}

export function ColorPicker({ value, onChange, white }: { value: number; onChange: (v: number) => void; white?: boolean }) {
  const rgb = value & 0xffffff, w = colorWhite(value);
  const cur = toHsv(rgb);
  // Either a color or a white level, never both.
  const emit = (newRgb: number, newW = 0) => onChange(newW ? newW << 24 : newRgb & 0xffffff);
  // Hue and saturation survive "off" (black), so brightness can bring the color back.
  const [hs, setHs] = useState({ h: cur.h, s: rgb ? cur.s : 1 });
  useEffect(() => {
    if (!rgb || fromHsv(hs.h, hs.s, toHsv(rgb).v) === rgb) return;
    const x = toHsv(rgb);
    setHs((p) => ({ h: x.s ? x.h : p.h, s: x.s }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rgb]);
  const full = fromHsv(hs.h, hs.s, 1);
  const bright = Math.round(cur.v * 100);
  const track = (bg: string): React.CSSProperties => ({ background: bg, flex: 1, minWidth: 36 });
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
      <input type="color" value={hex6(full)} title="Pick an exact color"
        onChange={(e) => {
          const x = parseInt(e.target.value.slice(1), 16), t = toHsv(x);
          if (x) setHs({ h: t.s ? t.h : hs.h, s: t.s });
          emit(x);
        }}
        style={{ width: 32, height: 26, padding: 0, flex: "none", background: "none", border: `1px solid ${C.b2}`, borderRadius: 5, opacity: rgb ? 1 : 0.5 }} />
      <input type="range" className="pm-slider" min={0} max={359} value={Math.round(hs.h)} title="Hue"
        onChange={(e) => {
          const h = Number(e.target.value), s = hs.s || 1;
          setHs({ h, s });
          emit(fromHsv(h, s, cur.v || 1));
        }}
        style={track("linear-gradient(to right,#f00,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00)")} />
      <input type="range" className="pm-slider" min={0} max={100} value={bright} title={`Brightness ${bright}%`}
        onChange={(e) => emit(fromHsv(hs.h, hs.s, Number(e.target.value) / 100))}
        style={track(`linear-gradient(to right,#000,${hex6(full)})`)} />
      {white && (
        <input type="range" className="pm-slider" min={0} max={WHITE_MAX} value={w} title={`Warm white ${Math.round(w * 100 / WHITE_MAX)}% — replaces the color`}
          onChange={(e) => emit(0, Number(e.target.value))}
          style={track("linear-gradient(to right,#000,#fff6e0)")} />
      )}
    </span>
  );
}

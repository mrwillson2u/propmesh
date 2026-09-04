// Show Graph — node-graph programming (handoff 1g): block palette,
// wired chains on a dot grid, the fog chain live/firing, minimap.
// Static reference implementation; React Flow replaces this in v2.
import { C, MONO } from "../lib/tokens";
import { mono, sys } from "../ui";

const PALETTE: [string, string[]][] = [
  ["TRIGGERS", ["⊙ Sensor", "◷ Time / schedule", "⇊ sACN / E1.31", "◉ Manual button"]],
  ["LOGIC", ["⏱ Delay", "⚄ Random pick", "≡ Sequence", "▦ Group", "❄ Cooldown"]],
  ["OUTPUTS", ["⚡ Prop sequence", "♪ Audio"]],
];

interface Card {
  x: number; y: number; w: number;
  cat: string; badge?: [string, string];
  title: string; titleColor?: string; sub: string;
  active?: boolean; ports: { side: "l" | "r"; top: number }[];
}

const CARDS: Card[] = [
  { x: 64, y: 120, w: 180, cat: "TRIGGER", badge: ["OFFLINE", C.red], title: "⊙ Driveway PIR", titleColor: C.red, sub: "PIR_1 · motion", ports: [{ side: "r", top: 36 }] },
  { x: 336, y: 130, w: 184, cat: "LOGIC", title: "❄ Cooldown", sub: "45 s · lockout 10× / 11 min", ports: [{ side: "l", top: 36 }, { side: "r", top: 36 }] },
  { x: 612, y: 122, w: 184, cat: "LOGIC", title: "≡ Sequence", sub: "Skeleton Lunge · 6.2 s", ports: [{ side: "l", top: 36 }, { side: "r", top: 30 }, { side: "r", top: 48 }] },
  { x: 904, y: 112, w: 190, cat: "OUTPUT", title: "▦ Front Porch group", sub: "3 nodes · 6 channels", ports: [{ side: "l", top: 36 }] },
  { x: 904, y: 254, w: 190, cat: "OUTPUT", title: "♪ Audio", sub: "scream01.wav · porch spkr", ports: [{ side: "l", top: 36 }] },
  { x: 64, y: 440, w: 180, cat: "TRIGGER", badge: ["RUNNING", C.emberT], title: "◷ Every 6 min", sub: "19:00–23:00 · next 20:45", active: true, ports: [{ side: "r", top: 36 }] },
  { x: 386, y: 432, w: 184, cat: "LOGIC", badge: ["3.2 s left", C.emberT], title: "≡ Sequence", sub: "Fog Burst · 8.0 s", active: true, ports: [{ side: "l", top: 36 }, { side: "r", top: 36 }] },
  { x: 740, y: 440, w: 200, cat: "OUTPUT", badge: ["FIRING", C.emberT], title: "⚡ Fog Chiller", sub: "RELAY_1 fog machine · ON", active: true, ports: [{ side: "l", top: 36 }] },
];

const WIRES = [
  { d: "M244 160 C 290 160, 290 168, 336 168", active: false },
  { d: "M520 168 C 566 168, 566 160, 612 160", active: false },
  { d: "M796 160 C 850 160, 850 150, 904 150", active: false },
  { d: "M796 176 C 860 176, 850 292, 904 292", active: false },
  { d: "M244 480 C 320 480, 310 470, 386 470", active: true },
  { d: "M570 470 C 660 470, 650 478, 740 478", active: true },
];

const MINI: { l: string; t: string; hot?: boolean }[] = [
  { l: "6%", t: "14%" }, { l: "30%", t: "16%" }, { l: "54%", t: "12%" },
  { l: "80%", t: "10%" }, { l: "80%", t: "34%" },
  { l: "6%", t: "62%", hot: true }, { l: "34%", t: "60%", hot: true }, { l: "64%", t: "62%", hot: true },
];

export default function ShowGraph() {
  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
      <div style={{ width: 200, background: C.panel, borderRight: `1px solid ${C.b2}`, padding: 12, display: "flex", flexDirection: "column", gap: 14, flex: "none", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 9px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 6, flex: "none" }}>
          <span style={{ color: C.t5, fontSize: 11 }}>⌕</span>
          <span style={sys(400, 11.5, C.t5)}>Search blocks…</span>
        </div>
        {PALETTE.map(([cat, items]) => (
          <div key={cat}>
            <div style={{ font: "700 9.5px system-ui", letterSpacing: ".1em", color: C.t5, marginBottom: 7 }}>{cat}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {items.map((it) => (
                <div key={it} style={{ padding: "8px 10px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 6, ...sys(600, 11.5, C.t2), cursor: "grab" }}>{it}</div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ font: "400 10.5px/1.5 system-ui", color: C.t6 }}>Drag a block onto the canvas. Wires carry fire events left → right.</div>
      </div>

      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, overflow: "auto", backgroundColor: C.bg, backgroundImage: `radial-gradient(${C.grid} 1px,transparent 1px)`, backgroundSize: "22px 22px" }}>
        <div style={{ position: "relative", width: 1188, height: 700 }}>
          <svg style={{ position: "absolute", inset: 0 }} width="1188" height="700">
            {WIRES.map((w, i) => (
              <path key={i} d={w.d} stroke={w.active ? C.ember : C.wire} strokeWidth={w.active ? 2.5 : 2} fill="none" />
            ))}
            <circle cx="320" cy="477" r="4" fill={C.ember} />
            <circle cx="660" cy="473" r="4" fill={C.ember} />
          </svg>

          {CARDS.map((card, i) => (
            <div key={i} style={{
              position: "absolute", left: card.x, top: card.y, width: card.w,
              background: C.card, borderRadius: 8,
              border: `1px solid ${card.active ? C.ember : card.badge?.[1] === C.red ? C.redB : C.b2}`,
              boxShadow: card.active ? "0 0 18px rgba(255,107,44,.18)" : undefined,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 11px", borderBottom: `1px solid ${C.b1}` }}>
                <span style={{ font: `700 9px ${MONO}`, color: C.t5, letterSpacing: ".08em" }}>{card.cat}</span>
                <span style={{ flex: 1 }} />
                {card.badge && <span style={mono(700, 9, card.badge[1])}>{card.badge[0]}</span>}
              </div>
              <div style={{ padding: "9px 11px" }}>
                <div style={sys(700, 12.5, card.titleColor ?? C.t1)}>{card.title}</div>
                <div style={{ ...mono(500, 10.5, card.titleColor ? C.t5 : C.t4), marginTop: 3 }}>{card.sub}</div>
              </div>
              {card.ports.map((p, j) => (
                <div key={j} style={{
                  position: "absolute", [p.side === "l" ? "left" : "right"]: -5, top: p.top,
                  width: 9, height: 9, borderRadius: "50%",
                  background: card.active ? C.ember : C.wire, border: `2px solid ${C.bg}`,
                }} />
              ))}
            </div>
          ))}

        </div>
        </div>

        <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", background: "rgba(28,17,9,.95)", border: `1px solid ${C.emberB}`, borderRadius: 6, ...mono(700, 11, C.emberT) }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: C.ember, boxShadow: `0 0 6px ${C.ember}` }} />
            RUN 20:44:02 · Ambient Fog
          </span>
          <button style={{ height: 32, padding: "0 13px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(600, 12, C.t2) }}>▶ Simulate</button>
          <button style={{ height: 32, padding: "0 13px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(600, 12, C.t2) }}>Deploy to bridge</button>
        </div>

        <div style={{ position: "absolute", left: 12, bottom: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {["+", "−", "1:1"].map((z) => (
            <div key={z} style={{ width: 30, height: 30, borderRadius: 6, background: C.raised, border: `1px solid ${C.b3}`, display: "flex", alignItems: "center", justifyContent: "center", font: z === "1:1" ? `600 10px ${MONO}` : "600 15px system-ui", color: C.t2, cursor: "pointer" }}>{z}</div>
          ))}
        </div>

        <div style={{ position: "absolute", right: 12, bottom: 12, width: 150, height: 92, background: "rgba(16,19,24,.94)", border: `1px solid ${C.b2}`, borderRadius: 6, padding: 6 }}>
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {MINI.map((m, i) => (
              <div key={i} style={{ position: "absolute", left: m.l, top: m.t, width: 16, height: 8, background: m.hot ? C.ember : C.wire, borderRadius: 2 }} />
            ))}
            <div style={{ position: "absolute", inset: 0, border: `1px solid ${C.ember}`, opacity: 0.35, borderRadius: 3 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

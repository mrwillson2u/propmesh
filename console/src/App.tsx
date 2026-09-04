// Shell 2b (chosen): 176px left rail — logo, nav, pinned telemetry +
// STOP ALL. Per the handoff, STOP ALL must always be visible.
import { useRef, useState } from "react";
import { C, MONO } from "./lib/tokens";
import { useMesh } from "./lib/mesh";
import { Logo, StopOctagon, mono } from "./ui";
import Yard, { type YardLayout } from "./views/Yard";
import Nodes from "./views/Nodes";
import Cues from "./views/Cues";
import ShowGraph from "./views/ShowGraph";

const VIEWS = [
  { name: "Yard", icon: "◎" },
  { name: "Nodes & Channels", icon: "☰" },
  { name: "Cues", icon: "▸" },
  { name: "Show Graph", icon: "⬡" },
] as const;
type ViewName = (typeof VIEWS)[number]["name"];

// ?view=yard|nodes|cues|show deep-links a view; ?layout=topology|map
// picks the yard projection. The old survey/blueprint names still work.
const q = () => new URLSearchParams(location.search);

function initialView(): ViewName {
  const v = q().get("view")?.toLowerCase();
  if (v === "survey" || v === "blueprint") return "Yard";
  return VIEWS.find((x) => x.name.toLowerCase().startsWith(v ?? ""))?.name ?? "Yard";
}

function initialLayout(): YardLayout {
  const p = q();
  if (p.get("view")?.toLowerCase() === "blueprint") return "map";
  return p.get("layout")?.toLowerCase() === "map" ? "map" : "topology";
}

export default function App() {
  const [view, setView] = useState<ViewName>(initialView);
  const mesh = useMesh();
  const [stopped, setStopped] = useState(false);
  const [holding, setHolding] = useState(false);
  const [pct, setPct] = useState(0);
  const holdIv = useRef<ReturnType<typeof setInterval>>();

  // Press-and-hold ~1.5 s to fire; release cancels.
  const stopDown = () => {
    if (stopped) return;
    clearInterval(holdIv.current);
    holdIv.current = setInterval(() => {
      setPct((p) => {
        const next = p + 0.06;
        if (next >= 1) {
          clearInterval(holdIv.current);
          setStopped(true);
          setHolding(false);
          return 0;
        }
        setHolding(true);
        return next;
      });
    }, 80);
  };
  const stopUp = () => {
    clearInterval(holdIv.current);
    setHolding(false);
    setPct(0);
  };

  const navBtn = (v: (typeof VIEWS)[number]) => {
    const active = v.name === view;
    return (
      <div
        key={v.name}
        onClick={() => setView(v.name)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
          borderRadius: 6, cursor: "pointer", flex: "none",
          background: active ? C.emberBg2 : undefined,
          border: active ? `1px solid ${C.emberB2}` : "1px solid transparent",
          font: `${active ? 600 : 500} 12.5px system-ui`,
          color: active ? C.emberT : C.t3,
        }}
      >
        <span style={{ fontSize: 13 }}>{v.icon}</span>
        {v.name}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", background: C.bg, color: C.t1, overflow: "hidden" }}>
      <div style={{ width: 176, flex: "none", background: C.panel, borderRight: `1px solid ${C.b2}`, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 14px 12px", borderBottom: `1px solid ${C.b1}` }}>
          <Logo />
          <div>
            <div style={{ font: `700 12px/1 ${MONO}`, letterSpacing: ".08em", color: C.t1 }}>PROPMESH</div>
            <div style={{ ...mono(500, 9.5, C.t5), marginTop: 3 }}>bridge v0.9.4</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 8px", flex: 1, minHeight: 0, overflowY: "auto" }}>
          {VIEWS.map(navBtn)}
        </div>
        <div style={{ flex: "none", padding: "10px 12px", borderTop: `1px solid ${C.b1}`, display: "flex", flexDirection: "column", gap: 7, font: `600 10.5px ${MONO}` }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.t5 }}>BRIDGE</span>
            <span style={{ color: C.green }}>● LINKED</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.t5 }}>SYNC</span>
            <span style={{ color: C.green }}>{mesh.sync}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.t5 }}>NODES</span>
            <span>
              <span style={{ color: C.green }}>{mesh.counts.online}</span>
              <span style={{ color: C.t4 }}> / {mesh.counts.asleep}</span>
              <span style={{ color: C.red }}> / {mesh.counts.missing}</span>
            </span>
          </div>
        </div>
        <button
          onMouseDown={stopDown} onMouseUp={stopUp} onMouseLeave={stopUp}
          onTouchStart={stopDown} onTouchEnd={stopUp}
          style={{
            position: "relative", overflow: "hidden", margin: 10, height: 52,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            background: stopped ? C.ember : C.emberBg,
            border: `1.5px solid ${C.ember}`, borderRadius: 8,
            color: stopped ? C.onEmber : C.emberT,
            font: `700 13px ${MONO}`, letterSpacing: ".1em",
          }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, background: "rgba(255,107,44,.35)", width: `${Math.round(pct * 100)}%` }} />
          <StopOctagon />
          <span style={{ position: "relative" }}>{stopped ? "STOPPED" : holding ? "HOLD…" : "STOP ALL"}</span>
        </button>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {stopped && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: C.emberBg, borderBottom: `1px solid ${C.ember}`, flex: "none" }}>
            <span style={{ font: `800 12.5px ${MONO}`, letterSpacing: ".1em", color: C.emberT }}>⬣ ALL OUTPUTS STOPPED</span>
            <span style={mono(500, 11.5, C.t2)}>every motor, relay, LED and audio killed · cues suppressed</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setStopped(false)} style={{ height: 32, padding: "0 16px", background: C.ember, border: "none", borderRadius: 6, color: C.onEmber, font: `800 12px ${MONO}`, letterSpacing: ".06em" }}>
              RE-ARM SHOW
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {view === "Yard" && <Yard mesh={mesh} initialLayout={initialLayout()} />}
          {view === "Nodes & Channels" && <Nodes />}
          {view === "Cues" && <Cues stopped={stopped} />}
          {view === "Show Graph" && <ShowGraph />}
        </div>
      </div>
    </div>
  );
}

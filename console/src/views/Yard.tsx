// Yard — the mesh, in two projections of one model.
//
// Topology and Map were separate views in the design handoff, but they
// render the same nodes, statuses, links and selection; keeping them
// apart meant two canvases that could disagree about the mesh (the
// handoff's own art did). One view, one selection, one detail panel,
// with a layout toggle: Topology answers "is my mesh healthy", Map
// answers "where is that physically".
import { useEffect, useRef, useState } from "react";
import { C } from "../lib/tokens";
import { NODES, PARENT, useLiveLinks, type Mesh } from "../lib/mesh";
import { Toggle, mono, sys } from "../ui";
import Topology from "./yard/Topology";
import YardMap from "./yard/YardMap";
import NodeDetail from "./yard/NodeDetail";
import Placement from "./yard/Placement";

export type YardLayout = "topology" | "map";
const TOOLS = ["➤", "▱", "╱", "◎", "⌫"];

export default function Yard({ mesh, initialLayout = "topology" }: { mesh: Mesh; initialLayout?: YardLayout }) {
  const [layout, setLayout] = useState<YardLayout>(initialLayout);
  const [sel, setSel] = useState<string | null>("graveyard");
  const [placement, setPlacement] = useState(false);
  const [blink, setBlink] = useState<string | null>(null);
  const [hist, setHist] = useState<number[]>([]);
  const [showLinks, setShowLinks] = useState(true);
  const blinkT = useRef<ReturnType<typeof setTimeout>>();

  const links = useLiveLinks(mesh);
  const node = NODES.find((n) => n.id === sel) ?? null;
  const parentLink = sel ? links.find((l) => l.k === PARENT[sel]) : undefined;

  useEffect(() => {
    if (placement && parentLink) setHist((h) => [...h.slice(-13), parentLink.rssi]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesh.tick, placement]);

  const select = (id: string) => { setSel(id); setHist([]); };
  const locate = () => {
    if (!sel) return;
    setBlink(sel);
    clearTimeout(blinkT.current);
    blinkT.current = setTimeout(() => setBlink(null), 4000);
  };
  const locateLabel = blink && blink === sel ? "◉ Blinking…" : "◉ Blink LED";

  const layoutChip = (id: YardLayout, text: string) => {
    const on = layout === id;
    return (
      <span onClick={() => setLayout(id)} style={{
        padding: "3px 10px", borderRadius: 5, cursor: "pointer",
        background: on ? C.emberBg2 : "transparent",
        border: `1px solid ${on ? C.emberB2 : "transparent"}`,
        ...sys(on ? 600 : 500, 11.5, on ? C.emberT : C.t3),
      }}>{text}</span>
    );
  };

  return (
    <>
      {layout === "map" && (
        <div style={{ width: 52, background: C.panel, borderRight: `1px solid ${C.b2}`, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 10, flex: "none" }}>
          {TOOLS.map((t, i) => (
            <div key={t} style={{
              width: 38, height: 38, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: i === 0 ? 15 : 14, cursor: "pointer",
              background: i === 0 ? C.emberBg : C.card,
              border: `1px solid ${i === 0 ? C.emberB : C.b2}`,
              color: i === 0 ? C.emberT : C.t3,
            }}>{t}</div>
          ))}
          <div style={{ flex: 1 }} />
          <div style={{ width: 38, height: 38, borderRadius: 7, background: C.card, border: `1px solid ${C.b2}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.t3, fontSize: 13, marginBottom: 10 }}>?</div>
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0, position: "relative", backgroundColor: C.bg, backgroundImage: `radial-gradient(${C.grid} 1px,transparent 1px)`, backgroundSize: "24px 24px" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 4, display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "linear-gradient(rgba(11,13,16,.95),rgba(11,13,16,0))", pointerEvents: "none" }}>
          <span style={sys(700, 13, C.t1)}>Yard</span>
          <div style={{ display: "flex", gap: 2, padding: 2, background: "rgba(20,23,28,.9)", border: `1px solid ${C.b2}`, borderRadius: 7, pointerEvents: "auto" }}>
            {layoutChip("topology", "Topology")}
            {layoutChip("map", "Map")}
          </div>
          <span style={{ padding: "3px 9px", borderRadius: 4, background: C.amberBg, border: `1px solid ${C.amberB}`, ...mono(700, 10.5, C.amber) }}>DEGRADED</span>
          <span style={mono(500, 11, C.t5)}>✕ Driveway PIR · ⚠ Lantern 3 batt · ⚠ link −83</span>
          <div style={{ flex: 1 }} />
          <span style={{ display: "flex", alignItems: "center", gap: 6, ...mono(500, 11, C.t5) }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.green, animation: "livedot 2s infinite" }} />
            live · updated 1 s ago
          </span>
        </div>

        {layout === "topology"
          ? <Topology links={links} sel={sel} blink={blink} onSelect={select} />
          : <YardMap links={links} sel={sel} blink={blink} showLinks={showLinks} onSelect={select} />}

        {layout === "map" && (
          <div style={{ position: "absolute", top: 52, left: 14, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "rgba(16,19,24,.92)", border: `1px solid ${C.b2}`, borderRadius: 7 }}>
            <span style={sys(600, 11.5, C.t2)}>Mesh links</span>
            <Toggle on={showLinks} small onClick={() => setShowLinks(!showLinks)} />
            <span style={mono(500, 10.5, C.t5)}>|</span>
            <span style={sys(600, 11.5, C.t3)}>Signal heat</span>
            <Toggle on={false} small />
          </div>
        )}

        <div style={{ position: "absolute", left: 14, bottom: 14, display: "flex", gap: 12, padding: "8px 12px", background: "rgba(11,13,16,.9)", border: `1px solid ${C.b2}`, borderRadius: 6, ...mono(500, 10.5, C.t4) }}>
          <span><span style={{ color: C.green }}>━</span> strong ≥−60</span>
          <span><span style={{ color: C.linkGray }}>━</span> ok</span>
          <span><span style={{ color: C.amber }}>╌</span> weak ≤−75</span>
          <span><span style={{ color: C.red }}>╌</span> lost</span>
        </div>

        {layout === "map" && (
          <div style={{ position: "absolute", right: 14, bottom: 14, padding: "8px 12px", background: "rgba(16,19,24,.92)", border: `1px solid ${C.b2}`, borderRadius: 7, ...mono(500, 10.5, C.t5) }}>
            scale ≈ 5 ft / square · drag nodes to move
          </div>
        )}
      </div>

      {node && !placement && (
        <NodeDetail
          node={node} links={links}
          onClose={() => setSel(null)}
          onLocate={locate} locateLabel={locateLabel}
          onPlacement={() => { setPlacement(true); setHist([]); }}
        />
      )}

      {placement && node && (
        <Placement
          node={node} parentLink={parentLink} history={hist}
          onExit={() => setPlacement(false)}
          onLocate={locate} locateLabel={locateLabel}
        />
      )}
    </>
  );
}

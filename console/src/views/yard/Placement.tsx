// Placement mode — the phone layout. Walk the yard holding a phone,
// watching one node's parent-link RSSI while you move it. Reachable
// from either yard layout; it belongs to the map's job but is just as
// useful mid-bring-up from the topology.
import { C, MONO } from "../../lib/tokens";
import { NODES, type LiveLink, type YardNode } from "../../lib/mesh";
import { mono, sys } from "../../ui";

export default function Placement({
  node, parentLink, history, onExit, onLocate, locateLabel,
}: {
  node: YardNode;
  parentLink?: LiveLink;
  history: number[];
  onExit: () => void;
  onLocate: () => void;
  locateLabel: string;
}) {
  const rssi = parentLink ? parentLink.rssi : -50;
  const lost = !!parentLink?.lost;
  const qual: [string, string, string, string] = lost
    ? ["LOST", C.red, C.redBg, C.redB]
    : rssi >= -60 ? ["STRONG", C.green, C.greenBg, C.greenB]
    : rssi >= -75 ? ["OK", C.t2, C.raised, C.b3]
    : ["WEAK", C.amber, C.amberBg, C.amberB];

  const h = history.length ? history : [rssi];
  const trend = h.length > 3
    ? h[h.length - 1] > h[0] ? "trending better ↗"
      : h[h.length - 1] < h[0] ? "trending worse ↘"
      : "holding steady →"
    : "reading…";

  const parentName = parentLink
    ? NODES.find((n) => n.id === (parentLink.b === node.id ? parentLink.a : parentLink.b))?.name ?? "bridge"
    : "bridge";

  const hint = lost
    ? "No signal — walk back toward the yard until the node reappears."
    : rssi < -75
    ? `Move toward ${parentName} or raise the node off the ground — damp grass eats 2.4 GHz. 🎃 The spirits prefer line of sight.`
    : "Good spot. Stake it down before the spirits move it.";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 20, background: "rgba(8,9,12,.94)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "min(400px,92vw)", background: C.panel, border: `1px solid ${C.emberB2}`, borderRadius: 12, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: C.emberBg2, borderBottom: `1px solid ${C.emberB2}` }}>
          <span style={{ font: `800 10.5px ${MONO}`, letterSpacing: ".14em", color: C.emberT }}>PLACEMENT MODE</span>
          <span style={{ ...sys(500, 11, C.t4), flex: 1 }}>readings every 1 s</span>
          <button onClick={onExit} style={{ height: 32, padding: "0 12px", background: "none", border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(600, 11.5, C.t3) }}>Exit</button>
        </div>

        <div style={{ padding: "18px 16px 10px", textAlign: "center" }}>
          <div style={sys(700, 17, C.t1)}>{node.name}</div>
          <div style={{ ...mono(500, 11.5, C.t4), marginTop: 4 }}>
            {(node.pro ? "PRO" : "MINI") + " · via " + parentName + " · hop " + node.hop}
          </div>
          <div style={{ font: `800 68px/1 ${MONO}`, color: qual[1], marginTop: 16, letterSpacing: "-.02em" }}>
            {lost ? "✕" : rssi}
            <span style={{ fontSize: 22, color: C.t4, fontWeight: 600 }}> dBm</span>
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginTop: 12, padding: "6px 14px", borderRadius: 99, background: qual[2], border: `1px solid ${qual[3]}` }}>
            <span style={{ font: `800 12px ${MONO}`, color: qual[1], letterSpacing: ".1em" }}>{qual[0]}</span>
            <span style={sys(500, 11.5, C.t3)}>{trend}</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, justifyContent: "center", height: 60, margin: "18px 0 6px" }}>
            {h.slice(-14).map((v, i, arr) => (
              <div key={i} style={{ width: 14, borderRadius: 2, flex: "none", height: Math.round(Math.max(6, Math.min(56, (v + 95) * 1.7))), background: i === arr.length - 1 ? qual[1] : "rgba(139,147,161,.28)" }} />
            ))}
          </div>
          <div style={mono(500, 10.5, C.t5)}>last 14 s</div>
          <div style={{ font: "400 12px/1.5 system-ui", color: C.t4, margin: "12px 0 4px" }}>{hint}</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "6px 16px 16px" }}>
          <button onClick={onLocate} style={{ height: 52, background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 8, ...sys(700, 14, C.t1) }}>{locateLabel}</button>
          <button onClick={onExit} style={{ height: 52, background: C.ember, border: "none", borderRadius: 8, ...sys(800, 14, C.onEmber) }}>Mark placed — done</button>
        </div>
      </div>
    </div>
  );
}

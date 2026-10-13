// Node detail panel — shared by both yard layouts, since a node's
// stats are the same question whether you found it on the topology or
// on the map.
import { C } from "../../lib/tokens";
import { EVENTS, statusPill, type LiveLink, type YardNode } from "../../lib/mesh";
import { NODES } from "../../lib/mesh";
import { mono, sys } from "../../ui";

const label = { font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5 } as const;

function Stat({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <div style={{ background: C.panel, padding: "10px 14px" }}>
      <div style={label}>{k}</div>
      <div style={{ ...mono(600, 13, color ?? C.t1), marginTop: 3 }}>{v}</div>
    </div>
  );
}

export default function NodeDetail({
  node, links, onClose, onLocate, locateLabel, onPlacement,
}: {
  node: YardNode;
  links: LiveLink[];
  onClose: () => void;
  onLocate: () => void;
  locateLabel: string;
  onPlacement: () => void;
}) {
  const p = statusPill(node.status);
  const neighbors = links
    .filter((l) => l.a === node.id || l.b === node.id)
    .map((l) => {
      const other = NODES.find((n) => n.id === (l.a === node.id ? l.b : l.a))!;
      return {
        name: other.name,
        lab: l.lost ? "lost" : `${l.rssi} dBm`,
        color: l.color === C.linkGray ? C.t3 : l.color,
      };
    });

  return (
    <div style={{ width: 330, flex: "none", borderLeft: `1px solid ${C.b2}`, background: C.panel, display: "flex", flexDirection: "column", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: `1px solid ${C.b1}` }}>
        <span style={{ ...sys(700, 13, C.t1), flex: 1 }}>{node.name}</span>
        <span style={{ padding: "2px 8px", borderRadius: 99, background: p[0], border: `1px solid ${p[1]}`, ...mono(700, 10, p[2]), letterSpacing: ".06em" }}>{p[3]}</span>
        <span onClick={onClose} style={{ color: C.t5, fontSize: 13, cursor: "pointer", padding: "2px 4px" }}>✕</span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: C.b1, borderBottom: `1px solid ${C.b1}` }}>
        <Stat k="UPTIME" v={node.up} />
        <Stat k="FIRMWARE" v={node.fw + (node.fw === "v0.9.3" ? " ↑ 0.9.4" : "")} />
        <Stat k="FREE MEMORY" v={node.mem ? `${node.mem} KB` : "—"} />
        <Stat k="ROUTE" v={node.route} />
        <Stat k="POWER" color={node.status === "low" ? C.amber : C.t1}
          v={node.pro ? "⚡ wall" : node.status === "missing" ? `was ${node.batt!.toFixed(2)} V` : `${node.batt!.toFixed(2)} V · ${Math.max(2, Math.round((node.batt! - 3.0) / 0.012))}%`} />
        <Stat k="BOARD" v={node.pro ? "PRO (ESP32-S3)" : "MINI (ESP32-C3)"} />
      </div>

      <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.b1}` }}>
        <div style={{ ...label, marginBottom: 8 }}>NEIGHBORS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {neighbors.map((nb) => (
            <div key={nb.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ ...sys(500, 12, C.t2), flex: 1 }}>{nb.name}</span>
              <span style={{ padding: "2px 7px", borderRadius: 4, background: C.raised, ...mono(600, 11, nb.color) }}>{nb.lab}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 14px", flex: 1 }}>
        <div style={{ ...label, marginBottom: 8 }}>RECENT EVENTS</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, ...mono(500, 11, C.t4) }}>
          {(EVENTS[node.id] ?? []).map((ev, i) => (
            <div key={i}><span style={{ color: ev.warn ? C.amber : C.t5 }}>{ev.t}</span> {ev.s}</div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderTop: `1px solid ${C.b1}` }}>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onLocate} style={{ flex: 1, height: 34, background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(600, 12, C.t2) }}>{locateLabel}</button>
          <button style={{ flex: 1, height: 34, background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(600, 12, C.t2) }}>↻ Reboot</button>
        </div>
        <button onClick={onPlacement} style={{ height: 38, background: C.emberBg, border: `1px solid ${C.ember}`, borderRadius: 6, ...sys(700, 12, C.emberT) }}>
          ⇱ Placement mode — watch signal live
        </button>
      </div>
    </div>
  );
}

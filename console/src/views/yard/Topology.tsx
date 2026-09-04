// Topology layout — nodes arranged by hop depth. Answers "is my mesh
// healthy": routes, hops, RSSI. Needs no setup, so it is what a new
// user and a shelf testbed both see first.
import { C, MONO } from "../../lib/tokens";
import { NODES, statusStroke, type LiveLink, type YardNode } from "../../lib/mesh";
import { PropIcon } from "../../lib/propIcons";
import { useProps } from "../../lib/propStore";

const sub = (n: YardNode) =>
  n.pro ? `PRO · H${n.hop}`
  : n.status === "missing" ? "MINI · missing"
  : `${n.batt!.toFixed(2)} V${n.status === "low" ? " LOW" : ""} · H${n.hop}${n.status === "asleep" ? " · asleep" : ""}`;

export default function Topology({
  links, sel, blink, onSelect,
}: {
  links: LiveLink[];
  sel: string | null;
  blink: string | null;
  onSelect: (id: string) => void;
}) {
  const props = useProps();
  return (
    <svg width="100%" height="100%" viewBox="0 0 1080 700" style={{ display: "block" }}>
      {links.map((l) => (
        <line key={l.k} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={l.color} strokeWidth={l.w} strokeDasharray={l.dash} opacity=".75" />
      ))}

      {NODES.map((n) => (
        <g key={n.id} onClick={() => onSelect(n.id)} style={{ cursor: "pointer" }}>
          {sel === n.id && <circle cx={n.x} cy={n.y} r="31" fill="none" stroke={C.ember} strokeWidth="2" strokeDasharray="4 4" />}
          {blink === n.id && <circle cx={n.x} cy={n.y} r="25" fill="none" stroke={C.emberT} strokeWidth="3" style={{ animation: "pmblink .8s ease-out infinite alternate" }} />}
          {n.pro
            ? <rect x={n.x - 26} y={n.y - 20} width="52" height="40" rx="8" fill={C.raised2} stroke={statusStroke(n.status)} strokeWidth="2" strokeDasharray={n.status === "missing" ? "3 3" : ""} />
            : <circle cx={n.x} cy={n.y} r="15" fill={C.raised2} stroke={statusStroke(n.status)} strokeWidth="2" strokeDasharray={n.status === "missing" ? "3 3" : ""} />}
          {(() => {
            const s = n.pro ? 32 : 24;
            return (
              <PropIcon type={props.get(n.id)} size={s} x={n.x - s / 2} y={n.y - s / 2}
                color={n.id === "bridge" ? C.emberT : statusStroke(n.status)}
                opacity={n.status === "missing" ? 0.7 : 1} />
            );
          })()}
        </g>
      ))}

      <g style={{ pointerEvents: "none" }}>
        {links.map((l) => (
          <text key={"ll" + l.k} x={(l.x1 + l.x2) / 2} y={(l.y1 + l.y2) / 2 - 6} fontFamily={MONO} fontSize="10.5" fontWeight="600" textAnchor="middle" fill={l.color} style={{ paintOrder: "stroke", stroke: C.bg, strokeWidth: "6px" }}>
            {l.lab}
          </text>
        ))}
        {NODES.map((n) => (
          <g key={"lb" + n.id}>
            <text x={n.x} y={n.y + (n.pro ? 41 : 36)} fontSize="12.5" fontWeight="600" textAnchor="middle" fontFamily="system-ui"
              fill={n.status === "missing" ? C.red : sel === n.id ? C.emberT : n.status === "asleep" ? C.t3 : C.t1}>
              {n.name}
            </text>
            <text x={n.x} y={n.y + (n.pro ? 56 : 51)} fontSize="10.5" textAnchor="middle" fontFamily={MONO} fill={n.status === "low" ? C.amber : C.t4}>
              {sub(n)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

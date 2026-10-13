// Map layout — the same mesh over a drawn yard. Answers "where is
// that physically": which prop is dead, where to walk, where a new
// node should go. Position plus RF explains what topology alone
// cannot — a weak link makes sense once you see it crosses the house.
import { C, MONO } from "../../lib/tokens";
import { NODES, statusStroke, type LiveLink } from "../../lib/mesh";
import { PropIcon } from "../../lib/propIcons";
import { useProps } from "../../lib/propStore";

const SHORT: Record<string, string> = {
  bridge: "Bridge", skeleton: "Porch Skeleton", fog: "Fog Chiller",
  graveyard: "Graveyard Rig", l1: "L1", l2: "L2", l3: "L3 · 3.18V", pir: "Driveway PIR",
};

export default function YardMap({
  links, sel, blink, showLinks, onSelect,
}: {
  links: LiveLink[];
  sel: string | null;
  blink: string | null;
  showLinks: boolean;
  onSelect: (id: string) => void;
}) {
  const props = useProps();
  const byId = new Map(NODES.map((n) => [n.id, n]));

  return (
    <svg width="100%" height="100%" viewBox="0 0 1140 700" style={{ display: "block" }}>
      <rect x="60" y="50" width="1020" height="600" fill="none" stroke={C.b1} strokeWidth="1.5" strokeDasharray="8 6" />
      <polygon points="330,120 700,120 700,340 560,340 560,400 330,400" fill={C.card} stroke={C.wire} strokeWidth="2" />
      <rect x="700" y="160" width="150" height="180" fill="#111419" stroke={C.wire} strokeWidth="2" />
      <text x="500" y="240" fontSize="12" fill={C.t6} fontFamily={MONO} textAnchor="middle">HOUSE</text>
      <text x="775" y="255" fontSize="11" fill={C.t6} fontFamily={MONO} textAnchor="middle">GARAGE</text>
      <path d="M775 340 L775 650" stroke="#2b313b" strokeWidth="34" opacity=".55" />
      <text x="805" y="560" fontSize="10.5" fill={C.t6} fontFamily={MONO}>driveway</text>
      <line x1="60" y1="620" x2="1080" y2="620" stroke="#2b313b" strokeWidth="10" opacity=".5" />
      <text x="95" y="608" fontSize="10.5" fill={C.t6} fontFamily={MONO}>sidewalk</text>

      {showLinks && links.map((l) => {
        const A = byId.get(l.a)!, B = byId.get(l.b)!;
        return <line key={l.k} x1={A.bx} y1={A.by} x2={B.bx} y2={B.by} stroke={l.color} strokeWidth={l.w * 0.9} strokeDasharray={l.dash} opacity=".6" />;
      })}

      <g textAnchor="middle">
        {NODES.map((n) => {
          const big = n.pro;
          const r = n.id === "bridge" ? 17 : big ? 15 : 11;
          const nameFill = n.status === "missing" ? C.red : n.status === "low" ? C.amber : n.status === "asleep" ? C.t3 : C.t1;
          const above = n.id === "fog";
          return (
            <g key={n.id} onClick={() => onSelect(n.id)} style={{ cursor: "pointer" }}>
              {sel === n.id && <circle cx={n.bx} cy={n.by} r={r + 9} fill="none" stroke={C.ember} strokeWidth="2" strokeDasharray="4 4" />}
              {blink === n.id && <circle cx={n.bx} cy={n.by} r={r + 6} fill="none" stroke={C.emberT} strokeWidth="3" style={{ animation: "pmblink .8s ease-out infinite alternate" }} />}
              <circle cx={n.bx} cy={n.by} r={r} fill={C.raised2} stroke={statusStroke(n.status)} strokeWidth={big ? 2.5 : 2} strokeDasharray={n.status === "missing" ? "3 3" : ""} />
              <PropIcon type={props.get(n.id)} size={r * 1.9} x={n.bx - r * 0.95} y={n.by - r * 0.95}
                color={n.id === "bridge" ? C.emberT : statusStroke(n.status)}
                opacity={n.status === "missing" ? 0.7 : 1} />
              <text x={n.bx} y={above ? n.by - r - 7 : n.by + r + (big ? 21 : 17)} fontSize={big ? 11.5 : 10.5} fontWeight="600"
                fill={sel === n.id ? C.emberT : nameFill} fontFamily="system-ui">
                {SHORT[n.id]}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

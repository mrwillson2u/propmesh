// Prop icons — what each node *is*, not just what it is called.
//
// A yard of eight identical dots makes you read labels; a yard of
// tombstones and lanterns you read at a glance. Stroke-based on a 24px
// grid, one consistent weight, drawn to stay legible down to ~13px
// where Mini nodes render on the map. All inline SVG: no asset budget,
// and they recolor with node status via currentColor.
import type { ReactNode } from "react";

export type PropType =
  | "skull" | "zombie" | "spider" | "tombstone" | "witch" | "cauldron"
  | "pumpkin" | "ghost" | "bat" | "scarecrow" | "coffin" | "tree"
  | "lantern" | "lights" | "fog" | "speaker" | "sensor" | "hub"
  | "generic";

export const PROP_TYPES: { id: PropType; label: string }[] = [
  { id: "skull", label: "Skeleton" },
  { id: "zombie", label: "Zombie hand" },
  { id: "ghost", label: "Ghost" },
  { id: "witch", label: "Witch" },
  { id: "cauldron", label: "Cauldron" },
  { id: "pumpkin", label: "Jack-o'-lantern" },
  { id: "tombstone", label: "Tombstone" },
  { id: "coffin", label: "Coffin" },
  { id: "spider", label: "Spider" },
  { id: "bat", label: "Bat" },
  { id: "scarecrow", label: "Scarecrow" },
  { id: "tree", label: "Dead tree" },
  { id: "lantern", label: "Lantern" },
  { id: "lights", label: "String lights" },
  { id: "fog", label: "Fogger" },
  { id: "speaker", label: "Speaker" },
  { id: "sensor", label: "Sensor" },
  { id: "hub", label: "Bridge / hub" },
  { id: "generic", label: "Unassigned" },
];

const F = { fill: "currentColor", stroke: "none" } as const;

const PATHS: Record<PropType, ReactNode> = {
  skull: (
    <>
      <path d="M12 2.6c-4.1 0-7 2.9-7 6.7 0 2 .9 3.4 1.7 4.3.4.4.6.9.6 1.4v1.5h9.4V15c0-.5.2-1 .6-1.4.8-.9 1.7-2.3 1.7-4.3 0-3.8-2.9-6.7-7-6.7z" />
      <circle cx="9.4" cy="9.7" r="1.7" {...F} />
      <circle cx="14.6" cy="9.7" r="1.7" {...F} />
      <path d="M12 12.4l-1 1.8h2z" {...F} />
      <path d="M7.3 16.5v2.6M12 16.5v2.6M16.7 16.5v2.6M7.3 19.1h9.4" />
    </>
  ),
  zombie: (
    <>
      <path d="M3 19.6h18" />
      <path d="M8 19.6c0-2.5 1.7-3.8 4-3.8s4 1.3 4 3.8" />
      <path d="M9.3 16.2v-5.6M11.4 15.9V8.2M13.7 16.1V9.6M15.8 16.7l1.3-3.6" />
    </>
  ),
  spider: (
    <>
      <ellipse cx="12" cy="13.6" rx="3.2" ry="3.7" />
      <circle cx="12" cy="8.8" r="1.9" />
      <path d="M9 11.6 5.6 9.7 3.8 10.9M8.8 13.3 5 12.7 3.4 14.1M8.9 15.1 5.4 16.1 4.2 17.7M9.8 16.6 7.4 18.9 6.8 20.7" />
      <path d="M15 11.6l3.4-1.9 1.8 1.2M15.2 13.3l3.8-.6 1.6 1.4M15.1 15.1l3.5 1 1.2 1.6M14.2 16.6l2.4 2.3.6 1.8" />
    </>
  ),
  tombstone: (
    <>
      <path d="M6.5 20.8V10.6a5.5 5.5 0 0 1 11 0v10.2" />
      <path d="M3.8 20.8h16.4" />
      <path d="M12 8.6v5.6M9.6 10.8h4.8" />
    </>
  ),
  witch: (
    <>
      <ellipse cx="12" cy="16.4" rx="8.6" ry="2.6" />
      <path d="M8.6 15.1C9.4 11 11 6.7 14.2 3.4c1 4 1.6 8 1.8 11.9" />
      <path d="M9 12.6c1.9.7 4 .9 6 .4" />
    </>
  ),
  cauldron: (
    <>
      <path d="M4.6 11.4h14.8" />
      <path d="M6 11.4c0 4.4 2.7 7.5 6 7.5s6-3.1 6-7.5" />
      <path d="M8.4 18.5l-1.3 2.1M15.6 18.5l1.3 2.1" />
      <circle cx="10" cy="7.8" r="1.3" {...F} />
      <circle cx="13.6" cy="5.8" r="1" {...F} />
      <circle cx="14.6" cy="9" r=".8" {...F} />
    </>
  ),
  pumpkin: (
    <>
      <path d="M12 7.6c-3.9 0-6.6 2.9-6.6 6.6s2.7 6.6 6.6 6.6 6.6-2.9 6.6-6.6S15.9 7.6 12 7.6z" />
      <path d="M12 7.6V5.4c0-.9.7-1.6 1.8-1.8" />
      <path d="M9.1 12.1l1.6 2.4H7.5z" {...F} />
      <path d="M14.9 12.1l1.6 2.4h-3.2z" {...F} />
      <path d="M8.6 17h1.2l.7-1.1.8 1.1h1.4l.8-1.1.7 1.1h1.2" />
    </>
  ),
  ghost: (
    <>
      <path d="M6 20.6v-8.7a6 6 0 0 1 12 0v8.7l-2-1.6-2 1.6-2-1.6-2 1.6z" />
      <circle cx="9.9" cy="11.4" r="1.2" {...F} />
      <circle cx="14.1" cy="11.4" r="1.2" {...F} />
    </>
  ),
  bat: (
    <>
      <path d="M12 9.9a1.9 1.9 0 0 1 1.9 1.9v1.5a1.9 1.9 0 0 1-3.8 0v-1.5A1.9 1.9 0 0 1 12 9.9z" />
      <path d="M10.6 10.2 9.9 7.7l1.8 1.4M13.4 10.2l.7-2.5-1.8 1.4" />
      <path d="M10.2 11.5C8.5 9.5 5.7 8.6 3 9.3c1.3 1.1 1.7 2.6 1.3 4.1 1.5-.7 3-.2 4 1.1.5.6 1.2.9 1.9.9" />
      <path d="M13.8 11.5c1.7-2 4.5-2.9 7.2-2.2-1.3 1.1-1.7 2.6-1.3 4.1-1.5-.7-3-.2-4 1.1-.5.6-1.2.9-1.9.9" />
    </>
  ),
  scarecrow: (
    <>
      <path d="M12 20.8v-11.4" />
      <path d="M6.2 12h11.6" />
      <circle cx="12" cy="6.4" r="2.7" />
      <path d="M8.2 4.6h7.6M9.7 4.6V2.6h4.6v2" />
      <path d="M6.2 12 4.6 14.4M17.8 12l1.6 2.4" />
    </>
  ),
  coffin: (
    <>
      <path d="M9.5 2.9h5l3.3 5.8L15 21.1H9L6.2 8.7z" />
      <path d="M12 9v5.2M9.7 11h4.6" />
    </>
  ),
  tree: (
    <>
      <path d="M12 21v-9.4" />
      <path d="M12 20.9c-1.3 0-2.2-.6-2.8-1.5M12 20.9c1.3 0 2.2-.6 2.8-1.5" />
      <path d="M12 15.6 8.5 12.1 6.4 10.6M12 13.6l3.6-3.5 2.1-1.4" />
      <path d="M12 11.9 9.5 8.2 8.2 6.3M12 11.9l2.5-3.7 1.2-1.9" />
      <path d="M12 11.6V8.1M12 8.5 10.3 6.3M12 8.5l1.7-2.2" />
    </>
  ),
  lantern: (
    <>
      <path d="M9.9 4.4a2.1 2.1 0 0 1 4.2 0" />
      <path d="M7.4 6.2h9.2" />
      <path d="M8.6 6.2 7.8 17h8.4l-.8-10.8" />
      <path d="M7.4 19.2h9.2M7.8 17v2.2M16.2 17v2.2" />
      <path d="M12 9.6c-1.1 1.4-1.6 2.3-1.6 3.1a1.6 1.6 0 0 0 3.2 0c0-.8-.5-1.7-1.6-3.1z" {...F} />
    </>
  ),
  lights: (
    <>
      <path d="M3 6.5c1.2 3 4.8 3 6 0c1.2 3 4.8 3 6 0c1.2 3 4.8 3 6 0" />
      <path d="M6 8.9v1.4M12 8.9v1.4M18 8.9v1.4" />
      <circle cx="6" cy="11.7" r="1.4" {...F} />
      <circle cx="12" cy="11.7" r="1.4" {...F} />
      <circle cx="18" cy="11.7" r="1.4" {...F} />
    </>
  ),
  fog: (
    <>
      <path d="M3 8.6q2.5-3 5 0t5 0 5 0" />
      <path d="M3 13q2.5-3 5 0t5 0 5 0" />
      <path d="M3 17.4q2.5-3 5 0t5 0 5 0" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.4v5.2h3.5l4.7 3.7V5.7L7.5 9.4z" />
      <path d="M15.4 9.2a4.6 4.6 0 0 1 0 5.6M18 6.8a8.2 8.2 0 0 1 0 10.4" />
    </>
  ),
  sensor: (
    <>
      <path d="M6.2 17.4a5.8 5.8 0 0 1 11.6 0z" />
      <path d="M5.4 17.4h13.2" />
      <path d="M9.4 8.6a4.4 4.4 0 0 1 5.2 0M7.2 5.6a8.4 8.4 0 0 1 9.6 0" />
    </>
  ),
  hub: (
    <>
      <path d="M12 4.6 4.8 17.4h14.4z" opacity=".5" />
      <circle cx="12" cy="4.6" r="2.6" {...F} />
      <circle cx="4.8" cy="17.4" r="2.6" {...F} />
      <circle cx="19.2" cy="17.4" r="2.6" {...F} />
    </>
  ),
  generic: (
    <>
      <path d="M12 3.8 19.2 8v8L12 20.2 4.8 16V8z" />
      <circle cx="12" cy="12" r="2" {...F} />
    </>
  ),
};

export function PropIcon({
  type, size = 24, color = "currentColor", x, y, opacity,
}: {
  type: PropType;
  size?: number;
  color?: string;
  x?: number; // set when rendering inside an SVG canvas
  y?: number;
  opacity?: number;
}) {
  return (
    <svg
      x={x} y={y} width={size} height={size} viewBox="0 0 24 24"
      style={{ color, display: "block", overflow: "visible" }}
      fill="none" stroke="currentColor" strokeWidth={1.7}
      strokeLinecap="round" strokeLinejoin="round" opacity={opacity}
    >
      {PATHS[type]}
    </svg>
  );
}

// --- clip art ------------------------------------------------------------------
// The same props in color, for the Yard Map: a tombstone is gray, a
// pumpkin orange, a ghost white. Flat fills, no outlines, so they read
// as little stickers on the dark ground rather than as UI glyphs.
const K = {
  ink: "#1b1e24", bone: "#ece6d4", white: "#f4f4f7", orange: "#f28c28", orangeD: "#c96a14", stem: "#5f9b3b",
  glow: "#ffd166", stone: "#9aa3b3", stoneD: "#687082", grass: "#4f8f3a", purple: "#7a5cc7", purpleD: "#55409a",
  gold: "#e8b43a", skin: "#8fc25c", skinD: "#5f8f3a", wood: "#8a5a34", woodD: "#5e3b20", brass: "#d4a647",
  flame: "#ff7a1a", red: "#e04545", fog: "#b9c8dc", teal: "#4fc3a1", ember: "#e0683a", blue: "#6ea8ff",
  gray: "#8a94a6", leg: "#b8b8c8", body: "#3a3a48", web: "#2f2f3c",
};
const ART: Record<PropType, ReactNode> = {
  skull: (
    <>
      <path d="M12 2.6c-4.1 0-7 2.9-7 6.7 0 2 .9 3.4 1.7 4.3.4.4.6.9.6 1.4v4.6h9.4V15c0-.5.2-1 .6-1.4.8-.9 1.7-2.3 1.7-4.3 0-3.8-2.9-6.7-7-6.7z" fill={K.bone} />
      <circle cx="9.4" cy="9.8" r="1.9" fill={K.ink} />
      <circle cx="14.6" cy="9.8" r="1.9" fill={K.ink} />
      <path d="M12 12.2l-1.1 2h2.2z" fill={K.ink} />
      <path d="M9.6 16.2v3M12 16.2v3M14.4 16.2v3" stroke={K.stoneD} strokeWidth=".9" />
    </>
  ),
  zombie: (
    <>
      <ellipse cx="12" cy="20.2" rx="9" ry="2.2" fill={K.woodD} />
      <path d="M9.3 17.4v-6.4M11.4 17.2V8M13.7 17.4V9.4M15.9 18l1.5-4" stroke={K.skin} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M8 20.2c0-2.8 1.7-4.3 4-4.3s4 1.5 4 4.3z" fill={K.skin} />
      <path d="M10.2 18.6h3.6" stroke={K.skinD} strokeWidth=".8" />
    </>
  ),
  spider: (
    <>
      <path d="M9.2 11.6 5.6 9.7 3.8 10.9M8.9 13.3 5 12.7 3.4 14.1M9 15.1 5.4 16.1 4.2 17.7M9.9 16.6 7.4 18.9 6.8 20.7" stroke={K.leg} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M14.8 11.6l3.6-1.9 1.8 1.2M15.1 13.3l3.9-.6 1.6 1.4M15 15.1l3.6 1 1.2 1.6M14.1 16.6l2.5 2.3.6 1.8" stroke={K.leg} strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <ellipse cx="12" cy="13.8" rx="3.3" ry="3.9" fill={K.body} />
      <circle cx="12" cy="8.9" r="2" fill={K.body} />
      <path d="M12 11.4l-1.2 2.2 1.2 2.4 1.2-2.4z" fill={K.red} />
      <circle cx="11.2" cy="8.4" r=".5" fill={K.red} /><circle cx="12.8" cy="8.4" r=".5" fill={K.red} />
    </>
  ),
  tombstone: (
    <>
      <ellipse cx="12" cy="20.4" rx="9.5" ry="2" fill={K.grass} />
      <path d="M6.5 20.4V10.4a5.5 5.5 0 0 1 11 0v10z" fill={K.stone} />
      <path d="M6.5 20.4V10.4a5.5 5.5 0 0 1 5.5-5.5v15.5z" fill={K.stoneD} opacity=".35" />
      <path d="M12 8.4v6M9.6 10.6h4.8" stroke={K.bone} strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  witch: (
    <>
      <ellipse cx="12" cy="16.6" rx="9" ry="2.8" fill={K.purpleD} />
      <path d="M8.2 15.6C9.2 11 11 6.6 14.4 3c1 4.2 1.6 8.3 1.8 12.6z" fill={K.purple} />
      <path d="M8.8 13.2c2.1.9 4.4 1 6.6.4l.2 1.6c-2.4.6-4.8.5-7.1-.3z" fill={K.gold} />
      <rect x="12.3" y="12.9" width="1.6" height="1.6" fill={K.purpleD} />
    </>
  ),
  cauldron: (
    <>
      <path d="M6 11.4c0 4.6 2.7 7.7 6 7.7s6-3.1 6-7.7z" fill={K.body} />
      <rect x="4.4" y="10.2" width="15.2" height="2.2" rx="1.1" fill={K.stoneD} />
      <ellipse cx="12" cy="11.3" rx="6.2" ry="1" fill={K.skin} />
      <path d="M8.4 18.8l-1.3 2.2M15.6 18.8l1.3 2.2" stroke={K.body} strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9.6" cy="7.6" r="1.4" fill={K.skin} /><circle cx="13.4" cy="5.4" r="1.1" fill={K.skin} /><circle cx="14.8" cy="8.6" r=".8" fill={K.skin} />
    </>
  ),
  pumpkin: (
    <>
      <path d="M12.6 7.2V4.8c0-1 .8-1.7 1.9-1.9l.5 1.6c-.6.1-1 .4-1 .9v1.8z" fill={K.stem} />
      <ellipse cx="12" cy="14" rx="7.2" ry="6.4" fill={K.orange} />
      <path d="M9.4 7.9c-1.6 1.6-2.2 3.8-2.2 6.1s.6 4.5 2.2 6.1M14.6 7.9c1.6 1.6 2.2 3.8 2.2 6.1s-.6 4.5-2.2 6.1" stroke={K.orangeD} strokeWidth="1" fill="none" />
      <path d="M9 12.2l1.6 2.4H7.4z" fill={K.glow} />
      <path d="M15 12.2l1.6 2.4h-3.2z" fill={K.glow} />
      <path d="M8.4 16.4h1.3l.7-1 .8 1h1.6l.8-1 .7 1h1.3l-.8 1.3H9.2z" fill={K.glow} />
    </>
  ),
  ghost: (
    <>
      <path d="M6 20.8v-9a6 6 0 0 1 12 0v9l-2-1.6-2 1.6-2-1.6-2 1.6-2-1.6z" fill={K.white} />
      <circle cx="9.9" cy="11.4" r="1.3" fill={K.ink} />
      <circle cx="14.1" cy="11.4" r="1.3" fill={K.ink} />
      <ellipse cx="12" cy="15" rx="1" ry="1.4" fill={K.ink} />
    </>
  ),
  bat: (
    <>
      <path d="M10.2 11.4C8.5 9.4 5.7 8.5 3 9.2c1.3 1.1 1.7 2.6 1.3 4.1 1.5-.7 3-.2 4 1.1.5.6 1.2.9 1.9.9z" fill={K.purple} />
      <path d="M13.8 11.4c1.7-2 4.5-2.9 7.2-2.2-1.3 1.1-1.7 2.6-1.3 4.1-1.5-.7-3-.2-4 1.1-.5.6-1.2.9-1.9.9z" fill={K.purple} />
      <path d="M12 9.6a2.1 2.1 0 0 1 2.1 2.1v1.7a2.1 2.1 0 0 1-4.2 0v-1.7A2.1 2.1 0 0 1 12 9.6z" fill={K.purpleD} />
      <path d="M10.6 10 9.8 7.5l1.9 1.5zM13.4 10l.8-2.5-1.9 1.5z" fill={K.purpleD} />
      <circle cx="11.2" cy="11.5" r=".5" fill={K.glow} /><circle cx="12.8" cy="11.5" r=".5" fill={K.glow} />
    </>
  ),
  scarecrow: (
    <>
      <path d="M12 21V9.4M6.2 12h11.6" stroke={K.wood} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6.2 12 4.6 14.4M17.8 12l1.6 2.4" stroke={K.gold} strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="12" cy="6.6" r="2.9" fill={K.gold} />
      <circle cx="11" cy="6.2" r=".5" fill={K.ink} /><circle cx="13" cy="6.2" r=".5" fill={K.ink} /><path d="M11 7.8h2" stroke={K.ink} strokeWidth=".6" />
      <path d="M8 4.4h8l-.4-1.1h-2.4V1.9H10.8v1.4H8.4z" fill={K.woodD} />
    </>
  ),
  coffin: (
    <>
      <path d="M9.5 2.9h5l3.3 5.8L15 21.1H9L6.2 8.7z" fill={K.wood} />
      <path d="M9.5 2.9 6.2 8.7 9 21.1h3V2.9z" fill={K.woodD} opacity=".45" />
      <path d="M12 8.6v6M9.7 10.8h4.6" stroke={K.bone} strokeWidth="1.5" strokeLinecap="round" />
    </>
  ),
  tree: (
    <>
      <path d="M12 21v-9.6" stroke={K.woodD} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M12 15.6 8.5 12.1 6.4 10.6M12 13.6l3.6-3.5 2.1-1.4M12 11.9 9.5 8.2 8.2 6.3M12 11.9l2.5-3.7 1.2-1.9M12 11.6V8.1M12 8.5 10.3 6.3M12 8.5l1.7-2.2" stroke={K.wood} strokeWidth="1.5" strokeLinecap="round" fill="none" />
      <path d="M8.2 21.2c1.2-.8 2.4-1.2 3.8-1.2s2.6.4 3.8 1.2" stroke={K.woodD} strokeWidth="1.4" strokeLinecap="round" fill="none" />
    </>
  ),
  lantern: (
    <>
      <path d="M9.9 4.4a2.1 2.1 0 0 1 4.2 0" stroke={K.brass} strokeWidth="1.4" fill="none" />
      <path d="M8.6 6.2 7.8 17h8.4l-.8-10.8z" fill={K.glow} opacity=".35" />
      <path d="M8.6 6.2 7.8 17h8.4l-.8-10.8z" stroke={K.brass} strokeWidth="1.3" fill="none" />
      <rect x="7" y="5.2" width="10" height="1.8" rx=".6" fill={K.brass} /><rect x="7" y="17" width="10" height="2.2" rx=".6" fill={K.brass} />
      <path d="M12 9c-1.3 1.6-1.9 2.7-1.9 3.6a1.9 1.9 0 0 0 3.8 0c0-.9-.6-2-1.9-3.6z" fill={K.flame} />
      <path d="M12 11.4c-.6.8-.8 1.3-.8 1.6a.8.8 0 0 0 1.6 0c0-.3-.2-.8-.8-1.6z" fill={K.glow} />
    </>
  ),
  lights: (
    <>
      <path d="M3 6.5c1.2 3 4.8 3 6 0c1.2 3 4.8 3 6 0c1.2 3 4.8 3 6 0" stroke={K.gray} strokeWidth="1.2" fill="none" />
      <path d="M6 8.9v1.6M12 8.9v1.6M18 8.9v1.6" stroke={K.gray} strokeWidth="1.2" />
      <circle cx="6" cy="12.4" r="2" fill={K.red} /><circle cx="12" cy="12.4" r="2" fill={K.skin} /><circle cx="18" cy="12.4" r="2" fill={K.glow} />
    </>
  ),
  fog: (
    <>
      <path d="M3 8.6q2.5-3 5 0t5 0 5 0" stroke={K.fog} strokeWidth="2" strokeLinecap="round" fill="none" opacity=".55" />
      <path d="M3 13q2.5-3 5 0t5 0 5 0" stroke={K.fog} strokeWidth="2" strokeLinecap="round" fill="none" opacity=".8" />
      <path d="M3 17.4q2.5-3 5 0t5 0 5 0" stroke={K.fog} strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.4v5.2h3.5l4.7 3.7V5.7L7.5 9.4z" fill={K.gray} />
      <path d="M15.4 9.2a4.6 4.6 0 0 1 0 5.6M18 6.8a8.2 8.2 0 0 1 0 10.4" stroke={K.blue} strokeWidth="1.6" strokeLinecap="round" fill="none" />
    </>
  ),
  sensor: (
    <>
      <path d="M6.2 17.4a5.8 5.8 0 0 1 11.6 0z" fill={K.teal} />
      <rect x="5" y="17" width="14" height="2" rx="1" fill={K.stoneD} />
      <path d="M9.4 8.6a4.4 4.4 0 0 1 5.2 0M7.2 5.6a8.4 8.4 0 0 1 9.6 0" stroke={K.teal} strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </>
  ),
  hub: (
    <>
      <path d="M12 4.6 4.8 17.4h14.4z" fill="none" stroke={K.ember} strokeWidth="1.5" opacity=".6" />
      <circle cx="12" cy="4.6" r="2.6" fill={K.ember} /><circle cx="4.8" cy="17.4" r="2.6" fill={K.ember} /><circle cx="19.2" cy="17.4" r="2.6" fill={K.ember} />
    </>
  ),
  generic: (
    <>
      <path d="M12 3.8 19.2 8v8L12 20.2 4.8 16V8z" fill={K.gray} opacity=".5" />
      <circle cx="12" cy="12" r="2.2" fill={K.white} />
    </>
  ),
};

// The colored version, for the map. Same size/position contract as PropIcon.
export function PropArt({ type, size = 24, x, y, opacity }: { type: PropType; size?: number; x?: number; y?: number; opacity?: number }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" style={{ display: "block", overflow: "visible" }} opacity={opacity}>
      {ART[type]}
    </svg>
  );
}

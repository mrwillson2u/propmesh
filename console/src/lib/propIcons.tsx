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

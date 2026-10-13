// Design tokens from the Claude Design handoff
// (reference/design_handoff_propmesh_console/README.md — "Design Tokens").
export const C = {
  bg: "#0b0d10",
  grid: "#161a20",
  panel: "#101318",
  card: "#14171c",
  raised: "#191d23",
  raised2: "#1a1e24",
  b1: "#20242b",
  b2: "#262b33",
  b3: "#333a45",
  t1: "#e6e9ed",
  t2: "#c7cdd6",
  t3: "#9aa3af",
  t4: "#8b93a1",
  t5: "#5f6873",
  t6: "#3f4652",
  ember: "#ff6b2c",
  emberT: "#ff8a4d",
  emberBg: "#2a1108",
  emberBg2: "#1c1109",
  emberB: "#6b3a1a",
  emberB2: "#3a2211",
  onEmber: "#1a0d05",
  green: "#3fb950",
  greenBg: "#0f2416",
  greenB: "#1f4a2c",
  amber: "#e0a52a",
  amberBg: "#2b2110",
  amberB: "#4a3a14",
  red: "#f4483a",
  redBg: "#2a1210",
  redBg2: "#1e0d0b",
  redB: "#4a1f1a",
  linkGray: "#6b7684",
  bluetooth: "#3d8bfd", // Bluetooth links to the floods (Yard)
  wire: "#3a4150",
} as const;

export const MONO = "'IBM Plex Mono',ui-monospace,monospace";

// Section label style used everywhere in panels
export const sectionLabel = {
  font: "600 10px system-ui",
  letterSpacing: ".08em",
  color: C.t5,
} as const;

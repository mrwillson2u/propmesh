// Small shared pieces from the handoff's component sheet.
import { C, MONO } from "./lib/tokens";

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M12 5L5 17h14z" stroke={C.ember} strokeWidth="1.4" fill="none" opacity=".5" />
      <circle cx="12" cy="5" r="2.6" fill={C.ember} />
      <circle cx="5" cy="17" r="2.6" fill={C.ember} />
      <circle cx="19" cy="17" r="2.6" fill={C.ember} />
    </svg>
  );
}

export function StopOctagon({ size = 16 }: { size?: number }) {
  return (
    <svg style={{ position: "relative" }} width={size} height={size} viewBox="0 0 16 16">
      <path d="M5 1.5h6L15 5v6l-4 3.5H5L1 11V5z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="5" y="7" width="6" height="2" fill="currentColor" />
    </svg>
  );
}

export function Toggle({ on, small, onClick }: { on: boolean; small?: boolean; onClick?: () => void }) {
  const w = small ? 36 : 40, h = small ? 20 : 22, k = h - 6;
  return (
    <div
      onClick={onClick}
      style={{
        width: w, height: h, borderRadius: 99, flex: "none", position: "relative",
        background: on ? C.ember : "#232833",
        boxShadow: on ? "0 0 10px rgba(255,107,44,.35)" : undefined,
        cursor: onClick ? "pointer" : undefined,
      }}
    >
      <div style={{
        position: "absolute", top: 3, width: k, height: k, borderRadius: "50%",
        ...(on ? { right: 3, background: C.onEmber } : { left: 3, background: C.t5 }),
      }} />
    </div>
  );
}

export const mono = (weight: number, size: number, color: string) =>
  ({ font: `${weight} ${size}px ${MONO}`, color }) as const;

export const sys = (weight: number, size: number, color: string) =>
  ({ font: `${weight} ${size}px system-ui`, color }) as const;

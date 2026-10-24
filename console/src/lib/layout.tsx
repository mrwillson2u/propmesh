// Which layout a screen gets, and which way it is held (docs/console-phone.md).
// One breakpoint: under 700 px wide is the phone layout — a bottom tab bar,
// a STOP ALL bar across the top, panels as sheets. At and above it the
// laptop layout stands, tablets included. Everything reads this hook; the
// app styles inline, so there is no stylesheet to fork.
import { useEffect, useState, type ReactNode } from "react";
import { C, MONO } from "./tokens";

const PHONE = "(max-width: 699px)";
const LANDSCAPE = "(orientation: landscape)";

export interface Layout { phone: boolean; landscape: boolean }

const read = (): Layout => ({
  phone: typeof matchMedia !== "undefined" && matchMedia(PHONE).matches,
  landscape: typeof matchMedia !== "undefined" && matchMedia(LANDSCAPE).matches,
});

export function useLayout(): Layout {
  const [l, setL] = useState<Layout>(read);
  useEffect(() => {
    const a = matchMedia(PHONE), b = matchMedia(LANDSCAPE);
    const on = () => setL(read());
    a.addEventListener("change", on); b.addEventListener("change", on);
    return () => { a.removeEventListener("change", on); b.removeEventListener("change", on); };
  }, []);
  return l;
}

// A view that is easier sideways says so, once, in portrait on a phone —
// a line with a rotate glyph, dismissed with a tap and remembered. Nothing
// is ever blocked on orientation; the hint is the whole affordance.
export function LandscapeHint({ what, children }: { what: string; children: ReactNode }) {
  const { phone, landscape } = useLayout();
  const key = `propmesh.hint.landscape.${what}`;
  const [gone, setGone] = useState(() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } });
  if (!phone || landscape || gone) return null;
  return (
    <div onClick={() => { setGone(true); try { localStorage.setItem(key, "1"); } catch { /* private mode */ } }}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", margin: "8px 12px", borderRadius: 8,
        background: C.raised, border: `1px solid ${C.b2}`, color: C.t3, font: `500 12.5px system-ui`, cursor: "pointer" }}>
      <span style={{ font: `700 16px ${MONO}`, color: C.amber }}>⟳</span>
      <span style={{ flex: 1 }}>{children}</span>
      <span style={{ color: C.t5, fontSize: 12 }}>✕</span>
    </div>
  );
}

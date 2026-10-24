// "Which pin should I use?" — the board's recommendations, grouped by
// what you're wiring. Free pins are bright, used ones dim; click one to
// jump to its row. Collapsible; the choice is remembered per browser.
import { useState } from "react";
import { C } from "../../lib/tokens";
import { mono, sys, Hint } from "../../ui";
import { FUNCTIONS, type Board } from "../../lib/boards_gen";
import { channelCode, type NodeConfig } from "../../lib/nodeConfig";
import { GUIDE_ORDER, holder, pinsFor } from "../../lib/pinAdvice";

const KEY = "propmesh.pinguide.open";

export default function PinGuide({ board, cfg }: { board: Board; cfg: NodeConfig }) {
  const [open, setOpenState] = useState(() => {
    try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
  });
  const setOpen = (o: boolean) => {
    setOpenState(o);
    try { localStorage.setItem(KEY, o ? "1" : "0"); } catch { /* private mode */ }
  };
  const jump = (gpio: number) =>
    document.getElementById(`pin-row-${gpio}`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <div style={{ margin: "10px 0 4px", border: `1px solid ${C.b2}`, borderRadius: 8, background: C.card }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" }}>
        <span style={{ color: C.t4, fontSize: 11 }}>{open ? "▾" : "▸"}</span>
        <span style={sys(700, 12, C.t1)}>Pin guide</span>
        <span style={sys(400, 11.5, C.t4)}>which pins suit what, on the {board.name}</span>
      </div>
      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "2px 12px 12px" }}>
          {GUIDE_ORDER.map((k) => {
            const { best } = pinsFor(board, k);
            if (!best.length) return null;
            return (
              <div key={k} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 10, alignItems: "baseline" }}>
                <span style={sys(600, 12, C.t2)}>{FUNCTIONS[k].label}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {best.map((p) => {
                      const used = holder(cfg, p.gpio);
                      return (
                        <span key={p.gpio} onClick={() => jump(p.gpio)}
                          title={used ? `in use: ${channelCode(used)}${used.label ? ` (${used.label})` : ""}` : `GPIO ${p.gpio} — free`}
                          style={{
                            padding: "1px 7px", borderRadius: 4, cursor: "pointer",
                            background: used ? "transparent" : C.raised,
                            border: `1px solid ${used ? C.b2 : C.b3}`,
                            ...mono(600, 11, used ? C.t5 : C.t1),
                            textDecoration: used && used.kind !== k ? "line-through" : undefined,
                          }}>
                          {p.label}{used ? (used.kind === k ? " ✓" : "") : ""}
                        </span>
                      );
                    })}
                  </span>
                  {board.guide[k] && <span style={sys(400, 11, C.t4)}>{board.guide[k]}</span>}
                </span>
              </div>
            );
          })}
          <Hint style={{ marginTop: 2 }}>
            ✓ = already used for this · struck = used for something else · ★ in the function lists marks the recommended pins.
          </Hint>
        </div>
      )}
    </div>
  );
}

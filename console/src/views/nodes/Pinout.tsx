// The board's pinout, drawn from its profile (boards/<id>.yaml `header`)
// with the node's assignments on the pins — so it is right offline, and
// right for THIS node. Boards whose vendors disagree on the header order
// (the C6 SuperMini) get a list of GPIO numbers instead. Each board links
// to the vendor's own pinout page for the photo-style version.
// Collapsible; the choice is remembered per browser.
import { useState } from "react";
import { C } from "../../lib/tokens";
import { mono, sys } from "../../ui";
import type { Board, BoardPin } from "../../lib/boards_gen";
import { channelCode, type NodeConfig } from "../../lib/nodeConfig";
import { holder } from "../../lib/pinAdvice";

const KEY = "propmesh.pinout.open";
const ROW = 18, PAD_W = 46, LABEL_W = 150, BODY_W = 150;

export default function Pinout({ board, cfg }: { board: Board; cfg: NodeConfig }) {
  const [open, setOpenState] = useState(() => {
    try { return localStorage.getItem(KEY) !== "0"; } catch { return true; }
  });
  const setOpen = (o: boolean) => {
    setOpenState(o);
    try { localStorage.setItem(KEY, o ? "1" : "0"); } catch { /* private mode */ }
  };
  const jump = (gpio: number) =>
    document.getElementById(`pin-row-${gpio}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  const byLabel = new Map(board.pins.map((p) => [String(p.label), p]));

  return (
    <div style={{ margin: "10px 0 4px", border: `1px solid ${C.b2}`, borderRadius: 8, background: C.card }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", cursor: "pointer" }}>
        <span style={{ color: C.t4, fontSize: 11 }}>{open ? "▾" : "▸"}</span>
        <span style={sys(700, 12, C.t1)}>Pinout</span>
        <span style={sys(400, 11.5, C.t4)}>the {board.name} with this node's assignments</span>
        <div style={{ flex: 1 }} />
        {board.pinoutUrl && (
          <a href={board.pinoutUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
            style={{ ...sys(500, 11, C.t3), textDecoration: "underline" }}>vendor pinout ↗</a>
        )}
      </div>
      {open && board.variants && (
        <div style={{ padding: "0 12px 8px", ...sys(400, 11.5, C.t3) }} title="Sellers' versions of this board differ — what to check on the one in hand">
          <span style={sys(700, 11, C.t5)}>VERSIONS DIFFER · </span>
          {board.variants.map((v, i) => <div key={i} style={{ margin: "3px 0 0 10px" }}>• {v.replace(/\*\*/g, "")}</div>)}
        </div>
      )}
      {open && (board.header
        ? <Drawing board={board} cfg={cfg} byLabel={byLabel} jump={jump} />
        : <List board={board} cfg={cfg} jump={jump} />)}
    </div>
  );
}

// What a pad says and how it's colored: the assignment if any, else the
// pin's tier; power/control pins are plain.
function padStyle(pin: BoardPin | undefined, used: ReturnType<typeof holder>) {
  if (!pin) return { fill: C.raised, stroke: C.b3, text: C.t4 };
  if (pin.tier === "reserved") return { fill: "transparent", stroke: C.b2, text: C.t6 };
  if (used) return { fill: used.kind === "DIGITAL_IN" ? "#1c2240" : C.emberBg, stroke: used.kind === "DIGITAL_IN" ? "#3a4680" : C.emberB, text: used.kind === "DIGITAL_IN" ? "#9aa6e8" : C.emberT };
  if (pin.tier === "caution") return { fill: C.amberBg, stroke: C.amberB, text: C.amber };
  return { fill: C.raised, stroke: C.b3, text: C.t1 };
}

function tip(pin: BoardPin | undefined, used: ReturnType<typeof holder>, label: string) {
  if (!pin) return label;
  const head = `${label} — GPIO ${pin.gpio}`;
  if (used) return `${head}: ${channelCode(used)}${used.label ? ` (${used.label})` : ""}`;
  if (pin.tier === "reserved") return `${head}: reserved — ${pin.note ?? ""}`;
  return `${head}: free${pin.best ? `, best for ${pin.best}` : ""}${pin.note ? ` — ${pin.note}` : ""}`;
}

function Drawing({ board, cfg, byLabel, jump }: {
  board: Board; cfg: NodeConfig; byLabel: Map<string, BoardPin>; jump: (gpio: number) => void;
}) {
  const h = board.header!;
  const rows = Math.max(h.left.length, h.right.length);
  const W = LABEL_W * 2 + PAD_W * 2 + BODY_W, H = rows * ROW + 56;
  const bodyX = LABEL_W + PAD_W, bodyY = 18, bodyH = rows * ROW + 20;
  const side = (labels: string[], left: boolean) => labels.map((label, i) => {
    const pin = byLabel.get(label);
    const used = pin ? holder(cfg, pin.gpio) : undefined;
    const st = padStyle(pin, used);
    const y = bodyY + 10 + i * ROW;
    const padX = left ? bodyX - PAD_W + 4 : bodyX + BODY_W - 4;
    const textX = left ? padX - 6 : padX + PAD_W + 6;
    const note = used ? `${channelCode(used)}${used.label ? ` · ${used.label}` : ""}` : pin?.best ? `★ ${pin.best}` : "";
    return (
      <g key={`${left ? "l" : "r"}${i}`} onClick={() => pin && jump(pin.gpio)} style={{ cursor: pin ? "pointer" : "default" }}>
        <title>{tip(pin, used, label)}</title>
        <rect x={padX} y={y} width={PAD_W - 4} height={ROW - 4} rx={3} fill={st.fill} stroke={st.stroke} />
        <text x={padX + (PAD_W - 4) / 2} y={y + ROW / 2 + 1} textAnchor="middle" dominantBaseline="middle"
          style={{ font: `600 9.5px ${MONO}`, fill: st.text }}>{label}</text>
        {note && (
          <text x={textX} y={y + ROW / 2 + 1} textAnchor={left ? "end" : "start"} dominantBaseline="middle"
            style={{ font: `${used ? 600 : 400} 9.5px ${MONO}`, fill: used ? st.text : C.t5 }}>{note}</text>
        )}
      </g>
    );
  });
  return (
    <div style={{ padding: "0 12px 10px", overflowX: "auto" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%" }}>
        <rect x={bodyX} y={bodyY} width={BODY_W} height={bodyH} rx={8} fill={C.panel} stroke={C.b3} />
        <text x={bodyX + BODY_W / 2} y={bodyY + bodyH / 2} textAnchor="middle" dominantBaseline="middle"
          style={{ font: "600 10px system-ui", fill: C.t5, letterSpacing: ".08em" }}>{board.mcu}</text>
        {/* the USB socket, so the drawing can be held the same way as the board */}
        <rect x={bodyX + BODY_W / 2 - 14} y={h.usb === "bottom" ? bodyY + bodyH - 6 : bodyY - 4} width={28} height={10} rx={2} fill={C.b3} />
        <text x={bodyX + BODY_W / 2} y={h.usb === "bottom" ? bodyY + bodyH + 14 : bodyY - 8} textAnchor="middle"
          style={{ font: "500 9px system-ui", fill: C.t5 }}>USB</text>
        {side(h.left, true)}
        {side(h.right, false)}
      </svg>
      <Legend />
    </div>
  );
}

function List({ board, cfg, jump }: { board: Board; cfg: NodeConfig; jump: (gpio: number) => void }) {
  return (
    <div style={{ padding: "0 12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={sys(400, 11.5, C.t4)}>
        This board comes with different header orders from different vendors, so here are its GPIOs by number — match them to the silkscreen.
      </span>
      <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {board.pins.map((pin) => {
          const used = holder(cfg, pin.gpio);
          const st = padStyle(pin, used);
          return (
            <span key={pin.gpio} onClick={() => jump(pin.gpio)} title={tip(pin, used, String(pin.label))}
              style={{ padding: "2px 7px", borderRadius: 4, cursor: "pointer", background: st.fill, border: `1px solid ${st.stroke}`, ...mono(600, 11, st.text) }}>
              {pin.label}{used ? ` ${channelCode(used)}` : ""}
            </span>
          );
        })}
      </span>
      <Legend />
    </div>
  );
}

function Legend() {
  const sw = (fill: string, stroke: string) => <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: fill, border: `1px solid ${stroke}`, verticalAlign: -1, marginRight: 4 }} />;
  return (
    <div style={{ ...sys(400, 10.5, C.t5), marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap" }}>
      <span>{sw(C.emberBg, C.emberB)}output assigned</span>
      <span>{sw("#1c2240", "#3a4680")}input assigned</span>
      <span>{sw(C.raised, C.b3)}free</span>
      <span>{sw(C.amberBg, C.amberB)}free, with a caveat (hover)</span>
      <span>{sw("transparent", C.b2)}reserved</span>
      <span>· click a pin to jump to its row</span>
    </div>
  );
}

const MONO = "ui-monospace, Menlo, monospace";

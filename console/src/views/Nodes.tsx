// Nodes & Channels — fleet manager (handoff 1c): fault surface, filter
// toolbar, expandable node table with per-channel test fire.
import { useRef, useState } from "react";
import { C } from "../lib/tokens";
import { NODES, CHANNELS, statusStroke, type YardNode } from "../lib/mesh";
import { PropIcon, PROP_TYPES, type PropType } from "../lib/propIcons";
import { useProps } from "../lib/propStore";
import { mono, sys } from "../ui";
import MeshPanel from "./nodes/MeshPanel";

const GRID = "280px 90px 130px 120px 1fr 40px";
const CH_GRID = "130px 220px 120px 1fr 110px";

const boardTag = (pro: boolean) => (
  <span style={{ ...mono(600, 10.5, C.t3), background: C.raised, borderRadius: 4, padding: "2px 7px", width: "fit-content" }}>
    {pro ? "PRO" : "MINI"}
  </span>
);

function powerCell(n: YardNode) {
  if (n.pro) return <span style={mono(600, 11.5, C.t4)}>⚡ wall power</span>;
  if (n.status === "missing") return <span style={mono(600, 11.5, C.t5)}>was {n.batt!.toFixed(2)} V</span>;
  const bars = n.batt! >= 3.8 ? "▮▮▮▮" : n.batt! >= 3.5 ? "▮▮▮▯" : n.batt! >= 3.3 ? "▮▮▯▯" : "▮▯▯▯";
  const col = n.status === "low" ? C.amber : n.batt! >= 3.8 ? C.green : C.t3;
  return <span style={mono(n.status === "low" ? 700 : 600, 11.5, col)}>{bars} {n.batt!.toFixed(2)} V</span>;
}

const SUMMARY: Record<string, string> = {
  skeleton: "4 outputs · 1 sensor · hop 1 · −52 dBm",
  bridge: "2 outputs · audio out · sACN in · hop 0",
  fog: "RELAY_1 fog machine · MOTOR_A chiller fan · TEMP_1 12.4 °C",
  graveyard: "SERVO_1–3 · MOTOR_A · 1 sensor · hop 2",
  l1: "LED_STRIP_1 flicker candle",
  l2: "LED_STRIP_1 flicker candle",
  l3: "LED_STRIP_1 flicker candle · weak link −83",
  pir: "PIR_1 driveway sensor · used by cue “Driveway Scare”",
};

const ORDER = ["skeleton", "bridge", "fog", "graveyard", "l1", "l2", "l3", "pir"];

// Click a node's prop icon to say what it actually drives — the icon is
// how you find it again on the yard canvas.
function PropPicker({ nodeId, current, color, onPick, onClose }: {
  nodeId: string; current: PropType; color: string;
  onPick: (t: PropType) => void; onClose: () => void;
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 30 }} />
      <div style={{
        position: "absolute", top: 34, left: 0, zIndex: 31, width: 268, padding: 10,
        background: C.panel, border: `1px solid ${C.b3}`, borderRadius: 8,
        boxShadow: "0 8px 24px rgba(0,0,0,.5)",
      }}>
        <div style={{ font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5, marginBottom: 8 }}>
          WHAT DOES {nodeId.toUpperCase()} DRIVE?
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
          {PROP_TYPES.map((p) => {
            const on = p.id === current;
            return (
              <div key={p.id} title={p.label} onClick={() => { onPick(p.id); onClose(); }}
                style={{
                  height: 42, display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 2, borderRadius: 6, cursor: "pointer",
                  background: on ? C.emberBg2 : C.card,
                  border: `1px solid ${on ? C.emberB : C.b2}`,
                }}>
                <PropIcon type={p.id} size={20} color={on ? C.emberT : color} />
              </div>
            );
          })}
        </div>
        <div style={{ ...sys(500, 11, C.t5), marginTop: 8 }}>{PROP_TYPES.find((p) => p.id === current)?.label}</div>
      </div>
    </>
  );
}

export default function Nodes() {
  const props = useProps();
  const [picking, setPicking] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({ skeleton: true });
  const [firing, setFiring] = useState<Record<string, number>>({});
  const [relayOn, setRelayOn] = useState<Record<string, boolean>>({ "skeleton/RELAY_1": true, "fog/RELAY_1": true });
  const fireIv = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const fire = (key: string) => {
    if (firing[key] !== undefined) {
      clearInterval(fireIv.current[key]);
      setFiring((f) => { const { [key]: _, ...rest } = f; return rest; });
      return;
    }
    setFiring((f) => ({ ...f, [key]: 3 }));
    fireIv.current[key] = setInterval(() => {
      setFiring((f) => {
        const left = (f[key] ?? 0) - 1;
        if (left <= 0) {
          clearInterval(fireIv.current[key]);
          const { [key]: _, ...rest } = f;
          return rest;
        }
        return { ...f, [key]: left };
      });
    }, 1000);
  };

  const banner = (bg: string, border: string, icon: string, iconColor: string, title: string, titleColor: string, sub: string, buttons: string[]) => (
    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: bg, border: `1px solid ${border}`, borderRadius: 7 }}>
      <span style={mono(800, 14, iconColor)}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={sys(700, 12.5, titleColor)}>{title}</div>
        <div style={{ ...mono(500, 11, C.t4), marginTop: 2 }}>{sub}</div>
      </div>
      {buttons.map((b) => (
        <button key={b} style={{ height: 30, padding: "0 12px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 5, ...sys(600, 11.5, C.t2) }}>{b}</button>
      ))}
    </div>
  );

  const rowStyle = (n: YardNode): React.CSSProperties =>
    n.status === "low"
      ? { border: `1px solid ${C.amberB}`, background: "#15120c" }
      : n.status === "missing"
      ? { border: `1px solid ${C.redB}`, background: "#140e0d" }
      : { border: `1px solid ${C.b1}`, background: C.panel };

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflowY: "auto", background: C.bg }}>
      <MeshPanel />
      {/* Everything below is the design handoff's mock fleet (lib/mesh.ts) —
          labelled so it isn't mistaken for the real boards above. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: C.bg, borderBottom: `1px solid ${C.b1}`, flex: "none" }}>
        <span style={{ padding: "2px 7px", borderRadius: 99, background: C.raised, border: `1px solid ${C.b3}`, ...mono(700, 9.5, C.t3), letterSpacing: ".06em" }}>DEMO DATA</span>
        <span style={sys(500, 11.5, C.t4)}>The fleet below is a design mockup, not your boards. Real boards appear in the panel above once a USB node is connected.</span>
      </div>
      <div style={{ display: "flex", gap: 10, padding: "12px 16px", background: C.panel, borderBottom: `1px solid ${C.b1}`, flex: "none" }}>
        {banner(C.redBg2, C.redB, "✕", C.red, "Driveway PIR — missing 42 min", C.red,
          "last seen 20:02 · last RSSI −79 · battery was 3.71 V · 1 cue depends on it",
          ["Show on map", "Mute 1 h"])}
        {banner("#211a09", C.amberB, "⚠", C.amber, "Lantern 3 — battery low · 3.18 V (18%)", C.amber,
          "~1 h 40 m at current draw · will deep-sleep at 3.05 V", ["Sleep now"])}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${C.b1}`, background: C.bg, flex: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, width: 260, height: 32, padding: "0 10px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 6 }}>
          <span style={{ color: C.t5, fontSize: 12 }}>⌕</span>
          <span style={sys(400, 12, C.t5)}>Filter nodes and channels…</span>
        </div>
        <span style={{ padding: "5px 11px", borderRadius: 99, background: "#232833", ...sys(600, 11.5, C.t1) }}>All 8</span>
        <span style={{ padding: "5px 11px", borderRadius: 99, background: C.card, border: `1px solid ${C.b2}`, ...sys(500, 11.5, C.t3) }}>Pro 4</span>
        <span style={{ padding: "5px 11px", borderRadius: 99, background: C.card, border: `1px solid ${C.b2}`, ...sys(500, 11.5, C.t3) }}>Mini 4</span>
        <span style={{ padding: "5px 11px", borderRadius: 99, background: C.card, border: `1px solid ${C.b2}`, ...sys(500, 11.5, C.amber) }}>Needs attention 2</span>
        <div style={{ flex: 1 }} />
        <button style={{ height: 32, padding: "0 14px", background: C.emberBg, border: `1px solid ${C.ember}`, borderRadius: 6, ...sys(600, 12, C.emberT) }}>
          ↑ Update firmware on 2 nodes (v0.9.4)
        </button>
      </div>

      <div style={{ padding: "0 16px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "9px 12px", font: "700 10px system-ui", letterSpacing: ".09em", color: C.t5, borderBottom: `1px solid ${C.b1}` }}>
          <span>NODE</span><span>BOARD</span><span>POWER</span><span>FIRMWARE</span><span>CHANNELS / SENSORS</span><span />
        </div>

        {ORDER.map((id) => {
          const n = NODES.find((x) => x.id === id)!;
          const expanded = !!open[id];
          const chs = CHANNELS[id] ?? [];
          return (
            <div key={id} style={{ ...rowStyle(n), borderRadius: 8, marginTop: expanded ? 10 : 8, overflow: "hidden" }}>
              <div onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
                style={{ display: "grid", gridTemplateColumns: GRID, alignItems: "center", padding: 12, cursor: "pointer", borderBottom: expanded ? `1px solid ${C.b1}` : "none" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, position: "relative" }}>
                  {n.status === "missing"
                    ? <span style={mono(800, 12, C.red)}>✕</span>
                    : <span style={{ width: 8, height: 8, borderRadius: "50%", background: n.status === "asleep" ? C.t4 : n.status === "low" ? C.amber : C.green }} />}
                  <span
                    title="Change prop type"
                    onClick={(e) => { e.stopPropagation(); setPicking(picking === id ? null : id); }}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center",
                      width: 28, height: 28, flex: "none", borderRadius: 6, cursor: "pointer",
                      background: picking === id ? C.emberBg2 : C.card,
                      border: `1px solid ${picking === id ? C.emberB : C.b2}`,
                    }}>
                    <PropIcon type={props.get(id)} size={19}
                      color={id === "bridge" ? C.emberT : statusStroke(n.status)} />
                  </span>
                  {picking === id && (
                    <PropPicker nodeId={id} current={props.get(id)} color={C.t3}
                      onPick={(t) => props.set(id, t)} onClose={() => setPicking(null)} />
                  )}
                  <span style={sys(700, 13, n.status === "missing" ? C.red : n.status === "asleep" ? C.t3 : C.t1)}>{n.name}</span>
                  {n.status === "asleep" && <span style={mono(500, 10.5, C.t4)}>☾ asleep · wakes :00/:30</span>}
                  {n.status === "low" && <span style={{ padding: "2px 7px", borderRadius: 99, background: C.amberBg, border: `1px solid ${C.amberB}`, ...mono(700, 9.5, C.amber), letterSpacing: ".06em" }}>LOW BATT</span>}
                  {n.status === "missing" && <span style={{ padding: "2px 7px", borderRadius: 99, background: C.redBg, border: `1px solid ${C.redB}`, ...mono(700, 9.5, C.red), letterSpacing: ".06em" }}>MISSING 42m</span>}
                </span>
                {boardTag(n.pro)}
                {powerCell(n)}
                <span style={mono(600, 11.5, n.fw === "v0.9.3" ? C.emberT : n.status === "missing" ? C.t5 : C.t3)}>
                  {n.fw}{n.fw === "v0.9.3" ? " ↑" : ""}
                </span>
                <span style={sys(500, 11.5, C.t4)}>{SUMMARY[id]}</span>
                <span style={{ color: C.t5, textAlign: "center" }}>{expanded ? "▾" : "▸"}</span>
              </div>
              {expanded && (
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {chs.map((ch, i) => {
                    const key = `${id}/${ch.code}`;
                    const isRelay = ch.code.startsWith("RELAY");
                    const on = relayOn[key];
                    const f = firing[key];
                    return (
                      <div key={ch.code} style={{ display: "grid", gridTemplateColumns: CH_GRID, alignItems: "center", gap: 10, padding: "9px 14px 9px 29px", borderBottom: i < chs.length - 1 ? "1px solid #181c22" : "none", background: isRelay && on ? "#12161c" : undefined }}>
                        <span style={mono(600, 11.5, ch.kind === "input" ? "#7d87b8" : C.t3)}>{ch.code}{ch.kind === "input" ? " ⊙" : ""}</span>
                        <span style={sys(500, 12.5, C.t1)}>{ch.label} ✎</span>
                        {isRelay
                          ? <span style={mono(700, 11, on ? C.green : C.t5)}>{on ? "● ON" : "○ OFF"}</span>
                          : <span style={mono(ch.kind === "input" && ch.state === "CLEAR" ? 700 : 500, 11, ch.kind === "input" && ch.state === "CLEAR" ? C.green : C.t5)}>{ch.state}</span>}
                        <span style={mono(500, 11, C.t5)}>{ch.detail ?? ""}</span>
                        {ch.kind === "input" ? (
                          <span style={{ ...sys(500, 10.5, C.t5), textAlign: "center" }}>input</span>
                        ) : isRelay ? (
                          <button onClick={() => setRelayOn((r) => ({ ...r, [key]: !r[key] }))}
                            style={{ height: 30, background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(700, 11, C.t2), letterSpacing: ".05em" }}>
                            {on ? "⏻ TURN OFF" : "⏻ TURN ON"}
                          </button>
                        ) : (
                          <button onClick={() => fire(key)}
                            style={f !== undefined
                              ? { height: 30, background: C.ember, border: `1px solid ${C.ember}`, borderRadius: 6, ...sys(700, 11, C.onEmber), letterSpacing: ".05em" }
                              : { height: 30, background: C.emberBg2, border: `1px solid ${C.emberB}`, borderRadius: 6, ...sys(700, 11, C.emberT), letterSpacing: ".05em" }}>
                            {f !== undefined ? `■ FIRING ${f}s` : "⚡ TEST FIRE"}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Cues — show programming (handoff 1d): armed bar, rule rows with
// trigger → sequence → targets pipeline, right-hand cue editor.
import { useState } from "react";
import { C } from "../lib/tokens";
import { Toggle, mono, sys } from "../ui";

interface Pipe { text: string; color?: string }
interface Cue {
  id: string;
  name: string;
  offline?: boolean;
  pipeline: Pipe[];
  fired: string;
  firedSub?: { text: string; color: string };
  trigger: { label: string; offline?: boolean };
  sequences: { name: string; meta: string }[];
  targets: string[];
  timing: [string, string][];
}

const CUES: Cue[] = [
  {
    id: "driveway", name: "Driveway Scare", offline: true,
    pipeline: [
      { text: "Driveway PIR", color: C.red }, { text: "→", color: C.t5 },
      { text: "Skeleton Lunge (6.2 s)", color: C.t2 }, { text: "→", color: C.t5 },
      { text: "Front Porch group (3)", color: C.t2 }, { text: "·", color: C.t5 },
      { text: "delay 0.5 s" }, { text: "·", color: C.t5 }, { text: "cooldown 45 s" },
      { text: "·", color: C.t5 }, { text: "lockout 11 min / 10 fires" },
    ],
    fired: "fired 10× · 20:42:11", firedSub: { text: "lockout: 8 min left", color: C.amber },
    trigger: { label: "Driveway PIR · PIR_1", offline: true },
    sequences: [
      { name: "Skeleton Lunge", meta: "6.2 s · 4 ch" },
      { name: "Slow Rise + Creak", meta: "9.0 s · 2 ch" },
      { name: "Eye Flicker Only", meta: "3.1 s · 1 ch" },
    ],
    targets: ["Front Porch group · 3 ✕"],
    timing: [["delay", "0.5 s"], ["cooldown", "45 s"], ["lockout after", "10 fires"], ["lockout for", "11 min"]],
  },
  {
    id: "fog", name: "Ambient Fog",
    pipeline: [
      { text: "Every 6 min (19:00–23:00)", color: C.t2 }, { text: "→", color: C.t5 },
      { text: "Fog Burst (8 s)", color: C.t2 }, { text: "→", color: C.t5 },
      { text: "Fog Chiller", color: C.t2 }, { text: "·", color: C.t5 },
      { text: "skip if TEMP_1 > 18 °C" },
    ],
    fired: "fired 19× · 20:39:00", firedSub: { text: "next 20:45:00", color: C.t5 },
    trigger: { label: "Every 6 min · 19:00–23:00" },
    sequences: [{ name: "Fog Burst", meta: "8.0 s · 2 ch" }, { name: "Long Roll", meta: "20 s · 2 ch" }],
    targets: ["Fog Chiller ✕"],
    timing: [["delay", "0 s"], ["cooldown", "6 min"], ["skip if", "TEMP_1 > 18 °C"], ["window", "19:00–23:00"]],
  },
  {
    id: "rustle", name: "Graveyard Rustle",
    pipeline: [
      { text: "Porch PIR_1", color: C.t2 }, { text: "→", color: C.t5 },
      { text: "Random 2 of 4 sequences", color: C.t2 }, { text: "→", color: C.t5 },
      { text: "Graveyard group (4)", color: C.t2 }, { text: "·", color: C.t5 },
      { text: "cooldown 90 s" },
    ],
    fired: "fired 3× · 20:42:11",
    trigger: { label: "Front Porch Skeleton · PIR_1" },
    sequences: [{ name: "Random 2 of 4", meta: "pool · 4 seq" }],
    targets: ["Graveyard group · 4 ✕"],
    timing: [["delay", "0 s"], ["cooldown", "90 s"], ["lockout after", "—"], ["lockout for", "—"]],
  },
  {
    id: "finale", name: "Big Finale",
    pipeline: [
      { text: "Manual button" }, { text: "→", color: C.t5 },
      { text: "Full Yard Finale (48 s) + finale.wav" }, { text: "→", color: C.t5 },
      { text: "All nodes" },
    ],
    fired: "never fired",
    trigger: { label: "Manual button · console" },
    sequences: [{ name: "Full Yard Finale", meta: "48 s · 22 ch" }],
    targets: ["All nodes ✕"],
    timing: [["delay", "0 s"], ["cooldown", "—"], ["audio", "finale.wav"], ["volume", "85%"]],
  },
];

export default function Cues({ stopped }: { stopped: boolean }) {
  const [armed, setArmed] = useState(true);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({ driveway: true, fog: true, rustle: true, finale: false });
  const [sel, setSel] = useState("driveway");
  const cue = CUES.find((c) => c.id === sel)!;
  const showArmed = armed && !stopped;

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 16px", background: showArmed ? C.emberBg2 : C.panel, borderBottom: `1px solid ${showArmed ? C.emberB2 : C.b1}`, flex: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Toggle on={showArmed} onClick={() => setArmed(!armed)} />
          <span style={{ font: "800 13px system-ui", letterSpacing: ".12em", color: showArmed ? C.emberT : C.t4 }}>
            {showArmed ? "SHOW ARMED" : stopped ? "SUPPRESSED — STOP ALL" : "SHOW DISARMED"}
          </span>
        </div>
        <span style={mono(500, 11.5, C.t4)}>armed 18:55 · 3 of 4 cues enabled · 14 fires tonight · last 20:42:11</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: 6, ...mono(600, 11.5, C.amber) }}>⚠ 1 cue has an offline trigger</span>
        <button style={{ height: 32, padding: "0 14px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(600, 12, C.t2) }}>+ New cue</button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, padding: "14px 16px", background: C.bg, overflowY: "auto" }}>
          {CUES.map((c) => {
            const on = !!enabled[c.id];
            const isSel = sel === c.id;
            return (
              <div key={c.id} onClick={() => setSel(c.id)}
                style={{
                  border: `1px solid ${isSel ? C.ember : C.b1}`, borderRadius: 8,
                  background: isSel ? "#12100d" : on ? C.panel : "#0d0f13",
                  padding: "12px 14px", display: "flex", alignItems: "center", gap: 14,
                  marginTop: c.id === CUES[0].id ? 0 : 8, opacity: on ? 1 : 0.65, cursor: "pointer",
                }}>
                <Toggle on={on} onClick={() => setEnabled((e) => ({ ...e, [c.id]: !e[c.id] }))} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <span style={sys(700, 13.5, on ? C.t1 : C.t3)}>{c.name}</span>
                    {c.offline && <span style={{ padding: "2px 7px", borderRadius: 99, background: C.redBg, border: `1px solid ${C.redB}`, ...mono(700, 9.5, C.red), letterSpacing: ".05em" }}>TRIGGER OFFLINE</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, ...mono(500, 11.5, on ? C.t3 : C.t4), flexWrap: "wrap" }}>
                    {c.pipeline.map((p, i) => <span key={i} style={p.color ? { color: p.color } : undefined}>{p.text}</span>)}
                  </div>
                </div>
                <div style={{ textAlign: "right", flex: "none" }}>
                  <div style={mono(600, 11, on ? C.t4 : C.t5)}>{c.fired}</div>
                  {c.firedSub && <div style={{ ...mono(500, 10.5, c.firedSub.color), marginTop: 2 }}>{c.firedSub.text}</div>}
                </div>
                <button style={on
                  ? { height: 30, padding: "0 13px", background: C.emberBg2, border: `1px solid ${C.emberB}`, borderRadius: 6, ...sys(700, 11, C.emberT), flex: "none" }
                  : { height: 30, padding: "0 13px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(700, 11, C.t3), flex: "none" }}>
                  ▶ TEST
                </button>
              </div>
            );
          })}
          <div style={{ marginTop: 16, padding: "12px 14px", border: `1px dashed ${C.b2}`, borderRadius: 8, font: "400 12px/1.5 system-ui", color: C.t5 }}>
            Cues cover trigger → sequence rules. For branching, random chains and audio sync, open the <a href="#" onClick={(e) => e.preventDefault()} style={{ fontWeight: 600 }}>Show Graph</a>.
          </div>
        </div>

        <div style={{ width: 400, borderLeft: `1px solid ${C.b2}`, background: C.panel, display: "flex", flexDirection: "column", flex: "none", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${C.b1}` }}>
            <span style={{ ...sys(700, 13, C.t1), flex: 1 }}>Edit cue — {cue.name}</span>
            <span style={sys(500, 11, C.t5)}>unsaved</span>
          </div>
          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14, flex: 1 }}>
            <div>
              <div style={{ font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5, marginBottom: 6 }}>TRIGGER</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, height: 38, padding: "0 12px", background: C.card, border: `1px solid ${cue.trigger.offline ? C.redB : C.b2}`, borderRadius: 6 }}>
                <span style={sys(600, 12.5, cue.trigger.offline ? C.red : C.t1)}>{cue.trigger.label}</span>
                <span style={{ flex: 1 }} />
                {cue.trigger.offline && <span style={mono(700, 9.5, C.red)}>OFFLINE</span>}
                <span style={{ color: C.t5 }}>▾</span>
              </div>
              {cue.trigger.offline && (
                <div style={{ font: "400 11px/1.45 system-ui", color: C.amber, marginTop: 5 }}>⚠ This node is missing — the cue is armed but cannot fire.</div>
              )}
            </div>
            <div>
              <div style={{ font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5, marginBottom: 6 }}>SEQUENCE</div>
              <div style={{ border: `1px solid ${C.b2}`, borderRadius: 6, overflow: "hidden" }}>
                {cue.sequences.map((s, i) => (
                  <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: i === 0 ? C.emberBg2 : undefined, borderTop: i > 0 ? `1px solid ${C.b1}` : undefined }}>
                    <span style={sys(i === 0 ? 600 : 500, 12.5, i === 0 ? C.emberT : C.t3)}>{s.name}</span>
                    <span style={{ flex: 1 }} />
                    <span style={mono(500, 11, i === 0 ? C.t4 : C.t5)}>{s.meta}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div style={{ font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5, marginBottom: 6 }}>TARGETS</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {cue.targets.map((t) => (
                  <span key={t} style={{ padding: "6px 10px", borderRadius: 99, background: C.emberBg, border: `1px solid ${C.emberB}`, ...sys(600, 11.5, C.emberT) }}>{t}</span>
                ))}
                <span style={{ padding: "6px 10px", borderRadius: 99, background: C.card, border: `1px solid ${C.b2}`, ...sys(500, 11.5, C.t3) }}>+ add node or group</span>
              </div>
            </div>
            <div>
              <div style={{ font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5, marginBottom: 6 }}>TIMING</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {cue.timing.map(([k, v]) => (
                  <div key={k} style={{ height: 38, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 12px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 6 }}>
                    <span style={sys(500, 11, C.t4)}>{k}</span>
                    <span style={mono(600, 12.5, C.t1)}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, padding: "14px 16px", borderTop: `1px solid ${C.b1}` }}>
            <button style={{ flex: 1, height: 38, background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 6, ...sys(600, 12.5, C.t2) }}>▶ Simulate (dry run)</button>
            <button style={{ flex: 1, height: 38, background: C.ember, border: "none", borderRadius: 6, ...sys(800, 12.5, C.onEmber) }}>Save cue</button>
          </div>
        </div>
      </div>
    </div>
  );
}

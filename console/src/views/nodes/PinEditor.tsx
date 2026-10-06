// Pin editor for one generic-board node (MeshPanel picks which): assign
// each pin a function, save, test-fire. One row per board pin, in header
// order, so the screen reads like the board in your hand.
// docs/generic-boards.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { Spinner, Toggle, mono, sys } from "../../ui";
import { Cap, FUNCTIONS, type Board, type BoardPin, type ChannelKindName } from "../../lib/boards_gen";
import {
  EMPTY_CONFIG, LABEL_MAX, NAME_MAX, channelCode, newChannel, pinRole,
  type ChannelCfg, type NodeConfig, type Pull,
} from "../../lib/nodeConfig";
import { issueText, validate, type Issue } from "../../lib/pinRules";
import type { NodeHello, NodeTarget } from "../../lib/transport";

// Fixed tracks for the short columns; options and test share what is
// left, so a narrow window squeezes them instead of clipping the test
// controls off the right edge.
const ROW = "64px minmax(150px, 200px) 92px minmax(100px, 150px) minmax(150px, 1fr) minmax(170px, 1fr)";
const KINDS = Object.keys(FUNCTIONS) as ChannelKindName[];

const field: React.CSSProperties = {
  height: 28, padding: "0 8px", background: C.card, border: `1px solid ${C.b2}`,
  borderRadius: 5, outline: "none", ...sys(500, 12, C.t1),
};
const btn = (primary = false, disabled = false): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
  background: primary ? C.emberBg : C.raised,
  border: `1px solid ${primary ? C.ember : C.b3}`,
  ...sys(600, 11.5, primary ? C.emberT : C.t2),
});

const canDo = (pin: BoardPin, kind: ChannelKindName, role = 0) => {
  const need = FUNCTIONS[kind].pins[role].need;
  return pin.tier !== "reserved" && (pin.caps & need) === need;
};

const hex = (v: number) => "#" + (v & 0xffffff).toString(16).padStart(6, "0");

export interface EditorProps {
  node: NodeTarget; // requests go to this node, over the mesh if remote
  hello: NodeHello;
  board: Board;
  where: string; // "USB" / "mesh · 1 hop · −54 dBm" — shown in the header
  // Subscribe to this node's input events; returns the unsubscribe.
  onInput: (cb: (kind: string, index: number, value: number) => void) => () => void;
  // The node's name or bridge flag changed on save — the roster shows them.
  onSaved: (cfg: NodeConfig) => void;
}

// Editor for one generic-board node: name, bridge mode, pin
// assignments, save, test fire.
export default function PinEditor({ node, hello, board, where, onInput, onSaved }: EditorProps) {
  const [applied, setApplied] = useState<NodeConfig>(EMPTY_CONFIG); // what the node is running
  const [draft, setDraft] = useState<NodeConfig>(EMPTY_CONFIG);
  const [values, setValues] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodeIssues, setNodeIssues] = useState<Issue[] | null>(null); // the node's verdict on the last save

  const issues = useMemo(() => validate(board, draft), [board, draft]);
  const hasErrors = issues.some((i) => i.error);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  // ---- load -----------------------------------------------------------

  const load = async () => {
    setError(null);
    try {
      const cfg = await node.request("get_config");
      const st = await node.request("state");
      if (!cfg.ok) throw new Error(cfg.error ?? "get_config failed");
      const config = { ...EMPTY_CONFIG, ...(cfg.config as NodeConfig) };
      setApplied(config);
      setDraft(config);
      setValues(toValues(st.channels));
      setNodeIssues(null);
      setLoaded(true);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [hello.node]);

  useEffect(() => onInput((kind, index, value) =>
    setValues((v) => ({ ...v, [`${kind}_${index}`]: value }))), [onInput]);

  // ---- save -----------------------------------------------------------

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await node.request("set_config", { config: draft });
      setNodeIssues((r.issues as Issue[]) ?? null);
      if (!r.ok) {
        setError(`Node refused the config: ${r.error}`);
        return;
      }
      setApplied(draft);
      onSaved(draft);
      const st = await node.request("state");
      setValues(toValues(st.channels));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ---- test fire ------------------------------------------------------
  // One request in flight per channel; a slider drag sends the newest
  // value as soon as the previous one is acknowledged, never a backlog.

  const inFlight = useRef<Record<string, boolean>>({});
  const queued = useRef<Record<string, number | undefined>>({});

  const fire = (c: ChannelCfg, value: number) => {
    const key = channelCode(c);
    setValues((v) => ({ ...v, [key]: value }));
    if (inFlight.current[key]) {
      queued.current[key] = value;
      return;
    }
    inFlight.current[key] = true;
    node.request("set", { kind: c.kind, index: c.index, value })
      .then((r) => { if (!r.ok) setError(`${key}: ${r.error}`); })
      .catch((e) => setError((e as Error).message))
      .finally(() => {
        inFlight.current[key] = false;
        const next = queued.current[key];
        queued.current[key] = undefined;
        if (next !== undefined) fire(c, next);
      });
  };

  const allOff = async () => {
    try {
      await node.request("all_off");
      const st = await node.request("state");
      setValues(toValues(st.channels));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Bridge mode drives no pins: turning it on clears the assignments
  // in the draft (Revert brings them back).
  const setBridge = (on: boolean) =>
    setDraft((d) => ({ ...d, bridge: on, channels: on ? [] : d.channels }));

  // ---- editing --------------------------------------------------------

  const patch = (i: number, p: Partial<ChannelCfg>) =>
    setDraft((d) => ({ ...d, channels: d.channels.map((c, j) => (j === i ? { ...c, ...p } : c)) }));

  const assign = (gpio: number, kind: ChannelKindName | "") =>
    setDraft((d) => {
      const channels = d.channels.filter((c) => c.pins[0] !== gpio);
      const next = { ...d, channels };
      if (kind) next.channels = [...channels, newChannel(next, kind, gpio)];
      return next;
    });

  // ---- render ---------------------------------------------------------

  const shown = [...issues, ...(nodeIssues ?? []).filter((n) => !issues.some((i) => i.code === n.code && i.channel === n.channel && i.gpio === n.gpio))];
  const freePins = (c: ChannelCfg, role: number) =>
    board.pins.filter((p) => canDo(p, c.kind, role) && (c.pins[role] === p.gpio || !draft.channels.some((o) => o.pins.includes(p.gpio))));

  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.b1}`, flex: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: `1px solid ${C.b1}`, flexWrap: "wrap" }}>
        <input value={draft.name} maxLength={NAME_MAX} placeholder="Name this node"
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          style={{ ...field, width: 200, ...sys(700, 13, C.t1) }} />
        <span style={mono(600, 11, C.t4)}>{hello.node} · {board.name} · fw {hello.fw} · {where}</span>
        <label title="A bridge drives no pins. It is the console's way into the mesh and keeps the mesh clock."
          style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", ...sys(600, 11.5, draft.bridge ? C.emberT : C.t3) }}>
          <Toggle small on={!!draft.bridge} onClick={() => setBridge(!draft.bridge)} /> Bridge
        </label>
        <div style={{ flex: 1 }} />
        {dirty && <span style={mono(600, 11, C.amber)}>unsaved changes</span>}
        {busy && <Spinner color={C.emberT} />}
        <button disabled={!dirty || busy} onClick={() => { setDraft(applied); setNodeIssues(null); }} style={btn(false, !dirty || busy)}>Revert</button>
        <button disabled={!dirty || hasErrors || busy || !loaded} onClick={save} style={btn(true, !dirty || hasErrors || busy || !loaded)}>
          {busy ? "Saving…" : "Save to node"}
        </button>
        {!applied.bridge && <button onClick={allOff} style={btn()}>All off</button>}
      </div>

      {(error || shown.length > 0) && (
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.b1}`, display: "flex", flexDirection: "column", gap: 4 }}>
          {error && <div style={mono(600, 11.5, C.red)}>✕ {error}</div>}
          {shown.map((it, i) => (
            <div key={i} style={mono(500, 11.5, it.error ? C.red : C.amber)}>
              {it.error ? "✕" : "⚠"} {issueText(board, draft, it)}
            </div>
          ))}
        </div>
      )}

      {!loaded && !error && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 16px", ...mono(500, 11.5, C.t4) }}>
          <Spinner /> Reading pin assignments from {hello.name || hello.node}{where === "USB" ? "" : " over the mesh"}…
        </div>
      )}
      {!loaded && error && (
        <div style={{ padding: "6px 16px 14px" }}>
          <button onClick={() => void load()} style={btn()}>Try again</button>
        </div>
      )}
      {loaded && draft.bridge && (
        <div style={{ padding: "14px 16px", ...sys(500, 12, C.t3), lineHeight: 1.5 }}>
          <b style={{ color: C.t1 }}>Bridge.</b> This board drives no pins. It passes the console's
          requests to the other nodes over the mesh, reports what it hears back up the USB cable,
          and keeps the mesh clock — every node syncs to it. Leave it plugged into the laptop.
        </div>
      )}
      {loaded && !draft.bridge && <div style={{ padding: "0 16px 12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: ROW, gap: 10, padding: "9px 0", font: "700 10px system-ui", letterSpacing: ".09em", color: C.t5, borderBottom: `1px solid ${C.b1}` }}>
          <span>PIN</span><span>FUNCTION</span><span>CHANNEL</span><span>NAME</span><span>OPTIONS</span><span>TEST{dirty ? " (SAVE FIRST)" : ""}</span>
        </div>
        {board.pins.map((pin) => {
          const ci = draft.channels.findIndex((c) => c.pins.includes(pin.gpio));
          const c = ci >= 0 ? draft.channels[ci] : undefined;
          const owner = c && c.pins[0] === pin.gpio;
          const mine = issues.filter((i) => i.channel === ci && ci >= 0 && (i.gpio === undefined || i.gpio === pin.gpio));
          const bad = mine.some((i) => i.error);
          const warn = !bad && (mine.length > 0 || (c && pin.tier === "caution"));
          const kinds = KINDS.filter((k) => canDo(pin, k));
          return (
            <div key={pin.gpio} title={pin.note}
              style={{ display: "grid", gridTemplateColumns: ROW, gap: 10, alignItems: "center", minHeight: 40, borderBottom: "1px solid #181c22", opacity: pin.tier === "reserved" ? 0.5 : 1 }}>
              <span style={{ display: "flex", flexDirection: "column" }}>
                <span style={mono(700, 12, bad ? C.red : warn ? C.amber : c ? C.t1 : C.t3)}>{pin.label}</span>
                <span style={mono(500, 10, C.t5)}>GPIO {pin.gpio}{pin.tier === "caution" ? " ⚠" : ""}</span>
              </span>

              {pin.tier === "reserved" ? (
                <span style={{ gridColumn: "2 / -1", ...sys(500, 11.5, C.t5) }}>reserved — {pin.note}</span>
              ) : c && !owner ? (
                <>
                  <span style={sys(500, 12, C.t3)}>{FUNCTIONS[c.kind].label}</span>
                  <span style={mono(600, 11.5, C.t3)}>{channelCode(c)}</span>
                  <span style={{ gridColumn: "4 / -1", ...mono(500, 11, C.t5) }}>{pinRole(c, pin.gpio)} pin — set on {board.pins.find((p) => p.gpio === c.pins[0])?.label}</span>
                </>
              ) : (
                <>
                  <select value={c?.kind ?? ""} onChange={(e) => assign(pin.gpio, e.target.value as ChannelKindName | "")}
                    style={{ ...field, color: c ? C.t1 : C.t5 }}>
                    <option value="">— unused —</option>
                    {kinds.map((k) => <option key={k} value={k}>{FUNCTIONS[k].label}</option>)}
                  </select>
                  {c ? (
                    <>
                      <span style={mono(600, 11.5, c.kind === "DIGITAL_IN" ? "#7d87b8" : C.emberT)}>{channelCode(c)}</span>
                      <input value={c.label} maxLength={LABEL_MAX} placeholder="what is it?"
                        onChange={(e) => patch(ci, { label: e.target.value })} style={field} />
                      <Options c={c} pin={pin} in2={c.kind === "MOTOR" ? freePins(c, 1) : []} onChange={(p) => patch(ci, p)} />
                      <Test c={c} value={values[channelCode(c)]} disabled={dirty} onFire={(v) => fire(c, v)} />
                    </>
                  ) : (
                    <span style={{ gridColumn: "3 / -1", ...sys(400, 11, C.t6) }}>{pin.note ?? ""}</span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>}
    </div>
  );
}

function toValues(channels: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of (channels as { kind: string; index: number; value: number }[]) ?? [])
    out[`${c.kind}_${c.index}`] = c.value;
  return out;
}

const optLabel: React.CSSProperties = { display: "flex", alignItems: "center", gap: 5, ...sys(500, 11, C.t4) };
const num: React.CSSProperties = { ...field, width: 64, ...mono(500, 11.5, C.t1) };

function Options({ c, pin, in2, onChange }: {
  c: ChannelCfg; pin: BoardPin; in2: BoardPin[]; onChange: (p: Partial<ChannelCfg>) => void;
}) {
  const int = (s: string) => Math.max(0, parseInt(s, 10) || 0);
  const activeLow = (text: string, hint?: string) => (
    <label style={optLabel} title={hint}>
      <input type="checkbox" checked={!!c.active_low} onChange={(e) => onChange({ active_low: e.target.checked })} />
      {text}
    </label>
  );
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "4px 12px", flexWrap: "wrap", minWidth: 0 }}>
      {c.kind === "RELAY" && activeLow("on = LOW", "Most relay modules switch on when their input is pulled LOW")}
      {c.kind === "DIGITAL_IN" && (
        <>
          <label style={optLabel}>pull
            <select value={c.pull ?? "none"} onChange={(e) => onChange({ pull: e.target.value as Pull })} style={field}>
              <option value="none">none</option>
              <option value="up" disabled={!(pin.caps & Cap.PULLUP)}>up</option>
              <option value="down" disabled={!(pin.caps & Cap.PULLDOWN)}>down</option>
            </select>
          </label>
          {activeLow("active = LOW")}
        </>
      )}
      {c.kind === "SERVO" && (
        <>
          <label style={optLabel}>min <input type="number" step={10} value={c.min_us ?? 500} onChange={(e) => onChange({ min_us: int(e.target.value) })} style={num} /></label>
          <label style={optLabel}>max <input type="number" step={10} value={c.max_us ?? 2500} onChange={(e) => onChange({ max_us: int(e.target.value) })} style={num} /> µs</label>
        </>
      )}
      {c.kind === "LED_STRIP" && (
        <label style={optLabel}>pixels <input type="number" min={1} value={c.pixels ?? 30} onChange={(e) => onChange({ pixels: int(e.target.value) })} style={num} /></label>
      )}
      {c.kind === "MOTOR" && (
        <label style={optLabel} title={`IN1 is ${pin.label}`}>IN2
          <select value={c.pins[1] ?? ""} style={field}
            onChange={(e) => onChange({ pins: e.target.value === "" ? [c.pins[0]] : [c.pins[0], Number(e.target.value)] })}>
            <option value="">— choose —</option>
            {in2.filter((p) => p.gpio !== c.pins[0]).map((p) => <option key={p.gpio} value={p.gpio}>{p.label}{p.tier === "caution" ? " ⚠" : ""}</option>)}
          </select>
        </label>
      )}
    </span>
  );
}

function Test({ c, value, disabled, onFire }: {
  c: ChannelCfg; value: number | undefined; disabled: boolean; onFire: (v: number) => void;
}) {
  const f = FUNCTIONS[c.kind];
  const v = value ?? 0;
  const dim: React.CSSProperties = disabled ? { opacity: 0.35, pointerEvents: "none" } : {};
  const readout = (text: string) => <span style={{ ...mono(600, 11, C.t3), width: 52, textAlign: "right" }}>{text}</span>;

  if (c.kind === "DIGITAL_IN")
    return <span style={mono(700, 11, v ? C.ember : C.green)}>{v ? "● ACTIVE" : "○ clear"}</span>;
  if (c.kind === "RELAY")
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 10, ...dim }}>
        <button onClick={() => onFire(v ? 0 : 1)} style={{ ...btn(!!v), width: 104, flex: "none" }}>{v ? "⏻ TURN OFF" : "⏻ TURN ON"}</button>
        <span style={mono(700, 11, v ? C.green : C.t5)}>{v ? "● ON" : "○ OFF"}</span>
      </span>
    );
  if (c.kind === "LED_STRIP")
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 10, ...dim }}>
        <input type="color" value={hex(v)} onChange={(e) => onFire(parseInt(e.target.value.slice(1), 16))}
          style={{ width: 44, height: 28, padding: 0, background: "none", border: `1px solid ${C.b2}`, borderRadius: 5 }} />
        <button onClick={() => onFire(0)} style={btn()}>Off</button>
        {readout(hex(v))}
      </span>
    );
  // LED, SERVO, MOTOR: a slider over the function's value range.
  const limp = c.kind === "SERVO" && v < 0;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, ...dim }}>
      <input type="range" min={f.min} max={f.max} step={10} value={limp ? 500 : v}
        onChange={(e) => onFire(Number(e.target.value))} style={{ flex: 1, minWidth: 60, accentColor: C.ember }} />
      {c.kind === "MOTOR" && <button onClick={() => onFire(0)} style={btn()}>Stop</button>}
      {readout(limp ? "limp" : c.kind === "MOTOR" ? `${v > 0 ? "+" : ""}${Math.round(v / 10)}%` : `${Math.round(v / 10)}%`)}
    </span>
  );
}

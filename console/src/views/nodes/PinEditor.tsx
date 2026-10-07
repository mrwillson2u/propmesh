// Pin editor for one generic-board node (MeshPanel picks which): assign
// each pin a function, save, test-fire. One row per board pin, in header
// order, so the screen reads like the board in your hand.
// docs/generic-boards.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { Spinner, Toggle, mono, sys } from "../../ui";
import { Cap, FUNCTIONS, type Board, type BoardPin, type ChannelKindName } from "../../lib/boards_gen";
import {
  EMPTY_CONFIG, LABEL_MAX, NAME_MAX, SERVO_MAX_US, SERVO_MIN_US, SMOOTHING, channelCode, isColour, newChannel, pinRole,
  type ChannelCfg, type NodeConfig, type Pull,
} from "../../lib/nodeConfig";
import { issueText, validate, type Issue } from "../../lib/pinRules";
import { SHORT, isBest, isGood, tips } from "../../lib/pinAdvice";
import PinGuide from "./PinGuide";
import type { NodeHello, NodeTarget } from "../../lib/transport";

// Fixed tracks for the short columns; options and test share what is
// left, so a narrow window squeezes them instead of clipping the test
// controls off the right edge.
const ROW = "64px minmax(150px, 200px) 92px minmax(100px, 150px) minmax(150px, 1fr) minmax(170px, 1fr)";
// Kinds a pin can be given. BLE lights use no pin — they get their own
// section below the pins.
const KINDS = (Object.keys(FUNCTIONS) as ChannelKindName[]).filter((k) => FUNCTIONS[k].pins.length > 0);

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
      setCal(null); // the node re-applied its pins: the servo is limp again
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
  const queued = useRef<Record<string, { value: number; us?: number } | undefined>>({});

  // ---- servo calibration -------------------------------------------------
  // The test slider only spans min..max, so it can't reach a new, wider
  // end. Calibrate swaps it for the raw pulse (400-2600 µs) and offers
  // "Set as min / max". It works with unsaved edits — it drives the
  // servo the node already has — so both ends can be set, then saved.
  const [cal, setCal] = useState<{ code: string; us: number } | null>(null);
  const canCalibrate = (c: ChannelCfg) =>
    applied.channels.some((a) => a.kind === c.kind && a.index === c.index && a.pins[0] === c.pins[0]);
  const startCal = (c: ChannelCfg) => {
    const run = applied.channels.find((a) => a.kind === c.kind && a.index === c.index) ?? c;
    const lo = run.min_us ?? 500, hi = run.max_us ?? 2500;
    const v = values[channelCode(c)];
    const us = v === undefined || v < 0 ? 1500 : Math.round(lo + ((hi - lo) * v) / 1000);
    setCal({ code: channelCode(c), us });
    fire(c, 0, us);
  };

  // `us` drives a servo's raw pulse width (calibration) instead of a
  // value between its end stops.
  const fire = (c: ChannelCfg, value: number, us?: number) => {
    const key = channelCode(c);
    if (us === undefined) setValues((v) => ({ ...v, [key]: value }));
    if (inFlight.current[key]) {
      queued.current[key] = { value, us };
      return;
    }
    inFlight.current[key] = true;
    node.request("set", us === undefined ? { kind: c.kind, index: c.index, value } : { kind: c.kind, index: c.index, us })
      .then((r) => { if (!r.ok) setError(`${key}: ${r.error}`); })
      .catch((e) => setError((e as Error).message))
      .finally(() => {
        inFlight.current[key] = false;
        const next = queued.current[key];
        queued.current[key] = undefined;
        if (next !== undefined) fire(c, next.value, next.us);
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

  const advice = tips(board, draft);
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

      {(error || shown.length > 0 || advice.length > 0) && (
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.b1}`, display: "flex", flexDirection: "column", gap: 4 }}>
          {error && <div style={mono(600, 11.5, C.red)}>✕ {error}</div>}
          {shown.map((it, i) => (
            <div key={i} style={mono(500, 11.5, it.error ? C.red : C.amber)}>
              {it.error ? "✕" : "⚠"} {issueText(board, draft, it)}
            </div>
          ))}
          {advice.map((t, i) => (
            <div key={"tip" + i} style={mono(500, 11.5, C.t3)}>ⓘ {t.text}</div>
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
        <PinGuide board={board} cfg={draft} />
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
          // Recommended uses first (★ best, · also good), then the rest.
          const kinds = KINDS.filter((k) => canDo(pin, k))
            .sort((a, b) => Number(isBest(pin, b)) - Number(isBest(pin, a)) || Number(isGood(pin, b)) - Number(isGood(pin, a)));
          return (
            <div key={pin.gpio} id={`pin-row-${pin.gpio}`} title={pin.note}
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
                    {kinds.map((k) => <option key={k} value={k}>{isBest(pin, k) ? "★ " : isGood(pin, k) ? "· " : "   "}{FUNCTIONS[k].label}</option>)}
                  </select>
                  {c ? (
                    <>
                      <span style={mono(600, 11.5, c.kind === "DIGITAL_IN" ? "#7d87b8" : C.emberT)}>{channelCode(c)}</span>
                      <input value={c.label} maxLength={LABEL_MAX} placeholder="what is it?"
                        onChange={(e) => patch(ci, { label: e.target.value })} style={field} />
                      <Options c={c} pin={pin} in2={c.kind === "MOTOR" ? freePins(c, 1) : []} onChange={(p) => patch(ci, p)} />
                      <Test c={c} value={values[channelCode(c)]} disabled={dirty} onFire={(v) => fire(c, v)}
                        cal={c.kind !== "SERVO" ? undefined : {
                          on: cal?.code === channelCode(c),
                          us: cal?.code === channelCode(c) ? cal.us : 0,
                          can: canCalibrate(c),
                          start: () => startCal(c),
                          stop: () => setCal(null),
                          pulse: (us) => { setCal({ code: channelCode(c), us }); fire(c, 0, us); },
                          setMin: (us) => patch(ci, { min_us: us }),
                          setMax: (us) => patch(ci, { max_us: us }),
                        }} />
                    </>
                  ) : (
                    <span style={{ gridColumn: "3 / -1", display: "flex", gap: 10, alignItems: "baseline", minWidth: 0 }}>
                      {pin.best && (
                        <span style={{ ...sys(500, 11, C.t4), flex: "none" }}>
                          ★ best for {SHORT[pin.best]}
                          {pin.also?.length ? <span style={{ color: C.t5 }}> · also {pin.also.map((a) => SHORT[a]).join(", ")}</span> : null}
                        </span>
                      )}
                      <span style={sys(400, 11, C.t6)}>{pin.note ?? ""}</span>
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
        <BleLights draft={draft} setDraft={setDraft} values={values} dirty={dirty}
          onFire={(c, v) => fire(c, v)} node={node} reload={load} />
      </div>}
    </div>
  );
}

// BRMesh flood lights: no pins — the board broadcasts colours over
// Bluetooth (firmware pm_ble_tx). One key per board, one row per light.
function BleLights({ draft, setDraft, values, dirty, onFire, node, reload }: {
  draft: NodeConfig;
  setDraft: React.Dispatch<React.SetStateAction<NodeConfig>>;
  values: Record<string, number>;
  dirty: boolean;
  onFire: (c: ChannelCfg, v: number) => void;
  node: NodeTarget;
  reload: () => Promise<void>;
}) {
  const [finding, setFinding] = useState(false);
  const lights = draft.channels.filter((c) => c.kind === "BLE_LIGHT");
  const add = () => setDraft((d) => {
    const used = new Set(d.channels.filter((c) => c.kind === "BLE_LIGHT").map((c) => c.light));
    let light = 1;
    while (used.has(light)) light++;
    const c = newChannel(d, "BLE_LIGHT", 0);
    return { ...d, channels: [...d.channels, { ...c, pins: [], light }] };
  });
  const patchLight = (c: ChannelCfg, p: Partial<ChannelCfg>) =>
    setDraft((d) => ({ ...d, channels: d.channels.map((x) => (x === c ? { ...x, ...p } : x)) }));
  const remove = (c: ChannelCfg) => setDraft((d) => ({ ...d, channels: d.channels.filter((x) => x !== c) }));
  const keyOk = /^[0-9a-fA-F]{8}$/.test(draft.brmesh_key ?? "");

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: `1px solid ${C.b1}` }}>
        <span style={{ font: "700 10px system-ui", letterSpacing: ".09em", color: C.t5 }}>BLUETOOTH LIGHTS</span>
        <span style={sys(400, 11, C.t5)}>BRMesh flood lights — this board broadcasts their colour, no wiring</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => setFinding(!finding)} disabled={dirty}
          title={dirty ? "Save or revert your changes first — pairing adds lights to the saved config" : "Find unpaired lights and pair them to this board"}
          style={btn(!finding, dirty)}>{finding ? "Close" : "Find lights…"}</button>
        <button onClick={add} style={btn()} title="Add a light by number — for lights already paired with this board's key">+ Add by number</button>
      </div>
      {finding && <BleFinder node={node} onPaired={reload} />}
      {(lights.length > 0 || draft.brmesh_key) && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #181c22" }}>
          <span style={{ ...sys(500, 12, C.t3), width: 110 }}>BRMesh key</span>
          <input value={draft.brmesh_key ?? ""} placeholder="8 hex digits" maxLength={8} spellCheck={false}
            onChange={(e) => setDraft((d) => ({ ...d, brmesh_key: e.target.value.trim() || undefined }))}
            style={{ ...field, width: 120, ...mono(600, 12, keyOk ? C.t1 : C.amber) }} />
          <span style={sys(400, 11, C.t5)}>
            Made by this board when it paired its first light, and stored on it only. Change it only to take over
            lights paired by another controller.
          </span>
        </div>
      )}
      {lights.map((c) => (
        <div key={c.index} style={{ display: "grid", gridTemplateColumns: "110px 120px 160px 1fr 24px", gap: 10, alignItems: "center", padding: "6px 0", borderBottom: "1px solid #181c22" }}>
          <span style={mono(600, 11.5, C.emberT)}>{channelCode(c)}</span>
          <label style={optLabel} title="The light's number in the BRMesh app (1, 2, …)">light #
            <input type="number" min={1} max={255} value={c.light ?? 1}
              onChange={(e) => patchLight(c, { light: Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0)) })} style={num} />
          </label>
          <input value={c.label} maxLength={LABEL_MAX} placeholder="what is it?" onChange={(e) => patchLight(c, { label: e.target.value })} style={field} />
          <Test c={c} value={values[channelCode(c)]} disabled={dirty} onFire={(v) => onFire(c, v)} />
          <span onClick={() => remove(c)} title="Remove light" style={{ color: C.t5, cursor: "pointer", textAlign: "center" }}>✕</span>
        </div>
      ))}
      {lights.length === 0 && (
        <div style={{ ...sys(400, 11.5, C.t5), padding: "8px 0" }}>
          None. Use <b>Find lights…</b> with the floods next to this board — it pairs them, no app or key needed.
        </div>
      )}
    </div>
  );
}

// Find + pair BRMesh lights from this board (firmware pm_ble_tx). Lights
// answer only while unpaired; the board makes its own key on the first
// pairing, saves it, and adds each paired light as a BLE_LIGHT output.
interface FoundLight { addr: string; type: string; rssi: number; state: "found" | "pairing" | "paired" | "failed"; number?: number }

function BleFinder({ node, onPaired }: { node: NodeTarget; onPaired: () => Promise<void> }) {
  const [mode, setMode] = useState<"idle" | "scanning" | "pairing">("idle");
  const [lights, setLights] = useState<FoundLight[]>([]);
  const [left, setLeft] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Poll until the board says it's idle. A request can miss while the
  // board's radio is busy listening — the next poll catches up.
  const poll = async () => {
    for (let i = 0; i < 60 && alive.current; i++) {
      await new Promise((r) => setTimeout(r, 700));
      try {
        const r = await node.request("ble_found");
        if (!r.ok) continue;
        setLights(r.lights as FoundLight[]);
        setLeft(r.remaining_ms as number);
        setMode(r.mode as "idle");
        if (r.mode === "idle") return r.lights as FoundLight[];
      } catch { /* try again */ }
    }
    return [];
  };

  const search = async () => {
    setError(null);
    setSearched(true);
    try {
      const r = await node.request("ble_scan", { ms: 8000 });
      if (!r.ok) { setError(r.error ?? "couldn't start the search"); return; }
      setMode("scanning");
      await poll();
    } catch (e) { setError((e as Error).message); }
  };

  const pair = async (l: FoundLight) => {
    setError(null);
    try {
      const r = await node.request("ble_pair", { addr: l.addr });
      if (!r.ok) { setError(r.error ?? "couldn't pair"); return; }
      setMode("pairing");
      const after = await poll();
      const me = after.find((x) => x.addr === l.addr);
      if (me?.state === "paired") await onPaired();
      else setError(`${l.type} light ${l.addr} didn't confirm — power-cycle it, search again and retry`);
    } catch (e) { setError((e as Error).message); }
  };

  const busy = mode !== "idle";
  return (
    <div style={{ margin: "8px 0", padding: 12, border: `1px solid ${C.b2}`, borderRadius: 8, background: C.card }}>
      <div style={{ ...sys(400, 12, C.t3), lineHeight: 1.55 }}>
        <b style={{ color: C.t1 }}>1.</b> Put the floods near this board and switch them <b>off</b>.{" "}
        <b style={{ color: C.t1 }}>2.</b> Click <b>Search</b>, then switch them <b>on</b> within a few seconds.{" "}
        Only lights not paired to anything answer — a light still paired to the BRMesh app must be reset first
        (often: switch it off and on several times). Pairing takes the light away from the BRMesh app.
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
        <button onClick={() => void search()} disabled={busy} style={btn(true, busy)}>Search (8 s)</button>
        {busy && <><Spinner /><span style={mono(500, 11, C.t4)}>{mode === "scanning" ? `listening… ${Math.ceil(left / 1000)} s` : "pairing…"}</span></>}
        {error && <span style={mono(500, 11, C.red)}>✕ {error}</span>}
      </div>
      {lights.map((l) => (
        <div key={l.addr} style={{ display: "flex", alignItems: "center", gap: 12, padding: "7px 0", borderTop: "1px solid #181c22", marginTop: 6 }}>
          <span style={sys(600, 12, C.t1)}>{l.type} light</span>
          <span style={mono(500, 11, C.t4)}>{l.addr} · {l.rssi} dBm</span>
          <div style={{ flex: 1 }} />
          {l.state === "paired"
            ? <span style={mono(700, 11, C.green)}>✓ paired as light #{l.number}</span>
            : l.state === "pairing"
              ? <span style={mono(600, 11, C.t4)}>pairing as #{l.number}…</span>
              : <>
                  {l.state === "failed" && <span style={mono(600, 11, C.amber)}>didn't confirm</span>}
                  <button onClick={() => void pair(l)} disabled={busy} style={btn(true, busy)}>{l.state === "failed" ? "Retry" : "Pair"}</button>
                </>}
        </div>
      ))}
      {searched && !busy && lights.length === 0 && !error && (
        <div style={{ ...sys(400, 11.5, C.t5), marginTop: 8 }}>
          No unpaired lights answered. Check they were switched on during the search, are close to this board,
          and aren't still paired to the BRMesh app.
        </div>
      )}
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
          <label style={optLabel} title="Pulse width at 0 %">min <input type="number" step={10} value={c.min_us ?? 500} onChange={(e) => onChange({ min_us: int(e.target.value) })} style={num} /></label>
          <label style={optLabel} title="Pulse width at 100 %">max <input type="number" step={10} value={c.max_us ?? 2500} onChange={(e) => onChange({ max_us: int(e.target.value) })} style={num} /> µs</label>
          {/* Reverse = the two ends swapped; stored as min above max. */}
          <label style={optLabel} title="Swap the ends: 0 % moves to where 100 % was">
            <input type="checkbox" checked={(c.min_us ?? 500) > (c.max_us ?? 2500)}
              onChange={() => onChange({ min_us: c.max_us ?? 2500, max_us: c.min_us ?? 500 })} />
            reverse
          </label>
          <Smoothing c={c} onChange={onChange} />
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

// Servo smoothing: a preset, or Custom with the two numbers.
function Smoothing({ c, onChange }: { c: ChannelCfg; onChange: (p: Partial<ChannelCfg>) => void }) {
  const t = c.travel_ms ?? 0, e = c.ease_ms ?? 0;
  const preset = SMOOTHING.find((p) => p.travel_ms === t && p.ease_ms === e);
  const [custom, setCustom] = useState(!preset);
  const showNums = custom || !preset;
  const int = (s: string) => Math.max(0, parseInt(s, 10) || 0);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
      title="How the servo gets to a new position. Off snaps at the servo's own speed; the presets accelerate, cruise and slow to a stop.">
      <label style={optLabel}>smoothing
        <select value={showNums ? "custom" : preset!.id} style={field}
          onChange={(ev) => {
            const p = SMOOTHING.find((x) => x.id === ev.target.value);
            if (p) { setCustom(false); onChange({ travel_ms: p.travel_ms, ease_ms: p.ease_ms }); }
            else setCustom(true);
          }}>
          {SMOOTHING.map((p) => (
            <option key={p.id} value={p.id}>{p.label}{p.travel_ms ? ` · ${p.travel_ms} ms` : ""}</option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {showNums && (
        <>
          <label style={optLabel} title="Time for a full 0–100 % sweep at cruise speed (0 = snap)">sweep
            <input type="number" step={50} min={0} value={t} onChange={(ev) => onChange({ travel_ms: int(ev.target.value) })} style={num} /></label>
          <label style={optLabel} title="Time to speed up from rest (and to slow down before stopping)">ease
            <input type="number" step={20} min={0} value={e} onChange={(ev) => onChange({ ease_ms: int(ev.target.value) })} style={num} /> ms</label>
        </>
      )}
    </span>
  );
}

interface Cal {
  on: boolean; // this servo is in calibrate mode
  us: number; // the raw pulse it is being driven with
  can: boolean; // the node already runs this servo (saved)
  start: () => void;
  stop: () => void;
  pulse: (us: number) => void;
  setMin: (us: number) => void;
  setMax: (us: number) => void;
}

function Test({ c, value, disabled, onFire, cal }: {
  c: ChannelCfg; value: number | undefined; disabled: boolean; onFire: (v: number) => void; cal?: Cal;
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
  if (isColour(c.kind))
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 10, ...dim }}>
        <input type="color" value={hex(v)} onChange={(e) => onFire(parseInt(e.target.value.slice(1), 16))}
          style={{ width: 44, height: 28, padding: 0, background: "none", border: `1px solid ${C.b2}`, borderRadius: 5 }} />
        <button onClick={() => onFire(0)} style={btn()}>Off</button>
        {readout(hex(v))}
      </span>
    );
  if (cal?.on) {
    const small: React.CSSProperties = { ...btn(), height: 26, padding: "0 8px", flex: "none" };
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input type="range" min={SERVO_MIN_US} max={SERVO_MAX_US} step={5} value={cal.us}
            onChange={(e) => cal.pulse(Number(e.target.value))} style={{ flex: 1, minWidth: 60, accentColor: C.amber }} />
          {readout(`${cal.us} µs`)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button onClick={() => cal.setMin(cal.us)} style={small} title="This position becomes 0 %">Set as min</button>
          <button onClick={() => cal.setMax(cal.us)} style={small} title="This position becomes 100 %">Set as max</button>
          <button onClick={cal.stop} style={{ ...small, ...sys(600, 11.5, C.t4) }}>Done</button>
        </span>
      </span>
    );
  }

  // LED, SERVO, MOTOR: a slider over the function's value range.
  const limp = c.kind === "SERVO" && v < 0;
  const calBtn = cal && (
    <button onClick={cal.start} disabled={!cal.can}
      title={cal.can ? "Drive the raw pulse width to find the ends of travel" : "Save this servo to the node first"}
      style={{ ...btn(false, !cal.can), height: 26, padding: "0 8px", flex: "none", pointerEvents: "auto", opacity: cal.can ? 1 : 0.45 }}>
      Calibrate
    </button>
  );
  if (cal && disabled) {
    // Unsaved edits: the % slider would drive the old end stops, so only
    // calibration (raw pulse) is offered.
    return <span style={{ display: "flex", alignItems: "center", gap: 8 }}>{calBtn}<span style={mono(500, 10.5, C.t5)}>save to use the % slider</span></span>;
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, ...dim }}>
      <input type="range" min={f.min} max={f.max} step={10} value={limp ? 500 : v}
        onChange={(e) => onFire(Number(e.target.value))} style={{ flex: 1, minWidth: 60, accentColor: C.ember }} />
      {c.kind === "MOTOR" && <button onClick={() => onFire(0)} style={btn()}>Stop</button>}
      {calBtn}
      {readout(limp ? "limp" : c.kind === "MOTOR" ? `${v > 0 ? "+" : ""}${Math.round(v / 10)}%` : `${Math.round(v / 10)}%`)}
    </span>
  );
}

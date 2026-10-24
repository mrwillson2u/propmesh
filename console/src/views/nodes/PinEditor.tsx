// Pin editor for one generic-board node (MeshPanel picks which): assign
// each pin a function, save, test-fire. One row per board pin, in header
// order, so the screen reads like the board in your hand.
// docs/generic-boards.md.
import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { ColorPicker, Confirm, NumberInput, Spinner, Toggle, mono, sys, Hint } from "../../ui";
import { Cap, FUNCTIONS, type Board, type BoardPin, type ChannelKindName } from "../../lib/boards_gen";
import { battText } from "../../lib/battery";
import { useLayout } from "../../lib/layout";
import {
  EMPTY_CONFIG, FIRE_DEFAULTS, LABEL_MAX, NAME_MAX, SERVO_MAX_US, SERVO_MIN_US, SMOOTHING, channelCode, isColor, isStrip, newChannel, pinRole,
  type ColorOrder, type FireCfg, type StripEffect,
  type ChannelCfg, type NodeConfig, type Pull, CANDLE_DEFAULTS, type CandleCfg } from "../../lib/nodeConfig";
import { issueText, validate, type Issue } from "../../lib/pinRules";
import { SHORT, isBest, isGood, tips } from "../../lib/pinAdvice";
import PinGuide from "./PinGuide";
import Pinout from "./Pinout";
import type { NodeHello, NodeTarget } from "../../lib/transport";
import { useConnection, type LocalMesh } from "../../lib/connection";

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
  where: string; // "USB" / "WIFI" (the bridge itself) / "mesh · 1 hop · −54 dBm" — shown in the header
  // Subscribe to this node's input events; returns the unsubscribe.
  onInput: (cb: (kind: string, index: number, value: number) => void) => () => void;
  // The node's name or bridge flag changed on save — the roster shows them.
  onSaved: (cfg: NodeConfig) => void;
}

// Editor for one generic-board node: name, bridge mode, pin
// assignments, save, test fire.
export default function PinEditor({ node, hello, board, where, onInput, onSaved }: EditorProps) {
  const conn = useConnection();
  // On a phone each pin is a card whose parts wrap, not a six-column row
  // (docs/console-phone.md §5); the column headings go with the columns.
  const { phone } = useLayout();
  const rowStyle: React.CSSProperties = phone
    ? { display: "flex", flexWrap: "wrap", gap: "8px 10px", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #181c22" }
    : { display: "grid", gridTemplateColumns: ROW, gap: 10, alignItems: "center", minHeight: 40, borderBottom: "1px solid #181c22" };
  // On a phone, each assigned pin's card has a chevron that opens a drawer
  // listing every setting with its explanation — the text the laptop
  // shows as hover tooltips, gathered from the card's own labels on
  // open (docs/console-phone.md §9).
  const [drawer, setDrawer] = useState<{ gpio: number; items: [string, string][] } | null>(null);
  const toggleDrawer = (gpio: number, el: HTMLElement | null) => {
    if (drawer?.gpio === gpio || !el) { setDrawer(null); return; }
    const items: [string, string][] = [];
    el.querySelectorAll<HTMLElement>(".pm-opts label[title], .pm-test [title]").forEach((n) => {
      const name = (n.tagName === "LABEL" ? n.firstChild?.textContent : n.textContent)?.trim() ?? "";
      const text = n.getAttribute("title") ?? "";
      if (name && text && !items.some(([k]) => k === name)) items.push([name, text]);
    });
    setDrawer({ gpio, items });
  };
  const [applied, setApplied] = useState<NodeConfig>(EMPTY_CONFIG); // what the node is running
  const [draft, setDraft] = useState<NodeConfig>(EMPTY_CONFIG);
  const [values, setValues] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nodeIssues, setNodeIssues] = useState<Issue[] | null>(null); // the node's verdict on the last save
  const [askBattery, setAskBattery] = useState(false); // "this board sends to the floods" check

  const issues = useMemo(() => validate(board, draft), [board, draft]);
  const hasErrors = issues.some((i) => i.error);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  // ---- load -----------------------------------------------------------

  // A board heard seconds ago may still be joining: a fresh one sends
  // heartbeats while it sweeps channels, so the first request can go out
  // before it has settled on the bridge's channel and time out. Try a few
  // times, a few seconds apart, before showing "no reply" (2026-10-21).
  const [joining, setJoining] = useState(0); // attempts so far while retrying
  const load = async (tries = 4) => {
    setError(null);
    for (let attempt = 1; attempt <= tries; attempt++) {
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
        setJoining(0);
        return;
      } catch (e) {
        const msg = (e as Error).message;
        if (attempt < tries && /no reply/i.test(msg)) {
          setJoining(attempt);
          await new Promise((r) => setTimeout(r, 4000));
          continue;
        }
        setJoining(0);
        setError(msg);
      }
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [hello.node]);

  useEffect(() => onInput((kind, index, value) =>
    setValues((v) => ({ ...v, [`${kind}_${index}`]: value }))), [onInput]);
  // A battery input's reading changes slowly: re-read it every 5 s while
  // the page is open (inputs otherwise only push changes as events). The
  // node target is a fresh object on every parent render, and heartbeats
  // re-render the parent every second or two — so the timer lives on a
  // ref and restarts only when the board or its channels change; keyed on
  // `node` it was cleared before it ever fired (2026-10-18).
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const hasBattery = applied.channels.some((c) => c.kind === "BATTERY");
  const reread = () => nodeRef.current.request("state").then((st) => { if (st.ok) setValues(toValues(st.channels)); }).catch(() => undefined);
  useEffect(() => {
    if (!hasBattery) return;
    const t = setInterval(reread, 5000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasBattery, hello.node]);

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
        {!draft.bridge && (
          <label title="On a battery this board is a leaf: it never relays for others, so losing it costs the mesh nothing. (Sleeping between triggers comes next.)"
            style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", ...sys(600, 11.5, draft.power === "battery" ? C.amber : C.t3) }}>
            <Toggle small on={draft.power === "battery"} onClick={() => {
              // Going on battery on a flood sender: say what it costs first.
              if (draft.power !== "battery" && draft.brmesh_key && hello.ble !== false) setAskBattery(true);
              else setDraft((d) => ({ ...d, power: d.power === "battery" ? "mains" : "battery" }));
            }} /> On battery
          </label>
        )}
        <div style={{ flex: 1 }} />
        {dirty && <span style={mono(600, 11, C.amber)}>unsaved changes</span>}
        {busy && <Spinner color={C.emberT} />}
        <button disabled={!dirty || busy} onClick={() => { setDraft(applied); setNodeIssues(null); }} style={btn(false, !dirty || busy)}>Revert</button>
        <button disabled={!dirty || hasErrors || busy || !loaded} onClick={save} style={btn(true, !dirty || hasErrors || busy || !loaded)}>
          {busy ? "Saving…" : "Save to node"}
        </button>
        {!applied.bridge && <button onClick={allOff} style={btn()}>All off</button>}
      </div>

      <Health hello={hello} />
      {askBattery && (
        <Confirm title="This board sends to the floods" okLabel="Put it on battery" onCancel={() => setAskBattery(false)}
          onOk={() => { setAskBattery(false); setDraft((d) => ({ ...d, power: "battery" })); }}>
          On battery it still sends, but only while awake: during the show it hears commands in short listen windows, so a
          flood change can reach the lights up to one listen interval late (about {((draft.sleep?.interval_ms ?? 1000) / 1000).toFixed(1)} s with
          the current settings), and while the show is off it is in deep sleep and sends nothing.
          {" "}Keep a mains-powered board ticked in the Floods tab so the lights change on time.
        </Confirm>
      )}
      {(error || joining > 0 || shown.length > 0 || advice.length > 0) && (
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.b1}`, display: "flex", flexDirection: "column", gap: 4 }}>
          {joining > 0 && <div style={mono(600, 11.5, C.amber)}>◌ no reply yet — a board that just joined may still be settling on the bridge's channel; trying again (attempt {joining + 1} of 4)</div>}
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
          <Spinner /> Reading pin assignments from {hello.name || hello.node}{where.startsWith("mesh") ? " over the mesh" : ""}…
        </div>
      )}
      {!loaded && error && (
        <div style={{ padding: "6px 16px 14px" }}>
          <button onClick={() => void load()} style={btn()}>Try again</button>
        </div>
      )}
      {loaded && draft.bridge && (
        <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...sys(500, 12, C.t3), lineHeight: 1.5 }}>
            <b style={{ color: C.t1 }}>Bridge.</b> This board drives no pins. It passes the console's
            requests to the other nodes over the mesh, reports what it hears back, and keeps the mesh
            clock — every node syncs to it.
          </div>
          <BridgeWifi draft={draft} applied={applied} setDraft={setDraft} isLink={!!conn && conn.hello.node === hello.node} local={conn?.local} />
        </div>
      )}
      {loaded && !draft.bridge && draft.power === "battery" && (
        hello.sleeps === false
          ? <div style={{ padding: "0 16px 12px", ...sys(500, 12, C.amber) }}>This board's firmware can't deep-sleep (a build from before 2026-10-11, when DevKit images left sleep out): on battery it stops relaying for others, but it won't sleep. Update it and it will.</div>
          : <SleepSettings draft={draft} setDraft={setDraft} />
      )}
      {loaded && !draft.bridge && <div style={{ padding: "0 16px 12px" }}>
        <Pinout board={board} cfg={draft} />
        <PinGuide board={board} cfg={draft} />
        {!phone && <div style={{ display: "grid", gridTemplateColumns: ROW, gap: 10, padding: "9px 0", font: "700 10px system-ui", letterSpacing: ".09em", color: C.t5, borderBottom: `1px solid ${C.b1}` }}>
          <span>PIN</span><span>FUNCTION</span><span>CHANNEL</span><span>NAME</span><span>OPTIONS</span><span>TEST{dirty ? " (SAVE FIRST)" : ""}</span>
        </div>}
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
            <div key={pin.gpio} id={`pin-row-${pin.gpio}`} title={pin.note} className="pm-pin"
              style={{ ...rowStyle, opacity: pin.tier === "reserved" ? 0.5 : 1 }}>
              <span style={{ display: "flex", flexDirection: "column", flex: phone ? "0 0 64px" : undefined }}>
                <span style={mono(700, 12, bad ? C.red : warn ? C.amber : c ? C.t1 : C.t3)}>{pin.label}</span>
                <span style={mono(500, 10, C.t5)}>GPIO {pin.gpio}{pin.tier === "caution" ? " ⚠" : ""}</span>
              </span>

              {pin.tier === "reserved" ? (
                <span style={{ gridColumn: "2 / -1", flex: "1 1 200px", minWidth: 0, ...sys(500, 11.5, C.t5) }}>reserved — {pin.note}</span>
              ) : c && !owner ? (
                <>
                  <span style={sys(500, 12, C.t3)}>{FUNCTIONS[c.kind].label}</span>
                  <span style={mono(600, 11.5, C.t3)}>{channelCode(c)}</span>
                  <span style={{ gridColumn: "4 / -1", flex: "1 1 160px", minWidth: 0, ...mono(500, 11, C.t5) }}>{pinRole(c, pin.gpio)} pin — set on {board.pins.find((p) => p.gpio === c.pins[0])?.label}</span>
                </>
              ) : (
                <>
                  <select value={c?.kind ?? ""} onChange={(e) => assign(pin.gpio, e.target.value as ChannelKindName | "")}
                    style={{ ...field, color: c ? C.t1 : C.t5, flex: phone ? "1 1 0" : undefined, minWidth: 0 }}>
                    <option value="">— unused —</option>
                    {kinds.map((k) => <option key={k} value={k}>{isBest(pin, k) ? "★ " : isGood(pin, k) ? "· " : "   "}{FUNCTIONS[k].label}</option>)}
                  </select>
                  {c ? (
                    <>
                      <span style={{ ...mono(600, 11.5, c.kind === "DIGITAL_IN" || c.kind === "BATTERY" ? "#7d87b8" : C.emberT), flex: "none", whiteSpace: "nowrap" }}>{channelCode(c)}</span>
                      {phone && (
                        <button className="pm-chev" aria-expanded={drawer?.gpio === pin.gpio} aria-label="What these settings do"
                          onClick={(e) => toggleDrawer(pin.gpio, (e.currentTarget as HTMLElement).closest(".pm-pin"))}>
                          {drawer?.gpio === pin.gpio ? "✕" : "ⓘ"}
                        </button>
                      )}
                      {phone && drawer?.gpio === pin.gpio && (
                        <div className="pm-drawer">
                          <div className="pm-drawer-head">{FUNCTIONS[c.kind].label}{pin.note ? ` · ${pin.note}` : ""}</div>
                          {drawer.items.length === 0 && <div className="pm-drawer-row"><span /><span>No settings to explain on this pin.</span></div>}
                          {drawer.items.map(([k, v]) => <div key={k} className="pm-drawer-row"><span className="pm-drawer-k">{k}</span><span>{v}</span></div>)}
                          {c.kind === "CANDLE" && <a href="https://mrwillson2u.github.io/propmesh/props/candles/" target="_blank" rel="noreferrer" className="pm-drawer-link">Wiring and tuning guide ↗</a>}
                        </div>
                      )}
                      <input value={c.label} maxLength={LABEL_MAX} placeholder="what is it?"
                        onChange={(e) => patch(ci, { label: e.target.value })} style={{ ...field, flex: phone ? "1 1 100%" : undefined, minWidth: 0 }} />
                      <span className="pm-opts" style={{ display: "contents" }}><Options c={c} pin={pin} in2={c.kind === "MOTOR" || c.kind === "SPI_STRIP" || c.kind === "CANDLE" ? freePins(c, 1) : []} onChange={(p) => patch(ci, p)} reading={values[channelCode(c)]} /></span>
                      <span className="pm-test" style={{ display: "contents" }}><Test c={c} value={values[channelCode(c)]} disabled={dirty} onFire={(v) => fire(c, v)} onReread={reread}
                        onCandle={(event, chz, ms, burst) => node.request("candle", { index: c.index, event, ...(chz !== undefined ? { chz } : {}), ...(ms ? { ms } : {}), ...(burst ? { burst } : {}) }).then((r) => { if (!r.ok) setError(`${channelCode(c)}: ${r.error}`); })}
                        onSwing={(chz, kick_ms) => patch(ci, { candle: { ...(c.candle ?? CANDLE_DEFAULTS), swing_chz: chz, kick_ms } })}
                        cal={c.kind !== "SERVO" ? undefined : {
                          on: cal?.code === channelCode(c),
                          us: cal?.code === channelCode(c) ? cal.us : 0,
                          can: canCalibrate(c),
                          start: () => startCal(c),
                          stop: () => setCal(null),
                          pulse: (us) => { setCal({ code: channelCode(c), us }); fire(c, 0, us); },
                          setMin: (us) => patch(ci, { min_us: us }),
                          setMax: (us) => patch(ci, { max_us: us }),
                        }} /></span>
                    </>
                  ) : (
                    <span style={{ gridColumn: "3 / -1", display: "flex", gap: 10, alignItems: "baseline", minWidth: 0, flex: phone ? "1 1 100%" : undefined, flexWrap: phone ? "wrap" : undefined }}>
                      {pin.best && (
                        <span style={{ ...sys(500, 11, C.t4), flex: phone ? "1 1 auto" : "none", minWidth: 0 }}>
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
        {draft.channels.some((c) => c.kind === "BLE_LIGHT") && (
          <Hint style={{ marginTop: 10 }}>
            This board also sends to {draft.channels.filter((c) => c.kind === "BLE_LIGHT").length} flood light(s) — managed in the <b>Floods</b> tab, where they belong to the whole mesh.
          </Hint>
        )}
      </div>}
    </div>
  );
}


// The bridge's home WiFi. Once it's set up, the board keeps the password
// and never tells the console, so a password box always looks empty — it
// read as "fill me in again" every time (2026-10-08). So: a status line
// and Change…; the fields only while changing.
function BridgeWifi({ draft, applied, setDraft, isLink, local }: {
  draft: NodeConfig; applied: NodeConfig;
  setDraft: React.Dispatch<React.SetStateAction<NodeConfig>>;
  isLink: boolean; // this bridge is the one the console is connected through (so its live status is known)
  local?: LocalMesh;
}) {
  const [editing, setEditing] = useState(false);
  const set = !!applied.wifi?.ssid;
  const changed = JSON.stringify(draft.wifi ?? null) !== JSON.stringify(applied.wifi ?? null);
  // After a save the board's config comes back: close the form.
  useEffect(() => { if (!changed) setEditing(false); }, [changed, applied]);
  const label = <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em" }}>HOME WIFI</span>;

  if (!editing && !changed) {
    const status = !set ? null
      : !isLink ? <span style={mono(500, 11.5, C.t4)}>status shows on the bridge you're connected through</span>
      : local?.ip ? <span style={mono(600, 11.5, C.green)}>● connected · {local.ip} · channel {local.channel}</span>
      : local?.wifi_reason ? <span style={mono(600, 11.5, C.amber)}>○ not connected — {local.wifi_reason}</span>
      : <span style={mono(600, 11.5, C.amber)}>○ connecting…</span>;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {label}
        {set
          ? <><span style={sys(600, 12.5, C.t1)}>{applied.wifi!.ssid}</span>{status}
              <button onClick={() => setEditing(true)} style={btn()}>Change…</button></>
          : <><span style={sys(400, 12, C.t4)}>not set up — the console reaches this bridge by cable only</span>
              <button onClick={() => setEditing(true)} style={btn()}>Set up home WiFi…</button></>}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {label}
      <input value={draft.wifi?.ssid ?? ""} placeholder="network name (2.4 GHz)" maxLength={32} autoFocus
        onChange={(e) => setDraft((d) => ({ ...d, wifi: { ...(d.wifi ?? { ssid: "" }), ssid: e.target.value } }))}
        style={{ ...field, width: 200 }} />
      <input value={draft.wifi?.pass ?? ""} type="password" autoComplete="off" maxLength={64}
        placeholder={applied.wifi?.pass_set && draft.wifi?.ssid === applied.wifi?.ssid ? "unchanged — type a new one to replace it" : "password"}
        onChange={(e) => setDraft((d) => ({ ...d, wifi: { ...(d.wifi ?? { ssid: "" }), pass: e.target.value } }))}
        style={{ ...field, width: 260 }} />
      {set && <button onClick={() => setDraft((d) => ({ ...d, wifi: undefined }))} style={btn()} title="Take the bridge off WiFi (Save to node to apply)">Forget network</button>}
      <button onClick={() => { setDraft((d) => ({ ...d, wifi: applied.wifi })); setEditing(false); }} style={btn()}>Cancel</button>
      <span style={sys(400, 11.5, C.t4)}>
        Then <b>Save to node</b>. The password stays on the board; the console never sees it again.
      </span>
    </div>
  );
}

// Sleep on battery (docs §6f). Two tiers: while the show runs the radio
// listens a window of every interval (modem sleep between); when the
// schedule says off the board deep-sleeps and checks in every few minutes
// (its sensor pins wake it at once either way).
function SleepSettings({ draft, setDraft }: { draft: NodeConfig; setDraft: React.Dispatch<React.SetStateAction<NodeConfig>> }) {
  const sl = draft.sleep ?? { interval_ms: 1000, window_ms: 100, checkin_ms: 300000 };
  const set = (p: Partial<typeof sl>) => setDraft((d) => ({ ...d, sleep: { ...sl, ...p } }));
  const num = (v: number, on: (n: number) => void, min: number, max: number, w = 64) => (
    <NumberInput value={v} onChange={on} min={min} max={max} integer width={w} style={field} />
  );
  const dutyMa = Math.round(100 * sl.window_ms / sl.interval_ms + 25);
  return (
    <div style={{ padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...sys(500, 12, C.t3), opacity: sl.relay ? 0.45 : 1 }}
        title={sl.relay ? "Not used while it relays: a repeater stays awake through the show" : undefined}>
        <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em" }}>SLEEP</span>
        <span>While the show runs, listen for</span>{num(sl.window_ms, (n) => set({ window_ms: n }), 30, sl.interval_ms)}<span>ms of every</span>
        {num(sl.interval_ms, (n) => set({ interval_ms: n }), 200, 10000)}<span>ms</span>
        <span style={mono(500, 11, C.t4)}>— a cue reaches it within {(sl.interval_ms / 1000).toFixed(1)} s; about {dutyMa} mA on average</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...sys(500, 12, C.t3) }}>
        <span style={{ width: 44 }} />
        <span>When the show is off, deep-sleep and check in every</span>{num(sl.checkin_ms, (n) => set({ checkin_ms: n }), 30000, 86400000, 88)}<span>ms</span>
        <span style={mono(500, 11, C.t4)}>({(sl.checkin_ms / 60000).toFixed(1)} min) — its sensor pins wake it at once; it also wakes for the next schedule window</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", ...sys(500, 12, C.t3) }}>
        <span style={{ width: 44 }} />
        <Toggle small on={!!sl.relay} onClick={() => set({ relay: !sl.relay })} />
        <span>Relay for other boards while the show runs</span>
        <span style={mono(500, 11, sl.relay ? C.amber : C.t4)}>
          {sl.relay
            ? "— stays awake through the show (about 100 mA instead of the listen setting above); the off tier is unchanged. Boards that reach the bridge only through this one are cut off while it sleeps."
            : "— for a repeater on a big battery: awake and passing messages along during the show, asleep outside it"}
        </span>
      </div>
    </div>
  );
}

// Find + pair BRMesh lights from this board (firmware pm_ble_tx). Every
// light heard is listed: unpaired ("found"), holding another controller's
// key ("other" — pairing it is a take-over), or already on this board's
// key ("paired" — adopted on the spot). The board makes its own key on
// the first pairing, saves it, and adds each paired light as a BLE_LIGHT.
interface FoundLight { addr: string; type: string; rssi: number; state: "found" | "pairing" | "paired" | "failed" | "other"; number?: number; key?: string; acked?: boolean }

export function BleFinder({ node, onPaired }: { node: NodeTarget; onPaired: () => Promise<void> }) {
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
      const after = await poll();
      // A light already on this board's key is adopted during the search.
      if (after.some((l) => l.state === "paired")) await onPaired();
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
      else setError(`${l.type} light ${l.addr}: the pairing didn't go out — search again and retry`);
    } catch (e) { setError((e as Error).message); }
  };

  const busy = mode !== "idle";
  return (
    <div style={{ margin: "8px 0", padding: 12, border: `1px solid ${C.b2}`, borderRadius: 8, background: C.card }}>
      <div style={{ ...sys(400, 12, C.t3), lineHeight: 1.55 }}>
        <b style={{ color: C.t1 }}>1.</b> Put the floods near this board and switch them <b>off</b>.{" "}
        <b style={{ color: C.t1 }}>2.</b> Click <b>Search</b>, then switch them <b>on</b> — a light only announces
        itself for a short while after power-up. Lights paired to the BRMesh app or another board show as
        <b> paired elsewhere</b>: <b>Take over</b> moves them to this board, and the app loses them.
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
            ? <span style={mono(700, 11, C.green)} title={l.acked ? "the light confirmed the new key" : "lights don't usually answer — check it with a test color below"}>
                ✓ paired as light #{l.number}{l.acked ? "" : " — try its color below"}
              </span>
            : l.state === "pairing"
              ? <span style={mono(600, 11, C.t4)}>pairing as #{l.number}…</span>
              : <>
                  {l.state === "failed" && <span style={mono(600, 11, C.amber)}>didn't confirm</span>}
                  {l.state === "other" && <span style={mono(600, 11, C.amber)} title={`holds key ${l.key}`}>paired elsewhere{l.number ? ` as #${l.number}` : ""}</span>}
                  <button onClick={() => void pair(l)} disabled={busy} style={btn(true, busy)}>
                    {l.state === "failed" ? "Retry" : l.state === "other" ? "Take over" : "Pair"}
                  </button>
                </>}
        </div>
      ))}
      {searched && !busy && lights.length === 0 && !error && (
        <div style={{ ...sys(400, 11.5, C.t5), marginTop: 8 }}>
          No lights answered. They only announce themselves just after power-up: switch them off, start a
          search, then switch them on close to this board.
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

function Options({ c, pin, in2, onChange, reading }: {
  c: ChannelCfg; pin: BoardPin; in2: BoardPin[]; onChange: (p: Partial<ChannelCfg>) => void;
  reading?: number; // BATTERY: the board's current reading, mV, for the calibration helper
}) {
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
          <label style={optLabel} title="Pulse width at 0 %">min <NumberInput value={c.min_us ?? 500} onChange={(n) => onChange({ min_us: n })} min={SERVO_MIN_US} max={SERVO_MAX_US} integer style={num} /></label>
          <label style={optLabel} title="Pulse width at 100 %">max <NumberInput value={c.max_us ?? 2500} onChange={(n) => onChange({ max_us: n })} min={SERVO_MIN_US} max={SERVO_MAX_US} integer style={num} /> µs</label>
          {/* Reverse = the two ends swapped; stored as min above max. */}
          <label style={optLabel} title="Swap the ends: 0 % moves to where 100 % was">
            <input type="checkbox" checked={(c.min_us ?? 500) > (c.max_us ?? 2500)}
              onChange={() => onChange({ min_us: c.max_us ?? 2500, max_us: c.min_us ?? 500 })} />
            reverse
          </label>
          <Smoothing c={c} onChange={onChange} />
        </>
      )}
      {isStrip(c.kind) && (
        <>
          {c.kind === "SPI_STRIP" && (
            <label style={optLabel} title={`DATA is ${pin.label}`}>clock
              <select value={c.pins[1] ?? ""} style={field}
                onChange={(e) => onChange({ pins: e.target.value === "" ? [c.pins[0]] : [c.pins[0], Number(e.target.value)] })}>
                <option value="">— choose —</option>
                {in2.filter((p) => p.gpio !== c.pins[0]).map((p) => <option key={p.gpio} value={p.gpio}>{p.label}{p.tier === "caution" ? " ⚠" : ""}</option>)}
              </select>
            </label>
          )}
          <label style={optLabel}>pixels <NumberInput value={c.pixels ?? 30} onChange={(n) => onChange({ pixels: n })} min={1} max={300} integer style={num} /></label>
          <label style={optLabel} title="Color order on the wire — WS2812 is usually GRB, SK9822 / APA102 BGR. Wrong order = wrong colors, nothing worse.">order
            <select value={c.order ?? (c.kind === "SPI_STRIP" ? "bgr" : "grb")} onChange={(e) => onChange({ order: e.target.value as ColorOrder })} style={field}>
              <option value="grb">GRB</option><option value="rgb">RGB</option><option value="bgr">BGR</option>
            </select>
          </label>
          <label style={optLabel} title="Solid: the strip shows the color it is set to. Fire: a flame effect runs on the strip; a cue or test color only switches it on (any color) or off (0).">effect
            <select value={c.effect ?? "solid"} style={field}
              onChange={(e) => {
                const effect = e.target.value as StripEffect;
                // First time: the lantern's 2×4 if the count fits, else one column.
                const n = c.pixels ?? 30;
                const fire = c.fire ?? (n === 8 ? { ...FIRE_DEFAULTS } : { ...FIRE_DEFAULTS, w: 1, h: n, zigzag: false });
                onChange({ effect, fire });
              }}>
              <option value="solid">solid color</option><option value="fire">fire</option>
            </select>
          </label>
          {c.effect === "fire" && <FireOptions f={c.fire ?? FIRE_DEFAULTS} onChange={(p) => onChange({ fire: { ...(c.fire ?? FIRE_DEFAULTS), ...p } })} />}
        </>
      )}
      {c.kind === "BATTERY" && <BatteryOptions c={c} onChange={onChange} reading={reading} />}
      {c.kind === "CANDLE" && (
        <>
          <label style={optLabel} title={`The LED is on ${pin.label}. The coil pulses to swing the flame; it drives a transistor, never the coil directly.`}>coil
            <select value={c.pins[1] ?? ""} style={field}
              onChange={(e) => onChange({ pins: e.target.value === "" ? [c.pins[0]] : [c.pins[0], Number(e.target.value)] })}>
              <option value="">— choose —</option>
              {in2.filter((p) => p.gpio !== c.pins[0]).map((p) => <option key={p.gpio} value={p.gpio}>{p.label}{p.tier === "caution" ? " ⚠" : ""}</option>)}
            </select>
          </label>
          {activeLow("LED on = LOW", "Tick if the LED lights when its pin is pulled LOW (the pin sinks the LED's current, as on most hacked candle boards)")}
          <CandleOptions k={c.candle ?? CANDLE_DEFAULTS} onChange={(p) => onChange({ candle: { ...(c.candle ?? CANDLE_DEFAULTS), ...p } })} />
        </>
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
            <NumberInput value={t} onChange={(n) => onChange({ travel_ms: n })} min={0} max={10000} integer style={num} /></label>
          <label style={optLabel} title="Time to speed up from rest (and to slow down before stopping)">ease
            <NumberInput value={e} onChange={(n) => onChange({ ease_ms: n })} min={0} max={5000} integer style={num} /> ms</label>
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

// Why the board last restarted, and what it saved to flash before that
// (pm_lastwords). Shown only when there is something worth reading: a
// plain power-on with nothing saved says nothing.
const dur = (s: number) => s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min` : `${s} s`;
function Health({ hello }: { hello: NodeHello }) {
  const odd = hello.reset && !["power on", "software (update or restart)", "deep sleep", "reset pin"].includes(hello.reset);
  if (!odd && !hello.last) return null;
  const when = hello.last?.utc_s ? new Date(hello.last.utc_s * 1000).toLocaleString() : hello.last?.up_s !== undefined ? `after ${dur(hello.last.up_s)} running` : "";
  return (
    <div style={{ padding: "6px 16px", borderBottom: `1px solid ${C.b1}`, display: "flex", gap: 14, flexWrap: "wrap", ...sys(400, 11.5, C.t3) }}>
      {hello.reset && <span>Last restart: <b style={{ color: odd ? C.amber : C.t2 }}>{hello.reset}</b>{hello.up_s !== undefined ? ` · up ${dur(hello.up_s)}` : ""}</span>}
      {hello.last && <span title="Saved to the board's flash when it happened, so a restart doesn't erase it">
        Before that: <b style={{ color: C.amber }}>{hello.last.what}</b>{hello.last.detail ? ` — ${hello.last.detail}` : ""}{when ? ` (${when})` : ""}
      </span>}
    </div>
  );
}

// Fire2023's knobs (firmware pm_fire.h). Titles say which way each one
// pushes the look; the defaults are Colin's lantern.
// The candle's knobs (firmware PmCandleCfg). Shown in plain units: drama as
// 0–1.5, the swing in Hz.
// Find the flame's own swing (docs §6n): the board kicks the coil steadily
// at one rate (no bursts, no gusts) while the rate sweeps slowly across the
// range, or is nudged by hand. The flame swings furthest at its own
// frequency. Then the kick width: at the found rate, shorten the kick until
// the swing shrinks, and go back up a step — the lightest push that still
// swings fully is the one that keeps the coil cool. "Use" puts both in the
// settings (then Save to node). The board stops kicking on its own after
// 2 minutes.
function SwingFinder({ lit, light, current, currentKick, onCandle, onSwing }: {
  lit: boolean; light: () => void; current: number; currentKick: number;
  onCandle: (event: "tune", chz: number, ms?: number, burst?: boolean) => void; onSwing: (chz: number, kick_ms: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chz, setChz] = useState(current);
  const [kick, setKick] = useState(currentKick);
  const [sweeping, setSweeping] = useState(false);
  const [burst, setBurst] = useState(false);
  const LO = 50, HI = 600, STEP = 10, HOLD_MS = 2500;  // 0.50–6.00 Hz, 0.10 Hz every 2.5 s (a floppy flame can swing under 1 Hz)
  // The parent re-renders every time a board reports in (every second or
  // two), and `onCandle` is a fresh function each time. The sweep timer
  // must not restart on those renders — it never reached 2.5 s on the
  // first real try (2026-10-16) — so it reads the latest values through
  // refs and depends only on `sweeping`.
  const latest = useRef({ chz, kick, burst, onCandle, open });
  latest.current = { chz, kick, burst, onCandle, open };
  const send = (c: number, k: number, b = burst) => { setChz(c); setKick(k); onCandle("tune", c, k, b); };
  const start = () => { if (!lit) light(); setOpen(true); setSweeping(false); send(current, currentKick); };
  const stop = () => { setSweeping(false); setOpen(false); onCandle("tune", 0); };
  useEffect(() => {
    if (!sweeping) return;
    const t = setInterval(() => {
      const { chz: c, kick: k, burst: b, onCandle: send } = latest.current;
      const n = c + STEP > HI ? LO : c + STEP;
      setChz(n);
      send("tune", n, k, b);
    }, HOLD_MS);
    return () => clearInterval(t);
  }, [sweeping]);
  useEffect(() => () => { if (latest.current.open) latest.current.onCandle("tune", 0); }, []);  // leaving the page stops the kicks
  if (!open)
    return <button onClick={start} style={{ ...btn(), alignSelf: "flex-start" }} title="Kick the coil steadily while the rate sweeps, and watch which rate swings the flame furthest; then find the lightest kick that still swings it">Find the swing…</button>;
  const hz = (chz / 100).toFixed(2);
  const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" };
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 6, padding: "6px 10px", border: `1px solid ${C.amberB}`, background: C.amberBg, borderRadius: 6 }}>
      <span style={row}>
        <span style={{ ...sys(700, 9.5, C.amber), letterSpacing: ".08em", width: 64 }}>RATE</span>
        <span style={{ ...mono(800, 22, C.t1), minWidth: 84, textAlign: "right" }}>{hz} Hz</span>
        <button onClick={() => send(Math.max(LO, chz - 5), kick)} style={btn()} title="0.05 Hz slower">−</button>
        <button onClick={() => send(Math.min(HI, chz + 5), kick)} style={btn()} title="0.05 Hz faster">+</button>
        <button onClick={() => setSweeping(!sweeping)} style={btn(sweeping)} title="Step 0.10 Hz every 2.5 s from 0.50 to 6.00 Hz, round and round">{sweeping ? "Pause sweep" : "Sweep"}</button>
        <button onClick={() => { setBurst(!burst); send(chz, kick, !burst); }} style={btn(burst)} title="Kick in sets of 3–5 with a rest between, like the normal flicker, instead of steadily. A rest lets the next set catch the flame at a different point in its swing, which can start it moving when steady kicks don't.">{burst ? "Bursts" : "Steady"}</button>
        <span style={mono(500, 10.5, C.t4)}>steady light, no gusts · watch the flame piece for the widest swing</span>
      </span>
      <span style={row}>
        <span style={{ ...sys(700, 9.5, C.amber), letterSpacing: ".08em", width: 64 }}>KICK</span>
        <span style={{ ...mono(800, 22, C.t1), minWidth: 84, textAlign: "right" }}>{kick} ms</span>
        <button onClick={() => send(chz, Math.max(4, kick - 2))} style={btn()} title="2 ms lighter">−</button>
        <button onClick={() => send(chz, Math.min(80, kick + 2))} style={btn()} title="2 ms harder">+</button>
        <span style={mono(500, 10.5, C.t4)}>at the found rate, shorten until the swing shrinks, then one step back up · a warm coil means too long</span>
      </span>
      <span style={row}>
        <button onClick={() => { onSwing(chz, kick); stop(); }} style={{ ...btn(true), fontWeight: 700 }} title="Put this rate and kick in the candle's settings (then Save to node)">Use {hz} Hz · {kick} ms</button>
        <button onClick={stop} style={btn()}>Stop</button>
        <span style={mono(500, 10.5, C.t4)}>the board stops on its own after 2 min</span>
      </span>
    </span>
  );
}

// The divider's ratio, with the formula and a calibration helper: type what
// the meter reads at the battery and it works out the ratio that makes the
// console agree (resistor tolerance and the chip's ADC both shift it;
// 1 % low on the first real one, 2026-10-17).
function BatteryOptions({ c, onChange, reading }: { c: ChannelCfg; onChange: (p: Partial<ChannelCfg>) => void; reading?: number }) {
  const [meter, setMeter] = useState<number | undefined>(undefined);
  const div = c.divider ?? 2;
  const suggested = meter && reading ? Math.round(div * (meter * 1000) / reading * 100) / 100 : undefined;
  return (
    <span className="pm-optbox" style={{ display: "flex", alignItems: "center", gap: "4px 10px", flexWrap: "wrap" }}>
      <label style={optLabel} title="The reading is the pin's voltage times this ratio.">divider
        <NumberInput value={div} onChange={(v) => onChange({ divider: v })} min={1} max={20} digits={2} style={num} />
      </label>
      <Hint style={{ ...mono(500, 10.5, C.t4), lineHeight: 1.4 }}>= (top resistor + bottom resistor) ÷ bottom resistor · two equal resistors = 2.00</Hint>
      <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }} title="Measure the battery with a meter and type it here; the ratio that makes the console agree is worked out from the board's current reading.">
        <span style={sys(500, 11.5, C.t3)}>meter reads</span>
        <NumberInput value={meter} onChange={setMeter} onEmpty={() => setMeter(undefined)} min={2} max={30} digits={2} width={60} style={num} placeholder="0.00" />
        <span style={sys(500, 11.5, C.t3)}>V</span>
        {suggested && reading ? (
          <>
            <span style={mono(500, 10.5, C.t4)}>console {(reading / 1000).toFixed(2)} V → divider {suggested.toFixed(2)}</span>
            <button onClick={() => { onChange({ divider: suggested }); setMeter(undefined); }} style={btn(true)} disabled={suggested === div}>Use {suggested.toFixed(2)}</button>
          </>
        ) : meter && !reading ? <span style={mono(500, 10.5, C.t5)}>save first, so the board has a reading to compare</span> : null}
      </span>
    </span>
  );
}

function CandleOptions({ k, onChange }: { k: CandleCfg; onChange: (p: Partial<CandleCfg>) => void }) {
  const small: React.CSSProperties = { ...num, width: 64 };
  const [help, setHelp] = useState(false);
  return (
    <span className="pm-optbox" style={{ display: "flex", alignItems: "center", gap: "4px 10px", flexWrap: "wrap", padding: "4px 8px", border: `1px solid ${C.b2}`, borderRadius: 6 }}>
      <span style={{ ...sys(700, 9.5, C.amber), letterSpacing: ".08em" }}>CANDLE</span>
      <span className="pm-help" onClick={() => setHelp(!help)} title="What these settings do" style={{ ...mono(700, 11, help ? C.amber : C.t4), cursor: "pointer", padding: "0 4px" }}>{help ? "✕" : "?"}</span>
      {help && (
        <span style={{ flexBasis: "100%", ...sys(400, 11.5, C.t3), lineHeight: 1.45, padding: "4px 2px 6px" }}>
          The LED flickers in four layers: a slow <b>wander</b>, a fast <b>shimmer</b>, random <b>gusts</b> (quick dips) and rare <b>sputters</b> (a near-blowout that stutters and flares back).
          The coil swings the flame piece in irregular sets of kicks, and pumps harder during a gust, so the wobble follows the flicker.<br />
          <b>drama</b> — how strong the shimmer and the gust dips are, and how hard the coil pumps in a gust: 0 is a calm flame, 1 a real candle, 1.5 one in a draft.
          <b> floor</b> — the dimmest the LED ever gets, so a sputter never looks like the candle died (3 % lets it; 30 % keeps it steady).
          <b> gust every</b> / <b>sputter every</b> — average seconds between them; the gaps are random, never a beat. Sputter 0 = never.
          <b> swing</b> — the coil's kick rate; match the flame's own swing with <b>Find the swing…</b> in the TEST column.
          <b> kick</b> — how long each coil pulse lasts: longer is harder and warmer; the finder helps pick the lightest kick that still swings fully.
          <b> swing the flame</b> — off keeps the flame piece still while the LED flickers.
          <b> draft</b> — candles in the same draft (on any board) gust and sputter together, as if one breath of wind crossed them: the same moment and strength, but each flame dips in its own rhythm and keeps its own shimmer and sway.
          {" "}<a href="https://mrwillson2u.github.io/propmesh/props/candles/" target="_blank" rel="noreferrer" style={{ color: C.amber }}>Wiring and tuning guide ↗</a>
        </span>
      )}
      <label style={optLabel} title="Scales every effect: 0 = a calm, steady flame; 1 = normal; 1.5 = wild">drama
        <NumberInput value={k.drama10 / 10} onChange={(v) => onChange({ drama10: Math.round(v * 10) })} min={0} max={1.5} digits={1} style={small} /></label>
      <label style={optLabel} title="The dimmest the flame ever gets, even mid-sputter">floor
        <NumberInput value={k.floor} onChange={(v) => onChange({ floor: v })} min={0} max={30} integer style={small} /> %</label>
      <label style={optLabel} title="Average seconds between gusts — quick dips with a big swing of the flame. Random, never on a beat.">gust every
        <NumberInput value={k.gust_s} onChange={(v) => onChange({ gust_s: v })} min={2} max={255} integer style={small} /> s</label>
      <label style={optLabel} title="Average seconds between near-blowouts: the flame nearly dies, stutters, then flares back. 0 = never.">sputter every
        <NumberInput value={k.sputter_s} onChange={(v) => onChange({ sputter_s: v })} min={0} max={3600} integer style={small} /> s</label>
      <label style={{ ...optLabel, opacity: k.coil ? 1 : 0.5 }} title="How often the coil kicks. Match the flame's own swing: nudge it ±0.3 Hz and watch for the biggest motion (the candle sketch measured 2.7 Hz).">swing
        <NumberInput value={k.swing_chz / 100} onChange={(v) => onChange({ swing_chz: Math.round(v * 100) })} min={0.5} max={8} digits={2} style={small} /> Hz</label>
      <label style={{ ...optLabel, opacity: k.coil ? 1 : 0.5 }} title="Length of each coil pulse. Longer = a harder kick and more battery. Start low; the coil gets warm if overdriven.">kick
        <NumberInput value={k.kick_ms} onChange={(v) => onChange({ kick_ms: v })} min={4} max={80} integer style={small} /> ms</label>
      <label style={optLabel} title="Off: the flame piece stays still, the LED still flickers">
        <input type="checkbox" checked={k.coil} onChange={(e) => onChange({ coil: e.target.checked })} /> swing the flame</label>
      <label style={optLabel} title="Candles in the same draft gust and sputter at the same moment, as if one breath of wind crossed them all — on any board, worked out from the mesh clock. Each keeps its own shimmer and sway. Alone: its own random timing.">draft
        <select value={k.draft ?? 0} onChange={(e) => onChange({ draft: Number(e.target.value) })} style={field}>
          <option value={0}>alone</option>
          {["A", "B", "C", "D", "E", "F", "G", "H"].map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
        </select>
      </label>
    </span>
  );
}

function FireOptions({ f, onChange }: { f: FireCfg; onChange: (p: Partial<FireCfg>) => void }) {
  const small: React.CSSProperties = { ...num, width: 50 };
  const field = (key: keyof FireCfg, label: string, title: string, max = 255) => (
    <label style={optLabel} title={title}>{label}
      <NumberInput value={f[key] as number} onChange={(v) => onChange({ [key]: v })} min={0} max={max} integer style={small} />
    </label>
  );
  return (
    <span className="pm-optbox" style={{ display: "flex", alignItems: "center", gap: "4px 10px", flexWrap: "wrap", padding: "4px 8px", border: `1px solid ${C.b2}`, borderRadius: 6 }}>
      <span style={{ ...sys(700, 9.5, C.amber), letterSpacing: ".08em" }}>FIRE</span>
      {field("w", "columns", "Columns of pixels, side by side around the prop. columns × height = pixel count.", 60)}
      {field("h", "height", "Pixels per column, bottom to top. The flame is seeded at the bottom.", 255)}
      <label style={optLabel} title="Serpentine wiring: the first column runs bottom to top, the next top to bottom, and so on (the lantern). Off: every column starts at the bottom.">
        <input type="checkbox" checked={f.zigzag} onChange={(e) => onChange({ zigzag: e.target.checked })} /> zigzag
      </label>
      {field("brightness", "brightness", "Overall level, 0–255.")}
      {field("speed", "speed", "How fast the flames move. Small matrices want small values (the lantern: 2).")}
      <label style={optLabel} title="Flame height — higher values cool the heat less, so flames climb further up the column (the lantern: 3.0).">flame
        <NumberInput value={f.flame10 / 10} onChange={(v) => onChange({ flame10: Math.round(v * 10) })} min={0.1} max={25.5} digits={1} style={small} />
      </label>
      {field("noise", "noise", "Flame noise scale: 0 = one smooth flame across the columns, bigger = each column flickers on its own.")}
      {field("smoke_speed", "smoke speed", "How fast the smoke layer drifts — a little faster than the flames reads best (the lantern: 25).")}
      {field("smoke_dim", "smoke", "Smoke thickness: lower = brighter, more visible flames; higher = more cut off by smoke (the lantern: 250).")}
      {field("smoke_scale", "smoke scale", "Smoke noise scale: small = soft veils, big = blinky (the lantern: 125).")}
    </span>
  );
}

function Test({ c, value, disabled, onFire, onCandle, onSwing, cal, onReread }: {
  c: ChannelCfg; value: number | undefined; disabled: boolean; onFire: (v: number) => void;
  onReread?: () => void; // BATTERY: read the board now
  onCandle?: (event: "gust" | "sputter" | "tune", chz?: number, ms?: number, burst?: boolean) => void; onSwing?: (chz: number, kick_ms: number) => void; cal?: Cal;
}) {
  const f = FUNCTIONS[c.kind];
  const v = value ?? 0;
  const dim: React.CSSProperties = disabled ? { opacity: 0.35, pointerEvents: "none" } : {};
  const readout = (text: string) => <span className="pm-readout" style={{ ...mono(600, 11, C.t3), width: 52, textAlign: "right" }}>{text}</span>;

  if (c.kind === "DIGITAL_IN")
    return <span style={mono(700, 11, v ? C.ember : C.green)}>{v ? "● ACTIVE" : "○ clear"}</span>;
  if (c.kind === "BATTERY")
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={mono(700, 11, v < 3500 ? C.amber : C.green)} title="The board samples every 2 s; this re-reads it every 5 s while the page is open. Percent from a resting 1S lithium curve.">{v ? battText(v) : "—"}</span>
        <button onClick={onReread} style={btn(false)} title="Read the board now">↻ READ NOW</button>
      </span>
    );
  if (c.kind === "RELAY")
    return (
      <span style={{ display: "flex", alignItems: "center", gap: 10, ...dim }}>
        <button onClick={() => onFire(v ? 0 : 1)} style={{ ...btn(!!v), width: 104, flex: "none" }}>{v ? "⏻ TURN OFF" : "⏻ TURN ON"}</button>
        <span style={mono(700, 11, v ? C.green : C.t5)}>{v ? "● ON" : "○ OFF"}</span>
      </span>
    );
  // A fire strip has no color to pick: it burns or it doesn't.
  if (isStrip(c.kind) && c.effect === "fire")
    return (
      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button disabled={disabled} onClick={() => onFire(0xff5500)} style={btn(true, disabled)}>Burn</button>
        <button disabled={disabled} onClick={() => onFire(0)} style={btn(false, disabled)}>Out</button>
        {value !== undefined && <span style={mono(500, 11, value ? C.amber : C.t5)}>{value ? "burning" : "out"}</span>}
      </span>
    );
  if (isColor(c.kind))
    return (
      <span style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, gap: 10, ...dim }}>
        <ColorPicker value={v} onChange={onFire} white={c.kind === "BLE_LIGHT"} />
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

  // A candle: its brightness on a slider, a gust or a sputter on demand, and
  // the swing finder.
  if (c.kind === "CANDLE")
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0, ...dim }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <input type="range" min={0} max={1000} step={10} value={v}
            onChange={(e) => onFire(Number(e.target.value))} style={{ flex: 1, minWidth: 60, accentColor: C.ember }} />
          <button onClick={() => onFire(v ? 0 : 1000)} style={btn(!v)}>{v ? "Out" : "Light"}</button>
          <button disabled={!v} onClick={() => onCandle?.("gust")} style={btn(false, !v)} title="A gust now: quick dips and a big swing">Gust</button>
          <button disabled={!v} onClick={() => onCandle?.("sputter")} style={btn(false, !v)} title="A near-blowout now">Sputter</button>
          {readout(v ? `${Math.round(v / 10)}%` : "out")}
        </span>
        {onCandle && onSwing && <SwingFinder lit={!!v} light={() => onFire(1000)} current={c.candle?.swing_chz ?? CANDLE_DEFAULTS.swing_chz} currentKick={c.candle?.kick_ms ?? CANDLE_DEFAULTS.kick_ms} onCandle={onCandle} onSwing={onSwing} />}
      </span>
    );

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

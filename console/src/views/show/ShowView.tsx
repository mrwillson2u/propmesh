// Cues on real boards: sequences (timed steps on any node's outputs),
// triggers (a sensor fires a sequence, with a cooldown), arming, and a
// live log of what the mesh did. Everything is stored on the nodes;
// this view reads it all in, and Save writes each node its own part.
// docs/generic-boards.md §"Sequences and triggers".
import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { ColorPicker, Spinner, Toggle, mono, sys } from "../../ui";
import { FUNCTIONS, type ChannelKindName } from "../../lib/boards_gen";
import { armAll, useConnection, type Activity, type Connection } from "../../lib/connection";
import { target } from "../../lib/transport";
import { isColor } from "../../lib/nodeConfig";
import { FLOODS, FLOODS_NAME } from "../../lib/floods";
import Timeline, { type Output } from "./Timeline";
import {
  EASE_PRESETS, canRamp, newUid, sameSequence, sortSteps, deleteSequence, lengthMs, loadShow, nextSequenceId, saveRules, saveSequence,
  type Rule, type Sequence, type Show, type Step,
} from "../../lib/show";

const btn = (primary = false, disabled = false): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1, flex: "none",
  background: primary ? C.emberBg : C.raised,
  border: `1px solid ${primary ? C.ember : C.b3}`,
  ...sys(600, 11.5, primary ? C.emberT : C.t2),
});
const field: React.CSSProperties = {
  height: 28, padding: "0 8px", background: C.card, border: `1px solid ${C.b2}`,
  borderRadius: 5, outline: "none", ...sys(500, 12, C.t1),
};
// Step table columns. The table keeps a minimum width and scrolls
// sideways in a narrow window rather than squashing the value slider.
const STEP_COLS = "72px 140px 180px minmax(160px,1fr) 380px 56px 24px";
const STEP_MIN_W = 1020;
const label = { font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5 } as const;
const secs = (ms: number) => (ms / 1000).toFixed(ms % 1000 ? (ms % 100 ? 2 : 1) : 0);
// Kinds whose step slider drives the real output while you drag it.
// Relays and motors are left to the Test button: a fogger clicking on
// or a motor spinning as a slider moves would be a surprise.
const LIVE_KINDS: ChannelKindName[] = ["SERVO", "LED", "LED_STRIP", "BLE_LIGHT"];

const clock = (t: number) => new Date(t).toTimeString().slice(0, 8);

export default function ShowView({ onConnect }: { onConnect: () => void }) {
  const conn = useConnection();
  if (!conn) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}>
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <div style={sys(700, 15, C.t1)}>No mesh connected</div>
          <div style={{ ...sys(400, 12.5, C.t3), marginTop: 8, lineHeight: 1.55 }}>
            Sequences and triggers are stored on the boards. Connect your bridge in Nodes &amp; Channels to read and edit them.
          </div>
          <button onClick={onConnect} style={{ ...btn(true), marginTop: 16 }}>Go to Nodes &amp; Channels</button>
        </div>
      </div>
    );
  }
  return <Editor conn={conn} />;
}

function Editor({ conn }: { conn: Connection }) {
  const [show, setShow] = useState<Show | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [draft, setDraft] = useState<Sequence | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [live, setLive] = useState(true);
  const [selStep, setSelStep] = useState<number | null>(null); // step uid selected in both views
  const [opened, setOpened] = useState(0); // bumps per sequence opened: remounts the timeline
  // Every edit leaves the steps in time order — except while the AT box
  // is being typed in (the row would jump mid-keystroke); it sorts on blur.
  const setSorted = (s: Sequence) => setDraft(sortSteps(s));
  const [playingFrom, setPlayingFrom] = useState<number | null>(null);

  // Send a value to a real output, coalesced per output: one request in
  // flight, and only the newest value queued behind it — so dragging a
  // slider over the mesh tracks without piling up stale moves.
  const inFlight = useRef(new Map<string, boolean>());
  const queued = useRef(new Map<string, Step>());
  // A flood step goes to every sending board (lib/floods.ts).
  const send = (st: Step) => {
    const nodes = st.node === FLOODS ? showRef.current?.floods.senders ?? [] : [st.node];
    for (const node of nodes) sendOne(node, st);
  };
  const sendOne = (node: string, st: Step) => {
    const key = `${node}/${st.kind}_${st.index}`;
    if (inFlight.current.get(key)) { queued.current.set(key, st); return; }
    const en = conn.entries[node];
    if (!en) return;
    inFlight.current.set(key, true);
    target(conn.link, en.usb ? null : en.node).request("set", { kind: st.kind, index: st.index, value: st.value })
      .catch(() => { /* the next move retries */ })
      .finally(() => {
        inFlight.current.set(key, false);
        const next = queued.current.get(key);
        queued.current.delete(key);
        if (next) sendOne(node, next);
      });
  };

  const entries = conn.entries;
  const known = Object.values(entries).filter((e) => e.hello);
  const nameOf = (node: string) => node === FLOODS ? FLOODS_NAME : entries[node]?.hello?.name || node;

  // Loads overlap (one starts each time a board introduces itself);
  // only the newest may land, or an early load that saw fewer boards
  // can finish last and blank the list (seen 2026-10-06).
  const loadGen = useRef(0);
  // The draft as of now, for load(): a reload must never throw away
  // unsaved edits — one landing a moment after "+ New sequence" used to
  // wipe it (2026-10-06).
  const draftRef = useRef<Sequence | null>(null);
  const showRef = useRef<Show | null>(null);
  draftRef.current = draft;
  showRef.current = show;
  const load = async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    setMsg(null);
    try {
      const sh = await loadShow(conn.link, known);
      if (gen !== loadGen.current) return;
      const d = draftRef.current;
      const before = d && showRef.current?.sequences.find((x) => x.id === d.id);
      // Unsaved = not on the boards as it stands. After a save the new
      // load already holds it, so that counts as saved too.
      const onBoards = d && sh.sequences.find((x) => x.id === d.id);
      const unsaved = !!d && !sameSequence(d, before) && !sameSequence(d, onBoards);
      setShow(sh);
      setRules(sh.rules);
      if (!unsaved) {
        const keep = sh.sequences.find((s) => s.id === sel) ?? sh.sequences[0] ?? null;
        setSel(keep?.id ?? null);
        setDraft(keep ? sortSteps(structuredClone(keep)) : null);
      }
      if (sh.unreachable.length) setMsg({ text: `No answer from ${sh.unreachable.map(nameOf).join(", ")} — its part of the show isn't shown.`, bad: true });
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  };
  // Load once the boards have introduced themselves.
  const knownKey = known.map((e) => e.node).sort().join(",");
  useEffect(() => { if (known.length) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [knownKey]);

  const saved = show?.sequences.find((s) => s.id === sel) ?? null;
  const dirty = !!draft && !sameSequence(draft, saved);
  const rulesDirty = JSON.stringify(rules) !== JSON.stringify(show?.rules ?? []);

  const outputs = useMemo(() => {
    const m: Record<string, { kind: ChannelKindName; index: number; label: string }[]> = {};
    for (const [node, cfg] of Object.entries(show?.configs ?? {}))
      m[node] = (cfg.channels ?? []).filter((c) => c.kind !== "DIGITAL_IN").map((c) => ({ kind: c.kind, index: c.index, label: c.label }));
    return m;
  }, [show]);
  const sensors = useMemo(() => {
    const out: { node: string; index: number; label: string }[] = [];
    for (const [node, cfg] of Object.entries(show?.configs ?? {}))
      for (const c of cfg.channels ?? []) if (c.kind === "DIGITAL_IN") out.push({ node, index: c.index, label: c.label });
    return out;
  }, [show]);
  const outNodes = Object.keys(outputs).filter((n) => outputs[n].length);
  const allOutputs: Output[] = outNodes.flatMap((n) => outputs[n].map((o) => ({ node: n, ...o })));

  const armedVals = Object.values(show?.armed ?? {});
  const allArmed = armedVals.length > 0 && armedVals.every(Boolean);
  const noneArmed = armedVals.length > 0 && armedVals.every((a) => !a);
  const armKnown = armedVals.length > 0; // nothing reported yet: don't claim either way

  // ---- actions --------------------------------------------------------------

  const select = (id: number) => {
    const s = show?.sequences.find((x) => x.id === id) ?? null;
    setSel(id);
    setDraft(s ? sortSteps(structuredClone(s)) : null);
    setOpened((n) => n + 1);
    setSelStep(null);
    setConfirmDelete(false);
  };

  const newSequence = () => {
    if (!show) return;
    const id = nextSequenceId(show);
    const firstNode = outNodes[0];
    const first = firstNode ? outputs[firstNode][0] : undefined;
    const seq: Sequence = {
      id, name: `Sequence ${id}`, loadedOn: [], problems: [],
      steps: first ? [{ uid: newUid(), t_ms: 0, node: firstNode, kind: first.kind, index: first.index, value: first.kind === "RELAY" ? 1 : 500 }] : [],
    };
    setSel(id);
    setDraft(seq);
    setOpened((n) => n + 1);
  };

  // Typing a time leaves the row where it is until the field loses focus
  // (onBlur sorts); every other edit re-sorts and re-applies the ramp
  // limits at once.
  const patchStep = (i: number, p: Partial<Step>) =>
    setDraft((d) => {
      if (!d) return d;
      const next = { ...d, steps: d.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) };
      return "t_ms" in p ? next : sortSteps(next);
    });

  const addStep = () => setDraft((d) => d && sortSteps(addStepTo(d)));
  const addStepTo = (d: Sequence): Sequence => {
    const last = d.steps[d.steps.length - 1];
    const node = last?.node ?? outNodes[0];
    const ch = last ? { kind: last.kind, index: last.index } : outputs[node]?.[0];
    if (!node || !ch) return d;
    return { ...d, steps: [...d.steps, { uid: newUid(), t_ms: (last?.t_ms ?? 0) + 500, node, kind: ch.kind, index: ch.index, value: last?.value ?? 500 }] };
  };

  const saveSeq = async () => {
    if (!draft) return;
    setBusy("save");
    setMsg(null);
    const steps = [...draft.steps].sort((a, b) => a.t_ms - b.t_ms);
    const r = await saveSequence(conn.link, entries, { ...draft, steps }, show?.floods.senders ?? []);
    setBusy(null);
    if (r.failed.length) {
      setMsg({ text: `Not saved on ${r.failed.map((f) => `${nameOf(f.node)} (${f.error})`).join("; ")}`, bad: true });
      return;
    }
    setMsg({ text: `Saved “${draft.name}” to ${new Set(steps.map((s) => s.node)).size} board(s).` });
    await load();
  };

  const play = async () => {
    if (!sel) return;
    setBusy("play");
    try {
      const r = await conn.link.request("cue", { seq: sel });
      if (!r.ok) setMsg({ text: `Couldn't play: ${r.error}`, bad: true });
      else setPlayingFrom(Date.now() + 200); // the cue's lead time — the playhead then tracks the boards
    } finally {
      setBusy(null);
    }
  };

  const del = async () => {
    if (!draft) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy("delete");
    const r = await deleteSequence(conn.link, entries, draft);
    setBusy(null);
    setConfirmDelete(false);
    if (r.failed.length) setMsg({ text: `Still on ${r.failed.map((f) => nameOf(f.node)).join(", ")} — try again`, bad: true });
    setSel(null);
    await load();
  };

  const saveTriggers = async () => {
    setBusy("rules");
    setMsg(null);
    const r = await saveRules(conn.link, entries, rules, show?.rules ?? []);
    setBusy(null);
    if (r.failed.length) setMsg({ text: `Triggers not saved on ${r.failed.map((f) => `${nameOf(f.node)} (${f.error})`).join("; ")}`, bad: true });
    else setMsg({ text: "Triggers saved." });
    await load();
  };

  const arm = async (on: boolean) => {
    setBusy("arm");
    const failed = await armAll(on);
    setBusy(null);
    if (failed.length) setMsg({ text: `No confirmation from ${failed.map(nameOf).join(", ")}`, bad: true });
    await load();
  };

  const testStep = (st: Step) => send(st);

  // ---- render ---------------------------------------------------------------

  const seqName = (id: number) => show?.sequences.find((s) => s.id === id)?.name ?? (draft?.id === id ? draft.name : `#${id}`);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: C.bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: C.panel, borderBottom: `1px solid ${C.b1}`, flexWrap: "wrap" }}>
        <span style={sys(700, 13, C.t1)}>Cues</span>
        <span style={{
          padding: "3px 9px", borderRadius: 4, letterSpacing: ".06em",
          ...(!armKnown ? { background: C.raised, border: `1px solid ${C.b3}`, ...mono(700, 10.5, C.t4) }
            : allArmed ? { background: C.greenBg, border: `1px solid ${C.greenB}`, ...mono(700, 10.5, C.green) }
            : noneArmed ? { background: C.redBg, border: `1px solid ${C.redB}`, ...mono(700, 10.5, C.red) }
            : { background: C.amberBg, border: `1px solid ${C.amberB}`, ...mono(700, 10.5, C.amber) }),
        }}>{!armKnown ? "…" : allArmed ? "ARMED" : noneArmed ? "DISARMED" : "PARTLY ARMED"}</span>
        <span style={sys(400, 11.5, C.t4)}>
          {!armKnown ? "" : allArmed ? "Sensors fire their sequences." : "Triggers and cues are ignored on disarmed boards."}
        </span>
        <div style={{ flex: 1 }} />
        {msg && <span style={mono(500, 11, msg.bad ? C.red : C.green)}>{msg.text}</span>}
        {(loading || busy) && <Spinner />}
        <button onClick={() => void load()} disabled={loading} style={btn(false, loading)}>Reload from boards</button>
        {allArmed
          ? <button onClick={() => void arm(false)} style={btn()}>Disarm all</button>
          : <button onClick={() => void arm(true)} style={btn(true)}>Arm all</button>}
      </div>

      {!show && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: 16, ...mono(500, 11.5, C.t4) }}>
          <Spinner /> {known.length ? "Reading sequences and triggers from every board…" : "Waiting for the boards to report in…"}
        </div>
      )}

      {show && (
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* sequences */}
          <div style={{ width: 230, flex: "none", borderRight: `1px solid ${C.b1}`, background: C.panel, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ ...label, padding: "12px 14px 6px" }}>SEQUENCES</div>
            {show.sequences.length === 0 && !draft && <div style={{ padding: "4px 14px", ...sys(400, 11.5, C.t4) }}>None yet.</div>}
            {[...show.sequences, ...(draft && !show.sequences.some((s) => s.id === draft.id) ? [draft] : [])].map((s) => {
              const on = s.id === sel;
              const nodes = new Set(s.steps.map((x) => x.node)).size;
              return (
                <div key={s.id} onClick={() => select(s.id)} style={{
                  padding: "8px 14px", cursor: "pointer", borderLeft: `3px solid ${on ? C.ember : "transparent"}`,
                  background: on ? C.emberBg2 : undefined,
                }}>
                  <div style={sys(600, 12.5, on ? C.emberT : C.t1)}>{on && draft ? draft.name || "(unnamed)" : s.name || "(unnamed)"}</div>
                  <div style={mono(500, 10.5, s.problems.length ? C.amber : C.t5)}>
                    {s.steps.length} steps · {secs(lengthMs(s))} s · {nodes} board{nodes === 1 ? "" : "s"}{s.problems.length ? " · ⚠" : ""}
                    {!show.sequences.some((x) => x.id === s.id) ? " · not saved" : ""}
                  </div>
                </div>
              );
            })}
            <div style={{ padding: "10px 14px" }}>
              <button onClick={newSequence} disabled={!outNodes.length} style={{ ...btn(false, !outNodes.length), width: "100%" }}
                title={outNodes.length ? "" : "No board has an output yet — assign pins in Nodes & Channels"}>+ New sequence</button>
            </div>
          </div>

          {/* editor + triggers */}
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
            {draft ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <input value={draft.name} maxLength={23} placeholder="Name this sequence"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...field, width: 230, ...sys(700, 13, C.t1) }} />
                  <span style={mono(500, 11, C.t5)}>#{draft.id} · {secs(lengthMs(draft))} s</span>
                  <label title="Dragging a servo, LED or strip value moves the real output, so you can see what you're setting. Relays and motors only change with Test."
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", ...sys(600, 11.5, live ? C.emberT : C.t4) }}>
                    <Toggle small on={live} onClick={() => setLive(!live)} /> Live preview
                  </label>
                  <div style={{ flex: 1 }} />
                  {dirty && <span style={mono(600, 11, C.amber)}>unsaved</span>}
                  <button onClick={() => select(draft.id)} disabled={!dirty || !!busy} style={btn(false, !dirty || !!busy)}>Revert</button>
                  <button onClick={() => void saveSeq()} disabled={!dirty || !!busy} style={btn(true, !dirty || !!busy)}>Save to boards</button>
                  <button onClick={() => void play()} disabled={dirty || !saved || !!busy || !allArmed}
                    title={dirty ? "Save first" : !allArmed ? "Arm the show first" : "Play on every board now"}
                    style={btn(false, dirty || !saved || !!busy || !allArmed)}>▶ Play</button>
                  <button onClick={() => void del()} disabled={!!busy}
                    style={{ ...btn(false, !!busy), ...(confirmDelete ? { background: C.redBg, border: `1px solid ${C.red}`, color: C.red } : {}) }}>
                    {confirmDelete ? "Really delete?" : "Delete"}
                  </button>
                </div>
                {draft.problems.map((p) => <div key={p} style={{ ...mono(500, 11, C.amber), marginTop: 6 }}>⚠ {p}</div>)}

                <div style={{ marginTop: 12 }}>
                  <Timeline key={opened} seq={draft} onChange={setSorted} selected={selStep} onSelect={setSelStep}
                    nameOf={nameOf} outputs={allOutputs} live={live} onLive={send} playingFrom={playingFrom} />
                </div>

                <div style={{ overflowX: "auto" }}><div style={{ minWidth: STEP_MIN_W }}>
                <div style={{ display: "grid", gridTemplateColumns: STEP_COLS, gap: 8, alignItems: "center", marginTop: 12, ...label }}>
                  <span>AT (s)</span><span>BOARD</span><span>OUTPUT</span><span>VALUE</span><span title="How long the output takes to get there — a ramp from where it was. 0 = jump at AT.">GET THERE OVER</span><span /><span />
                </div>
                {draft.steps.map((st, i) => {
                  const outs = outputs[st.node] ?? [];
                  const exists = outs.some((o) => o.kind === st.kind && o.index === st.index);
                  const on = selStep !== null && st.uid === selStep;
                  return (
                    <div key={st.uid ?? i} onClick={() => setSelStep(st.uid ?? null)}
                      style={{ display: "grid", gridTemplateColumns: STEP_COLS, gap: 8, alignItems: "center", padding: "5px 0 5px 6px", borderBottom: "1px solid #181c22", borderLeft: `3px solid ${on ? C.ember : "transparent"}`, background: on ? C.emberBg2 : undefined }}>
                      <input type="number" min={0} step={0.1} value={st.t_ms / 1000}
                        onChange={(e) => patchStep(i, { t_ms: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 1000)) })}
                        onBlur={() => setDraft((d) => d && sortSteps(d))}
                        style={{ ...field, ...mono(500, 12, C.t1) }} />
                      <select value={st.node} style={field} onChange={(e) => {
                        const o = outputs[e.target.value]?.[0];
                        if (o) patchStep(i, { node: e.target.value, kind: o.kind, index: o.index });
                      }}>
                        {outNodes.map((n) => <option key={n} value={n}>{nameOf(n)}</option>)}
                        {!outNodes.includes(st.node) && <option value={st.node}>{nameOf(st.node)} (gone)</option>}
                      </select>
                      <select value={`${st.kind}_${st.index}`} style={{ ...field, color: exists ? C.t1 : C.amber }} onChange={(e) => {
                        const o = outs.find((x) => `${x.kind}_${x.index}` === e.target.value);
                        if (o) patchStep(i, { kind: o.kind, index: o.index, value: o.kind === st.kind ? st.value : o.kind === "RELAY" ? 1 : 500 });
                      }}>
                        {outs.map((o) => <option key={`${o.kind}_${o.index}`} value={`${o.kind}_${o.index}`}>{o.kind}_{o.index}{o.label ? ` · ${o.label}` : ""}</option>)}
                        {!exists && <option value={`${st.kind}_${st.index}`}>{st.kind}_{st.index} (not on this board)</option>}
                      </select>
                      <ValueInput kind={st.kind} value={st.value} onChange={(v) => {
                        patchStep(i, { value: v });
                        if (live && LIVE_KINDS.includes(st.kind)) send({ ...st, value: v });
                      }} />
                      {canRamp(st.kind) ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input type="number" min={0} step={0.1} value={(st.dur_ms ?? 0) / 1000}
                            title="Seconds. 0 = jump. The ramp ends at AT, so it can't be longer than AT."
                            onChange={(e) => patchStep(i, { dur_ms: Math.min(st.t_ms, Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 1000))) })}
                            style={{ ...field, width: 54, ...mono(500, 12, (st.dur_ms ?? 0) > 0 ? C.t1 : C.t5) }} />
                          <span style={sys(500, 11, C.t5)}>s</span>
                          <EaseInput step={st} onChange={(p) => patchStep(i, p)} />
                        </span>
                      ) : <span style={sys(400, 11, C.t6)}>—</span>}
                      <button onClick={() => testStep(st)} title="Send this value to the board now" style={{ ...btn(), height: 26, padding: "0 8px" }}>Test</button>
                      <span onClick={(e) => { e.stopPropagation(); setSelStep(null); setDraft({ ...draft, steps: draft.steps.filter((x) => x.uid !== st.uid) }); }}
                        title="Remove step" style={{ color: C.t5, cursor: "pointer", textAlign: "center" }}>✕</span>
                    </div>
                  );
                })}
                </div></div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button onClick={addStep} disabled={!outNodes.length} style={btn(false, !outNodes.length)}>+ Add step</button>

                </div>
                <div style={{ ...sys(400, 11, C.t5), marginTop: 8, lineHeight: 1.5 }}>
                  Each step says what an output should be at a time after the sequence starts. With <b>get there over</b> set,
                  a servo, LED or motor ramps to it from wherever it was, ending at that time; at 0 it jumps (servos then glide
                  with their smoothing setting). Two steps at the same time happen together, on every board, on the mesh clock.
                </div>
              </div>
            ) : (
              <div style={sys(400, 12.5, C.t3)}>Pick a sequence, or create one.</div>
            )}

            {/* triggers */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={label}>TRIGGERS</span>
                <span style={sys(400, 11, C.t5)}>stored on the sensor's board — they work with no laptop attached</span>
                <div style={{ flex: 1 }} />
                {rulesDirty && <span style={mono(600, 11, C.amber)}>unsaved</span>}
                <button onClick={() => setRules(show.rules)} disabled={!rulesDirty || !!busy} style={btn(false, !rulesDirty || !!busy)}>Revert</button>
                <button onClick={() => void saveTriggers()} disabled={!rulesDirty || !!busy} style={btn(true, !rulesDirty || !!busy)}>Save triggers</button>
              </div>
              {sensors.length === 0 && (
                <div style={{ ...sys(400, 12, C.t4), marginTop: 8 }}>
                  No sensor inputs yet. Assign a pin to <b>Sensor / button input</b> in Nodes &amp; Channels — a PIR on VP/VN/D34/D35 is a good start.
                </div>
              )}
              {rules.map((r, i) => {
                const set = (p: Partial<Rule>) => setRules(rules.map((x, j) => (j === i ? { ...x, ...p } : x)));
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 0", borderBottom: "1px solid #181c22", opacity: r.enabled ? 1 : 0.55 }}>
                    <Toggle small on={r.enabled} onClick={() => set({ enabled: !r.enabled })} />
                    <span style={sys(500, 12, C.t3)}>When</span>
                    <select value={`${r.node}|${r.input}`} style={field} onChange={(e) => {
                      const [node, input] = e.target.value.split("|");
                      set({ node, input: Number(input) });
                    }}>
                      {sensors.map((s) => <option key={`${s.node}|${s.index}`} value={`${s.node}|${s.index}`}>{nameOf(s.node)} · DIGITAL_IN_{s.index}{s.label ? ` (${s.label})` : ""}</option>)}
                    </select>
                    <select value={r.on} style={field} onChange={(e) => set({ on: e.target.value as Rule["on"] })}>
                      <option value="active">becomes active</option>
                      <option value="clear">becomes clear</option>
                    </select>
                    <span style={sys(500, 12, C.t3)}>play</span>
                    <select value={r.seq} style={{ ...field, color: show.sequences.some((s) => s.id === r.seq) ? C.t1 : C.amber }}
                      onChange={(e) => set({ seq: Number(e.target.value) })}>
                      {show.sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      {!show.sequences.some((s) => s.id === r.seq) && <option value={r.seq}>#{r.seq} (missing)</option>}
                    </select>
                    <span style={sys(500, 12, C.t3)}>then wait</span>
                    <input type="number" min={0} step={1} value={r.cooldown_ms / 1000}
                      onChange={(e) => set({ cooldown_ms: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 1000)) })}
                      style={{ ...field, width: 64, ...mono(500, 12, C.t1) }} />
                    <span style={sys(500, 12, C.t3)}>s before it can fire again</span>
                    <span onClick={() => setRules(rules.filter((_, j) => j !== i))} title="Remove trigger" style={{ color: C.t5, cursor: "pointer", marginLeft: 4 }}>✕</span>
                  </div>
                );
              })}
              {sensors.length > 0 && (
                <button onClick={() => setRules([...rules, { node: sensors[0].node, input: sensors[0].index, on: "active", seq: show.sequences[0]?.id ?? 0, cooldown_ms: 30000, enabled: true }])}
                  disabled={!show.sequences.length} title={show.sequences.length ? "" : "Save a sequence first"}
                  style={{ ...btn(false, !show.sequences.length), marginTop: 8 }}>+ Add trigger</button>
              )}
            </div>
          </div>

          {/* activity */}
          <div style={{ width: 250, flex: "none", borderLeft: `1px solid ${C.b1}`, background: C.panel, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ ...label, padding: "12px 14px 6px" }}>ACTIVITY</div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
              {conn.activity.length === 0 && <div style={sys(400, 11.5, C.t5)}>Sensor changes and cues appear here as they happen.</div>}
              {conn.activity.map((a, i) => <ActivityRow key={i} a={a} nameOf={nameOf} seqName={seqName} show={show} />)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityRow({ a, nameOf, seqName, show }: {
  a: Activity; nameOf: (n: string) => string; seqName: (id: number) => string; show: Show;
}) {
  if (a.kind === "input") {
    const lbl = show.configs[a.node]?.channels?.find((c) => c.kind === "DIGITAL_IN" && c.index === a.index)?.label;
    return (
      <div style={mono(500, 11, a.value ? C.t2 : C.t4)}>
        <span style={{ color: C.t5 }}>{clock(a.at)}</span> {a.value ? "●" : "○"} {nameOf(a.node)} · {lbl || `IN_${a.index}`} {a.value ? "active" : "clear"}
      </div>
    );
  }
  return (
    <div style={mono(600, 11, a.armed === false ? C.amber : C.emberT)}>
      <span style={{ color: C.t5, fontWeight: 500 }}>{clock(a.at)}</span> ▶ {seqName(a.seq ?? 0)} — fired by {nameOf(a.node)}
      {a.armed === false && <span> (bridge disarmed)</span>}
    </div>
  );
}

// Ease amounts for a ramp: a preset, or drag the two handles of the
// bar. Left handle = how far into the move it stops speeding up (ease
// in %), right handle = where it starts slowing down (100 - ease out %).
// The shaded ends are the easing, the middle is steady speed. The
// handles can't cross, and moving one never moves the other — two
// linked number boxes did, and fought the user (2026-10-06).
const BAR_W = 112;

function EaseInput({ step, onChange }: { step: Step; onChange: (p: Partial<Step>) => void }) {
  const on = (step.dur_ms ?? 0) > 0;
  const ein = step.ease_in ?? 50, eout = step.ease_out ?? 50;
  const preset = EASE_PRESETS.find((p) => p.in === ein && p.out === eout);
  const bar = useRef<HTMLDivElement>(null);
  // "pick": the handles were on top of each other (e.g. the 50/50
  // default) — the first movement decides: left takes the in handle,
  // right the out handle. Otherwise one handle would be unreachable.
  const [drag, setDrag] = useState<{ which: "in" | "out" | "pick"; x0: number } | null>(null);

  const pctAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(100, Math.round(((clientX - r.left) / r.width) * 100 / 5) * 5));
  };
  const move = (clientX: number, which: "in" | "out") => {
    const p = pctAt(clientX);
    if (which === "in") onChange({ ease_in: Math.min(p, 100 - eout) });
    else onChange({ ease_out: Math.min(100 - p, 100 - ein) });
  };
  const grab = (which: "in" | "out") => (e: React.PointerEvent) => {
    if (!on) return;
    e.stopPropagation();
    e.preventDefault();
    try { bar.current!.setPointerCapture(e.pointerId); } catch { /* fine */ }
    setDrag({ which: ein === 100 - eout ? "pick" : which, x0: e.clientX });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    let which = drag.which;
    if (which === "pick") {
      if (Math.abs(e.clientX - drag.x0) < 2) return;
      which = e.clientX < drag.x0 ? "in" : "out";
      setDrag({ which, x0: drag.x0 });
    }
    move(e.clientX, which);
  };
  const handle = (x: number, which: "in" | "out"): React.CSSProperties => ({
    position: "absolute", top: -3, left: `calc(${x}% - 5px)`, width: 10, height: 18, borderRadius: 3,
    background: drag?.which === which ? C.emberT : C.t2, border: `1px solid ${C.bg}`, cursor: on ? "ew-resize" : "default",
    touchAction: "none",
  });

  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, opacity: on ? 1 : 0.4 }}
      title="Drag the handles: the shaded ends are speeding up (left) and slowing down (right); the middle is steady speed.">
      <select value={preset?.id ?? "custom"} disabled={!on} style={{ ...field, width: 100 }}
        onChange={(e) => { const p = EASE_PRESETS.find((x) => x.id === e.target.value); if (p) onChange({ ease_in: p.in, ease_out: p.out }); }}>
        {EASE_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        {!preset && <option value="custom">custom</option>}
      </select>
      <div ref={bar}
        onPointerMove={onMove}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        style={{ position: "relative", width: BAR_W, height: 12, borderRadius: 3, background: C.raised, border: `1px solid ${C.b3}`, flex: "none" }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${ein}%`, background: C.emberB, borderRadius: "3px 0 0 3px" }} />
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${eout}%`, background: C.emberB, borderRadius: "0 3px 3px 0" }} />
        <div onPointerDown={grab("in")} style={handle(ein, "in")} />
        <div onPointerDown={grab("out")} style={handle(100 - eout, "out")} />
      </div>
      <span style={{ ...mono(500, 10.5, C.t4), width: 62, flex: "none" }}>{ein} / {eout} %</span>
    </span>
  );
}

function ValueInput({ kind, value, onChange }: { kind: ChannelKindName; value: number; onChange: (v: number) => void }) {
  const f = FUNCTIONS[kind];
  if (kind === "RELAY")
    return (
      <select value={value ? 1 : 0} onChange={(e) => onChange(Number(e.target.value))} style={{ ...field, width: 90 }}>
        <option value={1}>on</option>
        <option value={0}>off</option>
      </select>
    );
  if (isColor(kind))
    return (
      <span style={{ display: "flex", alignItems: "center", flex: 1, minWidth: 0, gap: 8 }}>
        <ColorPicker value={value} onChange={onChange} white={kind === "BLE_LIGHT"} />
        {value === 0 && <span style={{ ...mono(500, 11, C.t4), flex: "none" }}>off</span>}
      </span>
    );
  const pct = Math.round(value / 10);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
      <input type="range" min={f.min} max={f.max} step={10} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 60, accentColor: C.ember }} />
      <span style={{ ...mono(600, 11, C.t3), width: 44, textAlign: "right" }}>{kind === "MOTOR" && pct > 0 ? "+" : ""}{pct}%</span>
    </span>
  );
}

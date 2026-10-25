// Two sections over one store of what the boards hold (software-plan
// "Console sections", 2026-10-12):
//   Sequences — orchestrate predefined sequences of outputs: the Timeline
//              editor, step list, Play / test.
//   Show      — wire triggers and logic into a show: the trigger list (the
//              row view of the Show Graph), the schedule, the mode, and the
//              live log of what the mesh did.
// Everything is stored on the nodes; both sections read it all in, and
// Save writes each node its own part. docs/generic-boards.md §6b.
import { useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { LandscapeHint, useLayout } from "../../lib/layout";
import { ColorPicker, Spinner, Toggle, mono, sys, NumberInput, Hint } from "../../ui";
import { FUNCTIONS, type ChannelKindName } from "../../lib/boards_gen";
import { setModeAll, useConnection, type Activity, type Connection, type Entry, isReachable, isMissing } from "../../lib/connection";
import { MODES, MODE_HELP, MODE_LABEL, hhmm, type Mode, type ModeStatus } from "../../lib/schedule";
import SchedulePanel, { MODE_COLOR } from "./SchedulePanel";
import { target } from "../../lib/transport";
import { isColor } from "../../lib/nodeConfig";
import { FLOODS, FLOODS_NAME } from "../../lib/floods";
import Timeline, { type Output } from "./Timeline";
import GraphEditor from "./GraphEditor";
import {
  EASE_PRESETS, RULE_MAX_SEQS, canRamp, newUid, sameSequence, sortSteps, deleteSequence, lengthMs, loadShow, nextSequenceId, saveRules, saveSequence,
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
const LIVE_KINDS: ChannelKindName[] = ["SERVO", "LED", "CANDLE", "LED_STRIP", "SPI_STRIP", "BLE_LIGHT"];

const clock = (t: number) => new Date(t).toTimeString().slice(0, 8);

export type Section = "sequences" | "show";

export default function ShowView({ section, onConnect }: { section: Section; onConnect: () => void }) {
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
  return <Editor conn={conn} section={section} />;
}

function Editor({ conn, section }: { conn: Connection; section: Section }) {
  const { phone } = useLayout();
  const seqSection = section === "sequences";
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
  const [schedOpen, setSchedOpen] = useState(false);
  // The Show's triggers as a graph (the editor) or as rows (the same
  // rules, one sentence each). Remembered per browser.
  const [graphView, setGraphViewState] = useState(() => { try { return localStorage.getItem("propmesh.show.graph") !== "0"; } catch { return true; } });
  const setGraphView = (g: boolean) => { setGraphViewState(g); try { localStorage.setItem("propmesh.show.graph", g ? "1" : "0"); } catch { /* private mode */ } };

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
    // preview: posing a sequence step, not setting how the yard should be —
    // the board won't bring it back when the show returns from off.
    target(conn.link, en.usb ? null : en.node).request("set", { kind: st.kind, index: st.index, value: st.value, preview: true })
      .catch(() => { /* the next move retries */ })
      .finally(() => {
        inFlight.current.set(key, false);
        const next = queued.current.get(key);
        queued.current.delete(key);
        if (next) sendOne(node, next);
      });
  };

  const entries = conn.entries;
  const known = Object.values(entries).filter(isReachable);
  const nameOf = (node: string) => node === FLOODS ? FLOODS_NAME : entries[node]?.hello?.name || node;
  // Through a bridge, a board that's away still gets every edit: the bridge
  // keeps a copy and the board pulls it when it's back (docs §6k).
  const viaBridge = !!conn.hello.bridge;
  const names = (ns: string[]) => ns.map(nameOf).join(", ");
  const awayText = (ns: string[]) =>
    `${names(ns)} didn't answer (asleep, or out of range) — the bridge holds the edit and ${ns.length === 1 ? "it picks" : "they pick"} it up by ${ns.length === 1 ? "itself" : "themselves"} when next awake; this page updates when ${ns.length === 1 ? "it has" : "they have"}.`;
  // Every board's hello (re-asked every 15 s by lib/connection) carries
  // show_synced: the newest edit it holds. When any board's stamp moves —
  // it pulled a part from the bridge after being away — the show is read
  // again, so a board catching up shows up here with nobody pressing
  // anything (Colin, 2026-10-24). The bridge's own stamp is the newest edit
  // it holds for anyone, so a heard board below it is still catching up.
  const stampOf = (e: Entry) => e.hello?.sync?.show_synced ?? 0;
  const syncKey = known.map((e) => `${e.node}:${stampOf(e)}`).sort().join(",");
  const bridgeStamp = Math.max(0, ...Object.values(entries).filter((e) => e.usb).map(stampOf));
  const catchingUp = (n: string) => { const e = entries[n]; return !!e && !isMissing(e) && !e.remembered && stampOf(e) < bridgeStamp; };

  // Loads overlap (one starts each time a board introduces itself);
  // only the newest may land, or an early load that saw fewer boards
  // can finish last and blank the list (seen 2026-10-06).
  const loadGen = useRef(0);
  // The draft as of now, for load(): a reload must never throw away
  // unsaved edits — one landing a moment after "+ New sequence" used to
  // wipe it (2026-10-06).
  const draftRef = useRef<Sequence | null>(null);
  const showRef = useRef<Show | null>(null);
  const msgRef = useRef<typeof msg>(null);
  const rulesRef = useRef<Rule[]>([]);
  draftRef.current = draft;
  showRef.current = show;
  msgRef.current = msg;
  rulesRef.current = rules;
  // A message a load itself wrote (boards away, unreachable) is replaced
  // by the next load; one a save or play wrote stays — the reload that
  // follows every save used to wipe "Saved …" the moment it appeared.
  const msgFromLoad = useRef(false);
  const loadMsg = (m: typeof msg) => { msgFromLoad.current = true; setMsg(m); };
  const load = async () => {
    const gen = ++loadGen.current;
    setLoading(true);
    if (msgFromLoad.current) { msgFromLoad.current = false; setMsg(null); }
    try {
      const sh = await loadShow(conn.link, known, showRef.current, viaBridge);
      if (gen !== loadGen.current) return;
      const d = draftRef.current;
      const before = d && showRef.current?.sequences.find((x) => x.id === d.id);
      // Unsaved = not on the boards as it stands. After a save the new
      // load already holds it, so that counts as saved too.
      const onBoards = d && sh.sequences.find((x) => x.id === d.id);
      const unsaved = !!d && !sameSequence(d, before) && !sameSequence(d, onBoards);
      // Boards that held a sequence only as the bridge's copy last time and
      // hold it themselves now: they picked it up.
      const caught = new Set<string>();
      for (const was of showRef.current?.sequences ?? []) {
        const now = sh.sequences.find((x) => x.id === was.id);
        for (const n of was.unconfirmed) if (now && now.loadedOn.includes(n) && !now.unconfirmed.includes(n)) caught.add(n);
      }
      if (caught.size) setMsg({ text: `${names([...caught])} picked up the saved show.` });
      setShow(sh);
      // Unsaved trigger edits (rows or graph) survive a reload, like an
      // unsaved sequence does — a mode change or a board catching up used
      // to wipe a half-built chain (2026-10-12).
      const rulesUnsaved = JSON.stringify(rulesRef.current) !== JSON.stringify(showRef.current?.rules ?? []);
      if (!rulesUnsaved) setRules(sh.rules);
      if (!unsaved) {
        const keep = sh.sequences.find((s) => s.id === sel) ?? sh.sequences[0] ?? null;
        setSel(keep?.id ?? null);
        setDraft(keep ? sortSteps(structuredClone(keep)) : null);
      }
      if (sh.unreachable.length) loadMsg({ text: `${names(sh.unreachable)} didn't answer (asleep, or out of range) — ${sh.unreachable.length === 1 ? "its" : "their"} part of the show isn't shown; it reloads when ${sh.unreachable.length === 1 ? "it's" : "they're"} heard again.`, bad: true });
      // A board away but covered by the bridge: say so only when nothing
      // more specific (a save's own message) is already showing.
      else if (sh.fromBridge.length && !msgRef.current) loadMsg({ text: `${names(sh.fromBridge)} ${sh.fromBridge.length === 1 ? "is" : "are"} asleep or out of range — showing the bridge's copy of ${sh.fromBridge.length === 1 ? "its" : "their"} part; it reloads when ${sh.fromBridge.length === 1 ? "it's" : "they're"} heard again.` });
      else if (sh.fromLast.length && !msgRef.current) loadMsg({ text: `${names(sh.fromLast)} ${sh.fromLast.length === 1 ? "is" : "are"} asleep or out of range — showing ${sh.fromLast.length === 1 ? "its" : "their"} part as last read; it reloads when ${sh.fromLast.length === 1 ? "it's" : "they're"} heard again.` });
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  };
  // Load once the boards have introduced themselves, and again whenever
  // the set of boards actually heard changes — a board that was asleep
  // or out of range for the last load is asked when it is back, so its
  // pins come into the pickers and its part of a sequence is confirmed
  // (before, nothing reloaded and a board stayed "not on this board"
  // for good — Colin, 2026-10-24).
  const knownKey = known.map((e) => e.node).sort().join(",");
  const heardKey = known.filter((e) => !isMissing(e)).map((e) => e.node).sort().join(",");
  useEffect(() => { if (known.length) void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [knownKey, heardKey, syncKey]);

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

  // Every board decides its own mode from the shared schedule; they
  // normally agree. The USB board's status speaks for the reason and the
  // next change (it heard the same clock).
  // Live first: hellos are re-asked every 15 s (lib/connection), so a
  // scheduled switch at 21:30 shows without a reload; the load's copy
  // covers boards whose hello hasn't come round yet.
  const liveModes: Record<string, ModeStatus> = { ...(show?.modes ?? {}) };
  for (const en of Object.values(entries)) {
    const h = en.hello;
    if (h?.mode) liveModes[en.node] = h as unknown as ModeStatus;
    else if (typeof h?.armed === "boolean")  // firmware before 2026-10-09: armed / disarmed by hand
      liveModes[en.node] = { mode: h.armed ? "armed" : "off", reason: h.armed ? "old firmware" : "manual", clock: false, scheduled: false };
  }
  // A board not heard now (asleep, away) keeps a stale mode in its last
  // hello: it must not make the show look mixed, nor block Play.
  for (const en of Object.values(entries)) if (isMissing(en) || en.remembered) delete liveModes[en.node];
  const modeVals = Object.values(liveModes);
  const modeKnown = modeVals.length > 0; // nothing reported yet: don't claim either way
  const oneMode: Mode | null = modeKnown && modeVals.every((m) => m.mode === modeVals[0].mode) ? modeVals[0].mode : null;
  const offBoards = Object.entries(liveModes).filter(([, m]) => m.mode === "off").map(([n]) => n);
  const usbNode = Object.values(entries).find((e) => e.usb)?.node;
  const lead: ModeStatus | undefined = (usbNode && liveModes[usbNode]) || modeVals[0];
  // Play sends one cue through the connected board; it refuses only when
  // that board is off. Other boards that are off just don't play.
  const bridgeOff = !!lead && lead.mode === "off";
  const noClock = modeVals.filter((m) => m.scheduled && !m.clock).length;

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
    // Blank: the Timeline offers "Add first track…" (a guessed first
    // output — whatever happened to be first on the first board — was
    // always the wrong one, 2026-10-12).
    const seq: Sequence = { id, name: `Sequence ${id}`, loadedOn: [], unconfirmed: [], problems: [], steps: [] };
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
    const r = await saveSequence(conn.link, entries, { ...draft, steps }, show?.floods.senders ?? [], viaBridge);
    setBusy(null);
    if (r.failed.length) {
      setMsg({ text: `Not saved on ${r.failed.map((f) => `${nameOf(f.node)} (${f.error})`).join("; ")}`, bad: true });
      return;
    }
    if (r.queued.length) {
      const got = [...new Set(steps.map((s) => s.node))].filter((n) => !r.queued.includes(n) && n !== FLOODS);
      setMsg({ text: `Saved “${draft.name}”${got.length ? ` on ${names(got)}` : ""}. ${awayText(r.queued)}` });
    } else setMsg({ text: `Saved “${draft.name}” to ${new Set(steps.map((s) => s.node)).size} board(s).` });
    await load();
  };

  const play = async () => {
    if (!sel) return;
    setBusy("play");
    try {
      const r = await conn.link.request("cue", { seq: sel });
      if (!r.ok) setMsg({ text: `Couldn't play: ${r.error}`, bad: true });
      else {
        setPlayingFrom(Date.now() + 200); // the cue's lead time — the playhead then tracks the boards
        const mine = new Set(saved?.steps.map((st) => st.node) ?? []);
        const skipped = [...mine].filter((n) => offBoards.includes(n) || (saved?.unconfirmed ?? []).includes(n) || (entries[n] && isMissing(entries[n])));
        if (skipped.length) setMsg({ text: `Playing — except on ${names(skipped)}: ${skipped.map((n) => offBoards.includes(n) ? "off" : saved?.unconfirmed.includes(n) ? "hasn't picked up the edit yet" : "not heard").filter((v, i, a) => a.indexOf(v) === i).join(" / ")}.` });
      }
    } finally {
      setBusy(null);
    }
  };

  // Resend the saved sequence to the boards that haven't confirmed it
  // (they were away for the save and are back now).
  const resend = async (nodes: string[]) => {
    if (!saved) return;
    setBusy("save");
    setMsg(null);
    const r = await saveSequence(conn.link, entries, saved, show?.floods.senders ?? [], viaBridge, nodes);
    setBusy(null);
    if (r.failed.length) setMsg({ text: `Not saved on ${r.failed.map((f) => `${nameOf(f.node)} (${f.error})`).join("; ")}`, bad: true });
    else if (r.queued.length) setMsg({ text: awayText(r.queued) });
    else setMsg({ text: `${names(nodes)} ${nodes.length === 1 ? "has" : "have"} “${saved.name}” now.` });
    await load();
  };

  const del = async () => {
    if (!draft) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy("delete");
    const r = await deleteSequence(conn.link, entries, draft, viaBridge);
    setBusy(null);
    setConfirmDelete(false);
    if (r.failed.length) setMsg({ text: `Still on ${r.failed.map((f) => nameOf(f.node)).join(", ")} — try again`, bad: true });
    else if (r.queued.length) setMsg({ text: `Deleted “${draft.name}”. ${awayText(r.queued)}` });
    setSel(null);
    await load();
  };

  const saveTriggers = async () => {
    setBusy("rules");
    setMsg(null);
    const r = await saveRules(conn.link, entries, rules, show?.rules ?? [], viaBridge);
    setBusy(null);
    if (r.failed.length) setMsg({ text: `Triggers not saved on ${r.failed.map((f) => `${nameOf(f.node)} (${f.error})`).join("; ")}`, bad: true });
    else if (r.queued.length) setMsg({ text: `Triggers saved. ${awayText(r.queued)}` });
    else setMsg({ text: "Triggers saved." });
    await load();
  };

  const setMode = async (m: Mode) => {
    setBusy("mode");
    const failed = await setModeAll(m);
    setBusy(null);
    // The mode rides on the conductor's beacon: a board that missed this
    // takes it the moment it hears the mesh again (docs §6k).
    if (failed.length) setMsg({ text: `${names(failed)} didn't answer — ${failed.length === 1 ? "it follows" : "they follow"} the new mode as soon as ${failed.length === 1 ? "it's" : "they're"} back on the mesh.` });
    await load();
  };

  const testStep = (st: Step) => send(st);

  // ---- render ---------------------------------------------------------------

  const seqName = (id: number) => show?.sequences.find((s) => s.id === id)?.name ?? (draft?.id === id ? draft.name : `#${id}`);

  return (
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: C.bg }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: C.panel, borderBottom: `1px solid ${C.b1}`, flexWrap: "wrap" }}>
        <span style={sys(700, 13, C.t1)}>{seqSection ? "Sequences" : "Show"}</span>
        {seqSection && <span style={sys(400, 11.5, C.t4)}>timed steps on any board's outputs — the Show wires sensors and logic to them</span>}
        {!seqSection && <span style={{
          padding: "3px 9px", borderRadius: 4, letterSpacing: ".06em",
          ...(!modeKnown ? { background: C.raised, border: `1px solid ${C.b3}`, ...mono(700, 10.5, C.t4) }
            : oneMode === "armed" ? { background: C.greenBg, border: `1px solid ${C.greenB}`, ...mono(700, 10.5, C.green) }
            : oneMode === "ambient" ? { background: C.amberBg, border: `1px solid ${C.amberB}`, ...mono(700, 10.5, C.amber) }
            : oneMode === "off" ? { background: C.raised, border: `1px solid ${C.b3}`, ...mono(700, 10.5, C.t3) }
            : { background: C.redBg, border: `1px solid ${C.redB}`, ...mono(700, 10.5, C.red) }),
        }}>{!modeKnown ? "…" : oneMode ? oneMode.toUpperCase() : "MIXED"}</span>}
        {!seqSection && <span style={sys(400, 11.5, C.t4)}>
          {!modeKnown ? "" : !oneMode ? `Boards disagree: ${modeVals.map((m) => m.mode).join(" / ")} — check their clocks.`
            : statusLine(oneMode, lead)}
          {noClock > 0 && <span style={{ color: C.amber }}> · {noClock} board(s) have no clock</span>}
        </span>}
        <div style={{ flex: 1 }} />
        {msg && <span style={mono(500, 11, msg.bad ? C.red : C.green)}>{msg.text}</span>}
        {(loading || busy) && <Spinner />}
        <button onClick={() => void load()} disabled={loading} style={btn(false, loading)}>Reload from boards</button>
        {!seqSection && <span style={{ display: "flex" }} title="Sets every board now; holds until the schedule's next change">
          {MODES.map((m, i) => {
            const on = oneMode === m;
            return (
              <button key={m} onClick={() => void setMode(m)} disabled={!!busy} title={MODE_HELP[m]} style={{
                height: 30, padding: "0 12px", cursor: busy ? "default" : "pointer",
                borderRadius: i === 0 ? "6px 0 0 6px" : i === MODES.length - 1 ? "0 6px 6px 0" : 0,
                marginLeft: i ? -1 : 0,
                background: on ? C.emberBg : C.raised, border: `1px solid ${on ? C.ember : C.b3}`,
                ...sys(600, 11.5, on ? MODE_COLOR[m] : C.t3),
              }}>{MODE_LABEL[m]}</button>
            );
          })}
        </span>}
        {!seqSection && <button onClick={() => setSchedOpen(!schedOpen)} style={btn(schedOpen)}>{schedOpen ? "Hide schedule" : "Schedule…"}</button>}
      </div>
      {!seqSection && schedOpen && <SchedulePanel conn={conn} onSaved={() => void load()} />}

      {!show && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: 16, ...mono(500, 11.5, C.t4) }}>
          <Spinner /> {known.length ? "Reading sequences and triggers from every board…" : "Waiting for the boards to report in…"}
        </div>
      )}

      {show && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: phone ? "column" : "row" }}>
          {/* sequences */}
          {seqSection && <div style={{ width: phone ? "100%" : 230, maxHeight: phone ? "32vh" : undefined, flex: "none", borderRight: phone ? undefined : `1px solid ${C.b1}`, borderBottom: phone ? `1px solid ${C.b1}` : undefined, background: C.panel, display: "flex", flexDirection: "column", overflowY: "auto" }}>
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
          </div>}

          {/* Sequences: the editor. Show: the triggers (the graph's row view). */}
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 18 }}>
            {!seqSection ? null : draft ? (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <input value={draft.name} maxLength={23} placeholder="Name this sequence"
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ ...field, width: 230, ...sys(700, 13, C.t1) }} />
                  <span style={mono(500, 11, C.t5)}>#{draft.id} · {secs(lengthMs(draft))} s</span>
                  <label title="Ambient: loops by itself while the show is Ambient or Armed — porch lights, a fog burst every few minutes. Every board repeats its part on the same beat."
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", ...sys(600, 11.5, draft.ambient ? C.amber : C.t4) }}>
                    <Toggle small on={!!draft.ambient} onClick={() => setDraft({ ...draft, ambient: !draft.ambient })} /> Ambient loop
                  </label>
                  {draft.ambient && (
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }} title="Repeat every … seconds. Blank or shorter than the sequence = its own length.">
                      <span style={sys(500, 11.5, C.t4)}>every</span>
                      <NumberInput placeholder={secs(Math.max(lengthMs(draft), 1000))} min={1} max={3600}
                        value={draft.loop_ms ? draft.loop_ms / 1000 : undefined}
                        onChange={(v) => setDraft({ ...draft, loop_ms: Math.round(v * 1000) })}
                        onEmpty={() => setDraft({ ...draft, loop_ms: undefined })}
                        width={64} style={{ ...field, ...mono(500, 12, C.t1) }} />
                      <span style={sys(500, 11.5, C.t4)}>s</span>
                    </span>
                  )}
                  <label title="Dragging a servo, LED or strip value moves the real output, so you can see what you're setting. Relays and motors only change with Test."
                    style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", ...sys(600, 11.5, live ? C.emberT : C.t4) }}>
                    <Toggle small on={live} onClick={() => setLive(!live)} /> Live preview
                  </label>
                  <div style={{ flex: 1 }} />
                  {dirty && <span style={mono(600, 11, C.amber)}>unsaved</span>}
                  <button onClick={() => select(draft.id)} disabled={!dirty || !!busy} style={btn(false, !dirty || !!busy)}>Revert</button>
                  <button onClick={() => void saveSeq()} disabled={!dirty || !!busy} style={btn(true, !dirty || !!busy)}>Save to boards</button>
                  <button onClick={() => void play()} disabled={dirty || !saved || !!busy || bridgeOff}
                    title={dirty ? "Save first" : !saved ? "Not on any board yet — save first" : bridgeOff ? `The show is off on ${nameOf(usbNode ?? "")} (the board the console is on) — switch to Ambient or Armed` : offBoards.length ? `Play now — ${names(offBoards)} ${offBoards.length === 1 ? "is" : "are"} off and won't join in` : "Play on every board now"}
                    style={btn(false, dirty || !saved || !!busy || bridgeOff)}>▶ Play</button>
                  <button onClick={() => void del()} disabled={!!busy}
                    style={{ ...btn(false, !!busy), ...(confirmDelete ? { background: C.redBg, border: `1px solid ${C.red}`, color: C.red } : {}) }}>
                    {confirmDelete ? "Really delete?" : "Delete"}
                  </button>
                </div>
                {draft.problems.map((p) => <div key={p} style={{ ...mono(500, 11, C.amber), marginTop: 6 }}>⚠ {p}</div>)}
                {saved && saved.unconfirmed.length > 0 && (() => {
                  const pulling = saved.unconfirmed.filter(catchingUp);
                  const back = saved.unconfirmed.filter((n) => entries[n] && !isMissing(entries[n]) && !pulling.includes(n));
                  const away = saved.unconfirmed.filter((n) => !entries[n] || isMissing(entries[n]));
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6, ...mono(500, 11, C.amber) }}>
                      {pulling.length > 0 && <span><Spinner size={10} /> {names(pulling)} {pulling.length === 1 ? "is" : "are"} picking this up from the bridge…</span>}
                      {away.length > 0 && <span>☾ {names(away)} {away.length === 1 ? "is" : "are"} asleep or out of range — the bridge holds it; {away.length === 1 ? "it picks" : "they pick"} it up when next awake.</span>}
                      {back.length > 0 && <>
                        <span>⚠ {names(back)} {back.length === 1 ? "is" : "are"} awake but {back.length === 1 ? "hasn't" : "haven't"} picked this up.</span>
                        <button onClick={() => void resend(back)} disabled={!!busy} style={btn(true, !!busy)}>Send to {names(back)} now</button>
                      </>}
                    </div>
                  );
                })()}

                <div style={{ marginTop: 12 }}>
                  <LandscapeHint what="timeline">The timeline is easier sideways. Turn the phone for tracks and keyframes; the step table below works either way.</LandscapeHint>
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
                      <span onBlur={() => setDraft((d) => d && sortSteps(d))} style={{ display: "contents" }}>
                        <NumberInput value={st.t_ms / 1000} min={0} max={600}
                          onChange={(v) => patchStep(i, { t_ms: Math.round(v * 1000) })}
                          style={{ ...field, width: "100%", textAlign: "left", ...mono(500, 12, C.t1) }} />
                      </span>
                      <select value={st.node} style={field} onChange={(e) => {
                        const o = outputs[e.target.value]?.[0];
                        if (o) patchStep(i, { node: e.target.value, kind: o.kind, index: o.index });
                      }}>
                        {outNodes.map((n) => <option key={n} value={n}>{nameOf(n)}</option>)}
                        {!outNodes.includes(st.node) && <option value={st.node}>{nameOf(st.node)} ({entries[st.node] ? "pins not read yet" : "not on the mesh"})</option>}
                      </select>
                      <select value={`${st.kind}_${st.index}`} style={{ ...field, color: exists ? C.t1 : C.amber }} onChange={(e) => {
                        const o = outs.find((x) => `${x.kind}_${x.index}` === e.target.value);
                        if (o) patchStep(i, { kind: o.kind, index: o.index, value: o.kind === st.kind ? st.value : o.kind === "RELAY" ? 1 : 500 });
                      }}>
                        {outs.map((o) => <option key={`${o.kind}_${o.index}`} value={`${o.kind}_${o.index}`}>{o.kind}_{o.index}{o.label ? ` · ${o.label}` : ""}</option>)}
                        {!exists && <option value={`${st.kind}_${st.index}`}>{st.kind}_{st.index} ({outputs[st.node] ? "not on this board" : "board not read yet"})</option>}
                      </select>
                      <ValueInput kind={st.kind} value={st.value} onChange={(v) => {
                        patchStep(i, { value: v });
                        if (live && LIVE_KINDS.includes(st.kind)) send({ ...st, value: v });
                      }} />
                      {canRamp(st.kind) ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <NumberInput value={(st.dur_ms ?? 0) / 1000} min={0} max={st.t_ms / 1000}
                            title="Seconds. 0 = jump. The ramp ends at AT, so it can't be longer than AT."
                            onChange={(v) => patchStep(i, { dur_ms: Math.round(v * 1000) })}
                            width={54} style={{ ...field, ...mono(500, 12, (st.dur_ms ?? 0) > 0 ? C.t1 : C.t5) }} />
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
                <Hint style={{ marginTop: 8 }}>
                  Each step says what an output should be at a time after the sequence starts. With <b>get there over</b> set,
                  a servo, LED or motor ramps to it from wherever it was, ending at that time; at 0 it jumps (servos then glide
                  with their smoothing setting). Two steps at the same time happen together, on every board, on the mesh clock.
                </Hint>
              </div>
            ) : (
              <div style={sys(400, 12.5, C.t3)}>Pick a sequence, or create one.</div>
            )}

            {/* triggers */}
            {!seqSection && <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: phone ? "wrap" : undefined }}>
                <span style={label}>{graphView ? "SHOW GRAPH" : "TRIGGERS"}</span>
                {!phone && <span style={sys(400, 11, C.t5)}>{graphView ? "trigger → logic → sequences; each chain is a rule stored on its trigger's board" : "stored on the sensor's board — they work with no laptop attached"}</span>}
                <span style={{ display: "flex", marginLeft: 6 }}>
                  {(["graph", "list"] as const).map((v, i) => {
                    const on = graphView === (v === "graph");
                    return <button key={v} onClick={() => setGraphView(v === "graph")} style={{
                      height: 24, padding: "0 10px", cursor: "pointer", borderRadius: i === 0 ? "5px 0 0 5px" : "0 5px 5px 0", marginLeft: i ? -1 : 0,
                      background: on ? C.emberBg : C.raised, border: `1px solid ${on ? C.ember : C.b3}`, ...sys(600, 11, on ? C.emberT : C.t3),
                    }}>{v === "graph" ? "Graph" : "List"}</button>;
                  })}
                </span>
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
              {graphView && (
                <div style={{ display: "flex", flexDirection: "column", marginTop: 8, height: phone ? "60vh" : "calc(100vh - 230px)", minHeight: phone ? 320 : 460 }}>
                  <LandscapeHint what="graph">The show graph is easier sideways. Turn the phone, or use List for the same rules as rows.</LandscapeHint>
                  <GraphEditor rules={rules} show={show} sensors={sensors} nameOf={nameOf} activity={conn.activity} onChange={setRules}
                    onFire={async (seq) => { try { const r = await conn.link.request("cue", { seq }); return r.ok ? null : (r.error ?? "refused"); } catch (e) { return (e as Error).message; } }} />
                </div>
              )}
              {!graphView && rules.map((r, i) => <RuleRow key={i} r={r} show={show} sensors={sensors} nameOf={nameOf}
                onChange={(p) => setRules(rules.map((x, j) => (j === i ? { ...x, ...p } : x)))}
                onRemove={() => setRules(rules.filter((_, j) => j !== i))} />)}
              {!graphView && (sensors.length > 0 || show.sequences.length > 0) && (
                <button onClick={() => setRules([...rules, sensors.length
                  ? { node: sensors[0].node, trigger: "sensor", input: sensors[0].index, on: "active", after: 0, delay_ms: 0, cooldown_ms: 30000, pick: "all", seqs: [show.sequences[0]?.id ?? 0], enabled: true }
                  : { node: show.sequences[0]?.loadedOn[0] ?? known[0]?.node ?? "", trigger: "after", input: 0, on: "active", after: show.sequences[0]?.id ?? 0, delay_ms: lengthMs(show.sequences[0]), cooldown_ms: 0, pick: "all", seqs: [show.sequences[0]?.id ?? 0], enabled: true }])}
                  disabled={!show.sequences.length} title={show.sequences.length ? "" : "Save a sequence first"}
                  style={{ ...btn(false, !show.sequences.length), marginTop: 8 }}>+ Add trigger</button>
              )}
            </div>}
          </div>

          {/* activity */}
          {!seqSection && <div style={{ width: phone ? "100%" : 250, maxHeight: phone ? "40vh" : undefined, flex: "none", borderLeft: phone ? undefined : `1px solid ${C.b1}`, borderTop: phone ? `1px solid ${C.b1}` : undefined, background: C.panel, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ ...label, padding: "12px 14px 6px" }}>ACTIVITY</div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 5 }}>
              {conn.activity.length === 0 && <div style={sys(400, 11.5, C.t5)}>Sensor changes and cues appear here as they happen.</div>}
              {conn.activity.map((a, i) => <ActivityRow key={i} a={a} nameOf={nameOf} seqName={seqName} show={show} />)}
            </div>
          </div>}
        </div>
      )}
    </div>
  );
}

// One trigger rule as a sentence: the Show Graph's row view. Trigger →
// delay → actions (all / one at random) → cooldown → lockout.
function RuleRow({ r, show, sensors, nameOf, onChange, onRemove }: {
  r: Rule; show: Show; sensors: { node: string; index: number; label: string }[];
  nameOf: (n: string) => string; onChange: (p: Partial<Rule>) => void; onRemove: () => void;
}) {
  const t = (text: string) => <span style={sys(500, 12, C.t3)}>{text}</span>;
  const num = (value: number, set: (v: number) => void, width = 64, _step = 1, min = 0) => (
    <NumberInput value={value} min={min} onChange={set} width={width} style={{ ...field, ...mono(500, 12, C.t1) }} />
  );
  const seqOpt = (id: number) => (
    <>
      {show.sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      {!show.sequences.some((s) => s.id === id) && <option value={id}>#{id} (missing)</option>}
    </>
  );
  const afterSeq = show.sequences.find((s) => s.id === r.after);
  const afterLen = afterSeq ? lengthMs(afterSeq) : 0;
  // "when X ends" is a delay of X's length; anything else is a plain delay.
  const atEnd = r.trigger === "after" && afterLen > 0 && r.delay_ms === afterLen;
  const boards = [...new Set([...show.sequences.flatMap((s) => s.loadedOn), ...Object.keys(show.configs)])].filter((n) => n !== FLOODS);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 0", borderBottom: "1px solid #181c22", opacity: r.enabled ? 1 : 0.55 }}>
      <Toggle small on={r.enabled} onClick={() => onChange({ enabled: !r.enabled })} />
      {t("When")}
      <select value={r.trigger === "after" ? `after` : `${r.node}|${r.input}`} style={field} onChange={(e) => {
        if (e.target.value === "after") {
          const first = show.sequences[0];
          onChange({ trigger: "after", after: r.after || first?.id || 0, delay_ms: first ? lengthMs(first) : 0, node: r.node || first?.loadedOn[0] || "" });
        } else {
          const [node, input] = e.target.value.split("|");
          onChange({ trigger: "sensor", node, input: Number(input) });
        }
      }}>
        {sensors.map((s) => <option key={`${s.node}|${s.index}`} value={`${s.node}|${s.index}`}>{nameOf(s.node)} · DIGITAL_IN_{s.index}{s.label ? ` (${s.label})` : ""}</option>)}
        {show.sequences.length > 0 && <option value="after">a sequence…</option>}
      </select>
      {r.trigger === "sensor" ? (
        <select value={r.on} style={field} onChange={(e) => onChange({ on: e.target.value as Rule["on"] })}>
          <option value="active">becomes active</option>
          <option value="clear">becomes clear</option>
        </select>
      ) : (
        <>
          <select value={r.after} style={{ ...field, color: afterSeq ? C.t1 : C.amber }}
            onChange={(e) => { const id = Number(e.target.value); const q = show.sequences.find((s) => s.id === id); onChange({ after: id, delay_ms: atEnd && q ? lengthMs(q) : r.delay_ms }); }}>
            {seqOpt(r.after)}
          </select>
          <select value={atEnd ? "ends" : "starts"} style={field} onChange={(e) => onChange({ delay_ms: e.target.value === "ends" ? afterLen : 0 })}>
            <option value="starts">starts</option>
            <option value="ends" disabled={!afterLen}>ends</option>
          </select>
        </>
      )}
      {!atEnd && <>{t(r.trigger === "after" ? "+" : "wait")}{num(r.delay_ms / 1000, (v) => onChange({ delay_ms: Math.round(v * 1000) }), 56, 0.5)}{t("s, then")}</>}
      {atEnd && t("then")}
      {t("play")}
      {r.seqs.length > 1 && (
        <select value={r.pick} style={field} onChange={(e) => onChange({ pick: e.target.value as Rule["pick"] })}>
          <option value="all">all of</option>
          <option value="random">one of</option>
        </select>
      )}
      {r.seqs.map((id, k) => (
        <span key={k} style={{ display: "flex", alignItems: "center", gap: 2 }}>
          <select value={id} style={{ ...field, color: show.sequences.some((s) => s.id === id) ? C.t1 : C.amber }}
            onChange={(e) => onChange({ seqs: r.seqs.map((x, j) => (j === k ? Number(e.target.value) : x)) })}>
            {seqOpt(id)}
          </select>
          {r.seqs.length > 1 && <span onClick={() => onChange({ seqs: r.seqs.filter((_, j) => j !== k) })} title="Remove this sequence" style={{ color: C.t5, cursor: "pointer" }}>✕</span>}
        </span>
      ))}
      {r.seqs.length < RULE_MAX_SEQS && show.sequences.length > 1 && (
        <span onClick={() => onChange({ seqs: [...r.seqs, show.sequences.find((s) => !r.seqs.includes(s.id))?.id ?? show.sequences[0].id] })}
          title="Add another sequence: play all of them, or one at random" style={{ ...sys(600, 12, C.t4), cursor: "pointer" }}>+</span>
      )}
      {t("· wait")}{num(r.cooldown_ms / 1000, (v) => onChange({ cooldown_ms: Math.round(v * 1000) }), 56)}{t("s before it can fire again")}
      {t("· at most")}{num(r.limit?.fires ?? 0, (v) => onChange({ limit: v > 0 ? { fires: Math.round(v), window_min: r.limit?.window_min || 60 } : undefined }), 48)}
      {t("times per")}{num(r.limit?.window_min ?? 60, (v) => onChange({ limit: r.limit ? { ...r.limit, window_min: Math.max(1, Math.round(v)) } : undefined }), 52, 1, 1)}{t("min")}
      <span style={sys(400, 11, C.t5)}>(0 = no limit)</span>
      {r.trigger === "after" && boards.length > 1 && (
        <>
          {t("· on")}
          <select value={r.node} style={field} onChange={(e) => onChange({ node: e.target.value })} title="Any board can hold an 'after' rule — it hears every sequence start. Pick one that's always powered.">
            {boards.map((n) => <option key={n} value={n}>{nameOf(n)}</option>)}
          </select>
        </>
      )}
      <span onClick={onRemove} title="Remove trigger" style={{ color: C.t5, cursor: "pointer", marginLeft: 4 }}>✕</span>
    </div>
  );
}

function ActivityRow({ a, nameOf, seqName, show }: {
  a: Activity; nameOf: (n: string) => string; seqName: (id: number) => string; show: Show;
}) {
  if (a.kind === "mode") {
    return (
      <div style={mono(600, 11, a.mode ? MODE_COLOR[a.mode] : C.t3)}>
        <span style={{ color: C.t5, fontWeight: 500 }}>{clock(a.at)}</span> ◷ {nameOf(a.node)} → {a.mode ? MODE_LABEL[a.mode] : "?"}
        <span style={{ color: C.t5, fontWeight: 500 }}> ({a.reason})</span>
      </div>
    );
  }
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

// "Armed until 21:30 (schedule) · sunset 17:59" — in the boards' time zone.
function statusLine(mode: Mode, st: ModeStatus | undefined): string {
  const base = MODE_HELP[mode];
  if (!st) return base;
  const tz = st.tz_min;
  const parts: string[] = [];
  if (st.reason === "manual" && st.hold_until_s) parts.push(`set by hand until ${hhmm(st.hold_until_s * 1000, tz)}`);
  else if (st.reason === "manual") parts.push("set by hand");
  else if (st.reason === "schedule" && st.next_s && st.next_mode) parts.push(`next: ${MODE_LABEL[st.next_mode]} at ${hhmm(st.next_s * 1000, tz)}`);
  else if (st.reason !== "schedule") parts.push(st.reason);
  if (st.sunset_s) parts.push(`sunset ${hhmm(st.sunset_s * 1000, tz)}`);
  return `${base} ${parts.length ? "· " + parts.join(" · ") : ""}`;
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

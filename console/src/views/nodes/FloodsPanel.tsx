// The Floods pseudo-node: BRMesh flood lights driven by every ticked
// board. Pair lights here (from any sender), name them, test colors, and
// choose which boards send. lib/floods.ts holds the model.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { ColorPicker, Confirm, Spinner, mono, sys } from "../../ui";
import { isAway } from "../../lib/show";
import { deriveFloods, mismatched, syncFloods, readFloodsCopy, type FloodsState, type FloodsCopy } from "../../lib/floods";
import { LABEL_MAX, type NodeConfig } from "../../lib/nodeConfig";
import { target, type NodeLink } from "../../lib/transport";
import { isMissing, type Entry, isReachable } from "../../lib/connection";
import { BleFinder } from "./PinEditor";

const btn = (primary = false, disabled = false): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
  background: primary ? C.emberBg : C.raised,
  border: `1px solid ${primary ? C.ember : C.b3}`,
  ...sys(600, 11.5, primary ? C.emberT : C.t2),
});
const field: React.CSSProperties = {
  height: 28, padding: "0 8px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 5, ...sys(500, 12, C.t1),
};

export default function FloodsPanel({ link, entries }: { link: NodeLink; entries: Record<string, Entry> }) {
  const [configs, setConfigs] = useState<Record<string, NodeConfig> | null>(null);
  const [copy, setCopy] = useState<FloodsCopy | null>(null); // the bridge's copy, when no board holds the key
  const [loading, setLoading] = useState(false);
  const [labels, setLabels] = useState<Record<number, string>>({});
  const [removed, setRemoved] = useState<number[]>([]);
  const [senders, setSenders] = useState<string[] | null>(null); // null = as on the boards
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [finding, setFinding] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [values, setValues] = useState<Record<number, number>>({});
  const [askTick, setAskTick] = useState<string | null>(null); // ticking a battery board: say what it costs first

  const known = Object.values(entries).filter(isReachable);
  const nameOf = (node: string) => entries[node]?.hello?.name || node;
  // Any board but the bridge can send (its radio already shares USB and the mesh).
  const candidates = known.filter((e) => !e.hello!.bridge).map((e) => e.node).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  // Built without Bluetooth (-DPM_NO_BLE; no shipped build since 2026-10-11,
  // when pm_ws2812 made room in IRAM). Older firmware doesn't say — assume it can.
  const noBle = (n: string) => entries[n]?.hello?.ble === false;
  const onBattery = (n: string) => entries[n]?.hello?.power === "battery";
  const canSearch = candidates.filter((n) => !noBle(n));

  const knownKey = known.map((e) => e.node).sort().join(",");
  const readConfigs = useCallback(async () => {
    const out: Record<string, NodeConfig> = {};
    await Promise.all(known.map(async (en) => {
      try {
        const r = await target(link, en.usb ? null : en.node).request("get_config");
        if (r.ok) out[en.node] = r.config as NodeConfig;
      } catch { /* shown as not answering */ }
    }));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, knownKey]);
  // The lights can't be asked (BRMesh is one-way: a paired light never
  // transmits), so the sliders show what the sending boards last sent —
  // saved to their flash, so it survives a reboot. Before 2026-10-08 the
  // tab started every light at "off", and moving a slider jumped it.
  const readLastSent = useCallback(async (cfgs: Record<string, NodeConfig>) => {
    const sent: Record<number, number> = {};
    const senders = deriveFloods(cfgs).senders.filter((n) => entries[n] && !isMissing(entries[n]));
    await Promise.all(senders.map(async (n) => {
      try {
        const r = await target(link, entries[n].usb ? null : n).request("state");
        if (!r.ok) return;
        for (const c of r.channels as { kind: string; index: number; value: number }[])
          if (c.kind === "BLE_LIGHT" && (sent[c.index] === undefined || (!sent[c.index] && c.value))) sent[c.index] = c.value;
      } catch { /* that board is busy; another sender may answer */ }
    }));
    return sent;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, knownKey]);
  const viaBridge = !!Object.values(entries).find((e) => e.usb)?.hello?.bridge;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const cfgs = await readConfigs();
      setConfigs(cfgs);
      setCopy(viaBridge ? await readFloodsCopy(link) : null);
      const sent = await readLastSent(cfgs);
      setValues((v) => ({ ...sent, ...Object.fromEntries(Object.entries(v).filter(([k]) => sent[+k] === undefined)) }));
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readConfigs, readLastSent, viaBridge]);
  useEffect(() => { void load(); }, [load]);

  const st: FloodsState = useMemo(() => deriveFloods(configs ?? {}, copy), [configs, copy]);
  const curSenders = senders ?? st.senders;
  const lights = st.lights.filter((l) => !removed.includes(l.number)).map((l) => ({ ...l, label: labels[l.number] ?? l.label }));
  const dirty = senders !== null || Object.keys(labels).length > 0 || removed.length > 0;
  const bad = mismatched(st);
  const online = (n: string) => !!entries[n] && !isMissing(entries[n]);
  // Default to a board that is awake and has Bluetooth; mains before battery.
  const awakeFirst = [...canSearch].sort((x, y) => Number(onBattery(x)) - Number(onBattery(y)));
  const searchFrom = from && canSearch.includes(from) ? from
    : awakeFirst.find((n) => curSenders.includes(n) && online(n)) ?? awakeFirst.find(online) ?? null;

  const revert = () => { setLabels({}); setRemoved([]); setSenders(null); setMsg(null); };
  const save = async (keyFrom?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await syncFloods(link, entries, { ...st, lights }, curSenders, keyFrom);
      // Through a bridge, a sender that didn't answer pulls the key and lights
      // from it when back (docs §6k); anything else is a real failure.
      const away = link && (entries[Object.keys(entries).find((n) => entries[n].usb) ?? ""]?.hello?.bridge)
        ? r.failed.filter((f) => isAway(f.error)) : [];
      const real = r.failed.filter((f) => !away.includes(f));
      if (real.length) setMsg({ text: real.map((f) => `${nameOf(f.node)}: ${f.error}`).join(" · "), bad: true });
      else if (away.length) setMsg({ text: `Saved. ${away.map((f) => nameOf(f.node)).join(", ")} didn't answer — the bridge kept the floods and ${away.length === 1 ? "it picks" : "they pick"} them up when back.` });
      else setMsg({ text: curSenders.length ? `Saved to ${curSenders.map(nameOf).join(", ")}` : "Saved — no board is sending" });
      revert();
      await load();
    } finally { setBusy(false); }
  };
  // A pairing lands on the board that searched; spread it to the other senders.
  const onPaired = async () => {
    const cfgs = await readConfigs();
    setConfigs(cfgs);
    const s2 = deriveFloods(cfgs);
    const want = [...new Set([...(senders ?? s2.senders), ...s2.senders])];
    if (want.length > 1) await syncFloods(link, entries, s2, want, searchFrom ?? undefined);
    await load();
  };

  // Test colors go to every sender, one request in flight per light.
  const inFlight = useRef(new Map<number, boolean>());
  const queued = useRef(new Map<number, number>());
  const fire = (light: number, v: number) => {
    setValues((x) => ({ ...x, [light]: v }));
    if (inFlight.current.get(light)) { queued.current.set(light, v); return; }
    inFlight.current.set(light, true);
    Promise.all(curSenders.filter(online).map((n) =>
      target(link, entries[n].usb ? null : n).request("set", { kind: "BLE_LIGHT", index: light, value: v }).catch(() => undefined)))
      .finally(() => {
        inFlight.current.set(light, false);
        const next = queued.current.get(light);
        queued.current.delete(light);
        if (next !== undefined) fire(light, next);
      });
  };

  const toggleSender = (n: string, confirmed = false) => {
    if (!confirmed && !curSenders.includes(n) && onBattery(n)) { setAskTick(n); return; }
    const cur = new Set(curSenders);
    if (cur.has(n)) cur.delete(n); else cur.add(n);
    setSenders([...cur].sort());
  };

  return (
    <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={sys(700, 14, C.t1)}>Floods</span>
        <span style={sys(400, 12, C.t3)}>BRMesh flood lights — every ticked board sends to them, so losing a board loses no lights.</span>
        {loading && <Spinner />}
        <div style={{ flex: 1 }} />
        {dirty && <button onClick={revert} disabled={busy} style={btn(false, busy)}>Revert</button>}
        {dirty && <button onClick={() => void save()} disabled={busy} style={btn(true, busy)}>{busy ? "Saving…" : "Save to boards"}</button>}
      </div>
      {msg && <div style={mono(600, 11.5, msg.bad ? C.red : C.green)}>{msg.bad ? "✕ " : "✓ "}{msg.text}</div>}
      {askTick && (
        <Confirm title={`${nameOf(askTick)} is on battery`} okLabel="Tick it anyway" onCancel={() => setAskTick(null)}
          onOk={() => { const n = askTick; setAskTick(null); toggleSender(n, true); }}>
          It will send to the floods, but only while awake: during the show it hears commands in short listen windows, so a
          change can reach the lights up to one listen interval late
          ({entries[askTick]?.hb?.listen ? `about ${(entries[askTick].hb!.listen! / 1000).toFixed(1)} s` : "typically a second"}), and while
          the show is off it is in deep sleep and sends nothing.
          {" "}{curSenders.some((n) => !onBattery(n) && !noBle(n))
            ? "A mains-powered board is also ticked, so the lights still change on time."
            : "No mains-powered board is ticked: the floods will lag, and won't change while the show is off."}
        </Confirm>
      )}
      <div style={{ padding: "9px 12px", borderRadius: 7, background: C.card, border: `1px solid ${C.b2}`, ...sys(400, 12, C.t3), lineHeight: 1.55 }}>
        <b style={{ color: C.amber }}>The lights never answer.</b> BRMesh only goes one way, so there is no way to tell whether a light is
        powered, in range, or actually showing what you set. The colors here are what your boards <b>last sent</b> (they remember it
        through a restart), and the lights keep their color through a power cut. They can drift out of step if a light misses a
        command — out of range, unplugged at the time — or is changed from the BRMesh app. Setting the color again puts it right.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", padding: 10, border: `1px solid ${C.b2}`, borderRadius: 8, background: C.card }}>
        <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em" }}>SENDING BOARDS</span>
        {candidates.length === 0 && <span style={sys(400, 12, C.t4)}>No prop boards on the mesh yet (the bridge never drives lights).</span>}
        {candidates.map((n) => (
          <label key={n} title={noBle(n) ? "This board's firmware has no Bluetooth, so it can't send to the floods." : undefined}
            style={{ display: "flex", alignItems: "center", gap: 6, ...sys(500, 12, online(n) && !noBle(n) ? C.t1 : C.t4), cursor: noBle(n) && !curSenders.includes(n) ? "default" : "pointer" }}>
            {/* A no-Bluetooth board can be unticked, never ticked. */}
            <input type="checkbox" checked={curSenders.includes(n)} disabled={noBle(n) && !curSenders.includes(n)} onChange={() => toggleSender(n)} />
            {nameOf(n)}
            {noBle(n) && <span style={{ ...mono(700, 9.5, C.t5), letterSpacing: ".05em" }}>NO BLUETOOTH</span>}
            {!noBle(n) && onBattery(n) && <span style={{ ...mono(700, 9.5, C.amber), letterSpacing: ".05em" }}>ON BATTERY</span>}
            {st.keys[n] && <span title="holds the floods key" style={{ ...mono(700, 9.5, bad.includes(n) ? C.amber : C.green), letterSpacing: ".05em" }}>{bad.includes(n) ? "OTHER KEY" : "KEY"}</span>}
            {!online(n) && <span style={mono(500, 10.5, C.t5)}>not heard</span>}
          </label>
        ))}
        <div style={{ flex: 1 }} />
        <span style={mono(500, 11, st.held === "bridge" ? C.amber : C.t4)}>
          {st.held === "bridge"
            ? `no board is sending — the bridge holds the key and ${st.lights.length} light${st.lights.length === 1 ? "" : "s"}${copy?.at ? ` (saved ${new Date(copy.at * 1000).toLocaleDateString([], { month: "short", day: "numeric" })})` : ""}; tick a board, then Save to boards`
            : st.key ? `key set on ${st.senders.length} board${st.senders.length === 1 ? "" : "s"}` : "no key yet — pairing the first light makes one"}
        </span>
      </div>
      {(() => {
        const bat = curSenders.filter((n) => onBattery(n) && !noBle(n));
        const dead = curSenders.filter(noBle);
        if (!bat.length && !dead.length) return null;
        const live = curSenders.filter((n) => !noBle(n) && !onBattery(n));
        const lag = Math.max(0, ...bat.map((n) => entries[n]?.hb?.listen ?? 0));
        return (
          <div style={{ padding: "9px 12px", borderRadius: 7, background: C.card, border: `1px solid ${C.b2}`, ...sys(400, 12, C.t3), lineHeight: 1.55 }}>
            {bat.length > 0 && (<>
              <b style={{ color: C.amber }}>{bat.map(nameOf).join(", ")} {bat.length === 1 ? "is" : "are"} on battery.</b>{" "}
              {bat.length === 1 ? "It sends" : "They send"} only while awake: during the show {bat.length === 1 ? "it hears" : "they hear"} commands
              in short listen windows, so a change can reach the lights up to {lag ? `${(lag / 1000).toFixed(lag % 1000 ? 1 : 0)} s` : "one listen interval"} late,
              and while the show is off {bat.length === 1 ? "it is" : "they are"} in deep sleep and send nothing.{" "}
              {live.length ? <>{live.map(nameOf).join(", ")} {live.length === 1 ? "covers" : "cover"} the lights on time.</>
                : <b style={{ color: C.amber }}>No mains-powered board is ticked, so the floods will lag and won't change while the show is off.</b>}
            </>)}
            {dead.length > 0 && (<>
              {bat.length > 0 && " "}
              <b style={{ color: C.amber }}>{dead.map(nameOf).join(", ")} {dead.length === 1 ? "has" : "have"} no Bluetooth</b> in {dead.length === 1 ? "its" : "their"} firmware
              — a build from before 2026-10-11, when the Feather image had no room for it. Update {dead.length === 1 ? "it" : "them"} and {dead.length === 1 ? "it" : "they"} can send; until then, untick to tidy up.
            </>)}
          </div>
        );
      })()}
      {bad.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", ...sys(500, 12, C.amber) }}>
          ⚠ {bad.map(nameOf).join(", ")} hold a different key from {st.senders.filter((n) => !bad.includes(n)).map(nameOf).join(", ")} — lights answer only one. Keep:
          {[...new Set(Object.values(st.keys))].map((k) => {
            const owner = st.senders.find((n) => st.keys[n] === k)!;
            return <button key={k} onClick={() => void save(owner)} disabled={busy} style={btn(false, busy)}>{nameOf(owner)}'s key</button>;
          })}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em" }}>LIGHTS</span>
        <span style={sys(400, 12, C.t3)}>{lights.length ? `${lights.length} paired` : "none yet"}</span>
        <div style={{ flex: 1 }} />
        {dirty && <span style={mono(600, 11, C.amber)}>save or revert your changes to find lights</span>}
        {canSearch.length > 1 && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, ...sys(500, 11.5, C.t3) }}>
            search from
            <select value={searchFrom ?? ""} onChange={(e) => setFrom(e.target.value)} style={{ ...field, height: 28 }}>
              {canSearch.map((n) => <option key={n} value={n}>{nameOf(n)}{online(n) ? "" : " (not heard)"}</option>)}
            </select>
          </label>
        )}
        <button onClick={() => setFinding(!finding)} disabled={dirty || !searchFrom}
          title={!searchFrom ? "No prop board on the mesh to search from" : "Find unpaired lights near that board and pair them"}
          style={btn(!finding, dirty || !searchFrom)}>{finding ? "Close" : "Find lights…"}</button>
      </div>
      {finding && searchFrom && (
        <BleFinder key={searchFrom} node={target(link, entries[searchFrom]?.usb ? null : searchFrom)} onPaired={onPaired} />
      )}

      {lights.map((l) => (
        <div key={l.number} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderTop: "1px solid #181c22" }}>
          <span style={{ ...mono(700, 11.5, C.emberT), width: 70, flex: "none" }}>light #{l.number}</span>
          <input value={l.label} maxLength={LABEL_MAX} placeholder="what is it?"
            onChange={(e) => setLabels((x) => ({ ...x, [l.number]: e.target.value }))} style={{ ...field, width: 160, flex: "none" }} />
          <span title="What the sending boards last sent. The lights can't be asked — BRMesh is one-way — so this is wrong if the light missed a command or was set from the BRMesh app."
            style={{ display: "contents" }}>
            <ColorPicker value={values[l.number] ?? 0} onChange={(v) => fire(l.number, v)} white />
          </span>
          <button onClick={() => fire(l.number, 0)} style={btn()}>Off</button>
          <button onClick={() => setRemoved((r) => [...r, l.number])} title="Forget this light (reset it to pair it again)" style={{ ...btn(), width: 30, padding: 0 }}>✕</button>
        </div>
      ))}
      {!lights.length && !finding && configs && (
        <div style={{ ...sys(400, 12, C.t4), lineHeight: 1.55 }}>
          Use <b>Find lights…</b> with the floods near one of your prop boards: it pairs them, no app or key needed,
          and the key and light list are copied to every ticked board.
        </div>
      )}
    </div>
  );
}

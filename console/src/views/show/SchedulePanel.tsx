// The show schedule editor (docs/generic-boards.md §6e): when the yard
// arms at dusk, goes lights-only, and switches off for the neighbors.
// Every board gets the same copy and decides for itself on its own
// clock, so the show keeps time with no laptop attached.
import { isAway } from "../../lib/show";
import { useEffect, useState } from "react";
import { C } from "../../lib/tokens";
import { Spinner, Toggle, mono, sys } from "../../ui";
import type { Connection } from "../../lib/connection";
import {
  DAYS, DEFAULT_WINDOWS, MODES, MODE_LABEL, TIME_RE, emptySchedule, hhmm, loadSchedule, resolve, saveSchedule, validTime,
  type Day, type Schedule, type Window,
} from "../../lib/schedule";

const field: React.CSSProperties = {
  height: 28, padding: "0 8px", background: C.card, border: `1px solid ${C.b2}`,
  borderRadius: 5, outline: "none", ...sys(500, 12, C.t1),
};
const btn = (primary = false, disabled = false): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1, flex: "none",
  background: primary ? C.emberBg : C.raised,
  border: `1px solid ${primary ? C.ember : C.b3}`,
  ...sys(600, 11.5, primary ? C.emberT : C.t2),
});
const label = { font: "600 10px system-ui", letterSpacing: ".08em", color: C.t5 } as const;
const COLS = "190px 270px 150px 150px 110px minmax(120px,1fr) 24px";
const PRESETS = ["sunset-60", "sunset-30", "sunset", "dusk", "21:00", "21:30", "22:00", "22:30", "23:00", "sunrise", "dawn"];
export const MODE_COLOR = { off: C.t4, ambient: C.amber, armed: C.green } as const;

const MD_RE = /^(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])$/;

// A time in plain words: "21:30" -> "9:30 pm", "sunset-90" -> "1 h 30 min before sunset".
function describe(spec: string): string {
  const m = TIME_RE.exec(spec.trim());
  if (!m) return "";
  if (m[1] !== undefined) {
    const h = +m[1], mm = m[2];
    return h === 24 || h === 0 ? `midnight${mm !== "00" ? ` +${mm} min` : ""}` : `${h % 12 || 12}:${mm} ${h < 12 ? "am" : "pm"}`;
  }
  const off = m[4] ? +m[4] : 0, a = Math.abs(off);
  const len = a >= 60 ? `${Math.floor(a / 60)} h${a % 60 ? ` ${a % 60} min` : ""}` : `${a} min`;
  return off === 0 ? `at ${m[3]}` : `${len} ${off < 0 ? "before" : "after"} ${m[3]}`;
}

// A month and a day, no year: a window repeats every year, and the
// browser's date picker can't hide its year (2026-10-10).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
function DateInput({ value, onChange, placeholder }: { value?: string; onChange: (md: string) => void; placeholder: string }) {
  const [m, d] = value && MD_RE.test(value) ? value.split("-").map(Number) : [0, 0];
  const pad = (n: number) => String(n).padStart(2, "0");
  const sel: React.CSSProperties = { ...field, padding: "0 4px", ...mono(500, 11.5, m ? C.t1 : C.t5) };
  return (
    <span style={{ display: "flex", gap: 2 }} title={placeholder}>
      <select value={m} style={{ ...sel, width: 62 }}
        onChange={(e) => { const nm = +e.target.value; onChange(nm ? `${pad(nm)}-${pad(Math.min(d || 1, DAYS_IN[nm - 1]))}` : ""); }}>
        <option value={0}>month</option>
        {MONTHS.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}
      </select>
      <select value={d} disabled={!m} style={{ ...sel, width: 52 }}
        onChange={(e) => onChange(`${pad(m)}-${pad(+e.target.value)}`)}>
        {!m && <option value={0}>day</option>}
        {m > 0 && Array.from({ length: DAYS_IN[m - 1] }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
      </select>
    </span>
  );
}

export default function SchedulePanel({ conn, onSaved }: { conn: Connection; onSaved: () => void }) {
  const [sched, setSched] = useState<Schedule | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [busy, setBusy] = useState<string | null>("load");
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const boards = Object.values(conn.entries).filter((e) => e.hello); // the bridge too: it may be the conductor

  useEffect(() => {
    let live = true;
    void loadSchedule(conn.link, Object.values(conn.entries).filter((e) => e.hello)).then((s) => {
      if (!live) return;
      const v = s ?? emptySchedule();
      setSched(v);
      setSaved(s ? JSON.stringify(s) : "");
      setBusy(null);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sched) return <div style={{ padding: 16, display: "flex", gap: 8, ...mono(500, 11.5, C.t4) }}><Spinner /> Reading the schedule from the boards…</div>;

  const set = (p: Partial<Schedule>) => setSched({ ...sched, ...p });
  const setW = (i: number, p: Partial<Window>) => set({ windows: sched.windows.map((w, j) => (j === i ? { ...w, ...p } : w)) });
  const located = Number.isFinite(sched.lat) && Number.isFinite(sched.lon);
  const problems: string[] = [];
  if (!located) problems.push("Set the location — sunset depends on it.");
  sched.windows.forEach((w, i) => {
    if (!validTime(w.start) || !validTime(w.end)) problems.push(`Row ${i + 1}: times are HH:MM or e.g. sunset-60.`);
    if (w.days && !w.days.length) problems.push(`Row ${i + 1}: pick at least one day.`);
    if (w.dates && (!MD_RE.test(w.dates[0]) || !MD_RE.test(w.dates[1]))) problems.push(`Row ${i + 1}: dates are MM-DD.`);
  });
  const dirty = JSON.stringify(sched) !== saved;

  const locate = () => {
    if (!navigator.geolocation) { setMsg({ text: "This browser can't share its location — type it in.", bad: true }); return; }
    setBusy("locate");
    navigator.geolocation.getCurrentPosition(
      (p) => { set({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }); setBusy(null); setMsg(null); },
      (e) => { setBusy(null); setMsg({ text: `No location (${e.message}) — type it in, e.g. from a map.`, bad: true }); },
      { timeout: 10000 },
    );
  };

  const save = async () => {
    setBusy("save");
    setMsg(null);
    const clean: Schedule = { ...sched, windows: sched.windows.map((w) => ({ ...w, start: w.start.trim(), end: w.end.trim() })) };
    const failed = await saveSchedule(conn.link, boards, clean);
    setBusy(null);
    const nm = (n: string) => conn.entries[n]?.hello?.name || n;
    // A board that didn't answer takes the schedule from the conductor when
    // it's back (docs §6k) — as long as one board, the conductor's copy, has it.
    const away = failed.filter((f) => isAway(f.error));
    const refused = failed.filter((f) => !isAway(f.error));
    if (refused.length || away.length === boards.length) {
      setMsg({ text: `Not saved on ${failed.map((f) => `${nm(f.node)} (${f.error})`).join("; ")}`, bad: true });
      return;
    }
    if (away.length) {
      setSched(clean);
      setSaved(JSON.stringify(clean));
      setMsg({ text: `Saved. ${away.map((f) => nm(f.node)).join(", ")} didn't answer — ${away.length === 1 ? "it takes" : "they take"} the schedule from the mesh when back.` });
      return;
    }
    setSched(clean);
    setSaved(JSON.stringify(clean));
    setMsg({ text: `Saved to ${boards.length} board(s) · clocks set` });
    onSaved();
  };

  const today = new Date();
  const sunrise = located ? resolve("sunrise", sched.lat, sched.lon, today) : NaN;
  const sunset = located ? resolve("sunset", sched.lat, sched.lon, today) : NaN;

  return (
    <div style={{ padding: "12px 16px 14px", background: C.panel, borderBottom: `1px solid ${C.b1}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={sys(700, 12.5, C.t1)}>Schedule</span>
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", ...sys(600, 11.5, sched.enabled ? C.emberT : C.t4) }}>
          <Toggle small on={sched.enabled} onClick={() => set({ enabled: !sched.enabled })} /> {sched.enabled ? "On" : "Off — modes only change by hand"}
        </label>
        <span style={{ width: 12 }} />
        <span style={label}>LOCATION</span>
        <input type="number" step={0.01} placeholder="latitude" value={Number.isFinite(sched.lat) ? sched.lat : ""}
          onChange={(e) => set({ lat: e.target.value === "" ? NaN : +e.target.value })} style={{ ...field, width: 92, ...mono(500, 12, C.t1) }} />
        <input type="number" step={0.01} placeholder="longitude" value={Number.isFinite(sched.lon) ? sched.lon : ""}
          onChange={(e) => set({ lon: e.target.value === "" ? NaN : +e.target.value })} style={{ ...field, width: 92, ...mono(500, 12, C.t1) }} />
        <button onClick={locate} disabled={!!busy} style={btn(false, !!busy)}>Use this device's location</button>
        <span style={mono(500, 11, C.t4)}>
          {located ? `today: sunrise ${hhmm(sunrise)} · sunset ${hhmm(sunset)}` : "west is negative (New York −74.01)"}
        </span>
        <div style={{ flex: 1 }} />
        {msg && <span style={mono(500, 11, msg.bad ? C.red : C.green)}>{msg.text}</span>}
        {busy && <Spinner />}
        {dirty && <span style={mono(600, 11, C.amber)}>unsaved</span>}
        <button onClick={() => void save()} disabled={!dirty || !!busy || problems.length > 0}
          title={problems[0]} style={btn(true, !dirty || !!busy || problems.length > 0)}>Save to boards</button>
      </div>

      <div style={{ marginTop: 10, padding: "8px 12px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 6, ...sys(400, 11.5, C.t3), lineHeight: 1.6 }}>
        <b style={{ color: C.t2 }}>FROM / TO</b> — type, or pick from the list:{" "}
        a clock time <code style={mono(600, 11, C.t1)}>21:30</code> (24-hour; <code style={mono(600, 11, C.t1)}>24:00</code> = midnight) ·{" "}
        a sun time <code style={mono(600, 11, C.t1)}>sunset</code> <code style={mono(600, 11, C.t1)}>sunrise</code>{" "}
        <code style={mono(600, 11, C.t1)}>dusk</code> (sky dark, ~30 min after sunset) <code style={mono(600, 11, C.t1)}>dawn</code> ·{" "}
        add <b>minutes</b> before (−) or after (+): <code style={mono(600, 11, C.t1)}>sunset-60</code> = an hour before sunset,{" "}
        <code style={mono(600, 11, C.t1)}>dusk+15</code>. A TO earlier than FROM runs past midnight.{" "}
        <b style={{ color: C.t2 }}>DATES</b> are optional, month and day only — they repeat every year (leave them on "month" for any date).
      </div>

      <div style={{ overflowX: "auto" }}><div style={{ minWidth: 1100 }}>
        <div style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, alignItems: "center", marginTop: 12, ...label }}>
          <span>DAYS</span><span title="Optional: only between these dates, MM-DD">DATES</span><span>FROM</span><span>TO</span><span>MODE</span><span>TODAY</span><span />
        </div>
        <datalist id="pm-times">{PRESETS.map((p) => <option key={p} value={p} />)}</datalist>
        {sched.windows.map((w, i) => {
          const a = resolve(w.start, sched.lat, sched.lon, today), b = resolve(w.end, sched.lat, sched.lon, today);
          const days = w.days ?? [...DAYS];
          const applies = days.includes(DAYS[today.getDay()]) && (!w.dates || inDates(w.dates, today));
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: COLS, gap: 8, alignItems: "center", padding: "5px 0", borderBottom: "1px solid #181c22" }}>
              <span style={{ display: "flex", gap: 2 }}>
                {DAYS.map((d) => {
                  const on = days.includes(d);
                  return (
                    <span key={d} onClick={() => {
                      const next = on ? days.filter((x) => x !== d) : DAYS.filter((x) => x === d || days.includes(x));
                      setW(i, { days: next.length === 7 ? undefined : (next as Day[]) });
                    }} title={d} style={{
                      width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 4, cursor: "pointer",
                      background: on ? C.emberBg : C.card, border: `1px solid ${on ? C.emberB : C.b2}`, ...mono(600, 10, on ? C.emberT : C.t5),
                    }}>{d[0].toUpperCase()}</span>
                  );
                })}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <DateInput placeholder="First date (any year)" value={w.dates?.[0]}
                  onChange={(md) => setW(i, { dates: dates(md, w.dates?.[1] || md) })} />
                <span style={sys(400, 11, C.t5)}>–</span>
                <DateInput placeholder="Last date (any year)" value={w.dates?.[1]}
                  onChange={(md) => setW(i, { dates: dates(w.dates?.[0] || md, md) })} />
                {w.dates
                  ? <span onClick={() => setW(i, { dates: undefined })} title="Any date" style={{ color: C.t5, cursor: "pointer", padding: "0 3px" }}>✕</span>
                  : <span style={sys(400, 10.5, C.t6)}>any</span>}
              </span>
              <TimeField value={w.start} onChange={(v) => setW(i, { start: v })} />
              <TimeField value={w.end} onChange={(v) => setW(i, { end: v })} />
              <select value={w.mode} onChange={(e) => setW(i, { mode: e.target.value as Window["mode"] })} style={{ ...field, color: MODE_COLOR[w.mode] }}>
                {MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
              <span style={mono(500, 11, applies ? C.t2 : C.t6)}>
                {applies ? `${hhmm(a)} → ${hhmm(b)}` : "not today"}
              </span>
              <span onClick={() => set({ windows: sched.windows.filter((_, j) => j !== i) })} title="Remove"
                style={{ color: C.t5, cursor: "pointer", textAlign: "center" }}>✕</span>
            </div>
          );
        })}
      </div></div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={() => set({ windows: [...sched.windows, { start: "sunset-60", end: "22:00", mode: "armed" }] })}
          disabled={sched.windows.length >= 12} style={btn(false, sched.windows.length >= 12)}>+ Add window</button>
        <button onClick={() => set({ windows: DEFAULT_WINDOWS.map((w) => ({ ...w })) })} style={btn()}>Reset to defaults</button>
        <span style={{ ...sys(400, 11.5, C.t4), marginLeft: 6 }}>
          Later rows win where they overlap; outside every window the show is <b>Off</b>.
          A button press holds until the next change, but Armed during quiet hours lasts at most
        </span>
        <input type="number" min={1} max={1440} value={sched.manual_max_min}
          onChange={(e) => set({ manual_max_min: Math.max(1, Math.min(1440, Math.round(+e.target.value || 60))) })}
          style={{ ...field, width: 58, ...mono(500, 12, C.t1) }} />
        <span style={sys(400, 11.5, C.t4)}>min.</span>
      </div>
    </div>
  );
}

// Blank both = any date.
function dates(a: string, b: string): Window["dates"] {
  return !a.trim() && !b.trim() ? undefined : [a.trim(), b.trim()];
}

function inDates([a, b]: [string, string], d: Date) {
  const md = (d.getMonth() + 1) * 100 + d.getDate();
  const n = (s: string) => { const [m, x] = s.split("-").map(Number); return m * 100 + x; };
  const f = n(a), t = n(b);
  return f <= t ? md >= f && md <= t : md >= f || md <= t;
}

function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ok = validTime(value);
  return (
    <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <input list="pm-times" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="21:30 or sunset-60"
        title="A clock time (21:30), or sunset / sunrise / dusk / dawn with minutes before (−) or after (+): sunset-60, dusk+15"
        style={{ ...field, ...mono(500, 12, ok ? C.t1 : C.red) }} />
      <span style={sys(400, 10.5, ok ? C.t5 : C.red)}>{ok ? describe(value) : "e.g. 21:30, sunset-60, dusk+15"}</span>
    </span>
  );
}

// The show schedule as the console edits it (docs/software-plan.md §4.1,
// docs/generic-boards.md §6e). The boards evaluate it themselves — this
// side only edits it, sends every board the same copy, sets their clocks
// from this device, and previews what the windows mean today.
import { editStamp, target, type NodeLink, type Reply } from "./transport";
import type { Entry } from "./connection";

export type Mode = "off" | "ambient" | "armed";
export const MODES: Mode[] = ["off", "ambient", "armed"];
export const MODE_LABEL: Record<Mode, string> = { off: "Off", ambient: "Ambient", armed: "Armed" };
export const MODE_HELP: Record<Mode, string> = {
  off: "Nothing plays; every output off.",
  ambient: "Ambient sequences loop (lights, fog); sensors don't scare.",
  armed: "Ambient sequences loop and sensors fire their sequences.",
};

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];

export interface Window {
  days?: Day[]; // absent = every day
  dates?: [string, string]; // ["MM-DD", "MM-DD"], absent = any date
  start: string; // "HH:MM" or "sunset-60" / "dusk+15" / "sunrise" / "dawn"
  end: string;
  mode: Mode;
}

export interface Schedule {
  enabled: boolean;
  lat: number;
  lon: number;
  manual_max_min: number;
  windows: Window[];
}

// The shipped default (software-plan §4.1). Later rows win where they overlap.
export const DEFAULT_WINDOWS: Window[] = [
  { start: "sunset-60", end: "21:30", mode: "armed" },
  { start: "21:30", end: "22:30", mode: "ambient" },
  { days: ["fri", "sat"], start: "sunset-60", end: "22:30", mode: "armed" },
  { dates: ["10-31", "10-31"], start: "sunset-60", end: "23:00", mode: "armed" },
];

export const emptySchedule = (): Schedule => ({ enabled: true, lat: NaN, lon: NaN, manual_max_min: 60, windows: DEFAULT_WINDOWS.map((w) => ({ ...w })) });

// What every board reports about its mode (get_show / set_mode replies).
export interface ModeStatus {
  mode: Mode;
  reason: string; // "schedule" | "manual" | "no clock" | "no schedule" | "waiting for the clock"
  clock: boolean;
  scheduled: boolean;
  utc_s?: number;
  tz_min?: number;
  next_s?: number;
  next_mode?: Mode;
  hold_until_s?: number;
  sunset_s?: number;
  sunrise_s?: number;
}

// ---- clock ----------------------------------------------------------------

// This device's UTC offset now, and when it next changes (a DST switch):
// found by stepping a day at a time for a year, then narrowing to the second.
export function tzInfo(now = Date.now()): { tz_offset_min: number; tz_next_change_s: number; tz_next_offset_min: number } {
  const off = (t: number) => -new Date(t).getTimezoneOffset();
  const cur = off(now);
  let lo = now, hi = 0;
  for (let t = now + 86400e3; t < now + 400 * 86400e3; t += 86400e3) {
    if (off(t) !== cur) { hi = t; break; }
    lo = t;
  }
  if (!hi) return { tz_offset_min: cur, tz_next_change_s: 0, tz_next_offset_min: cur };
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (off(mid) === cur) lo = mid; else hi = mid;
  }
  return { tz_offset_min: cur, tz_next_change_s: Math.ceil(hi / 1000), tz_next_offset_min: off(hi) };
}

export const clockBody = () => ({ utc_ms: Date.now(), ...tzInfo() });

const ask = (link: NodeLink, en: Entry, cmd: string, body: Record<string, unknown> = {}): Promise<Reply> =>
  target(link, en.usb ? null : en.node).request(cmd, body);

export const setClock = (link: NodeLink, en: Entry) => ask(link, en, "set_clock", clockBody());

// ---- sun (the same NOAA equations as firmware pm_sun.h) --------------------

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
function eventUtc(rise: boolean, jd: number, lat: number, lon: number, zenith: number): number {
  const t = (jd - 2451545.0) / 36525.0;
  let l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  if (l0 < 0) l0 += 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = rad(m);
  const c = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const e0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = e0 + 0.00256 * Math.cos(rad(omega));
  const dec = Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda)));
  let y = Math.tan(rad(eps) / 2); y *= y;
  const l0r = rad(l0);
  const eqt = deg(y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r)
    - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr)) * 4;
  const latr = rad(lat);
  const arg = Math.cos(rad(zenith)) / (Math.cos(latr) * Math.cos(dec)) - Math.tan(latr) * Math.tan(dec);
  if (arg < -1 || arg > 1) return NaN;
  const ha = deg(Math.acos(arg));
  return 720 - 4 * (lon + (rise ? ha : -ha)) - eqt;
}

type SunRef = "dawn" | "sunrise" | "sunset" | "dusk";
// UTC ms of a sun event on the local calendar date containing `when`.
export function sunEvent(ref: SunRef, when: Date, lat: number, lon: number): number {
  const day = Math.floor(Date.UTC(when.getFullYear(), when.getMonth(), when.getDate()) / 86400e3);
  const rise = ref === "dawn" || ref === "sunrise";
  const zen = ref === "dawn" || ref === "dusk" ? 96 : 90.833;
  const jd = day + 2440587.5;
  let m = eventUtc(rise, jd, lat, lon, zen);
  if (!Number.isNaN(m)) m = eventUtc(rise, jd + m / 1440, lat, lon, zen);
  return day * 86400e3 + m * 60e3;
}

// ---- time strings --------------------------------------------------------------

export const TIME_RE = /^(?:([01]?\d|2[0-4]):([0-5]\d)|(dawn|sunrise|sunset|dusk)([+-]\d{1,3})?)$/;
export const validTime = (s: string) => TIME_RE.test(s.trim());

// When a window edge falls today, on this device's clock (ms), or NaN.
export function resolve(spec: string, lat: number, lon: number, day = new Date()): number {
  const m = TIME_RE.exec(spec.trim());
  if (!m) return NaN;
  if (m[1] !== undefined) return new Date(day.getFullYear(), day.getMonth(), day.getDate(), +m[1], +m[2]).getTime();
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return NaN;
  return sunEvent(m[3] as SunRef, day, lat, lon) + (m[4] ? +m[4] : 0) * 60e3;
}

export const hhmm = (ms: number, tzMin?: number) => {
  if (!Number.isFinite(ms)) return "—";
  if (tzMin === undefined) return new Date(ms).toTimeString().slice(0, 5);
  return new Date(ms + tzMin * 60e3).toISOString().slice(11, 16);
};

// ---- boards ------------------------------------------------------------------------

// One copy for everyone: the first board that has a schedule.
export async function loadSchedule(link: NodeLink, entries: Entry[]): Promise<Schedule | null> {
  for (const en of entries) {
    try {
      const r = await ask(link, en, "get_schedule");
      const s = r.ok ? (r.schedule as Schedule) : null;
      if (s && s.windows?.length) return s;
    } catch { /* try the next board */ }
  }
  return null;
}

export async function saveSchedule(link: NodeLink, entries: Entry[], s: Schedule): Promise<{ node: string; error: string }[]> {
  const failed: { node: string; error: string }[] = [];
  const at = editStamp();  // one edit, one stamp on every board's copy
  await Promise.all(entries.map(async (en) => {
    try {
      await setClock(link, en); // a schedule is no use to a board without the time
      const r = await ask(link, en, "set_schedule", { schedule: s, at });
      if (!r.ok) failed.push({ node: en.node, error: r.error ?? "refused" });
    } catch (e) {
      failed.push({ node: en.node, error: (e as Error).message });
    }
  }));
  return failed;
}

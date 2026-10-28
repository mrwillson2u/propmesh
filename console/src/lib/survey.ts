// Surveys: the Show, Yard and Floods views read every board at once. Any
// request but background polling holds a battery board awake 10 min
// (firmware pm_api), so a survey at a check-in kept six candles up for
// nothing and renewed them each time one of them was heard (2026-10-28).
//
// Boards from 2026-10-28 on take a request marked `bg` as background (a
// 3 s hold). An older board can't tell, so it is asked its hello first
// (background) and:
// - free (no hold, or the 6 s dwell after a reset): read, then let sleep
//   again;
// - held by anything else (its setup window, a sensor wake, a sync pull,
//   a console page, or an earlier survey): NOT read. Any read would renew
//   its 10 min, and the next survey would find it held again — six candles
//   stayed awake for over an hour that way (2026-10-28, 15:20–16:40). The
//   view uses its last copy of the board, as for one that doesn't answer.
// A board wanted awake (`keep`: "stay awake next time", a queued update,
// its page open) is read as before; the person is working on it.
import { target, type NodeLink, type Reply } from "./transport";
import type { Entry } from "./connection";

export const BG = { bg: true } as const;
const DWELL_S = 6;  // the hold after a reset (pm_sleep BOOT_DWELL_MS): still a plain wake

let keep: (node: string) => boolean = () => false;
export const setSurveyKeep = (f: (node: string) => boolean) => { keep = f; };

export interface Surveyed { en: Entry; release: boolean; skip?: boolean }
export async function surveyBegin(link: NodeLink, en: Entry): Promise<Surveyed> {
  const old = en.hb?.cfg_at === undefined;  // reports no settings stamp: firmware before 2026-10-28
  if (en.usb || en.hello?.power !== "battery" || !old || keep(en.node)) return { en, release: false };
  try {
    const h = await target(link, en.node).request("hello", BG);
    if (!h.ok) return { en, release: false };
    const free = ((h.hold_s as number | undefined) ?? 0) <= DWELL_S;
    return free ? { en, release: true } : { en, release: false, skip: true };
  } catch { return { en, release: false }; }
}
// A skipped board answers like one that is away, so each view falls back
// to what it last knew.
export const surveyAsk = (link: NodeLink, s: Surveyed, cmd: string, body: Record<string, unknown> = {}): Promise<Reply> =>
  s.skip ? Promise.reject(new Error("held awake already: not asked, so its hold isn't renewed"))
    : target(link, s.en.usb ? null : s.en.node).request(cmd, { ...body, ...BG });
export function surveyEnd(link: NodeLink, s: Surveyed) {
  if (s.release) void target(link, s.en.node).request("hold_awake", { min: 0 }).catch(() => undefined);
}

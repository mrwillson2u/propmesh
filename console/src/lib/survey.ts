// Surveys: the Show, Yard and Floods views read every board at once. Any
// request but background polling holds a battery board awake 10 min
// (firmware pm_api), so a survey at a check-in kept six candles up for
// nothing and renewed them each time one of them was heard (2026-10-28).
//
// Boards from 2026-10-28 on take a request marked `bg` as background (a
// 3 s hold). An older board can't tell, so a free one is asked its hello
// first (background) and let sleep again after the survey — unless
// something holds it already: its setup window, a sensor wake, a sync
// pull or a console page all show in the hello; "stay awake next time",
// a queued update and an open page come from `keep` (lib/configCache).
// Those a survey must never cut short.
import { target, type NodeLink, type Reply } from "./transport";
import type { Entry } from "./connection";

export const BG = { bg: true } as const;
const DWELL_S = 6;  // the hold after a reset (pm_sleep BOOT_DWELL_MS): still a plain wake

let keep: (node: string) => boolean = () => false;
export const setSurveyKeep = (f: (node: string) => boolean) => { keep = f; };

export interface Surveyed { en: Entry; release: boolean }
export async function surveyBegin(link: NodeLink, en: Entry): Promise<Surveyed> {
  const old = en.hb?.cfg_at === undefined;  // reports no settings stamp: firmware before 2026-10-28
  if (en.usb || en.hello?.power !== "battery" || !old || keep(en.node)) return { en, release: false };
  try {
    const h = await target(link, en.node).request("hello", BG);
    return { en, release: !!h.ok && ((h.hold_s as number | undefined) ?? 0) <= DWELL_S };
  } catch { return { en, release: false }; }
}
export const surveyAsk = (link: NodeLink, s: Surveyed, cmd: string, body: Record<string, unknown> = {}): Promise<Reply> =>
  target(link, s.en.usb ? null : s.en.node).request(cmd, { ...body, ...BG });
export function surveyEnd(link: NodeLink, s: Surveyed) {
  if (s.release) void target(link, s.en.node).request("hold_awake", { min: 0 }).catch(() => undefined);
}

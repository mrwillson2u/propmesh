// Firmware updates in progress, kept outside any view: a mesh transfer
// runs in this browser (the console streams the image through the bridge
// in acknowledged chunks), so it used to stop the moment the Firmware
// panel was left — the bridge was never the limit (Colin, 2026-10-24).
// The panel and the node list read this store; the transfer and the
// "did it come back with the new build" check run here until done.
import { useSyncExternalStore } from "react";
import { getConnection, isMissing } from "./connection";
import { target, type NodeLink } from "./transport";
import { imageUrlFor, streamImage, type Image } from "./ota";

export type JobState = "sent" | "sending" | "waiting" | "done" | "failed";
export interface Job { state: JobState; since: number; was?: string; sent?: string; upWas?: number; note?: string; progress?: number }
const CAME_BACK_MS = 240000; // a download plus the reboot, generously

let jobs: Record<string, Job> = {};
let version = 0;
const listeners = new Set<() => void>();
const stops = new Map<string, { stop: boolean }>();
let checker: ReturnType<typeof setInterval> | null = null;

function set(node: string, j: Job | ((prev: Job | undefined) => Job)) {
  jobs = { ...jobs, [node]: typeof j === "function" ? j(jobs[node]) : j };
  version++;
  listeners.forEach((l) => l());
  startChecker();
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useOtaJobs(): Record<string, Job> {
  useSyncExternalStore(subscribe, () => version);
  return jobs;
}
export const otaJobs = () => jobs;
export const otaBusy = (j?: Job) => !!j && j.state !== "failed" && j.state !== "done";
// Over the mesh one image streams at a time — the bridge can carry no more.
export const otaStreaming = () => Object.keys(jobs).find((n) => jobs[n]?.state === "sending");
export function stopOta(node: string) { const s = stops.get(node); if (s) s.stop = true; }

// A board that was sent an update is done when its hello shows a different
// build; it goes quiet (missing) while it downloads and reboots.
function startChecker() {
  if (checker) return;
  checker = setInterval(() => {
    const c = getConnection();
    const now = Date.now();
    let any = false;
    for (const [node, j] of Object.entries(jobs)) {
      if (j.state === "done" || j.state === "failed") continue;
      any = true;
      const en = c?.entries[node];
      const build = en?.hello?.build;
      // Done when the board is back with a different build, or back on
      // probation, or its uptime restarted — the same build sent again.
      const rebooted = en?.hello?.pending || (j.upWas !== undefined && en?.hb !== undefined && en.hb.up < j.upWas);
      // Back on the build it had, after a *different* one was sent and
      // accepted: the new image ran, crashed before its 20 s, and the
      // board rolled back (Candle 1, 2026-10-24 — read as "✓ updated").
      // Its hello says why it last restarted; a brownout is the usual one.
      const sameAsBefore = !!build && build === j.was && !!j.sent && j.sent !== j.was;
      if (en && build && sameAsBefore && (rebooted || en.hello?.pending === false)) {
        const why = en.hello?.reset;
        set(node, { ...j, state: "failed", note: `rolled back to ${build} — the new image didn't run 20 s${why ? ` (restart: ${why})` : ""}; a weak supply usually, check its power` });
      } else if (en && build && (build !== j.was || rebooted)) set(node, { ...j, state: "done", note: build !== j.was ? `now ${build}` : `restarted on ${build}` });
      else if (j.state === "sent" && en && isMissing(en, now)) set(node, { ...j, state: "waiting" });
      else if (j.state !== "sending" && now - j.since > CAME_BACK_MS) set(node, { ...j, state: "failed", note: "didn't come back with a new build — check its serial log" });
    }
    if (!any && checker) { clearInterval(checker); checker = null; }
  }, 1000);
}

const explain = (note: string) => /unknown command|unknown cmd/i.test(note)
  ? "this board's firmware predates mesh updates — update it once over USB or WiFi, then the mesh works"
  : note;

// Stream an image to one board over the mesh. Returns when the board has
// accepted it (it then reboots; the checker waits for it to come back).
export async function startMeshUpdate(link: NodeLink, node: string, usb: boolean, img: Image, was: string | undefined, upWas: number | undefined) {
  const t = target(link, usb ? null : node);
  const sig = { stop: false };
  stops.set(node, sig);
  set(node, { state: "sending", since: Date.now(), was, sent: img.build, upWas, progress: 0 });
  try {
    await streamImage(t, img, (w, total) => set(node, (j) => ({ ...(j ?? { state: "sending", since: 0 }), progress: w / total, since: Date.now() })), sig);
    set(node, (j) => ({ ...(j ?? { state: "sending", since: 0 }), state: "waiting", since: Date.now(), progress: 1 }));
  } catch (e) {
    set(node, { state: "failed", since: Date.now(), note: explain((e as Error).message) });
  } finally { stops.delete(node); }
}

// Tell a board to fetch the image itself over WiFi.
export async function startWifiUpdate(link: NodeLink, node: string, usb: boolean, board: string | undefined, url: string, ssid: string, pass: string, was: string | undefined, upWas: number | undefined, sent?: string) {
  const t = target(link, usb ? null : node);
  set(node, { state: "sent", since: Date.now(), was, sent, upWas });
  try {
    const r = await t.request("ota", { url: board ? imageUrlFor(url, board) : url, ssid, pass });
    if (!r.ok) set(node, { state: "failed", since: Date.now(), note: explain(r.error ?? "refused") });
  } catch (e) { set(node, { state: "failed", since: Date.now(), note: explain((e as Error).message) }); }
}

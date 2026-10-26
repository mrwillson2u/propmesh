// Firmware updates in progress, kept outside any view: a mesh transfer
// runs in this browser (the console streams the image through the bridge
// in acknowledged chunks), so it used to stop the moment the Firmware
// panel was left — the bridge was never the limit (Colin, 2026-10-24).
// The panel and the node list read this store; the transfer and the
// "did it come back with the new build" check run here until done.
import { useSyncExternalStore } from "react";
import { getConnection, isMissing, onHeartbeat, batteryState } from "./connection";
import { target, type NodeLink } from "./transport";
import { imageUrlFor, streamImage, type Image } from "./ota";

export type JobState = "queued" | "sent" | "sending" | "waiting" | "done" | "failed";
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
export function stopOta(node: string) {
  const s = stops.get(node); if (s) s.stop = true;
  if (queue.has(node)) { queue.delete(node); const { [node]: _, ...rest } = jobs; jobs = rest; version++; listeners.forEach((l) => l()); }
}

// ---- update when awake (Colin, 2026-10-26) ----------------------------------
// A sleeping board is queued; its next heartbeat (it is awake a few
// seconds) is the moment: if no other transfer is running, it is asked to
// hold itself awake and the image streams. If one is running, it is left to
// sleep and tried at its next check-in — the bridge carries one transfer at
// a time. A board whose battery is critical waits for a charge rather than
// risk a brownout mid-update (Candles 1 and 2, 2026-10-24). The image stays
// in this browser: nothing is cached on the bridge, so this works while a
// console tab is open.
const queue = new Map<string, { link: NodeLink; img: Image; was?: string; upWas?: number }>();
let unsub: (() => void) | null = null;
export function queueMeshUpdate(link: NodeLink, node: string, img: Image, was: string | undefined, upWas: number | undefined) {
  queue.set(node, { link, img, was, upWas });
  set(node, { state: "queued", since: Date.now(), was, sent: img.build, upWas, note: "at its next check-in" });
  if (!unsub) unsub = onHeartbeat((n) => void woke(n));
}
async function woke(node: string) {
  const q = queue.get(node);
  if (!q) return;
  if (otaStreaming()) { set(node, (j) => ({ ...(j ?? { state: "queued", since: Date.now() }), note: "another board was updating — next check-in" })); return; }
  const en = getConnection()?.entries[node];
  const b = en ? batteryState(en) : null;
  if (b && (b.level === "critical" || b.level === "out")) { set(node, (j) => ({ ...(j ?? { state: "queued", since: Date.now() }), note: `waiting for a charge (${b.mv ? (b.mv / 1000).toFixed(2) + " V" : "low"})` })); return; }
  queue.delete(node);
  if (!queue.size && unsub) { unsub(); unsub = null; }
  try { await target(q.link, node).request("hold_awake", { min: 15 }); } catch { /* the transfer's own requests hold it too */ }
  await startMeshUpdate(q.link, node, false, q.img, q.was, q.upWas);
}

// A board that was sent an update is done when its hello shows a different
// build; it goes quiet (missing) while it downloads and reboots.
function startChecker() {
  if (checker) return;
  checker = setInterval(() => {
    const c = getConnection();
    const now = Date.now();
    let any = false;
    for (const [node, j] of Object.entries(jobs)) {
      if (j.state === "done" || j.state === "failed" || j.state === "queued") continue;
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
      // Judge only on a hello from this boot: the restart's first heartbeat
      // arrives before its fresh hello, and the old one still names the old build.
      const stale = !!rebooted && !!en?.hb && en.hello?.up_s !== undefined && en.hello.up_s > en.hb.up + 5;
      if (en && build && !stale && sameAsBefore && (rebooted || en.hello?.pending === false)) {
        const why = en.hello?.reset;
        // A battery board on a build before d9ed9ab sleeps before it
        // confirms (the lantern and Candle 1 on release 848c2d7, 2026-10-26);
        // a crash or a sagging supply are the other reasons.
        set(node, { ...j, state: "failed", note: `rolled back to ${build} — the new image restarted before it was confirmed (20 s up)${why ? `; last restart: ${why}` : ""}` });
      } else if (en && build && !stale && (build !== j.was || rebooted)) set(node, { ...j, state: "done", note: build !== j.was ? `now ${build}` : `restarted on ${build}` });
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

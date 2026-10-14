// Stream a firmware image to one board over the mesh (docs §6c): base64
// chunks through the USB bridge, each acknowledged with the bytes written,
// so a lost request resumes from the board's count instead of starting
// over. The image comes from tools/ota_serve.py (fetched here, CORS open)
// or a local file.
import type { NodeTarget } from "./transport";

export interface Image { bytes: Uint8Array; sha256: string; build: string; board?: string }

// The URL of a board's own image: the server lays builds out as
// <root>/<board id>/firmware.bin (tools/ota_serve.py). A URL without a
// board segment (the old single-image layout) is used as given.
export function imageUrlFor(url: string, board: string): string {
  const m = url.match(/^(.*\/)(esp32-[a-z0-9-]+)\/(firmware\.bin)$/);
  return m ? `${m[1]}${board}/${m[3]}` : url;
}

// The latest release, as the docs site publishes it for each board type
// (website/scripts/stage-firmware.mjs): <site>/firmware/<board>/firmware.bin
// beside its version.json. GitHub Pages allows cross-origin fetches.
export const RELEASE_ROOT = "https://mrwillson2u.github.io/propmesh/firmware";
export const releaseUrl = (board: string) => `${RELEASE_ROOT}/${board}/firmware.bin`;

export async function fetchImage(url: string): Promise<Image> {
  const [bin, ver] = await Promise.all([
    fetch(url, { cache: "no-store" }),
    fetch(url.replace(/firmware\.bin$/, "version.json"), { cache: "no-store" }),
  ]);
  if (!bin.ok) throw new Error(`firmware.bin: ${bin.status}`);
  const bytes = new Uint8Array(await bin.arrayBuffer());
  const info = ver.ok ? await ver.json() as { build?: string; sha256?: string } : {};
  const sha256 = info.sha256 && info.sha256.length === 64 ? info.sha256 : await digest(bytes);
  return { bytes, sha256, build: info.build ?? "?" };
}

export async function fileImage(file: File): Promise<Image> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, sha256: await digest(bytes), build: file.name.replace(/\.bin$/, "").slice(0, 12) };
}

async function digest(bytes: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const b64 = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 0x2000) s += String.fromCharCode(...b.subarray(i, i + 0x2000));
  return btoa(s);
};

// A lost chunk is normal on a weak link: the bridge tries each one 3
// times, then answers "no reply from node …". Until 2026-10-09 that one
// answer cancelled the whole transfer and the next try started from
// zero, so a ~490-chunk image at −69 dBm never finished. Now a lost
// chunk is sent again, and only this long with NO progress gives up.
const STALL_MS = 180000;
const transient = (msg: string) => /no reply from node|bridge busy|timed out|timeout|not answer|out of memory/i.test(msg);

// Resolves when the board has accepted the whole image (it then reboots);
// rejects with the board's reason. `onProgress` gets bytes written. A
// failed transfer is NOT cancelled on the board: pressing Update again
// with the same image resumes where it stopped (firmware from 2026-10-09;
// older firmware restarts it).
export async function streamImage(node: NodeTarget, img: Image, onProgress: (written: number, total: number) => void, signal?: { stop: boolean }) {
  let begin = await retrying(() => node.request("ota_begin", { size: img.bytes.length, sha256: img.sha256 }), signal);
  // Boards before 1a779c7 stayed "busy" after a failed transfer until
  // rebooted; ota_abort clears that, so clear it and ask once more.
  if (!begin.ok && /already running|update is running/.test(begin.error ?? "")) {
    await node.request("ota_abort").catch(() => undefined);
    begin = await node.request("ota_begin", { size: img.bytes.length, sha256: img.sha256 });
  }
  if (!begin.ok) throw new Error(begin.error ?? "the board refused to start");
  const from = typeof begin.written === "number" ? begin.written : 0;
  if (from) onProgress(from, img.bytes.length);
  try {
    await send(node, img, (begin.chunk as number) || 2700, from, onProgress, signal);
  } catch (e) {
    // Stopped by hand: cancel on the board. Anything else: leave it to resume.
    if (signal?.stop) await node.request("ota_abort").catch(() => undefined);
    throw e;
  }
}

// One request, re-sent while the failure looks like the radio, until it
// answers or STALL_MS passes.
async function retrying(ask: () => Promise<{ ok: boolean; error?: string; [k: string]: unknown }>, signal?: { stop: boolean }) {
  const t0 = Date.now();
  for (;;) {
    if (signal?.stop) throw new Error("stopped");
    try {
      const r = await ask();
      if (r.ok || !transient(r.error ?? "") || Date.now() - t0 > STALL_MS) return r;
    } catch (e) {
      if (Date.now() - t0 > STALL_MS) throw e;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function send(node: NodeTarget, img: Image, chunk: number, start: number, onProgress: (written: number, total: number) => void, signal?: { stop: boolean }) {
  let off = start, lastProgress = Date.now(), lastErr = "";
  while (off < img.bytes.length) {
    if (signal?.stop) throw new Error("stopped");
    if (Date.now() - lastProgress > STALL_MS)
      throw new Error(`no progress for ${STALL_MS / 60000} min at ${Math.round((off / img.bytes.length) * 100)} % (${lastErr || "no answer"}) — press Update again to resume`);
    const data = b64(img.bytes.subarray(off, off + chunk));
    let r;
    try { r = await node.request("ota_data", { off, data }); }
    catch (e) { lastErr = (e as Error).message; await new Promise((r) => setTimeout(r, 500)); continue; }
    if (r.ok) { off = r.written as number; lastProgress = Date.now(); onProgress(off, img.bytes.length); continue; }
    const err = r.error ?? "";
    // The chunk arrived but its reply was lost, so we're behind: carry on from its count.
    if (typeof r.written === "number" && err.startsWith("offset")) { off = r.written; continue; }
    if (transient(err)) { lastErr = err; await new Promise((r) => setTimeout(r, 500)); continue; }
    throw new Error(err || "the board refused a chunk");
  }
  // If ota_end's reply is lost, the retry finds the transfer already
  // closed — the board took the image and is rebooting. The panel then
  // waits for it to come back with the new build, which settles it.
  let tries = 0;
  const end = await retrying(() => { tries++; return node.request("ota_end", { build: img.build }); }, signal);
  if (!end.ok && !(tries > 1 && /no update in progress/.test(end.error ?? ""))) throw new Error(end.error ?? "the board refused the image");
}

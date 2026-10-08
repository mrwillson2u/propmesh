// Stream a firmware image to one board over the mesh (docs §6c): base64
// chunks through the USB bridge, each acknowledged with the bytes written,
// so a lost request resumes from the board's count instead of starting
// over. The image comes from tools/ota_serve.py (fetched here, CORS open)
// or a local file.
import type { NodeTarget } from "./transport";

export interface Image { bytes: Uint8Array; sha256: string; build: string }

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

// Resolves when the board has accepted the whole image (it then reboots);
// rejects with the board's reason. `onProgress` gets bytes written.
export async function streamImage(node: NodeTarget, img: Image, onProgress: (written: number, total: number) => void, signal?: { stop: boolean }) {
  const begin = await node.request("ota_begin", { size: img.bytes.length, sha256: img.sha256 });
  if (!begin.ok) throw new Error(begin.error ?? "the board refused to start");
  try {
    await send(node, img, (begin.chunk as number) || 2700, onProgress, signal);
  } catch (e) {
    // Leave the board ready for the next try (it also drops a transfer
    // that goes silent for a minute, in case this doesn't get through).
    await node.request("ota_abort").catch(() => undefined);
    throw e;
  }
}

async function send(node: NodeTarget, img: Image, chunk: number, onProgress: (written: number, total: number) => void, signal?: { stop: boolean }) {
  let off = 0, misses = 0;
  while (off < img.bytes.length) {
    if (signal?.stop) throw new Error("stopped");
    const data = b64(img.bytes.subarray(off, off + chunk));
    let r;
    try { r = await node.request("ota_data", { off, data }); }
    catch (e) { if (++misses > 8) throw e; continue; }  // lost on the mesh: same offset again
    if (r.ok) { off = r.written as number; misses = 0; onProgress(off, img.bytes.length); continue; }
    if (typeof r.written === "number" && (r.error ?? "").startsWith("offset")) { off = r.written; continue; }  // resume from its count
    throw new Error(r.error ?? "the board refused a chunk");
  }
  const end = await node.request("ota_end", { build: img.build });
  if (!end.ok) throw new Error(end.error ?? "the board refused the image");
}

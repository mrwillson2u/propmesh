// Update firmware over the air (docs/generic-boards.md §6c). Over the
// mesh (the default — props are out of WiFi reach): the console streams the
// image through the USB bridge in acknowledged chunks. Over WiFi (when the
// laptop's network reaches the board): the board is told the URL and your
// WiFi and pulls it itself. Either way it reboots and comes back on the
// mesh with the new build id. WiFi details stay in this browser.
import { useEffect, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { Spinner, mono, sys } from "../../ui";
import { target, type NodeLink } from "../../lib/transport";
import { isMissing, type Entry } from "../../lib/connection";
import { fetchImage, fileImage, streamImage, type Image } from "../../lib/ota";

const KEY = "propmesh.ota";
const btn = (primary = false, disabled = false): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
  background: primary ? C.emberBg : C.raised,
  border: `1px solid ${primary ? C.ember : C.b3}`,
  ...sys(600, 11.5, primary ? C.emberT : C.t2),
});
const field: React.CSSProperties = {
  height: 30, padding: "0 9px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 6, ...sys(500, 12.5, C.t1),
};

interface Served { build: string; size: number; sha256: string }
type Job = { state: "sent" | "sending" | "waiting" | "done" | "failed"; since: number; was?: string; note?: string; progress?: number };
const CAME_BACK_MS = 240000; // a download plus the reboot, generously

export default function OtaPanel({ link, entries }: { link: NodeLink; entries: Record<string, Entry> }) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } })() as Partial<{ url: string; ssid: string; pass: string; mode: string }>;
  const [mode, setMode] = useState<"mesh" | "wifi">(stored.mode === "wifi" ? "wifi" : "mesh");
  const [image, setImage] = useState<Image | "loading" | null>(null);
  const [imageErr, setImageErr] = useState<string | null>(null);
  const stops = useRef(new Map<string, { stop: boolean }>());
  const [url, setUrl] = useState(stored.url ?? "");
  const [ssid, setSsid] = useState(stored.ssid ?? "");
  const [pass, setPass] = useState(stored.pass ?? "");
  const [served, setServed] = useState<Served | null | "checking" | "error">(null);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;
  // The connection store re-renders every second; the checker below must
  // outlive renders, so it reads the latest entries through a ref.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ url, ssid, pass, mode })); } catch { /* private mode */ } }, [url, ssid, pass, mode]);

  const known = Object.values(entries).filter((e) => e.hello)
    .sort((a, b) => Number(a.usb) - Number(b.usb) || (a.hello!.name || a.node).localeCompare(b.hello!.name || b.node));
  const nameOf = (n: string) => entries[n]?.hello?.name || n;

  // What the server offers: version.json next to firmware.bin.
  const check = async () => {
    setServed("checking");
    if (link.via === "sim") {  // no server: the URL's last path segment is the "build"
      const build = url.replace(/\/firmware\.bin$/, "").split("/").pop() || "simnew";
      setTimeout(() => setServed({ build: build.slice(0, 12), size: 1282768, sha256: "" }), 400);
      return;
    }
    try {
      const r = await fetch(url.replace(/firmware\.bin$/, "version.json"), { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setServed(await r.json() as Served);
    } catch { setServed("error"); }
  };
  useEffect(() => { if (url) void check(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // The image for the mesh path: from the serve script's URL, or a file.
  const loadImage = async (file?: File) => {
    setImage("loading");
    setImageErr(null);
    try {
      if (link.via === "sim") {  // no server behind the URL: a fake image of the right size
        const build = url.replace(/\/firmware\.bin$/, "").split("/").pop() || "simnew";
        setImage({ bytes: new Uint8Array(27000), sha256: "0".repeat(64), build: build.slice(0, 12) });
        return;
      }
      setImage(file ? await fileImage(file) : await fetchImage(url));
    } catch (e) {
      setImage(null);
      setImageErr((e as Error).message);
    }
  };

  // A board that was sent an update is done when its hello shows a
  // different build; it goes quiet (missing) while it downloads and reboots.
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now();
      let changed = false;
      const next = { ...jobsRef.current };
      for (const [node, j] of Object.entries(next)) {
        if (j.state === "done" || j.state === "failed") continue;
        const en = entriesRef.current[node];
        const build = en?.hello?.build;
        // Back with a different build, or back on probation (same build re-sent).
        if (en && build && (build !== j.was || (j.state === "waiting" && en.hello?.pending))) { next[node] = { ...j, state: "done", note: `now ${build}` }; changed = true; }
        else if (j.state === "sent" && en && isMissing(en, now)) { next[node] = { ...j, state: "waiting" }; changed = true; }
        else if (j.state !== "sending" && now - j.since > CAME_BACK_MS) { next[node] = { ...j, state: "failed", note: "didn't come back with a new build — check its serial log" }; changed = true; }
      }
      if (changed) setJobs(next);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const update = async (node: string) => {
    const en = entries[node];
    if (!en) return;
    const t = target(link, en.usb ? null : node);
    const failed = (note: string) => setJobs((j) => ({ ...j, [node]: { state: "failed", since: Date.now(), note: explain(note) } }));
    // A board running firmware from before mesh updates existed doesn't
    // know ota_begin; it needs one update by USB (or over WiFi) first.
    const explain = (note: string) => /unknown command|unknown cmd/i.test(note)
      ? "this board's firmware predates mesh updates — update it once over USB or WiFi, then the mesh works"
      : note;
    if (mode === "mesh") {
      if (typeof image !== "object" || !image) return;
      const sig = { stop: false };
      stops.current.set(node, sig);
      setJobs((j) => ({ ...j, [node]: { state: "sending", since: Date.now(), was: en.hello?.build, progress: 0 } }));
      try {
        await streamImage(t, image, (w, total) => setJobs((j) => ({ ...j, [node]: { ...j[node], progress: w / total, since: Date.now() } })), sig);
        // Accepted and verified: it reboots now; the checker waits for it to come back.
        setJobs((j) => ({ ...j, [node]: { ...j[node], state: "waiting", since: Date.now(), progress: 1 } }));
      } catch (e) { failed((e as Error).message); }
      return;
    }
    setJobs((j) => ({ ...j, [node]: { state: "sent", since: Date.now(), was: en.hello?.build } }));
    try {
      const r = await t.request("ota", { url, ssid, pass });
      if (!r.ok) failed(r.error ?? "refused");
    } catch (e) { failed((e as Error).message); }
  };
  // Everyone but the USB board: that one takes the console down with it,
  // so it gets its own click, last.
  const updateAll = async () => { for (const en of known) if (!en.usb) await update(en.node); };

  const servedBuild = mode === "mesh"
    ? (typeof image === "object" && image ? image.build : null)
    : (typeof served === "object" && served ? served.build : null);
  const ready = mode === "mesh" ? servedBuild !== null : !!url && !!ssid && servedBuild !== null;
  const busy = (j?: Job) => !!j && j.state !== "failed" && j.state !== "done";
  const pill = (on: boolean): React.CSSProperties => ({
    ...btn(on), height: 26, padding: "0 10px",
  });

  return (
    <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={sys(700, 14, C.t1)}>Update firmware</span>
        <span style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setMode("mesh")} style={pill(mode === "mesh")}>Over the mesh</button>
          <button onClick={() => setMode("wifi")} style={pill(mode === "wifi")}>Over WiFi</button>
        </span>
        <span style={sys(400, 12, C.t3)}>
          {mode === "mesh"
            ? "The image streams through the bridge to each board in turn — nothing to unplug, no WiFi needed. About six minutes a board."
            : "Each board joins your WiFi and fetches the image itself — fast, when your WiFi reaches the board. Details stay in this browser."}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={sys(500, 11.5, C.t4)}>Run <code style={mono(600, 11, C.t2)}>python3 tools/ota_serve.py --build</code> on the laptop and paste its URL:</span>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:8266/firmware.bin" style={{ ...field, width: 300 }} />
        {mode === "mesh" ? (
          <>
            <button onClick={() => void loadImage()} disabled={!url || image === "loading"} style={btn(false, !url || image === "loading")}>Load image</button>
            <label style={{ ...btn(), display: "inline-flex", alignItems: "center" }} title="…or pick a firmware.bin from this computer">
              from file
              <input type="file" accept=".bin" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadImage(f); }} />
            </label>
            {image === "loading" && <Spinner />}
            {imageErr && <span style={mono(600, 11, C.red)}>✕ {imageErr} — is ota_serve.py running?</span>}
            {typeof image === "object" && image && <span style={mono(600, 11, C.green)}>✓ image build {image.build} · {(image.bytes.length / 1024).toFixed(0)} kB</span>}
          </>
        ) : (
          <>
            <button onClick={() => void check()} disabled={!url} style={btn(false, !url)}>Check</button>
            {served === "checking" && <Spinner />}
            {served === "error" && <span style={mono(600, 11, C.red)}>✕ nothing served there — is ota_serve.py running, and the laptop on the same WiFi?</span>}
            {typeof served === "object" && served && <span style={mono(600, 11, C.green)}>✓ serving build {served.build} · {(served.size / 1024).toFixed(0)} kB</span>}
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {mode === "wifi" && (
          <>
            <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="WiFi name" style={{ ...field, width: 200 }} />
            <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="WiFi password" type="password" autoComplete="off" style={{ ...field, width: 200 }} />
            <span style={sys(400, 11.5, C.t4)}>2.4 GHz only — the boards can't see 5 GHz networks.</span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => void updateAll()} disabled={!ready} style={btn(true, !ready)}>Update all mesh boards</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "180px 130px 1fr 120px", gap: "6px 12px", alignItems: "center" }}>
        <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em" }}>BOARD</span>
        <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em" }}>BUILD</span>
        <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em" }}>STATUS</span>
        <span />
        {known.map((en) => {
          const j = jobs[en.node];
          const build = en.hello?.build ?? `fw ${en.hello?.fw}`;
          const current = servedBuild !== null && build === servedBuild;
          const missing = isMissing(en, Date.now());
          return [
            <span key={en.node + "n"} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: missing ? C.red : C.green }} />
              <span style={sys(600, 12.5, C.t1)}>{nameOf(en.node)}</span>
              {en.usb && <span style={mono(700, 9.5, C.t3)}>USB</span>}
            </span>,
            <span key={en.node + "b"} style={mono(600, 11.5, current ? C.green : C.t2)}>{build}{en.hello?.pending ? " · unconfirmed" : ""}</span>,
            <span key={en.node + "s"} style={{ display: "flex", alignItems: "center", gap: 6, ...mono(500, 11, j?.state === "failed" ? C.red : j?.state === "done" ? C.green : C.t4) }}>
              {j?.state === "sending" && (
                <>
                  <span style={{ width: 160, height: 8, borderRadius: 4, background: C.raised, overflow: "hidden", flex: "none" }}>
                    <span style={{ display: "block", width: `${Math.round((j.progress ?? 0) * 100)}%`, height: "100%", background: C.ember }} />
                  </span>
                  {Math.round((j.progress ?? 0) * 100)} % sent
                  <button onClick={() => { const s = stops.current.get(en.node); if (s) s.stop = true; }} style={{ ...btn(), height: 22, padding: "0 7px" }}>stop</button>
                </>
              )}
              {j?.state === "sent" && <><Spinner size={10} /> sent — joining WiFi and downloading…</>}
              {j?.state === "waiting" && <><Spinner size={10} /> {mode === "mesh" ? "image accepted — rebooting into it…" : "gone quiet — downloading, then rebooting…"}</>}
              {j?.state === "done" && `✓ updated — ${j.note}`}
              {j?.state === "failed" && `✕ ${j.note}`}
              {!j && (current ? "up to date" : missing ? "not heard recently" : "")}
            </span>,
            <button key={en.node + "u"} onClick={() => void update(en.node)} disabled={!ready || busy(j)}
              title={en.usb ? "The USB board reboots at the end; the console usually rides it out (the USB-serial chip stays connected)" : undefined}
              style={btn(false, !ready || busy(j))}>
              {en.usb ? "Update (last)" : "Update"}
            </button>,
          ];
        })}
      </div>
      <div style={{ ...sys(400, 11.5, C.t5), lineHeight: 1.5 }}>
        A new image that crashes before it has run with the mesh up for 20 s is rolled back automatically. Do the USB board last: while it
        reboots the others can't be reached.{mode === "wifi" ? " Over WiFi a board leaves the mesh for the download (about a minute)." : ""}
      </div>
    </div>
  );
}

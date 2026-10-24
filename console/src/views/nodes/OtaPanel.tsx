// Update firmware over the air (docs/generic-boards.md §6c). Over the
// mesh (the default — props are out of WiFi reach): the console streams the
// image through the USB bridge in acknowledged chunks. Over WiFi (when the
// laptop's network reaches the board): the board is told the URL and your
// WiFi and pulls it itself. Either way it reboots and comes back on the
// mesh with the new build id. WiFi details stay in this browser.
import { useEffect, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { Spinner, mono, sys } from "../../ui";
import { directLabel, target, type NodeLink } from "../../lib/transport";
import { isMissing, type Entry } from "../../lib/connection";
import { RELEASE_IS_THIS_SITE, fetchImage, fileImage, imageUrlFor, releaseUrl, streamImage, type Image } from "../../lib/ota";

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

interface Served { build: string; built?: number; size: number; sha256: string }
type Job = { state: "sent" | "sending" | "waiting" | "done" | "failed"; since: number; was?: string; upWas?: number; note?: string; progress?: number };
const CAME_BACK_MS = 240000; // a download plus the reboot, generously

export default function OtaPanel({ link, entries }: { link: NodeLink; entries: Record<string, Entry> }) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } })() as Partial<{ url: string; ssid: string; pass: string; mode: string; source: string }>;
  const [mode, setMode] = useState<"mesh" | "wifi">(stored.mode === "wifi" ? "wifi" : "mesh");
  // Over the mesh, the image is the latest release from the docs site by
  // default (no server to run); "own" is a build served by ota_serve.py
  // or a file. Over WiFi the boards fetch it themselves over plain HTTP,
  // which the site (HTTPS only) can't serve — that path needs ota_serve.py.
  const [source, setSource] = useState<"release" | "own">(stored.source === "own" ? "own" : "release");
  const [image, setImage] = useState<Image | "loading" | null>(null);
  // Other boards' images (a HUZZAH32 needs its own build), fetched on demand.
  const images = useRef(new Map<string, Image>());
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
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ url, ssid, pass, mode, source })); } catch { /* private mode */ } }, [url, ssid, pass, mode, source]);

  const known = Object.values(entries).filter((e) => e.hello)
    .sort((a, b) => Number(a.usb) - Number(b.usb) || (a.hello!.name || a.node).localeCompare(b.hello!.name || b.node));
  const nameOf = (n: string) => entries[n]?.hello?.name || n;
  // The release image for the board the console is connected to; other
  // board types get theirs through imageUrlFor (same folder layout).
  const homeBoard = known.find((e) => e.usb)?.hello?.board ?? known[0]?.hello?.board ?? "esp32-devkit-v1";
  const meshUrl = source === "release" ? releaseUrl(homeBoard) : url;

  // What each board is doing about updates RIGHT NOW, from the board —
  // not from this page's memory, which a refresh wipes: a half-received
  // mesh image (resumable), or a WiFi download under way.
  const [onBoard, setOnBoard] = useState<Record<string, { state: string; progress: number; written: number }>>({});
  const knownKey = known.map((e) => e.node).join(",");
  // Asked again every 5 s — a once-only read went stale and showed a
  // finished/dropped transfer as still running (2026-10-10).
  useEffect(() => {
    let live = true;
    const ask = () => {
      for (const en of Object.values(entriesRef.current).filter((e) => e.hello)) {
        if (jobsRef.current[en.node]?.state === "sending") continue;  // our own transfer: don't add traffic
        target(link, en.usb ? null : en.node).request("ota_status").then((r) => {
          if (!live || !r.ok) return;
          setOnBoard((m) => ({ ...m, [en.node]: { state: r.state as string, progress: (r.progress as number) ?? 0, written: (r.written as number) ?? -1 } }));
        }).catch(() => { /* busy: next round */ });
      }
    };
    ask();
    const t = setInterval(ask, 5000);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knownKey, link]);

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
        const build = source === "release" ? "release" : url.replace(/\/firmware\.bin$/, "").split("/").pop() || "simnew";
        setImage({ bytes: new Uint8Array(27000), sha256: "0".repeat(64), build: build.slice(0, 12) });
        return;
      }
      images.current.clear();
      setImage(file ? await fileImage(file) : await fetchImage(meshUrl));
    } catch (e) {
      setImage(null);
      setImageErr((e as Error).message);
    }
  };

  // The release needs no setup: load it as soon as the panel knows which
  // board it's talking to (and again if the source or that board changes).
  useEffect(() => {
    if (mode === "mesh" && source === "release" && known.length) void loadImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, source, homeBoard, known.length > 0]);

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
        // Done when the board is back with a different build, or back on
        // probation, or its uptime restarted — the same build sent again
        // (2026-10-11: a real, confirmed update read "didn't come back"
        // because the build id hadn't changed and the 10 s download never
        // made the board look missing).
        const rebooted = en?.hello?.pending || (j.upWas !== undefined && en?.hb !== undefined && en.hb.up < j.upWas);
        if (en && build && (build !== j.was || rebooted)) { next[node] = { ...j, state: "done", note: build !== j.was ? `now ${build}` : `restarted on ${build}` }; changed = true; }
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
      // A board of another profile than the loaded image: fetch its own.
      let img: Image = image;
      const board = en.hello?.board;
      if (board && !image.board?.startsWith(board) && !image.board && link.via !== "sim" && meshUrl) {
        const own = imageUrlFor(meshUrl, board);
        if (own !== meshUrl) {
          try {
            img = images.current.get(board) ?? await fetchImage(own);
            images.current.set(board, img);
          } catch (e) { failed(`no image for ${board}: ${(e as Error).message}`); return; }
        }
      }
      const sig = { stop: false };
      stops.current.set(node, sig);
      setJobs((j) => ({ ...j, [node]: { state: "sending", since: Date.now(), was: en.hello?.build, upWas: en.hb?.up, progress: 0 } }));
      try {
        await streamImage(t, img, (w, total) => setJobs((j) => ({ ...j, [node]: { ...j[node], progress: w / total, since: Date.now() } })), sig);
        // Accepted and verified: it reboots now; the checker waits for it to come back.
        setJobs((j) => ({ ...j, [node]: { ...j[node], state: "waiting", since: Date.now(), progress: 1 } }));
      } catch (e) { failed((e as Error).message); }
      return;
    }
    setJobs((j) => ({ ...j, [node]: { state: "sent", since: Date.now(), was: en.hello?.build, upWas: en.hb?.up } }));
    try {
      const r = await t.request("ota", { url: en.hello?.board ? imageUrlFor(url, en.hello.board) : url, ssid, pass });
      if (!r.ok) failed(r.error ?? "refused");
    } catch (e) { failed((e as Error).message); }
  };
  // Everyone but the USB board: that one takes the console down with it,
  // so it gets its own click, last.
  const updateAll = async () => { for (const en of known) if (!en.usb) await update(en.node); };

  const servedBuild = mode === "mesh"
    ? (typeof image === "object" && image ? image.build : null)
    : (typeof served === "object" && served ? served.build : null);
  const servedBuilt = mode === "mesh"
    ? (typeof image === "object" && image ? image.built : undefined)
    : (typeof served === "object" && served ? served.built : undefined);
  // A board on a different build may be on a NEWER one (a branch build put
  // on for testing): the build time says so, where commit names can't.
  const newerThanServed = (en: Entry) => !!en.hello?.built && !!servedBuilt && en.hello.built > servedBuilt;
  const branchOf = (build: string) => { const m = build.match(/@(.+)$/); return m ? m[1] : null; };
  const ready = mode === "mesh" ? servedBuild !== null : !!url && !!ssid && servedBuild !== null;
  const busy = (j?: Job) => !!j && j.state !== "failed" && j.state !== "done";
  // Over the mesh one image streams at a time — the bridge can carry no
  // more — so while one is sending, every other Update is off (2026-10-23).
  // Over WiFi the boards fetch their own images, so several at once is fine.
  const streaming = mode === "mesh" ? Object.keys(jobs).find((n) => jobs[n]?.state === "sending") : undefined;
  const oneAtATime = (node: string) => !!streaming && streaming !== node;
  const oneAtATimeNote = streaming ? `one board at a time over the mesh — ${nameOf(streaming)} is being sent now` : undefined;
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
      {mode === "mesh" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={sys(500, 11.5, C.t4)}>Image:</span>
          <span style={{ display: "flex", gap: 4 }}>
            <button onClick={() => { if (source !== "release") { setImage(null); setImageErr(null); setSource("release"); } }} style={pill(source === "release")} title={RELEASE_IS_THIS_SITE ? "The firmware this site serves — a dev build, not the published release — built for each board type" : "The firmware published on the PropMesh site — the latest release, built for each board type"}>{RELEASE_IS_THIS_SITE ? "This site's build" : "Latest release"}</button>
            <button onClick={() => { if (source !== "own") { setImage(null); setImageErr(null); setSource("own"); } }} style={pill(source === "own")} title="A build of your own: from tools/ota_serve.py, or a .bin file">My own build</button>
          </span>
          {source === "release" && image === "loading" && <><Spinner /><span style={sys(400, 11.5, C.t4)}>loading from the PropMesh site…</span></>}
          {source === "release" && imageErr && (
            <span style={mono(600, 11, C.red)}>✕ couldn't load the release ({imageErr}) — is this computer online? <span onClick={() => void loadImage()} style={{ textDecoration: "underline", cursor: "pointer" }}>retry</span></span>
          )}
          {source === "release" && typeof image === "object" && image && (
            <span style={mono(600, 11, C.green)}>✓ {RELEASE_IS_THIS_SITE ? "this site's build" : "latest release"} · build {image.build} · {(image.bytes.length / 1024).toFixed(0)} kB — each board type gets its own</span>
          )}
        </div>
      )}
      {(mode === "wifi" || source === "own") && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={sys(500, 11.5, C.t4)}>
            {mode === "wifi" ? "Over WiFi the boards download the image themselves from a server on your network: run " : "Run "}
            <code style={mono(600, 11, C.t2)}>python3 tools/ota_serve.py --build</code> on the laptop and paste its URL:
          </span>
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
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {mode === "wifi" && (
          <>
            <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="WiFi name" style={{ ...field, width: 200 }} />
            <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="WiFi password" type="password" autoComplete="off" style={{ ...field, width: 200 }} />
            <span style={sys(400, 11.5, C.t4)}>2.4 GHz only — the boards can't see 5 GHz networks.</span>
          </>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => void updateAll()} disabled={!ready || !!streaming} title={oneAtATimeNote} style={btn(true, !ready || !!streaming)}>Update all mesh boards</button>
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
          const newer = !current && newerThanServed(en);
          const branch = branchOf(build);
          const missing = isMissing(en, Date.now());
          return [
            <span key={en.node + "n"} style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: missing ? C.red : C.green }} />
              <span style={sys(600, 12.5, C.t1)}>{nameOf(en.node)}</span>
              {en.usb && <span style={mono(700, 9.5, C.t3)}>{directLabel(link)}</span>}
            </span>,
            <span key={en.node + "b"} style={mono(600, 11.5, current ? C.green : newer ? C.amber : C.t2)} title={branch ? `a build from the ${branch} branch, not the published one` : undefined}>
              {branch ? build.slice(0, build.indexOf("@")) : build}{branch && <span style={{ color: C.amber }}>@{branch}</span>}{en.hello?.pending ? " · unconfirmed" : ""}
            </span>,
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
              {!j && (current ? "up to date" : newer ? `newer than this site's build (built ${new Date((en.hello!.built!) * 1000).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}) — Update would put the older one on` : missing ? "not heard recently"
                : onBoard[en.node]?.state === "downloading" && onBoard[en.node].written > 0
                  ? `paused at ${onBoard[en.node].progress} % received — Update resumes it (same image)`
                // Firmware before 2026-10-09 reports a mesh transfer and a WiFi
                // download alike (no `written`): don't guess which.
                : onBoard[en.node]?.state === "downloading" && onBoard[en.node].written < 0
                  ? `holding a part-received update (${onBoard[en.node].progress} %) — Update starts it again`
                : onBoard[en.node]?.state === "downloading" || onBoard[en.node]?.state === "connecting"
                  ? `downloading over WiFi… ${onBoard[en.node].progress} %`
                : !ready ? "load an image above to update" : "")}
            </span>,
            <button key={en.node + "u"} onClick={() => void update(en.node)} disabled={!ready || busy(j) || oneAtATime(en.node)}
              title={oneAtATime(en.node) ? oneAtATimeNote : en.usb ? (link.via === "wifi"
                ? "The console's own bridge: it reboots at the end and the console reconnects by itself. Over WiFi is the sturdier way to update this one."
                : "The USB board reboots at the end; the console usually rides it out (the USB-serial chip stays connected)") : undefined}
              style={btn(false, !ready || busy(j) || oneAtATime(en.node))}>
              {en.usb ? "Update (last)" : "Update"}
            </button>,
          ];
        })}
      </div>
      <div style={{ ...sys(400, 11.5, C.t5), lineHeight: 1.5 }}>
        A new image that crashes before it has run with the mesh up for 20 s is rolled back automatically. Do the bridge (the board the console is connected to) last: while it
        reboots the others can't be reached.{mode === "wifi" ? " Over WiFi a board leaves the mesh for the download (about a minute)." : ""}
      </div>
    </div>
  );
}

// Update firmware over the air (docs/generic-boards.md §6c): the laptop
// serves firmware.bin (tools/ota_serve.py); each node is told the URL and
// your WiFi, pulls the image, reboots and comes back on the mesh with the
// new build id. WiFi details stay in this browser.
import { useEffect, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { Spinner, mono, sys } from "../../ui";
import { target, type NodeLink } from "../../lib/transport";
import { isMissing, type Entry } from "../../lib/connection";

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
type Job = { state: "sent" | "waiting" | "done" | "failed"; since: number; was?: string; note?: string };
const CAME_BACK_MS = 240000; // a download plus the reboot, generously

export default function OtaPanel({ link, entries }: { link: NodeLink; entries: Record<string, Entry> }) {
  const stored = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } })() as Partial<{ url: string; ssid: string; pass: string }>;
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
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify({ url, ssid, pass })); } catch { /* private mode */ } }, [url, ssid, pass]);

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
        else if (now - j.since > CAME_BACK_MS) { next[node] = { ...j, state: "failed", note: "didn't come back with a new build — check its serial log" }; changed = true; }
      }
      if (changed) setJobs(next);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const update = async (node: string) => {
    const en = entries[node];
    if (!en) return;
    setJobs((j) => ({ ...j, [node]: { state: "sent", since: Date.now(), was: en.hello?.build } }));
    try {
      const r = await target(link, en.usb ? null : node).request("ota", { url, ssid, pass });
      if (!r.ok) setJobs((j) => ({ ...j, [node]: { state: "failed", since: Date.now(), note: r.error ?? "refused" } }));
    } catch (e) {
      setJobs((j) => ({ ...j, [node]: { state: "failed", since: Date.now(), note: (e as Error).message } }));
    }
  };
  // Everyone but the USB board: that one takes the console down with it,
  // so it gets its own click, last.
  const updateAll = async () => { for (const en of known) if (!en.usb) await update(en.node); };

  const servedBuild = typeof served === "object" && served ? served.build : null;
  const ready = !!url && !!ssid && servedBuild !== null;
  const busy = (j?: Job) => !!j && j.state !== "failed" && j.state !== "done";

  return (
    <div style={{ padding: "12px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <span style={sys(700, 14, C.t1)}>Update firmware</span>
        <span style={sys(400, 12, C.t3)}>
          On the laptop run <code style={mono(600, 11.5, C.t2)}>python3 tools/ota_serve.py --build</code>, paste the URL it prints, and the boards fetch it over your WiFi.
          WiFi details stay in this browser.
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.20:8266/firmware.bin" style={{ ...field, width: 320 }} />
        <button onClick={() => void check()} disabled={!url} style={btn(false, !url)}>Check</button>
        {served === "checking" && <Spinner />}
        {served === "error" && <span style={mono(600, 11, C.red)}>✕ nothing served there — is ota_serve.py running, and the laptop on the same WiFi?</span>}
        {servedBuild !== null && typeof served === "object" && served && <span style={mono(600, 11, C.green)}>✓ serving build {served.build} · {(served.size / 1024).toFixed(0)} kB</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="WiFi name" style={{ ...field, width: 200 }} />
        <input value={pass} onChange={(e) => setPass(e.target.value)} placeholder="WiFi password" type="password" autoComplete="off" style={{ ...field, width: 200 }} />
        <span style={sys(400, 11.5, C.t4)}>2.4 GHz only — the boards can't see 5 GHz networks.</span>
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
              {j?.state === "sent" && <><Spinner size={10} /> sent — joining WiFi and downloading…</>}
              {j?.state === "waiting" && <><Spinner size={10} /> gone quiet — downloading, then rebooting…</>}
              {j?.state === "done" && `✓ updated — ${j.note}`}
              {j?.state === "failed" && `✕ ${j.note}`}
              {!j && (current ? "up to date" : missing ? "not heard recently" : "")}
            </span>,
            <button key={en.node + "u"} onClick={() => void update(en.node)} disabled={!ready || busy(j)}
              title={en.usb ? "The USB board reboots mid-update: the console disconnects — reconnect after" : undefined}
              style={btn(false, !ready || busy(j))}>
              {en.usb ? "Update (last)" : "Update"}
            </button>,
          ];
        })}
      </div>
      <div style={{ ...sys(400, 11.5, C.t5), lineHeight: 1.5 }}>
        A board leaves the mesh for the download (about a minute) and comes back on reboot. A new image that crashes before it has run with
        the mesh up for 20 s is rolled back automatically. The USB board takes the console down with it — do it last, then reconnect.
      </div>
    </div>
  );
}

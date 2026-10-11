// Shell 2b (chosen): 176px left rail — logo, nav, pinned telemetry +
// STOP ALL. Per the handoff, STOP ALL must always be visible.
import { useEffect, useRef, useState } from "react";
import { C, MONO } from "./lib/tokens";
import { useMesh } from "./lib/mesh";
import { useSettings } from "./lib/settings";
import { armAll, counts, getConnection, openConnection, showState, stopAll, useConnection } from "./lib/connection";
import { reconnectLast } from "./lib/transport";
import { Logo, StopOctagon, mono } from "./ui";
import { MODE_LABEL, hhmm } from "./lib/schedule";
import Yard, { type YardLayout } from "./views/Yard";
import Nodes from "./views/Nodes";
import Cues from "./views/Cues";
import ShowGraph from "./views/ShowGraph";
import Settings from "./views/Settings";
import NotWired from "./views/NotWired";
import RealYard from "./views/yard/RealYard";
import ShowView from "./views/show/ShowView";
import { select } from "./lib/connection";

const VIEWS = [
  { name: "Yard", icon: "◎" },
  { name: "Nodes & Channels", icon: "☰" },
  { name: "Cues", icon: "▸" },
  { name: "Show Graph", icon: "⬡" },
  { name: "Settings", icon: "⚙" },
] as const;
type ViewName = (typeof VIEWS)[number]["name"];

// ?view=yard|nodes|cues|show deep-links a view; ?layout=topology|map
// picks the yard projection. The old survey/blueprint names still work.
const q = () => new URLSearchParams(location.search);

function initialView(): ViewName {
  const v = q().get("view")?.toLowerCase();
  if (v === "survey" || v === "blueprint") return "Yard";
  return VIEWS.find((x) => x.name.toLowerCase().startsWith(v ?? ""))?.name ?? "Yard";
}

function initialLayout(): YardLayout {
  const p = q();
  if (p.get("view")?.toLowerCase() === "blueprint") return "map";
  return p.get("layout")?.toLowerCase() === "map" ? "map" : "topology";
}

let autoTried = false;

export default function App() {
  const [view, setView] = useState<ViewName>(initialView);
  const mesh = useMesh();
  const { demo } = useSettings();
  const conn = useConnection();
  // A reloaded page reconnects the way it was last connected (no clicks).
  const [autoState, setAutoState] = useState<"idle" | "trying" | "failed">("idle");
  useEffect(() => {
    // Once per page load (dev StrictMode runs effects twice: two opens would
    // fight over a USB port).
    if (autoTried || demo || getConnection()) return;
    autoTried = true;
    setAutoState("trying");
    reconnectLast().then((r) => {
      if (r && !getConnection()) openConnection(r.link, r.hello);
      else void r?.link.close();
      setAutoState("idle");
    }).catch(() => setAutoState("failed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Stopped = what the boards say (every one off by hand), not what this
  // page remembers: a refresh after STOP ALL used to show it running
  // (2026-10-09). `pressedAt` bridges the second or two between pressing
  // and the boards' answers; the demo has no boards, so it stays local.
  const [pressedAt, setPressedAt] = useState(0);
  const [demoStopped, setDemoStopped] = useState(false);
  const boards = showState(conn);
  const justPressed = pressedAt > 0 && Date.now() - pressedAt < 5000;
  const stopped = demo ? demoStopped : !!conn && (boards.stopped || justPressed);
  // Off because the schedule says so (daytime), not by hand: the show is
  // NOT running, and the button must not look like it is (2026-10-11).
  // STOP ALL is the emergency stop: lit whenever ANYTHING is on — any
  // board armed or ambient, or any output on (floods switched on by hand
  // with the show off count) — and greyed out only when everything is off
  // (2026-10-11). Boards before the outputs_on field count by mode alone.
  // Until the boards have reported, it stays lit: never block a stop.
  const anythingOn = !boards.known || boards.boards.some((h) => h.mode !== "off" || (h.outputs_on ?? 0) > 0);
  const allOff = !demo && !!conn && !anythingOn;
  const offWhy = !allOff ? ""
    : boards.boards.every((h) => h.reason === "manual") ? "stopped by hand"
    : boards.boards.every((h) => h.reason === "schedule") ? "by schedule"
    : "off";
  const nextOn = allOff ? boards.boards.filter((h) => h.next_s && h.next_mode !== "off").sort((a, b) => a.next_s! - b.next_s!)[0] : undefined;
  const setStopped = (on: boolean) => { if (demo) setDemoStopped(on); else setPressedAt(on ? Date.now() : 0); };
  const [stopFailed, setStopFailed] = useState<string[]>([]);
  const [holding, setHolding] = useState(false);
  const [pct, setPct] = useState(0);
  const holdIv = useRef<ReturnType<typeof setInterval>>();

  // Press-and-hold ~1.5 s to fire; release cancels.
  // Nothing to stop without boards: the button is shown but inert.
  const canStop = demo ? !demoStopped : !!conn && anythingOn && !justPressed;
  const stopDown = () => {
    if (!canStop) return;
    clearInterval(holdIv.current);
    holdIv.current = setInterval(() => {
      setPct((p) => {
        const next = p + 0.06;
        if (next >= 1) {
          clearInterval(holdIv.current);
          setStopped(true);
          setHolding(false);
          // Real boards: every output off, every node. (Demo data is
          // never sent anything.)
          setStopFailed([]);
          void stopAll().then(setStopFailed);
          return 0;
        }
        setHolding(true);
        return next;
      });
    }, 80);
  };
  const stopUp = () => {
    clearInterval(holdIv.current);
    setHolding(false);
    setPct(0);
  };

  const navBtn = (v: (typeof VIEWS)[number]) => {
    const active = v.name === view;
    return (
      <div
        key={v.name}
        onClick={() => setView(v.name)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "9px 10px",
          borderRadius: 6, cursor: "pointer", flex: "none",
          background: active ? C.emberBg2 : undefined,
          border: active ? `1px solid ${C.emberB2}` : "1px solid transparent",
          font: `${active ? 600 : 500} 12.5px system-ui`,
          color: active ? C.emberT : C.t3,
        }}
      >
        <span style={{ fontSize: 13 }}>{v.icon}</span>
        {v.name}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "100vh", width: "100%", background: C.bg, color: C.t1, overflow: "hidden" }}>
      <div style={{ width: 176, flex: "none", background: C.panel, borderRight: `1px solid ${C.b2}`, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 14px 12px", borderBottom: `1px solid ${C.b1}` }}>
          <Logo />
          <div>
            <div style={{ font: `700 12px/1 ${MONO}`, letterSpacing: ".08em", color: C.t1 }}>PROPMESH</div>
            <div style={{ ...mono(500, 9.5, C.t5), marginTop: 3 }}>{demo ? "bridge v0.9.4 · demo" : "console"}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 8px", flex: 1, minHeight: 0, overflowY: "auto" }}>
          {VIEWS.filter((v) => v.name !== "Settings").map(navBtn)}
          <div style={{ flex: 1 }} />
          {navBtn(VIEWS.find((v) => v.name === "Settings")!)}
        </div>
        {!demo && (
          <div style={{ flex: "none", padding: "10px 12px", borderTop: `1px solid ${C.b1}`, display: "flex", flexDirection: "column", gap: 7, font: `600 10.5px ${MONO}` }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: C.t5 }}>BRIDGE</span>
              {conn
                ? conn.reconnecting
                  ? <span style={{ color: C.amber }}>◌ reconnecting…</span>
                  : <span style={{ color: C.green }}>● {conn.link.via === "usb" ? "USB" : conn.link.via === "sim" ? "SIM" : "WIFI"}</span>
                : autoState === "trying" ? <span style={{ color: C.amber }}>◌ reconnecting…</span>
                : autoState === "failed" ? <span style={{ color: C.t4 }} title="Couldn't reach the last bridge — connect in Nodes & Channels">○ not connected</span>
                : <span style={{ color: C.t4 }}>○ not connected</span>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: C.t5 }}>NODES</span>
              {conn
                ? <span>
                    <span style={{ color: C.green }}>{counts(conn).online}</span>
                    {!!counts(conn).missing && <span style={{ color: C.red }}> / {counts(conn).missing} missing</span>}
                  </span>
                : <span style={{ color: C.t5 }}>—</span>}
            </div>
          </div>
        )}
        {demo && <div style={{ flex: "none", padding: "10px 12px", borderTop: `1px solid ${C.b1}`, display: "flex", flexDirection: "column", gap: 7, font: `600 10.5px ${MONO}` }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.t5 }}>BRIDGE</span>
            <span style={{ color: C.green }}>● LINKED</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.t5 }}>SYNC</span>
            <span style={{ color: C.green }}>{mesh.sync}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: C.t5 }}>NODES</span>
            <span>
              <span style={{ color: C.green }}>{mesh.counts.online}</span>
              <span style={{ color: C.t4 }}> / {mesh.counts.asleep}</span>
              <span style={{ color: C.red }}> / {mesh.counts.missing}</span>
            </span>
          </div>
        </div>}
        <button disabled={!canStop} title={canStop ? "Hold to stop every board" : !conn && !demo ? "Connect to a bridge first" : "Everything is off — nothing to stop"}
          onMouseDown={stopDown} onMouseUp={stopUp} onMouseLeave={stopUp}
          onTouchStart={stopDown} onTouchEnd={stopUp}
          style={{
            position: "relative", overflow: "hidden", margin: 10, height: 52,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
            background: canStop ? C.emberBg : C.raised,
            border: `1.5px solid ${canStop ? C.ember : C.b3}`, borderRadius: 8,
            color: canStop ? C.emberT : C.t5,
            cursor: canStop ? "pointer" : "not-allowed",
            font: `700 13px ${MONO}`, letterSpacing: ".1em",
          }}
        >
          <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, background: "rgba(255,107,44,.35)", width: `${Math.round(pct * 100)}%` }} />
          <StopOctagon />
          <span style={{ position: "relative" }}>{justPressed ? "STOPPING…" : holding ? "HOLD…" : allOff || (demo && demoStopped) ? "ALL OFF" : "STOP ALL"}</span>
        </button>
        {allOff && (
          <div style={{ margin: "-4px 10px 10px", textAlign: "center", ...mono(600, 10.5, C.t3), lineHeight: 1.5 }}>
            {offWhy.toUpperCase()}
            {nextOn?.next_s && nextOn.next_mode && (
              <div style={{ color: C.t4, fontWeight: 500 }}>{MODE_LABEL[nextOn.next_mode].toLowerCase()} at {hhmm(nextOn.next_s * 1000, nextOn.tz_min)}</div>
            )}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {stopped && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 16px", background: C.emberBg, borderBottom: `1px solid ${C.ember}`, flex: "none" }}>
            <span style={{ font: `800 12.5px ${MONO}`, letterSpacing: ".1em", color: C.emberT }}>⬣ ALL OUTPUTS STOPPED</span>
            <span style={mono(500, 11.5, stopFailed.length ? C.red : C.t2)}>
              {!conn ? "no boards connected — nothing was sent"
                : stopFailed.length ? `all-off sent · NO CONFIRMATION from ${stopFailed.join(", ")} — check those boards`
                : "every board disarmed and all outputs off · RE-ARM SHOW re-enables triggers"}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={() => { setStopped(false); void armAll(true); }} style={{ height: 32, padding: "0 16px", background: C.ember, border: "none", borderRadius: 6, color: C.onEmber, font: `800 12px ${MONO}`, letterSpacing: ".06em" }}>
              RE-ARM SHOW
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {view === "Yard" && (demo
            ? <Yard mesh={mesh} initialLayout={initialLayout()} />
            : <RealYard
                onOpenNode={(id) => { select(id); setView("Nodes & Channels"); }}
                onConnect={() => setView("Nodes & Channels")} />)}
          {view === "Nodes & Channels" && <Nodes />}
          {view === "Cues" && (demo
            ? <Cues stopped={stopped} />
            : <ShowView onConnect={() => setView("Nodes & Channels")} />)}
          {view === "Show Graph" && (demo ? <ShowGraph /> : (
            <NotWired title="The show graph is a design preview">
              The node-graph editor for wiring triggers to sequences is planned for after the October
              show. Stage 3 sensor triggers come first.
            </NotWired>
          ))}
          {view === "Settings" && <Settings />}
        </div>
      </div>
    </div>
  );
}

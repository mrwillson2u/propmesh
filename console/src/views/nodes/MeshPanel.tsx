// Generic-board nodes as the console sees them through one USB node:
// connect, list every node heard on the mesh, pick one to edit.
// Requests for remote nodes go through the USB node over ESP-NOW.
// docs/generic-boards.md.
import { useCallback, useState } from "react";
import { battText } from "../../lib/battery";
import { C } from "../../lib/tokens";
import { useLayout } from "../../lib/layout";
import { Spinner, mono, sys, Hint, Confirm } from "../../ui";
import { BOARDS } from "../../lib/boards_gen";
import { NodeRole } from "../../lib/proto_gen";
import type { NodeConfig } from "../../lib/nodeConfig";
import { DEFAULT_WIFI_URL, connectSim, connectUsb, connectWifi, directLabel, rememberWay, target, webSerialSupported } from "../../lib/transport";
import PinEditor from "./PinEditor";
import FloodsPanel from "./FloodsPanel";
import OtaPanel from "./OtaPanel";
import { FLOODS, FLOODS_NAME } from "../../lib/floods";
import {
  closeConnection, connectionError, isMissing, onInput, openConnection, refreshHello, select,
  useConnection, type Entry, checkinText, orderedEntries, getRoster, hideNode, forgetNode, setOrder, batteryState, nextCheckin } from "../../lib/connection";

const btn = (primary = false, disabled = false): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
  background: primary ? C.emberBg : C.raised,
  border: `1px solid ${primary ? C.ember : C.b3}`,
  ...sys(600, 11.5, primary ? C.emberT : C.t2),
});

// "3 h", "12 min", "40 s" — how long since a board was heard.
export function ago(ms: number, short = false): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  if (h < 24) return short || !mm ? `${h} h` : `${h} h ${mm} min`;
  const d = Math.floor(h / 24);
  return short ? `${d} d` : `${d} d ${h % 24} h`;
}

// The firmware panel's "selected" id (not a node).
const OTA = "ota";

const tag = (text: string, color: string, bg: string): JSX.Element => (
  <span style={{ padding: "1px 6px", borderRadius: 99, background: bg, ...mono(700, 9.5, color), letterSpacing: ".05em" }}>{text}</span>
);

// The board list and its tracking live in lib/connection.ts, so they
// keep running while another view is open; this panel only shows them.
export default function MeshPanel() {
  const conn = useConnection();
  const { phone } = useLayout();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false); // hidden boards shown for a look
  const [askHide, setAskHide] = useState<Entry | null>(null); // a sleeping board about to be hidden
  const [arrange, setArrange] = useState(false); // the order is being changed
  const [wifiAddr, setWifiAddr] = useState(() => { try { return localStorage.getItem("propmesh.bridge") ?? DEFAULT_WIFI_URL; } catch { return DEFAULT_WIFI_URL; } });
  const link = conn?.link ?? null;
  const entries = conn?.entries ?? {};
  const selected = conn?.selected ?? null;
  const now = Date.now();

  const connect = async (how: "usb" | "wifi" | "sim") => {
    setBusy(true);
    setError(null);
    try {
      const { link, hello } = how === "usb" ? await connectUsb() : how === "wifi" ? await connectWifi(wifiAddr) : await connectSim();
      if (how === "wifi") { try { localStorage.setItem("propmesh.bridge", wifiAddr); } catch { /* private mode */ } }
      if (how !== "sim") rememberWay(how);
      openConnection(link, hello);
    } catch (e) {
      // Closing the port chooser is not an error worth showing.
      if ((e as Error).name !== "NotFoundError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => { rememberWay(null); void closeConnection(); };

  const onSelInput = useCallback(
    (cb: (kind: string, index: number, value: number) => void) => onInput(selected ?? "", cb),
    [selected]);

  // ---- render -------------------------------------------------------------

  if (!link) {
    // On a phone the panel is a column: words, then the address with its
    // button, then the other two ways, each a full-width thumb-sized row.
    const big: React.CSSProperties = phone ? { height: 44, flex: "1 1 auto", fontSize: 13 } : {};
    return (
      <div style={{ display: "flex", flexDirection: phone ? "column" : "row", alignItems: phone ? "stretch" : "center", gap: 12, padding: "12px 16px", background: C.panel, borderBottom: `1px solid ${C.b1}`, flex: "none" }}>
        <div style={{ flex: 1 }}>
          <div style={sys(700, 12.5, C.t1)}>Connect to your bridge</div>
          {(error ?? connectionError())
            ? <div style={{ ...mono(500, 11, C.red), marginTop: 3 }}>{error ?? connectionError()}</div>
            : <Hint style={{ marginTop: phone ? 8 : 3 }}>{webSerialSupported()
              ? "Over WiFi (the bridge's address), or plug the bridge in and connect over USB. Every node it hears on the mesh shows up here."
              : phone ? "Type the bridge's address on your WiFi. Every node it hears on the mesh shows up here."
              : "USB needs Web Serial — open the console in Chrome or Edge. The simulated mesh works anywhere."}</Hint>}
        </div>
        <span style={{ display: "flex", alignItems: "center", gap: 6, order: phone ? 1 : 0 }} title="A bridge on your WiFi (set it up on its board page over USB first)">
          <input value={wifiAddr} onChange={(e) => setWifiAddr(e.target.value)} placeholder={DEFAULT_WIFI_URL}
            onKeyDown={(e) => { if (e.key === "Enter") void connect("wifi"); }}
            style={{ height: phone ? 44 : 30, width: phone ? undefined : 190, flex: phone ? "1 1 0" : undefined, minWidth: 0, padding: "0 9px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 6, ...sys(500, phone ? 16 : 12, C.t1) }} />
          <button disabled={busy} onClick={() => connect("wifi")} style={{ ...btn(true, busy), ...(phone ? { height: 44, flex: "none", fontSize: 13 } : {}) }}>{busy ? "Connecting…" : phone ? "⌔ Connect" : "⌔ Connect over WiFi"}</button>
        </span>
        {(!phone || webSerialSupported()) && (
          <button disabled={busy || !webSerialSupported()} onClick={() => connect("usb")} style={{ ...btn(true, busy || !webSerialSupported()), ...big, order: phone ? 2 : 0 }}>
            {busy ? "Connecting…" : "⌁ Connect USB node"}
          </button>)}
        <button disabled={busy} onClick={() => connect("sim")} style={{ ...btn(false, busy), ...big, order: phone ? 3 : 0 }}>Simulated mesh</button>
      </div>
    );
  }

  const hiddenCount = getRoster().hidden.filter((n) => entries[n]).length;
  const list = conn ? orderedEntries(conn, showHidden) : [];
  const sel = selected ? entries[selected] : undefined;
  const selBoard = sel?.hello ? BOARDS[sel.hello.board] : undefined;
  // On a phone the list is the view; a board's page opens over it when a
  // row is tapped (or the Yard asks for it) and ‹ Boards goes back. The
  // connect-time default selection (the bridge) does not open a page.
  const pageOpen = phone && !!selected && (conn?.selectedAt ?? 0) > 0;
  const back = () => select(null);

  const where = (en: Entry) => en.usb ? directLabel(link)
    : en.hb ? `mesh · ${en.hb.hops === 0 ? "direct" : `${en.hb.hops + 1} hops`} · ${en.hb.rssi} dBm`
    : en.remembered ? `remembered — last heard ${ago(now - en.seen)} ago` : "mesh";

  // The hand order: the boards after the bridge, as listed; moving one
  // writes the whole order so unmoved boards keep their places.
  const moveTo = (node: string, index: number) => {
    const ids = list.filter((e) => !e.usb).map((e) => e.node).filter((n) => n !== node);
    ids.splice(Math.max(0, Math.min(ids.length, index)), 0, node);
    setOrder(ids);
  };
  const movable = list.filter((e) => !e.usb);
  const meshLine = (
    <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em" }}
      title={conn?.local ? `mesh channel ${conn.local.channel ?? "?"}${conn.local.ip ? ` · bridge at ${conn.local.ip} (WiFi ${conn.local.wifi_rssi} dBm)` : conn.local.wifi === "joining" ? ` · joining WiFi ${conn.local.wifi_ssid}…` : ""}` : undefined}>
      {link.via === "usb" ? "MESH VIA USB" : link.via === "wifi" ? "MESH VIA WIFI" : "SIMULATED MESH"}
      {conn?.local?.channel ? <span style={{ color: C.t4 }}> · ch {conn.local.channel}</span> : null}
      {conn?.local?.stale ? <span style={{ color: C.amber }}> · {conn.local.stale === "rebooted" ? "bridge rebooted — reconnecting WiFi…" : "bridge not answering…"}</span>
        : conn?.local?.ip ? <span style={{ color: C.green }}> · {conn.local.ip}</span>
        : conn?.local?.wifi === "joining" ? <span style={{ color: C.amber }}> · {conn.local.wifi_reason ? `WiFi: ${conn.local.wifi_reason}` : "joining WiFi…"}</span> : null}
    </span>
  );

  // One board, one row: a state mark, the name, and a second line of
  // facts (signal, battery, sleep) — the chips' hover text, in the open.
  const row = (en: Entry) => {
    const missing = isMissing(en, now);
    const hidden = getRoster().hidden.includes(en.node);
    const battery = en.hello?.power === "battery";
    const asleep = battery && missing;
    const listening = battery && !missing && !!en.hb?.listen;
    const role = en.usb ? en.hello?.role ?? 0 : en.hb?.role ?? 0;
    const bridge = !!(role & NodeRole.BRIDGE);
    const clock = !!(role & NodeRole.CONDUCTOR);
    const on = en.node === selected && !phone;
    const batt = batteryState(en, now);
    const battColor = batt?.level === "out" || batt?.level === "critical" ? C.red : batt?.level === "low" || batt?.level === "overdue" ? C.amber : C.t4;
    const facts: JSX.Element[] = [];
    if (!en.hello) facts.push(<span key="c">connecting…</span>);
    if (en.usb) facts.push(<span key="u">{directLabel(link)}</span>);
    if (batt && batt.level !== "ok") facts.push(<span key="b" style={{ color: battColor, fontWeight: 700 }}>{batt.text}</span>);
    const next = nextCheckin(en.hello?.checkin_ms, now);
    if (asleep) facts.push(<span key="z" style={{ color: C.t4 }}>asleep {ago(now - en.seen, true)}{next ? ` · next ${next.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>);
    else if (missing) facts.push(<span key="m" style={{ color: C.red }}>not heard for {ago(now - en.seen)}</span>);
    else if (en.hb && !en.usb) facts.push(<span key="r">{en.hb.hops === 0 ? "direct" : `${en.hb.hops + 1} hops`} · {en.hb.rssi} dBm</span>);
    if (listening) facts.push(<span key="l" title="listening in windows between cues">☾ {en.hb!.listen} ms</span>);
    const mv = en.hb?.batt || en.lastBatt;
    if (battery && mv) facts.push(<span key="v" style={{ color: battColor }}>{battText(mv)}</span>);
    const idx = movable.findIndex((e) => e.node === en.node);
    return (
      <div key={en.node} onClick={() => { if (!arrange) select(en.node); }}
        draggable={arrange && !en.usb} onDragStart={(e) => { e.dataTransfer.setData("text/plain", en.node); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => { if (arrange && !en.usb) e.preventDefault(); }}
        onDrop={(e) => { const from = e.dataTransfer.getData("text/plain"); if (arrange && from && from !== en.node && !en.usb) { e.preventDefault(); moveTo(from, idx); } }}
        title={`${en.node} · ${where(en)}${asleep ? ` · ${checkinText(en.hello?.checkin_ms)} (every ${en.hello?.checkin_ms ? Math.round(en.hello.checkin_ms / 60000) : "?"} min), or on its sensor` : ""}${hidden ? " · hidden" : ""}`}
        style={{
          display: "flex", alignItems: "center", gap: 9, minHeight: phone ? 56 : 44, padding: phone ? "6px 12px" : "5px 10px", cursor: arrange ? "grab" : "pointer",
          background: on ? C.emberBg2 : "transparent", borderLeft: `3px solid ${on ? C.ember : "transparent"}`,
          borderBottom: `1px solid ${C.b1}`, opacity: hidden ? 0.45 : asleep ? 0.7 : 1, WebkitTapHighlightColor: "transparent",
        }}>
        {en.hello
          ? asleep
            ? <span style={{ ...mono(700, 11, C.t4), width: 14, textAlign: "center", letterSpacing: "-.02em" }}>z<span style={{ fontSize: 8 }}>z</span></span>
            : <span style={{ width: 8, height: 8, borderRadius: "50%", margin: "0 3px", background: missing ? C.red : batt?.level === "critical" ? C.red : batt?.level === "low" ? C.amber : C.green, flex: "none" }} />
          : <Spinner size={10} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ ...sys(600, phone ? 14 : 12.5, asleep ? C.t3 : missing ? C.red : en.hello ? C.t1 : C.t3), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{en.hello?.name || en.node}</span>
            {bridge && tag("BRIDGE", C.emberT, C.emberBg)}
            {clock && <span title="Keeps the mesh clock (conductor)" style={mono(600, 11, C.t4)}>⏱</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", ...mono(500, 10.5, C.t4), marginTop: 2 }}>{facts}</div>
        </div>
        {arrange && !en.usb ? (
          <span style={{ display: "flex", gap: 4, flex: "none" }} onClick={(e) => e.stopPropagation()}>
            <button disabled={idx <= 0} onClick={() => moveTo(en.node, idx - 1)} aria-label="Move up" style={{ ...btn(false, idx <= 0), width: 36, padding: 0 }}>▲</button>
            <button disabled={idx >= movable.length - 1} onClick={() => moveTo(en.node, idx + 1)} aria-label="Move down" style={{ ...btn(false, idx >= movable.length - 1), width: 36, padding: 0 }}>▼</button>
          </span>
        ) : missing && !hidden ? (
          <span role="button" title={asleep ? "Hide this board (it may only be asleep — it comes back when heard)" : "Hide this board until it speaks again"}
            onClick={(e) => { e.stopPropagation(); if (asleep) setAskHide(en); else { hideNode(en.node, true); if (en.node === selected) select(null); } }}
            style={{ ...mono(700, 13, C.t4), padding: "6px 6px", flex: "none" }}>✕</span>
        ) : hidden ? (
          <span role="button" title="Forget this board (it comes back if it ever speaks again)" onClick={(e) => { e.stopPropagation(); forgetNode(en.node); }}
            style={{ ...mono(700, 11, C.red), padding: "6px 4px", flex: "none" }}>forget</span>
        ) : phone ? <span style={{ color: C.t5, fontSize: 16 }}>›</span> : null}
      </div>
    );
  };

  const item = (id: string, icon: string, label: string, title: string) => (
    <div key={id} onClick={() => select(id)} title={title}
      style={{ display: "flex", alignItems: "center", gap: 9, minHeight: phone ? 50 : 40, padding: phone ? "4px 12px" : "4px 10px", cursor: "pointer",
        background: selected === id && !phone ? C.emberBg2 : "transparent", borderLeft: `3px solid ${selected === id && !phone ? C.ember : "transparent"}`, borderBottom: `1px solid ${C.b1}` }}>
      <span style={{ width: 14, textAlign: "center", fontSize: 13 }}>{icon}</span>
      <span style={{ flex: 1, ...sys(600, phone ? 14 : 12.5, C.t1) }}>{label}</span>
      {phone && <span style={{ color: C.t5, fontSize: 16 }}>›</span>}
    </div>
  );

  const column = (
    <div style={{ width: phone ? "100%" : 256, flex: phone ? 1 : "none", minHeight: 0, display: "flex", flexDirection: "column", background: C.panel, borderRight: phone ? undefined : `1px solid ${C.b1}` }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: phone ? "10px 12px" : "10px 10px", borderBottom: `1px solid ${C.b1}`, minHeight: 40 }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{meshLine}</span>
        {movable.length > 1 && (
          <button onClick={() => setArrange(!arrange)} title={arrange ? "Done arranging" : "Change the order of the boards"} style={{ ...btn(arrange), height: 28, padding: "0 9px" }}>
            {arrange ? "Done" : "Arrange"}
          </button>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {list.map(row)}
        {hiddenCount > 0 && (
          <div onClick={() => setShowHidden(!showHidden)} title={showHidden ? "Hide them again" : "Boards you hid — they come back by themselves when heard"}
            style={{ padding: "8px 12px", ...mono(600, 11, C.t4), cursor: "pointer", borderBottom: `1px solid ${C.b1}` }}>
            {showHidden ? "hide them again" : `+${hiddenCount} hidden`}
          </div>
        )}
        {list.length === 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 12px", ...mono(500, 11, C.t5) }}>
            <Spinner size={10} />
            {now - list[0].firstSeen < 12000
              ? "Listening for other nodes — they report in every ~5 s…"
              : "No other nodes heard yet. Is a second devkit flashed with firmware/node and powered?"}
          </div>
        )}
        {arrange && <Hint style={{ margin: 8 }}>Drag a board, or use the arrows, to set the order. The bridge stays first; the order is kept in this browser.</Hint>}
        <div style={{ height: 8 }} />
        {list.length > 0 && item(FLOODS, "✺", FLOODS_NAME, "BRMesh flood lights — driven by every board you tick")}
        {item(OTA, "↑", "Firmware", "Update the boards' firmware")}
      </div>
      <div style={{ flex: "none", padding: phone ? "10px 12px" : "8px 10px", borderTop: `1px solid ${C.b1}` }}>
        <button onClick={disconnect} style={{ ...btn(), width: "100%", height: phone ? 40 : 30 }}>Disconnect</button>
      </div>
    </div>
  );

  const pageTitle = selected === FLOODS ? FLOODS_NAME : selected === OTA ? "Firmware" : sel?.hello?.name || sel?.node || "";
  const page = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto", background: C.bg }}>
      {pageOpen && (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", background: C.panel, borderBottom: `1px solid ${C.b1}`, position: "sticky", top: 0, zIndex: 3 }}>
          <button onClick={back} aria-label="Back to the boards" style={{ height: 40, padding: "0 10px 0 6px", background: "none", border: "none", ...sys(600, 15, C.emberT), display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span> Boards
          </button>
          <span style={{ flex: 1, minWidth: 0, textAlign: "center", ...sys(700, 14, C.t1), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pageTitle}</span>
          <span style={{ width: 84, flex: "none" }} />
        </div>
      )}
      {selected === FLOODS && <FloodsPanel link={link} entries={entries} />}
      {selected === OTA && <OtaPanel link={link} entries={entries} />}
      {sel && !sel.hello && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 16px", ...mono(500, 11.5, C.t4) }}>
          <Spinner />
          <span>
            Connecting to {sel.node} over the mesh — asking for its name and board…
            {sel.helloTries > 1 && <span style={{ color: C.amber }}> no reply yet, retrying (attempt {sel.helloTries})</span>}
          </span>
        </div>
      )}
      {sel?.remembered && sel.hello && (
        <div style={{ padding: "12px 16px", ...mono(500, 11.5, C.t4), borderBottom: `1px solid ${C.b1}` }}>
          {sel.hello.power === "battery" ? "Asleep: " : "Not heard this session: "}last heard {ago(now - sel.seen)} ago. What follows is read from the board when it next answers
          {sel.hello.power === "battery" && sel.hello.checkin_ms ? ` (${checkinText(sel.hello.checkin_ms)})` : ""}.
        </div>
      )}
      {sel?.hello && !selBoard && (
        <div style={{ padding: "14px 16px", ...mono(500, 11.5, C.amber) }}>
          {sel.node} runs board profile “{sel.hello.board}”, which this console doesn't know — rebuild it after running tools/genboards.py.
        </div>
      )}
      {sel?.hello && selBoard && !sel.remembered && (
        <PinEditor key={sel.node}
          node={target(link, sel.usb ? null : sel.node)}
          hello={sel.hello}
          board={selBoard}
          where={where(sel)}
          onInput={onSelInput}
          onSaved={(_cfg: NodeConfig) => refreshHello(sel.node)}
        />
      )}
      {!phone && !sel && selected !== FLOODS && selected !== OTA && (
        <div style={{ padding: "24px 20px", ...sys(500, 12.5, C.t4) }}>Pick a board on the left.</div>
      )}
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", background: C.bg }}>
      {phone ? (pageOpen ? page : column) : <>{column}{page}</>}
      {askHide && (
        <Confirm title={`Hide ${askHide.hello?.name || askHide.node}?`} okLabel="Hide it" onCancel={() => setAskHide(null)}
          onOk={() => { hideNode(askHide.node, true); if (selected === askHide.node) select(null); setAskHide(null); }}>
          This is a battery board, and a quiet battery board is usually asleep, not gone: it was last heard {ago(now - askHide.seen)} ago
          and {askHide.hello?.checkin_ms ? `checks in every ${Math.round(askHide.hello.checkin_ms / 60000)} min (${checkinText(askHide.hello.checkin_ms)})` : "checks in on its own schedule"}.
          Hiding only takes it off this list; the moment it is heard again it comes back by itself. Hide it if it is really gone — dead
          battery, taken inside — or just for a tidier list.
        </Confirm>
      )}
    </div>
  );
}

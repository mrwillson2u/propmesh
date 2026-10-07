// Generic-board nodes as the console sees them through one USB node:
// connect, list every node heard on the mesh, pick one to edit.
// Requests for remote nodes go through the USB node over ESP-NOW.
// docs/generic-boards.md.
import { useCallback, useState } from "react";
import { C } from "../../lib/tokens";
import { Spinner, mono, sys } from "../../ui";
import { BOARDS } from "../../lib/boards_gen";
import { NodeRole } from "../../lib/proto_gen";
import type { NodeConfig } from "../../lib/nodeConfig";
import { connectSim, connectUsb, target, webSerialSupported } from "../../lib/transport";
import PinEditor from "./PinEditor";
import FloodsPanel from "./FloodsPanel";
import OtaPanel from "./OtaPanel";
import { FLOODS, FLOODS_NAME } from "../../lib/floods";
import {
  closeConnection, connectionError, isMissing, onInput, openConnection, refreshHello, select,
  useConnection, type Entry,
} from "../../lib/connection";

const btn = (primary = false, disabled = false): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
  background: primary ? C.emberBg : C.raised,
  border: `1px solid ${primary ? C.ember : C.b3}`,
  ...sys(600, 11.5, primary ? C.emberT : C.t2),
});

// The firmware panel's "selected" id (not a node).
const OTA = "ota";

const tag = (text: string, color: string, bg: string): JSX.Element => (
  <span style={{ padding: "1px 6px", borderRadius: 99, background: bg, ...mono(700, 9.5, color), letterSpacing: ".05em" }}>{text}</span>
);

// The board list and its tracking live in lib/connection.ts, so they
// keep running while another view is open; this panel only shows them.
export default function MeshPanel() {
  const conn = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = conn?.link ?? null;
  const entries = conn?.entries ?? {};
  const selected = conn?.selected ?? null;
  const now = Date.now();

  const connect = async (how: "usb" | "sim") => {
    setBusy(true);
    setError(null);
    try {
      const { link, hello } = how === "usb" ? await connectUsb() : await connectSim();
      openConnection(link, hello);
    } catch (e) {
      // Closing the port chooser is not an error worth showing.
      if ((e as Error).name !== "NotFoundError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = () => { void closeConnection(); };
  const setSelected = select;

  const onSelInput = useCallback(
    (cb: (kind: string, index: number, value: number) => void) => onInput(selected ?? "", cb),
    [selected]);

  // ---- render -------------------------------------------------------------

  if (!link) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.panel, borderBottom: `1px solid ${C.b1}`, flex: "none" }}>
        <div style={{ flex: 1 }}>
          <div style={sys(700, 12.5, C.t1)}>Generic boards over USB</div>
          <div style={{ ...mono(500, 11, error || connectionError() ? C.red : C.t4), marginTop: 3 }}>
            {error ?? connectionError() ?? (webSerialSupported()
              ? "Plug in a devkit flashed with firmware/node — your bridge — and connect. Every node it hears on the mesh shows up here."
              : "USB needs Web Serial — open the console in Chrome or Edge. The simulated mesh works anywhere.")}
          </div>
        </div>
        <button disabled={busy} onClick={() => connect("sim")} style={btn(false, busy)}>Simulated mesh</button>
        <button disabled={busy || !webSerialSupported()} onClick={() => connect("usb")} style={btn(true, busy || !webSerialSupported())}>
          {busy ? "Connecting…" : "⌁ Connect USB node"}
        </button>
      </div>
    );
  }

  const list = (Object.values(entries) as Entry[]).sort((a, b) =>
    Number(b.usb) - Number(a.usb) || (a.hb?.hops ?? 0) - (b.hb?.hops ?? 0) || a.node.localeCompare(b.node));
  const sel = selected ? entries[selected] : undefined;
  const selBoard = sel?.hello ? BOARDS[sel.hello.board] : undefined;

  const where = (en: Entry) => en.usb ? "USB"
    : en.hb ? `mesh · ${en.hb.hops === 0 ? "direct" : `${en.hb.hops + 1} hops`} · ${en.hb.rssi} dBm`
    : "mesh";

  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.b1}`, flex: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${C.b1}`, flexWrap: "wrap" }}>
        <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em", marginRight: 4 }}>
          {link.via === "usb" ? "MESH VIA USB" : "SIMULATED MESH"}
        </span>
        {list.map((en) => {
          const missing = isMissing(en, now);
          const role = en.usb ? en.hello?.role ?? 0 : en.hb?.role ?? 0;
          const bridge = !!(role & NodeRole.BRIDGE);
          const clock = !!(role & NodeRole.CONDUCTOR);
          const on = en.node === selected;
          return (
            <button key={en.node} onClick={() => setSelected(en.node)}
              title={`${en.node} · ${where(en)}${missing ? " · not heard recently" : ""}${en.hello ? "" : " · asking it for its name and board"}`}
              style={{
                display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 10px", borderRadius: 6, cursor: "pointer",
                background: on ? C.emberBg2 : C.card, border: `1px solid ${on ? C.emberB : C.b2}`,
              }}>
              {en.hello
                ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: missing ? C.red : C.green }} />
                : <Spinner size={10} />}
              <span style={sys(600, 12, missing ? C.red : en.hello ? C.t1 : C.t3)}>{en.hello?.name || en.node}</span>
              {!en.hello && <span style={mono(500, 10.5, C.t4)}>connecting…</span>}
              {en.usb && tag("USB", C.t2, C.raised)}
              {bridge && tag("BRIDGE", C.emberT, C.emberBg)}
              {clock && <span title="Keeps the mesh clock (conductor)" style={mono(600, 11, C.t4)}>⏱</span>}
              {!en.usb && en.hb && <span style={mono(500, 10.5, C.t4)}>{en.hb.rssi}</span>}
            </button>
          );
        })}
        {list.length > 0 && (
          <button onClick={() => setSelected(FLOODS)} title="BRMesh flood lights — driven by every board you tick"
            style={{
              display: "flex", alignItems: "center", gap: 7, height: 32, padding: "0 10px", borderRadius: 6, cursor: "pointer",
              background: selected === FLOODS ? C.emberBg2 : C.card, border: `1px solid ${selected === FLOODS ? C.emberB : C.b2}`,
            }}>
            <span style={{ fontSize: 12 }}>✺</span>
            <span style={sys(600, 12, C.t1)}>{FLOODS_NAME}</span>
          </button>
        )}
        {list.length === 1 && (
          <span style={{ display: "flex", alignItems: "center", gap: 7, ...mono(500, 11, C.t5) }}>
            <Spinner size={10} />
            {now - list[0].firstSeen < 12000
              ? "Listening for other nodes — they report in every ~5 s…"
              : "No other nodes heard yet. Is a second devkit flashed with firmware/node and powered?"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setSelected(OTA)} title="Update the boards' firmware over WiFi" style={btn(selected === OTA)}>↑ Firmware</button>
        <button onClick={disconnect} style={btn()}>Disconnect</button>
      </div>

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
      {sel?.hello && !selBoard && (
        <div style={{ padding: "14px 16px", ...mono(500, 11.5, C.amber) }}>
          {sel.node} runs board profile “{sel.hello.board}”, which this console doesn't know — rebuild it after running tools/genboards.py.
        </div>
      )}
      {sel?.hello && selBoard && (
        <PinEditor key={sel.node}
          node={target(link, sel.usb ? null : sel.node)}
          hello={sel.hello}
          board={selBoard}
          where={where(sel)}
          onInput={onSelInput}
          onSaved={(_cfg: NodeConfig) => refreshHello(sel.node)}
        />
      )}
    </div>
  );
}

// Generic-board nodes as the console sees them through one USB node:
// connect, list every node heard on the mesh, pick one to edit.
// Requests for remote nodes go through the USB node over ESP-NOW.
// docs/generic-boards.md.
import { useCallback, useEffect, useRef, useState } from "react";
import { C } from "../../lib/tokens";
import { Spinner, mono, sys } from "../../ui";
import { BOARDS } from "../../lib/boards_gen";
import { NodeRole } from "../../lib/proto_gen";
import type { NodeConfig } from "../../lib/nodeConfig";
import {
  connectSim, connectUsb, target, webSerialSupported,
  type Heartbeat, type NodeHello, type NodeLink,
} from "../../lib/transport";
import PinEditor from "./PinEditor";

// A node not heard for three heartbeats is shown as missing.
const MISSING_MS = 16000;
// A hello can be lost like any frame; ask again soon, not after a
// pause long enough to look like nothing is happening.
const HELLO_RETRY_MS = 3000;

interface Entry {
  node: string;
  usb: boolean; // the node on the cable
  hello?: NodeHello;
  hb?: Heartbeat;
  seen: number; // ms timestamp of the last heartbeat / hello
  firstSeen: number; // when the console first heard it
  helloTries: number; // hellos sent and not answered
}

type InputCb = (kind: string, index: number, value: number) => void;

const btn = (primary = false, disabled = false): React.CSSProperties => ({
  height: 30, padding: "0 12px", borderRadius: 6, cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.45 : 1,
  background: primary ? C.emberBg : C.raised,
  border: `1px solid ${primary ? C.ember : C.b3}`,
  ...sys(600, 11.5, primary ? C.emberT : C.t2),
});

const tag = (text: string, color: string, bg: string): JSX.Element => (
  <span style={{ padding: "1px 6px", borderRadius: 99, background: bg, ...mono(700, 9.5, color), letterSpacing: ".05em" }}>{text}</span>
);

export default function MeshPanel() {
  const [link, setLink] = useState<NodeLink | null>(null);
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const inputSubs = useRef(new Map<string, Set<InputCb>>());
  const local = useRef<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const helloAt = useRef(new Map<string, number>()); // last hello attempt per node

  const patch = (node: string, p: Partial<Entry>) =>
    setEntries((all) => ({ ...all, [node]: { ...(all[node] ?? { node, usb: false, seen: 0, firstSeen: Date.now(), helloTries: 0 }), ...p } }));

  // ---- connection -------------------------------------------------------

  const connect = async (how: "usb" | "sim") => {
    setBusy(true);
    setError(null);
    try {
      const { link, hello } = how === "usb" ? await connectUsb() : await connectSim();
      local.current = hello.node;
      setEntries({ [hello.node]: { node: hello.node, usb: true, hello, seen: Date.now(), firstSeen: Date.now(), helloTries: 0 } });
      helloAt.current = new Map([[hello.node, Date.now()]]);
      setSelected(hello.node);
      setLink(link);
    } catch (e) {
      // Closing the port chooser is not an error worth showing.
      if ((e as Error).name !== "NotFoundError") setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await link?.close();
    setLink(null);
    setEntries({});
    setSelected(null);
  };

  useEffect(() => {
    if (!link) return;
    const off = link.onEvent((e) => {
      if (e.evt === "disconnected") {
        setLink(null);
        setEntries({});
        setError("USB connection lost");
      } else if (e.evt === "heartbeat") {
        const hb = e as unknown as Heartbeat;
        if (hb.node !== local.current) patch(hb.node, { hb, seen: Date.now() });
      } else if (e.evt === "input") {
        const node = (e.node as string | undefined) ?? local.current ?? "";
        inputSubs.current.get(node)?.forEach((cb) => cb(e.kind as string, e.index as number, e.value as number));
      } else if (e.evt === "boot" && e.node === local.current) {
        // The USB node rebooted (e.g. reset button): re-read its role.
        helloAt.current.delete(e.node as string);
      }
    });
    return () => { off(); void link.close(); };
  }, [link]);

  // Learn each node's name and board with a hello; refresh the USB
  // node's role now and then (it changes when an election runs).
  useEffect(() => {
    if (!link) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      Object.values(entriesRef.current).forEach((en) => {
        const last = helloAt.current.get(en.node);
        const due = en.usb ? last === undefined || t - last > 5000
          : !en.hello && (last === undefined || t - last > HELLO_RETRY_MS);
        if (!due) return;
        helloAt.current.set(en.node, t);
        if (!en.usb) patch(en.node, { helloTries: en.helloTries + 1 });
        target(link, en.usb ? null : en.node).request("hello").then((r) => {
          if (r.ok) patch(en.node, { hello: r as unknown as NodeHello, seen: Date.now(), helloTries: 0 });
        }).catch(() => { /* retried on a later tick */ });
      });
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [link]);

  const onInput = useCallback((cb: InputCb) => {
    const node = selected ?? "";
    const m = inputSubs.current;
    if (!m.has(node)) m.set(node, new Set());
    m.get(node)!.add(cb);
    return () => { m.get(node)?.delete(cb); };
  }, [selected]);

  // ---- render -------------------------------------------------------------

  if (!link) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.panel, borderBottom: `1px solid ${C.b1}`, flex: "none" }}>
        <div style={{ flex: 1 }}>
          <div style={sys(700, 12.5, C.t1)}>Generic boards over USB</div>
          <div style={{ ...mono(500, 11, error ? C.red : C.t4), marginTop: 3 }}>
            {error ?? (webSerialSupported()
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

  const list = Object.values(entries).sort((a, b) =>
    Number(b.usb) - Number(a.usb) || (a.hb?.hops ?? 0) - (b.hb?.hops ?? 0) || a.node.localeCompare(b.node));
  const sel = selected ? entries[selected] : undefined;
  const selBoard = sel?.hello ? BOARDS[sel.hello.board] : undefined;

  const where = (en: Entry) => en.usb ? "USB"
    : en.hb ? `mesh · ${en.hb.hops === 0 ? "direct" : `${en.hb.hops} hop${en.hb.hops > 1 ? "s" : ""}`} · ${en.hb.rssi} dBm`
    : "mesh";

  return (
    <div style={{ background: C.panel, borderBottom: `1px solid ${C.b1}`, flex: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderBottom: `1px solid ${C.b1}`, flexWrap: "wrap" }}>
        <span style={{ ...sys(700, 10, C.t5), letterSpacing: ".08em", marginRight: 4 }}>
          {link.via === "usb" ? "MESH VIA USB" : "SIMULATED MESH"}
        </span>
        {list.map((en) => {
          const missing = !en.usb && now - en.seen > MISSING_MS;
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
        {list.length === 1 && (
          <span style={{ display: "flex", alignItems: "center", gap: 7, ...mono(500, 11, C.t5) }}>
            <Spinner size={10} />
            {now - list[0].firstSeen < 12000
              ? "Listening for other nodes — they report in every ~5 s…"
              : "No other nodes heard yet. Is a second devkit flashed with firmware/node and powered?"}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={disconnect} style={btn()}>Disconnect</button>
      </div>

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
          onInput={onInput}
          onSaved={(cfg: NodeConfig) => { helloAt.current.delete(sel.node); patch(sel.node, {
            hello: { ...sel.hello!, name: cfg.name, bridge: !!cfg.bridge },
          }); }}
        />
      )}
    </div>
  );
}

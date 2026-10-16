// The Show Graph: trigger → logic → action chains on a canvas, each chain
// one trigger rule on a board (lib/graph.ts compiles both ways). React
// Flow renders it; the model, the look and the compile are ours, so the
// renderer can be swapped (software-plan "Console sections", 2026-10-12).
// Live: a block lights up when its sensor fires or its sequence starts.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, addEdge, useReactFlow,
  applyEdgeChanges, applyNodeChanges, type Connection as RFConnection, type Edge as RFEdge, type EdgeChange, type Node as RFNode, type NodeChange, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { C, MONO } from "../../lib/tokens";
import { mono, sys, NumberInput } from "../../ui";
import type { Activity } from "../../lib/connection";
import { lengthMs, type Rule, type Show } from "../../lib/show";
import { FLOODS } from "../../lib/floods";
import {
  BLOCK_HELP, BLOCK_LABEL, CATEGORY, LOGIC_KINDS, TRIGGER_KINDS, compile, decompile, loadPositions, newId, sameRules, savePositions,
  type Block, type BlockData, type BlockKind, type Graph,
} from "../../lib/graph";

type PmNode = RFNode<BlockData & { active?: boolean; unwired?: boolean }, "pm">;

export interface Sensor { node: string; index: number; label: string }
interface Props {
  rules: Rule[];
  show: Show;
  sensors: Sensor[];
  nameOf: (node: string) => string;
  activity: Activity[];
  onChange: (rules: Rule[]) => void;
  // Simulate: play a sequence for real (the console's cue), as the chain would.
  onFire: (seq: number) => Promise<string | null>;  // null = ok, else why not
}

const field: React.CSSProperties = {
  height: 24, padding: "0 6px", background: C.raised, border: `1px solid ${C.b3}`, borderRadius: 4, outline: "none",
  ...sys(500, 11.5, C.t1), maxWidth: 170,
};
const num: React.CSSProperties = { ...field, width: 58, ...mono(500, 11.5, C.t1) };

// The editor hands each node its context through module state: React
// Flow owns the node tree, and functions in node data would churn it.
let ctx: { show: Show; sensors: Sensor[]; nameOf: (n: string) => string; update: (id: string, patch: Partial<BlockData>) => void; remove: (id: string) => void; simulate: (id: string) => void; simulating: string | null } | null = null;

function PmBlock({ id, data, selected }: NodeProps<PmNode>) {
  const c = ctx!;
  const cat = CATEGORY[data.kind];
  const isTrigger = TRIGGER_KINDS.includes(data.kind);
  const isAction = data.kind === "action";
  const color = data.active ? C.ember : data.unwired ? C.amber : selected ? C.t3 : C.b2;
  const seqs = c.show.sequences;
  const boards = [...new Set([...seqs.flatMap((s) => s.loadedOn), ...Object.keys(c.show.configs)])].filter((n) => n !== FLOODS);
  const set = (p: Partial<BlockData>) => c.update(id, p);
  const seqSelect = (value: number | undefined, onPick: (id: number) => void) => (
    <select className="nodrag" value={value ?? ""} onChange={(e) => onPick(Number(e.target.value))} style={{ ...field, color: seqs.some((s) => s.id === value) ? C.t1 : C.amber }}>
      <option value="">— sequence —</option>
      {seqs.map((s) => <option key={s.id} value={s.id}>{s.name || `#${s.id}`}</option>)}
      {value && !seqs.some((s) => s.id === value) ? <option value={value}>#{value} (missing)</option> : null}
    </select>
  );
  const afterSeq = seqs.find((s) => s.id === data.seq);
  return (
    <div style={{
      width: 210, background: C.card, borderRadius: 8, border: `1px solid ${color}`,
      boxShadow: data.active ? "0 0 18px rgba(255,107,44,.25)" : selected ? "0 0 0 1px rgba(255,255,255,.04)" : undefined,
    }}>
      {!isTrigger && <Handle type="target" position={Position.Left} style={{ width: 9, height: 9, background: C.bg, border: `2px solid ${color}` }} />}
      {!isAction && <Handle type="source" position={Position.Right} style={{ width: 9, height: 9, background: C.bg, border: `2px solid ${color}` }} />}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: `1px solid ${C.b1}` }}>
        <span style={{ font: `700 9px ${MONO}`, color: C.t5, letterSpacing: ".08em" }}>{cat}</span>
        <span style={{ flex: 1 }} />
        {data.active && <span style={{ font: `700 9px ${MONO}`, color: C.emberT, letterSpacing: ".06em" }}>{isAction ? "PLAYING" : "FIRED"}</span>}
        {data.unwired && !data.active && <span title="Not part of a complete chain — it does nothing until wired trigger → … → sequence" style={{ font: `700 9px ${MONO}`, color: C.amber }}>UNWIRED</span>}
        {isTrigger && !data.unwired && (
          <span className="nodrag" onClick={() => c.simulate(id)} title="Simulate: run this chain now as if the trigger fired — delays, random pick, and the sequences play for real (cooldown and lockout are not enforced)"
            style={{ ...sys(700, 10, c.simulating === id ? C.emberT : C.t3), cursor: "pointer", padding: "1px 6px", border: `1px solid ${c.simulating === id ? C.ember : C.b3}`, borderRadius: 4 }}>▶ sim</span>
        )}
        <span className="nodrag" onClick={() => c.remove(id)} title="Remove block" style={{ color: C.t5, cursor: "pointer", fontSize: 11 }}>✕</span>
      </div>
      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={sys(700, 12.5, data.active ? C.emberT : C.t1)}>{BLOCK_LABEL[data.kind]}</div>
        {data.kind === "sensor" && (
          <>
            <select className="nodrag" value={`${data.node}|${data.input}`} style={field}
              onChange={(e) => { const [node, input] = e.target.value.split("|"); set({ node, input: Number(input) }); }}>
              {!c.sensors.some((s) => s.node === data.node && s.index === data.input) && <option value={`${data.node}|${data.input}`}>— sensor —</option>}
              {c.sensors.map((s) => <option key={`${s.node}|${s.index}`} value={`${s.node}|${s.index}`}>{c.nameOf(s.node)} · IN_{s.index}{s.label ? ` ${s.label}` : ""}</option>)}
            </select>
            <select className="nodrag" value={data.on ?? "active"} style={field} onChange={(e) => set({ on: e.target.value as BlockData["on"] })}>
              <option value="active">becomes active</option>
              <option value="clear">becomes clear</option>
            </select>
          </>
        )}
        {data.kind === "after" && (
          <>
            {seqSelect(data.seq, (seq) => set({ seq }))}
            <div style={{ display: "flex", gap: 5 }}>
              <select className="nodrag" value={data.atEnd ? "ends" : "starts"} style={field} onChange={(e) => set({ atEnd: e.target.value === "ends" })}>
                <option value="starts">starts</option>
                <option value="ends" disabled={!afterSeq || !lengthMs(afterSeq)}>ends{afterSeq ? ` (${(lengthMs(afterSeq) / 1000).toFixed(1)} s)` : ""}</option>
              </select>
            </div>
            {boards.length > 1 && (
              <label style={{ display: "flex", alignItems: "center", gap: 5, ...sys(500, 10.5, C.t4) }} title="Any board can hold this rule — it hears every sequence start. Pick one that's always powered.">on
                <select className="nodrag" value={data.board ?? ""} style={field} onChange={(e) => set({ board: e.target.value })}>
                  <option value="">{afterSeq?.loadedOn[0] ? c.nameOf(afterSeq.loadedOn[0]) + " (auto)" : "— board —"}</option>
                  {boards.map((n) => <option key={n} value={n}>{c.nameOf(n)}</option>)}
                </select>
              </label>
            )}
          </>
        )}
        {(data.kind === "delay" || data.kind === "cooldown") && (
          <label style={{ display: "flex", alignItems: "center", gap: 5, ...sys(500, 11, C.t3) }}>
            <NumberInput className="nodrag" value={(data.ms ?? 0) / 1000} min={0} max={3600} style={num} width={num.width as number}
              onChange={(v) => set({ ms: Math.round(v * 1000) })} /> s
            {data.kind === "cooldown" && <span style={sys(400, 10.5, C.t5)}>before it fires again</span>}
          </label>
        )}
        {data.kind === "lockout" && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", ...sys(500, 11, C.t3) }}>
            at most <NumberInput className="nodrag" value={data.fires ?? 10} min={1} max={1000} integer style={num} width={46} onChange={(v) => set({ fires: v })} />
            per <NumberInput className="nodrag" value={data.window_min ?? 60} min={1} max={1440} integer style={num} width={52} onChange={(v) => set({ window_min: v })} /> min
          </div>
        )}
        {data.kind === "pick" && <div style={sys(400, 11, C.t4)}>one of the connected sequences, at random</div>}
        {data.kind === "action" && seqSelect(data.seq, (seq) => set({ seq }))}
      </div>
    </div>
  );
}

const nodeTypes = { pm: PmBlock };

export default function GraphEditor(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}

function Canvas({ rules, show, sensors, nameOf, activity, onChange, onFire }: Props) {
  const flow = useReactFlow();
  const positions = useRef(loadPositions());
  const [simulating, setSimulating] = useState<string | null>(null);
  const [simMsg, setSimMsg] = useState<string | null>(null);
  const simBlocks = useRef(new Set<string>());  // blocks lit by a running simulation
  const [nodes, setNodes] = useState<PmNode[]>([]);
  const [edges, setEdges] = useState<RFEdge[]>([]);
  const lastCompiled = useRef<Rule[] | null>(null);

  const toRF = (g: Graph): [PmNode[], RFEdge[]] => [
    g.blocks.map((b) => ({ id: b.id, type: "pm" as const, position: { x: b.x, y: b.y }, data: { ...b.data } })),
    g.wires.map((w) => ({ id: w.id, source: w.source, target: w.target, type: "default" })),
  ];
  const toGraph = (ns: PmNode[], es: RFEdge[]): Graph => ({
    blocks: ns.map((n) => { const { active: _a, unwired: _u, ...data } = n.data; return { id: n.id, data: data as BlockData, x: n.position.x, y: n.position.y }; }),
    wires: es.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  });

  // Rules from outside (load, revert, the row view): rebuild the canvas —
  // unless they're what this canvas just compiled, which keeps positions
  // and half-built chains.
  useEffect(() => {
    if (lastCompiled.current && sameRules(lastCompiled.current, rules)) return;
    const [ns, es] = toRF(decompile(rules, show, positions.current));
    setNodes(ns);
    setEdges(es);
    lastCompiled.current = rules;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, show]);

  // Every edit compiles; the rows and the Save button see the result.
  const emit = useCallback((ns: PmNode[], es: RFEdge[]) => {
    const { rules: compiled, unwired } = compile(toGraph(ns, es), show);
    const flagged = new Set(unwired);
    setNodes((cur) => cur.map((n) => (!!n.data.unwired === flagged.has(n.id) ? n : { ...n, data: { ...n.data, unwired: flagged.has(n.id) } })));
    if (!lastCompiled.current || !sameRules(lastCompiled.current, compiled)) {
      lastCompiled.current = compiled;
      onChange(compiled);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, onChange]);

  // Simulate a chain: walk it from the trigger as the board would — light
  // each block in turn, honour the delays, pick one sequence if there's a
  // Random pick, then play the sequences for real. Cooldown and lockout are
  // shown, not enforced: a simulation is for seeing the chain, not gating it.
  const simulate = async (triggerId: string) => {
    if (simulating) return;
    const g = toGraph(nodes, edges);
    const byId = new Map(g.blocks.map((b) => [b.id, b]));
    const out = new Map<string, string[]>();
    for (const w of g.wires) { if (!out.has(w.source)) out.set(w.source, []); out.get(w.source)!.push(w.target); }
    const light = (id: string, on: boolean) => { if (on) simBlocks.current.add(id); else simBlocks.current.delete(id); };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    setSimulating(triggerId);
    setSimMsg(null);
    try {
      const trig = byId.get(triggerId);
      if (!trig) return;
      light(triggerId, true);
      // Breadth-first along the chain, in wall time.
      let frontier = [triggerId];
      const seqs: number[] = [];
      let random = false;
      let startDelay = trig.data.kind === "after" && trig.data.atEnd ? lengthMs(show.sequences.find((q) => q.id === trig.data.seq) ?? { steps: [] } as unknown as Parameters<typeof lengthMs>[0]) : 0;
      if (startDelay) { setSimMsg(`waiting ${(startDelay / 1000).toFixed(1)} s for the sequence to end…`); await sleep(startDelay); }
      while (frontier.length) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const to of out.get(id) ?? []) {
            const b = byId.get(to);
            if (!b) continue;
            light(to, true);
            if (b.data.kind === "delay") { setSimMsg(`delay ${((b.data.ms ?? 0) / 1000).toFixed(1)} s…`); await sleep(b.data.ms ?? 0); }
            if (b.data.kind === "pick") random = true;
            if (b.data.kind === "action") { if (b.data.seq) seqs.push(b.data.seq); }
            else next.push(to);
          }
        }
        frontier = next;
      }
      const chosen = random && seqs.length ? [seqs[Math.floor(Math.random() * seqs.length)]] : [...new Set(seqs)];
      if (!chosen.length) { setSimMsg("the chain reaches no sequence"); return; }
      const names = chosen.map((q) => show.sequences.find((s) => s.id === q)?.name ?? `#${q}`);
      setSimMsg(`playing ${names.join(", ")}`);
      for (const q of chosen) {
        const err = await onFire(q);
        if (err) { setSimMsg(`couldn't play ${names[chosen.indexOf(q)]}: ${err}`); break; }
      }
      await sleep(1500);
    } finally {
      simBlocks.current.clear();
      setSimulating(null);
      setTimeout(() => setSimMsg(null), 4000);
    }
  };

  ctx = {
    show, sensors, nameOf, simulate: (id) => void simulate(id), simulating,
    update: (id, patch) => setNodes((cur) => { const next = cur.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)); emit(next, edges); return next; }),
    remove: (id) => { const ns = nodes.filter((n) => n.id !== id), es = edges.filter((e) => e.source !== id && e.target !== id); setNodes(ns); setEdges(es); emit(ns, es); },
  };

  const onNodesChange = useCallback((changes: NodeChange<PmNode>[]) => {
    setNodes((cur) => {
      const next = applyNodeChanges(changes, cur);
      for (const ch of changes) if (ch.type === "position" && !ch.dragging && ch.position) positions.current[ch.id] = ch.position;
      if (changes.some((ch) => ch.type === "position" && !ch.dragging)) savePositions(positions.current);
      if (changes.some((ch) => ch.type === "remove")) emit(next, edges);
      return next;
    });
  }, [edges, emit]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((cur) => { const next = applyEdgeChanges(changes, cur); if (changes.some((ch) => ch.type === "remove")) emit(nodes, next); return next; });
  }, [nodes, emit]);
  const onConnect = useCallback((conn: RFConnection) => {
    setEdges((cur) => { const next = addEdge({ ...conn, type: "default" }, cur); emit(nodes, next); return next; });
  }, [nodes, emit]);

  // Live: sensor edges and sequence starts in the last 3 s light their blocks.
  const live = useMemo(() => {
    const now = Date.now();
    const recent = activity.filter((a) => now - a.at < 3000);
    return (n: PmNode) => simBlocks.current.has(n.id) || recent.some((a) =>
      (a.kind === "input" && a.value === 1 && n.data.kind === "sensor" && a.node === n.data.node && a.index === n.data.input) ||
      (a.kind === "cue" && (n.data.kind === "action" || n.data.kind === "after") && a.seq === n.data.seq));
  }, [activity]);
  useEffect(() => {
    const tick = () => setNodes((cur) => cur.map((n) => (!!n.data.active === live(n) ? n : { ...n, data: { ...n.data, active: live(n) } })));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [live]);
  const styledEdges = useMemo(() => edges.map((e) => {
    const hot = nodes.find((n) => n.id === e.source)?.data.active;
    return { ...e, animated: !!hot, style: { stroke: hot ? C.ember : C.wire, strokeWidth: hot ? 2.5 : 2 } };
  }), [edges, nodes]);

  // The palette: click to add a block near the top-left of what's visible.
  const add = (kind: BlockKind, at?: { x: number; y: number }) => {
    const n = nodes.length;
    const data: BlockData = { kind };
    if (kind === "sensor" && sensors[0]) { data.node = sensors[0].node; data.input = sensors[0].index; data.on = "active"; }
    if (kind === "after" || kind === "action") data.seq = show.sequences[0]?.id;
    if (kind === "delay") data.ms = 2000;
    if (kind === "cooldown") data.ms = 30000;
    if (kind === "lockout") { data.fires = 10; data.window_min = 60; }
    if (kind === "pick") data.pick = "random";
    const id = newId(kind);
    const col = TRIGGER_KINDS.includes(kind) ? 0 : LOGIC_KINDS.includes(kind) ? 1 : 2;
    // Below the lowest block in its column, so chains read left → right.
    const inCol = nodes.filter((b) => (TRIGGER_KINDS.includes(b.data.kind) ? 0 : LOGIC_KINDS.includes(b.data.kind) ? 1 : 2) === col);
    const y = inCol.length ? Math.max(...inCol.map((b) => b.position.y)) + 150 : 40;
    const block: Block = { id, data, x: at?.x ?? 40 + col * 250, y: at?.y ?? y };
    const next = [...nodes, { id, type: "pm" as const, position: { x: block.x, y: block.y }, data: { ...data } }];
    setNodes(next);
    emit(next, edges);
    void n;
    if (!at) setTimeout(() => flow.fitView({ padding: 0.2, maxZoom: 1, duration: 200 }), 50);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData("application/propmesh-block") as BlockKind;
    if (!kind) return;
    add(kind, flow.screenToFlowPosition({ x: e.clientX - 105, y: e.clientY - 20 }));  // the card under the cursor's grab point
  };

  const palette: [string, BlockKind[]][] = [["TRIGGERS", ["sensor", "after"]], ["LOGIC", ["delay", "cooldown", "lockout", "pick"]], ["ACTIONS", ["action"]]];
  return (
    <div style={{ display: "flex", flex: 1, minHeight: 460, border: `1px solid ${C.b2}`, borderRadius: 8, overflow: "hidden" }}>
      <div style={{ width: 176, flex: "none", background: C.panel, borderRight: `1px solid ${C.b2}`, padding: 10, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
        {palette.map(([cat, kinds]) => (
          <div key={cat}>
            <div style={{ font: "700 9.5px system-ui", letterSpacing: ".1em", color: C.t5, marginBottom: 6 }}>{cat}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {kinds.map((k) => (
                <div key={k} onClick={() => add(k)} title={BLOCK_HELP[k]} draggable
                  onDragStart={(e) => { e.dataTransfer.setData("application/propmesh-block", k); e.dataTransfer.effectAllowed = "move"; }}
                  style={{ padding: "7px 9px", background: C.card, border: `1px solid ${C.b2}`, borderRadius: 6, ...sys(600, 11.5, C.t2), cursor: "grab" }}>{BLOCK_LABEL[k]}</div>
              ))}
            </div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ font: "400 10.5px/1.5 system-ui", color: C.t6 }}>
          Drag a block onto the canvas (or click it), then drag the dots to wire them left → right. A chain is one trigger rule, stored on the trigger's board. <b>▶ sim</b> on a trigger runs its chain now. Save with <b>Save triggers</b>.
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, position: "relative", background: C.bg }} onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
        {simMsg && (
          <div style={{ position: "absolute", top: 10, right: 10, zIndex: 5, padding: "5px 10px", borderRadius: 6, background: C.emberBg, border: `1px solid ${C.emberB}`, ...mono(600, 11, C.emberT) }}>
            ▶ SIM · {simMsg}
          </div>
        )}
        <style>{`
          .react-flow__controls { background: ${C.card}; border: 1px solid ${C.b2}; box-shadow: none; }
          .react-flow__controls-button { background: ${C.card}; border-bottom: 1px solid ${C.b2}; color: ${C.t3}; fill: ${C.t3}; }
          .react-flow__controls-button:hover { background: ${C.raised}; }
          .react-flow__minimap { background: ${C.panel}; border: 1px solid ${C.b2}; }
          .react-flow__attribution { display: none; }
          .react-flow__edge-path { stroke: ${C.wire}; }
          .react-flow__node { font-family: system-ui; }
        `}</style>
        <ReactFlow
          nodes={nodes} edges={styledEdges} nodeTypes={nodeTypes}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.3} maxZoom={1.5}
          deleteKeyCode={["Backspace", "Delete"]} proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "default" }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={C.grid} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor={(n) => ((n as PmNode).data.active ? C.ember : C.b3)} maskColor="rgba(11,13,16,.6)" style={{ width: 150, height: 90 }} />
        </ReactFlow>
      </div>
    </div>
  );
}

# PropMesh Console

Web control app, served from the bridge node's flash in production.
Implements the Claude Design handoff
(`reference/design_handoff_propmesh_console/`): left-rail shell (2b),
IBM Plex Mono + system-ui, ember-on-dark mission-control tokens
(`src/lib/tokens.ts`).

```
npm install
npm run dev        # Vite dev server, simulated mesh telemetry
npm run typecheck
npm run build      # output later embedded in bridge firmware
```

Deep-link a view with `?view=survey|nodes|cues|blueprint|show`.

## Demo data vs real boards

The views were first built against the design handoff's mock yard
(`src/lib/mesh.ts`: eight imaginary nodes, banners, cues). Since real
boards arrived (docs/generic-boards.md) that mock is **off by
default** — **Settings → Show demo data** turns it back on, per
browser. With it off: Nodes & Channels shows only real boards; Yard,
Cues and Show Graph say they aren't wired to real data yet; the sidebar
shows the real USB connection; **STOP ALL sends `all_off` to every
connected node** (it was cosmetic before 2026-10-05) and names any node
that didn't confirm. Demo data is never sent to boards.

## Views

- **Yard** — the mesh in two projections, switched by a layout toggle:
  **Topology** (arranged by hop — "is my mesh healthy") and **Map**
  (drawn yard with staked positions — "where is that physically").
  One selection, one detail panel, one link model across both. Includes
  locate blink and placement mode (the phone layout). Fully interactive.
- **Nodes & Channels** — the **pin editor** for generic boards at the
  top (connect a devkit over USB, or a simulated node, assign pins to
  functions, save, test-fire — `docs/generic-boards.md`), then fault
  banners, expandable node table,
  per-channel test fire / relay toggle, and the **prop-type picker**
  (click a node's icon).
- **Cues** — armed bar, rule list with enable toggles, cue editor panel.
- **Show Graph** — static reference of the node-graph editor; React
  Flow replaces it in v2.

The design handoff drew Topology and Map as two separate views (Survey
and Blueprint). They were merged during implementation: they render the
same nodes, statuses, links and selection, so keeping them apart meant
two canvases that could disagree about the mesh — the handoff's own art
did, showing different parent routes in each.

The **STOP ALL** control (press and hold ~1.5 s) and the stopped banner
live in the shell and work across every view.

## Prop icons

`src/lib/propIcons.tsx` holds 19 stroke-based SVG icons for what a node
actually drives — skeleton, zombie, ghost, witch, cauldron, pumpkin,
tombstone, coffin, spider, bat, scarecrow, dead tree, lantern, string
lights, fogger, speaker, sensor, hub, unassigned. A yard of identical
dots makes you read labels; a yard of tombstones and lanterns you read
at a glance, which is the point when a node goes red.

They are drawn on a 24px grid at one stroke weight, inline (no asset
budget on a flash-served app), and recolor with node status via
`currentColor`. Assignments live in `src/lib/propStore.tsx`, seeded from
each node's `prop` field and changed from the Nodes & Channels picker —
it is node config, so the bridge should persist it per node.

Adding one: draw a 24×24 path, add it to `PATHS`, add a `PROP_TYPES`
entry. Check it at 26px before committing — that is the size Mini nodes
render at on the map, and detail disappears fast.

## Wiring notes

- `src/lib/mesh.ts` is the data model + 1 s simulated telemetry tick.
  Its shapes are the contract the bridge WebSocket API should serve;
  swap the simulation for the stream, keep the shapes.
- `src/lib/transport.ts` is how the console reaches a node: USB
  (Web Serial — Chrome/Edge only) or the simulated node. The bridge
  WebSocket becomes a third carrier with the same request shapes.
- `src/lib/boards_gen.ts` is **generated** from `boards/*.yaml`
  (`python3 tools/genboards.py`) — never hand-edit.
- `src/lib/proto_gen.ts` is **generated** from `schema/messages.yaml`
  (`python3 tools/genmsg.py`) — never hand-edit.
- For flash serving, self-host the two IBM Plex Mono woff2 weights
  instead of the Google Fonts link in `index.html`.

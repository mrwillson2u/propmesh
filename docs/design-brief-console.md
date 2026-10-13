# PropMesh Console — Claude Design brief

Copy everything below the line into Claude Design as the prompt. (It also
works as the seed for a `/design` canvas in Claude Code.)

> **Status:** used — the returned designs are in
> `reference/design_handoff_propmesh_console/` and implemented in
> `console/`. One deviation: views 1 (Survey) and 4 (Blueprint) shipped
> merged as a single **Yard** view with a Topology/Map layout toggle,
> since they are two projections of one model. See `console/README.md`.

---

Design the UI for **PropMesh Console**, the control app for an
open-source ESP32 mesh prop controller used in Halloween and holiday
yard displays. Users stake battery and wall-powered controller boards
around their yard; the boards drive motors, servos, fog machines, LED
strips, and audio, and talk to each other over a radio mesh. The console
is a web app served by the "bridge" node and is the single place to see,
configure, and program the whole yard.

**Audience:** haunters and makers — technically capable hobbyists who
run xLights, 3D printers, and soldering irons. They want a serious
show-control tool, not a toy.

## Visual direction

**Dark mission-control.** Dark-first (it will literally be used outdoors
at night during shows), information-dense but calm, clean typography,
flat panels. One restrained accent — an ember orange — for primary
actions, live/armed states, and the identity. Status colors (green/
amber/red) carry meaning and are never decorative. Small moments of
Halloween personality are welcome in empty states and micro-copy, never
in the working chrome. Think lighting desk / network operations console,
with warmth.

A large **STOP ALL** control must be visible in the shell at all times —
it kills every motor and effect in the yard. It should read as the
emergency control it is without dominating the layout.

## Global shell

Persistent across views: app name, connection state to the bridge, mesh
clock sync quality, count of nodes online/asleep/missing, STOP ALL, and
navigation between the five views below.

## Views to design

**1. Survey** *(desktop + phone)* — live mesh topology. A graph of
nodes: name, board type (Pro = big board, Mini = small battery board),
battery voltage/percent on Minis, sleep state, hop distance from the
bridge. Links between nodes show RSSI (signal strength) by color/weight.
Selecting a node opens a detail panel: uptime, firmware version, free
memory, its neighbors, recent events. A health strip summarizes the
mesh. **Phone layout matters:** the user walks the yard holding a phone,
watching one node's signal while repositioning it — design a focused
"placement mode" for that.

**2. Nodes & Channels** *(desktop)* — the fleet manager. Every node with
its logical output channels (`RELAY_1`, `SERVO_2`, `LED_STRIP_1`,
`MOTOR_A`…) and sensor inputs. Rename nodes, label channels with what
they drive ("coffin lid", "fog fan"), **test-fire any output** with a
tap, see live sensor state, start firmware updates. Include a
low-battery and fault surface.

**3. Cues** *(desktop)* — show programming for most users. A list of
rules: **trigger → sequence → targets → timing** ("Driveway PIR →
Skeleton Lunge on Front Porch group, 0.5 s delay, cooldown 45 s,
11 min lockout after 10 fires"). Editor for a rule, a sequence picker,
enable/disable per rule, armed/disarmed for the whole show, last-fired
timestamps. Show a test/simulate affordance.

**4. Blueprint** *(desktop + phone)* — spatial view. The user draws a
rough outline of their house/yard (simple polygon + line tools, nothing
CAD-like), then drags nodes onto the map. Nodes show the same live
status as Survey. Toggle overlay of mesh links/signal. Phone version is
view-and-check, not editing.

**5. Show Graph** *(desktop)* — the power-user programming canvas, an
n8n-style node-graph editor: trigger nodes (sensors, time, sACN, manual),
logic nodes (delay, random, sequence, group, cooldown), output nodes
(prop sequences, audio). Wires connect them; a run highlights the active
path. Palette, minimap, zoom. Design it to feel native to the same
design system, on the same dark canvas.

## Sample data — use this, realism matters

Nodes: "Bridge (garage)" (Pro, hop 0), "Front Porch Skeleton" (Pro),
"Fog Chiller" (Pro), "Graveyard Servo Rig" (Pro), "Lantern 1–3" (Minis
on battery, e.g. 3.92 V, 3.41 V, one low at 3.18 V), "Driveway PIR"
(Mini, currently offline/missing). RSSI values between −45 and −85 dBm.
Hops 0–3. Include degraded states in the designs: a missing node, a weak
link, a low battery — the tool's job is making problems obvious.

## Constraints

- Served from a microcontroller's flash: lightweight assets, system
  fonts or one webfont max, no photography, SVG iconography.
- Desktop-first at ~1440 px; phone (~390 px) layouts required for
  Survey (placement mode) and Blueprint (view mode).
- Dense but legible outdoors at night — strong contrast, generous touch
  targets on the phone views.
- Component sheet to include: node card, status pill, RSSI badge,
  battery indicator, test-fire button, rule row, panel header, the STOP
  ALL control in idle and confirming states.

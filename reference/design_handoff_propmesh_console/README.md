# Handoff: PropMesh Console — Survey view + full-console mockups

## Overview
UI design for **PropMesh Console**, the web control app served by the bridge node of an ESP32 mesh prop controller for Halloween/holiday yard displays. This bundle covers a **working Survey prototype** (live mesh topology, node detail, placement mode, STOP ALL) on the chosen left-rail shell, plus static hi-fi mockups of all five views (Survey, Nodes & Channels, Cues, Blueprint, Show Graph), phone layouts, and a component sheet.

## About the Design Files
The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, **not production code to copy directly**. Recreate these designs in the propmesh codebase's existing environment and patterns (the console is served from ESP32 flash, so keep the same constraints: lightweight assets, one webfont, SVG iconography, no photography). The `.dc.html` files use a design-tool component format; read them for markup, inline styles, and the logic class (plain React-style class at the bottom of each file) — the data model and interaction logic there translate directly.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and copy are final intent — recreate pixel-perfectly. The five-view mockups in `PropMesh Console.dc.html` are static hi-fi references; `Survey Prototype.dc.html` is the interactive reference for behavior.

## Chosen shell (applies to every view)
Left rail, 176px, `#101318`, right border `#262b33`:
- Header: logo (3-node mesh triangle, ember `#ff6b2c`) + "PROPMESH" 12px mono 700 + "bridge v0.9.4" 9.5px mono `#5f6873`
- Nav items: 12.5px system-ui 500 `#9aa3af`, 9px 10px padding, radius 6. Active: `#ff8a4d` on `#1c1109` bg, border `#3a2211`. Nav column scrolls on short viewports (`flex:1;min-height:0;overflow-y:auto`)
- Pinned bottom: telemetry block (BRIDGE ● LINKED / SYNC ±2.1 ms / NODES 6/1/1, 10.5px mono) above the **STOP ALL** button — both `flex:none` so STOP ALL is always visible (hard requirement)

## Screens / Views

### Survey (working prototype — `Survey Prototype.dc.html`)
- **Canvas**: full-bleed, `#0b0d10` with dot grid (`radial-gradient(#161a20 1px, transparent 1px)`, 24px tile). SVG viewBox 0 0 1080 700.
- **Links**: RSSI-coded — strong ≥−60: `#3fb950` width 2.5; ok −60…−75: `#6b7684` width 1.8; weak <−75: `#e0a52a` width 1.3 dash `6 4`; lost: `#f4483a` width 1.4 dash `4 5`, label "LOST 42m". RSSI label at midpoint, 10.5px mono 600, link color, `paint-order:stroke` with 6px `#0b0d10` stroke for legibility. Legend chip bottom-left.
- **Nodes**: Pro = 52×40 rect radius 8, Mini = r15 circle; fill `#1a1e24`, 2px stroke by status (online `#3fb950`, asleep `#8b93a1` + ☾ icon, low battery `#e0a52a`, missing `#f4483a` dashed `3 3` + ✕). Name 12.5px system-ui 600 below; subline 10.5px mono (`PRO · H1` or `3.41 V · H2`). Selected: ember dashed ring r31. Locate: pulsing ember ring (opacity 0.9→0.05, .8s alternate).
- **Header strip**: view title + health pill (DEGRADED amber `#e0a52a` on `#2b2110`/`#4a3a14`, or HEALTHY green) + fault summary + "live · updated 1 s ago" with blinking green dot. Gradient scrim over canvas, `pointer-events:none`.
- **Detail panel** (node selected): 330px right panel `#101318`. Header: name + status pill + close ✕. 2-col stat grid (1px `#20242b` gutters): UPTIME, FIRMWARE (upgrade hint `↑ 0.9.4` in `#ff8a4d`), FREE MEMORY, ROUTE, POWER (battery V + %), BOARD. NEIGHBORS list (name + RSSI badge). RECENT EVENTS mono log (warn timestamps `#e0a52a`, normal `#5f6873`). Footer: Blink LED / Reboot (secondary) + "Placement mode" (ember outline).
- **Placement mode** (modal, also the phone layout at 390px): dark scrim `rgba(8,9,12,.94)`, card ≤400px. Header "PLACEMENT MODE" ember + Exit. Node name, `MINI · via <parent> · hop N`, giant RSSI readout 68px mono 800 colored by quality, quality pill (STRONG/OK/WEAK/LOST) + trend ("trending better ↗"), 14-bar signal history (last bar quality-colored, rest `rgba(139,147,161,.28)`, height `(rssi+95)*1.7` clamped 6–56px), guidance micro-copy, then two 52px buttons: "Blink this node's LED" (secondary) and "Mark placed — done" (ember filled). Touch targets ≥44px.

### Other four views (static reference — `PropMesh Console.dc.html`, canvas ids 1c–1h)
- **Nodes & Channels (1c)**: fault banners (missing node red, low battery amber) → filter toolbar + firmware-update CTA → node table (grid columns 280/90/130/120/1fr/40) with expandable channel rows: channel code mono (`SERVO_1`), editable label ("coffin lid"), live state, TEST FIRE button per output; sensor rows show live value.
- **Cues (1d)**: SHOW ARMED bar (ember toggle + stats + offline-trigger warning), rule rows (enable toggle, name, `trigger → sequence → targets · timing` pipeline in mono, last-fired, TEST), right 400px editor (trigger select w/ OFFLINE warning, sequence picker, target chips, 2×2 timing grid, Simulate + Save).
- **Blueprint (1e desktop, 1f phone)**: left tool rail (select/polygon/line/place/erase), yard SVG (house/garage polygons `#14171c` stroke `#3a4150`, driveway, dashed property line), nodes with live status, mesh-links overlay toggle. Phone: view-only map + bottom sheet with node status + Blink/Open-in-Survey.
- **Show Graph (1g)**: 200px palette (Triggers/Logic/Outputs), dot-grid canvas, node cards 180–200px (`#14171c`, header row with category tag, mono param line, 9px port dots on edges), bezier wires `#3a4150`; active run path ember (wires 2.5px `#ff6b2c`, cards ember-bordered with glow), RUN badge, zoom stack, minimap.
- **Component sheet (1h)**: node card, status pills, RSSI badges, battery indicator, test-fire states, rule row, panel header, STOP ALL idle + confirming.

## Interactions & Behavior
- **Node select**: click node → detail panel; ✕ deselects. Selection ring + name turns `#ff8a4d`.
- **STOP ALL**: press-and-hold ~1.5s (mousedown/touchstart; interval fills progress overlay `rgba(255,107,44,.35)` left→right; release cancels). On complete: button becomes filled `#ff6b2c`/dark text "STOPPED"; full-width banner `#2a1108`/ember border: "⬣ ALL OUTPUTS STOPPED — every motor, relay, LED and audio killed · cues suppressed" + RE-ARM SHOW button. Real implementation: broadcast kill, suppress cues until re-arm.
- **Live telemetry**: 1s tick; RSSI random-walk ±4 dBm around base (replace with real mesh telemetry via WebSocket/SSE from bridge). Link colors/labels, sync jitter, placement history update per tick.
- **Locate**: blinks node ring 4s, button reads "◉ Blinking…" (real: node blinks its status LED).
- **Placement mode**: entered from detail panel; per-second parent-link RSSI history; trend compares first vs last sample.
- **Test fire** (Nodes & Channels): tap → FIRING state (filled ember + countdown), tap again stops; disabled while show armed.

## State Management
- `sel` (selected node id), `stopped`/`holding`/`stopPct`, `placement`, `blink`, per-link jitter map, RSSI history array.
- Data model: nodes `{id, name, type: pro|mini, status: online|asleep|low|missing, hop, fw, mem, uptime, route, battV}`; links `{a, b, rssi, lost}`; parent map for hop routing; per-node event log.
- Needs from bridge: topology + RSSI stream, node stats, event log, cue state, STOP ALL and locate/test-fire commands.

## Design Tokens
Colors — bg page `#0b0d10` (dot grid `#161a20`); panel `#101318`; card `#14171c`; raised `#191d23`/`#1a1e24`; borders `#20242b`, `#262b33`, `#333a45`; text `#e6e9ed` / `#c7cdd6` / `#9aa3af` / `#8b93a1` / `#5f6873` / `#3f4652`. Accent ember `#ff6b2c`, text-on-dark ember `#ff8a4d`, ember bg `#2a1108`/`#1c1109`, ember border `#6b3a1a`/`#3a2211`, text-on-ember `#1a0d05`. Status: green `#3fb950` (bg `#0f2416`, border `#1f4a2c`); amber `#e0a52a` (bg `#2b2110`, border `#4a3a14`); red `#f4483a` (bg `#2a1210`/`#1e0d0b`, border `#4a1f1a`); neutral link gray `#6b7684`.
Type — one webfont: **IBM Plex Mono** (400–700) for all data, labels, badges, telemetry; `system-ui` for names/body copy. Scale: 9.5–13px UI, 10–10.5px section labels (letter-spacing .08–.14em, uppercase), 68–76px placement readout.
Spacing/shape — radius 5–8px (pills 99px), 1px borders, flat panels (no shadows except ember glows `rgba(255,107,44,.15–.35)`), 24px dot-grid tile, rail 176px, detail panel 330px, cue editor 400px.

## Assets
No external assets. Logo and all icons are inline SVG / unicode glyphs (⌂ ☾ ✕ ⚡ ⬣ ◎); STOP ALL octagon is an inline SVG path. Font from Google Fonts (self-host the two Plex Mono woff2 weights for flash serving).

## Files
- `Survey Prototype.dc.html` — working Survey prototype (behavior reference; logic class at bottom)
- `PropMesh Console.dc.html` — full canvas: shell options (2a–2c; 2b chosen), all five views, phone layouts (1b, 1f), component sheet (1h)
- `screenshots/` — PNG of every view: `0-survey-prototype` (live prototype), `1a`–`1h` (five views, phone layouts, component sheet), `2a`–`2c` (shell options; **2b is the chosen shell**)

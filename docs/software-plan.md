# PropMesh — Software Plan v0.1

Companion to `hardware-spec.md`. Covers node firmware, bridge firmware,
the mesh protocol, and the control app ("console"). Written 2026-09-01.

**Two-track premise** (schedule revised 2026-09-01 — Pro v0.1 boards
arrive late Sep 2026, October 2026 is a field season, launch is
Halloween 2027):

- **The October 2026 show does NOT wait for the real stack.** It runs
  "show firmware v0": hardcoded sequences in the style of
  `reference/halloween-stepper` and `lantern-fire-test`, plus — if remote
  triggering is wanted — one last season of the proven painlessMesh rig
  from `reference/prop-mesh`. Zero new protocol work before Halloween.
- **The real stack (ESP-NOW mesh, cue engine, console) is winter work**,
  built on devkits *and* the field-tested v0.1 boards, replacing the
  painlessMesh rig before the 2027 season. Nothing below blocks on v0.2
  hardware.

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  console/  — web SPA, served from the bridge's flash    │
│  (survey · config · cue editor · blueprint · OTA UI)    │
└───────────────┬─────────────────────────────────────────┘
                │ WebSocket + REST, mDNS discovery
┌───────────────┴─────────────────────────────────────────┐
│  BRIDGE — any Pro, promoted by config (not a build)     │
│  WiFi STA + sACN/E1.31 ingress + MQTT (optional) + web  │
└───────────────┬─────────────────────────────────────────┘
                │ ESP-NOW flood, same channel as router
┌───────────────┴─────────────────────────────────────────┐
│  MESH — connectionless broadcast flood                  │
│  powered nodes relay (backbone) · battery Minis = leaf  │
└───────────────┬─────────────────────────────────────────┘
                │
┌───────────────┴─────────────────────────────────────────┐
│  NODES — Pro / Mini, one firmware core, board profiles  │
│  cue engine · effects · drivers · sleep · OTA           │
└─────────────────────────────────────────────────────────┘
```

**Locked decisions** (rationale in git history and `reference/README.md`):

| Decision | Reason |
|---|---|
| **ESP-NOW flood, not painlessMesh** | painlessMesh trees break when nodes sleep (kills the Mini's battery story), concentrate RAM cost on well-connected nodes (worst on C3), and degrade past ~10 nodes. Flooding is connectionless: per-node cost is flat regardless of mesh size. |
| **Powered nodes relay; battery Minis never relay** | A sleeping leaf just misses traffic and rejoins invisibly. The mesh must never depend on a sleeping node as a path. One role flag in the heartbeat. |
| **Cues over the mesh, not pixel streams** | Nodes store sequences locally; the mesh carries "fire sequence N at mesh-time T" plus clock sync. Tiny packets, jitter-tolerant, scales with node count. Live sACN streaming is a bridge-local / 1-hop feature only. |
| **Logical channels, not raw GPIO** | Mesh messages address `RELAY_1`, `SERVO_2`, `LED_STRIP_1` — generated from `pinmap.yaml`, board-portable, and can't touch a strapping pin. (Lesson from `reference/prop-mesh`, which shipped raw GPIO numbers over the air.) |
| **Bridge is a role, not a SKU** | Every Pro image includes bridge capability (~1 MB of web assets in 8 MB flash); the console or button promotes one node. The Mini can't be a bridge (RAM, and no reason). |
| **One firmware core, two board profiles** | `pins_pro.h` / `pins_mini.h` + capability flags select drivers at compile time. |
| **PlatformIO + Arduino core 3.x (pioarduino platform)** | Matches the prototypes, the contributor community, and the libraries (FastLED, TMCStepper, AccelStepper). Drop to ESP-IDF APIs directly where Arduino lacks them (ESP-NOW, deep-sleep hold, RMT). Note: use the community **pioarduino** platform — the legacy `espressif32` platform is frozen on Arduino 2.x. |

## 2. Repo layout (target)

```
schema/messages.yaml     mesh message + channel definitions (single source of truth)
tools/genmsg.py          -> firmware/common/proto_gen.h + console/src/proto_gen.ts
firmware/
  common/                mesh stack, cue engine, effects, config store, OTA
  pro/                   PlatformIO env: ESP32-S3 (+ bridge role)
  mini/                  PlatformIO env: ESP32-C3
console/                 Vite + React + TypeScript SPA
```

The `schema/` → codegen → CI-check pipeline is the same pattern as
`pinmap.yaml` → `genpins.py`, for the same reason: the firmware and the
web app must be mechanically unable to drift apart.

## 3. Mesh protocol v1

**Transport:** ESP-NOW broadcast frames, fixed channel (set by the
bridge's router; nodes scan for the bridge beacon to find it — the
channel-coupling lesson from `prop-mesh-bridge`). Payload budget
**≤ 200 bytes** app-layer (fits classic 250-byte ESP-NOW; larger v2
frames are a later optimization, never a dependency).

**Flooding:** every frame carries `(src, seq, ttl)`. Relay-role nodes
rebroadcast once after a random 2–10 ms jitter; all nodes dedup on a
`(src, seq)` sliding window. TTL default 4.

*Implemented* (`pm_dedup.h`): the window is **per source**, 32 deep, as
a bitmap behind the newest sequence number — the IPsec anti-replay
shape. One shared window churns several entries per originated frame
(one per relay path), so on a busy mesh a late duplicate over a long
path can fall out of it. Sequence comparison is wrap-safe, and a source
whose counter jumps far backwards is treated as rebooted rather than as
a stream of ancient duplicates.

**Time sync** *(implemented: `pm_time.h`)*: the conductor beacons its
clock every 5 s. **Relays re-stamp the timestamp at the moment of
transmission**, so the 2–10 ms relay jitter a beacon sat through does
not accumulate as downstream clock error — per-hop error stays at
airtime plus callback latency. Nodes adopt a beacon when they are
unsynced, when their sync is stale, from a higher-id conductor
(election), or over a shorter path to the same conductor. Corrections
under 100 ms are smoothed (quarter of the delta) so the clock never
steps backwards under normal jitter; anything larger is a reboot or a
new conductor and jumps. A conductor that hears a higher-id conductor
steps down on its own.

**Neighbor discovery** *(implemented: `pm_neighbors.h`)*: a heartbeat
that arrives with an undecremented TTL came straight off the radio, so
its source is a direct neighbor. RSSI is smoothed to keep the survey
view from flickering; entries not refreshed in three heartbeat periods
age out, so a sleeping or dead node drops off the topology on its own.

**Security:** a network key provisioned at setup (captive portal).
Frames carry a truncated AES-CMAC tag; seq window doubles as replay
protection. Payload encryption is a v2 option — authentication is the
part that must be in the frame format from day one.

**Message types:**

| Type | Direction | Content |
|---|---|---|
| `HEARTBEAT` | node → flood | status, battery (Mini), role, neighbor list with RSSI — **this feeds the survey view** |
| `TIME` | conductor → flood | mesh-clock beacon; hop-count field for per-hop latency compensation. Target sync: ±10 ms at 3 hops |
| `CUE` | any → flood | fire sequence N on target group at mesh-time T (T in the future absorbs hop jitter) |
| `STATE` | node → flood | sensor event / trigger report |
| `CONFIG` | bridge → node | node settings, channel maps, sequences (chunked) |
| `OTA` | bridge → flood | chunked image, targeted by board role (`pro`/`mini`), NAK-based repair |

**Prior art to compare against before hardening:** Hemisphere-Project's
**ESPNowMeshClock** is a mature, show-control-oriented ESP-NOW mesh-time
library. `pm_time.h` was designed independently; a side-by-side may
surface edge cases (conductor churn, drift under packet loss) it has
already solved.

**Conductor:** the bridge by default; any powered node can be elected if
the bridge dies mid-show (highest node-id heartbeat wins). Shows must
not stop because the WiFi router hiccuped.

## 4. Node firmware

Modules in `firmware/common/`, composed per board profile:

- **HAL** — generated pin headers + drivers: PCA9685 (servos/LEDs/relays),
  LEDC motor PWM @ 25 kHz, TMC2209 shared UART (port `halloween-stepper`:
  TMCStepper + AccelStepper, StallGuard homing), WS2812/APA102 via
  FastLED/RMT, I²S audio (MAX98357A), sensors with debounce.
- **Cue engine** — a sequence is a **timeline**: a list of
  `(t_ms, channel, action, params)` addressing logical channels, with
  effect references. Stepper actions carry motion primitives
  (`move_to`, `move_by`, speed, accel, easing) that map onto
  AccelStepper; relay/LED/servo actions are set-and-hold; audio and
  projection tracks carry a per-target **pre-roll offset**. Stored as
  JSON in LittleFS (compact binary later only if profiling demands it).
  The `halloween-stepper` animation state machine generalizes into this.
- **Effects library** — stock effects shipped in firmware: fire
  (port `lantern-fire-test`), candle flicker, lightning, chase, fade.
  Sequences reference them by id + params.
- **Audio** — Pro: WAV/MP3 from SD. Mini: MP3 in a LittleFS partition
  (~2 MB of a 4 MB N4 — MP3 is mandatory there, WAV won't fit).
- **Power manager (Mini)** — deep-sleep/always-on mode selector, wake on
  GPIO 4 (PIR) / GPIO 3 (IR), rail switch discipline (active-low, §3.5 of
  the hardware spec), battery reporting in heartbeats.
- **Config store** — NVS, seeded by captive portal on first boot
  (network key, node name, channel map). Port of `prop-mesh`'s NVS
  pattern, minus raw pin numbers.
- **OTA** — mesh-distributed (nodes have no WiFi credentials and may be
  out of router range — mesh OTA is the only path that works). Role
  targeting ported conceptually from painlessMesh's `initOTAReceive`.

## 5. Bridge role (Pro only)

- WiFi STA + mDNS (`propmesh.local`), ESP-NOW on the router's channel.
- **REST + WebSocket API** for the console: topology, node state, config
  push, cue firing, OTA upload, audio upload.
- **sACN/E1.31 receiver** — the adoption feature. Two mapping modes:
  universe/channel → logical output on bridge-adjacent nodes (live
  streaming), and DMX trigger channels → cues (works at any hop depth).
  xLights sees a standard sACN device; nothing new to learn.
- **Projection triggering** — *decided 2026-09-02: no Bluetooth.*
  Nothing you project with listens to BLE; it would need a custom
  player, at which point WiFi (already on the bridge) beats a third
  radio with 10 m range. What works, cheapest first:
  1. **Dry-contact relay → trigger-input player** (v1, zero new
     hardware): relay closes, clip plays. A Raspberry Pi + `mpv` +
     a two-line GPIO script is the $40 version.
  2. **sACN → Falcon Player**: FPP plays video and starts playlists
     from sACN channel values, so a projection is simply *a channel in
     the same show*. Strongest single argument for the sACN work.
  3. **IR blaster** (~$0.10 of parts, could ride a Mini): emulate the
     projector's remote — line-of-sight, remote-only commands.
  4. **"Projector node"** *(future product)*: a Pi/ESP32-P4-class mesh
     member with HDMI. Mesh time sync would allow frame-accurate
     prop-plus-projection choreography, which nothing ships today.

  **The sync limiter is the player, not the mesh.** Mesh time is good to
  ±10 ms; a consumer player takes 100–500 ms to open and start a clip.
  The Timeline therefore gives each projection track a **pre-roll
  offset** so the play command leads the physical action by the
  player's measured latency — a track property, not user arithmetic.
- **MQTT client (optional)** — port of `prop-mesh-bridge`'s topic scheme
  (`propmesh/to/...`, `propmesh/from/...`) for Home Assistant users.
- Serves the console SPA (gzipped build embedded in flash).

## 6. Console (control app)

**Stack:** Vite + React + TypeScript. No backend — the bridge is the
backend. Types generated from `schema/messages.yaml`.

**Views, in build order:**

1. **Yard** *(build first — it's also the bring-up and yard-debug
   tool)*: the mesh from heartbeat neighbor tables — status, RSSI per
   link, hop depth, battery, firmware per node — in two layouts behind
   one toggle. **Topology** (auto-arranged by hop) answers "is my mesh
   healthy" and needs no setup, so it is the default and the only one
   that works on a shelf testbed. **Map** *(the drawing tools are v2)*
   puts the same nodes on a drawn yard outline and answers "where is
   that physically" — position plus RF explains what topology alone
   cannot, like a weak link that crosses the house.
2. **Nodes & channels**: name nodes, map logical channels to props,
   test-fire any output, edit node settings, trigger OTA.
3. **Show Graph** *(v1 — restored 2026-09-02)*: **the trigger-wiring
   layer.** Trigger nodes (sensors, time, sACN, manual) → logic nodes
   (delay, random, cooldown, lockout, group) → **action nodes, where an
   action is a reference to a sequence** authored in the Timeline. A
   one-PIR show is a two-node graph; the same editor scales to fan-out,
   fan-in and conditions without a second tool. React Flow.
4. **Cues**: **a list projection of the Show Graph, not a separate
   editor** — every trigger→action edge as a row, with the armed /
   disarmed bar, per-rule enable toggles, and last-fired times that a
   list does better than a canvas. Same model, two views, like
   Yard's topology/map. The existing Cues view is kept as this.
5. **Timeline** *(v1)*: **the action-authoring layer.** Horizontal
   time, **one track per actuator** (stepper, servo, relay, LED
   channel, audio, projection), blocks with start/duration/params,
   scrub and preview. This is how stepper choreography is expressed
   ("to 200 steps at speed 3, ease in 800 ms, hold, home") and it is
   what every animatronics tool converges on (Brookshire VSA,
   Gilderfluke, xLights). Simple first: blocks and numbers, no curve
   editor. Every track type carries a **pre-roll offset** for
   slow-starting targets (video players, fog machines, pneumatics).

**Execution model — decided 2026-09-02.** The graph is an *authoring*
abstraction; it does **not** run on the bridge at show time. It
**compiles to per-node trigger tables**: the node that owns a sensor
holds its own outgoing edges (with delays, cooldowns, targets) and
**broadcasts the resulting cues itself**. Sequences live on the nodes
that execute them. A dead bridge therefore costs the console and sACN
ingress, never the show — consistent with conductor election.

*Design note:* the handoff drew Topology and Map as separate views
(Survey and Blueprint). Merged during implementation — same nodes,
statuses, links and selection, so two canvases could (and in the
handoff's art, did) disagree about the mesh. One view, one selection,
one detail panel, half the canvas code.

## 7. Testing

- **Host-native unit tests** (PlatformIO `native` env) for everything
  with no hardware in it: flood dedup/TTL, time-sync math, cue
  scheduling, schema round-trips. These run in CI. *The mesh core's
  pure logic is header-only precisely to keep it testable this way —
  `pio test -d firmware/test -e native`; 21 cases so far.*
- **Devkit mesh testbed, now**: 5+ devkits on a shelf running soak
  tests — topology churn, sleep/wake cycling, OTA distribution, range
  test in the actual yard before winter.
- **CI**: build all envs + host tests + `genpins.py --check` +
  `genmsg.py --check` on every push.
- **Hardware-in-loop** starts at April bring-up, against a stack that
  already passed the above.

## 8. Milestones

Aligned to the revised hardware schedule (hardware-spec §7): Pro v0.1
Sep 2026, field season Oct 2026, Mini v0.1 Nov–Dec, launch Sep 2027.

| When | Software milestone | Hardware |
|---|---|---|
| **Sep 2026** | Software mostly paused — the month belongs to Pro v0.1 design and bring-up. Only "show firmware v0": hardcoded sequences ported from `reference/`, bring-up test sketches | Pro v0.1 arrives |
| **Oct 2026** | **Field season — decorate, observe, log.** Show runs on firmware v0 (+ painlessMesh rig for triggers if wanted). Defect log is the winter to-do list | Pro v0.1 in the yard |
| **Nov–Dec 2026** | `schema/` + codegen; mesh frame format; ESP-NOW flood core + time sync on devkits and field-tested Pros. (Hardware in parallel: Mini v0.1) | Pro v0.1, Mini v0.1 |
| **Jan–Feb 2027** | Cues end-to-end; cue engine + stock effects; config store + captive portal; bridge WS API; **Survey view live**. painlessMesh rig retired | v0.2 spin lands |
| **Mar–Apr 2027** | sACN ingress + xLights smoke test; Nodes & Channels view; Cues view; mesh OTA | v0.2 |
| **May–Jun 2027** | Hardening for beta: Mini sleep current, sync accuracy, OTA reliability; fogger profile end-to-end; beta ships | beta fleet |
| **Jul–Aug 2027** | Beta feedback loop; docs; Blueprint view if time allows; promo season | beta fleet |
| **Sep 2027** | Ship. Console v2 features (graph editor) are post-ship | ship |

**De-scope line (protect the ship date):** v1 ships without Blueprint
drawing tools, Node-RED nodes, ESPHome, MQTT, BRMesh adapter, projector
node, and multi-hop streaming. **Show Graph and Timeline are both v1**
— triggers-to-actions and action-authoring are the two halves of the
product's core, and neither is an extra. They are also the two largest
console builds of the winter; the Yard and Nodes views being largely
done is what makes room for them. Each is additive later; none blocks a working show.

## 9. Licensing

Firmware and console: **MIT** (per README). Protocol spec and this doc:
CC BY-SA 4.0. The schema file is MIT so third-party tools can generate
bindings without thinking about it.

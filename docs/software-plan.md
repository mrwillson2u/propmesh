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
- **Exception, decided 2026-10-03: generic-board support is October
  work.** Off-the-shelf ESP32 devkits get pins assigned from the console
  (`docs/generic-boards.md`), staged so each step is a usable fallback
  for this year's show: USB config (Stage 1) → config over the mesh
  (Stage 2) → sensor-triggered sequences (Stage 3), frozen Oct 22.
  Channels stay logical; GPIO numbers never leave the node.
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
| **The WiFi-band radio (ESP-NOW), not Zigbee / Thread / BLE / LoRa** | The radio is free — the ESP32 is already on the board for the console, sACN and OTA, and the one radio also serves phones. The show's real traffic profile (mostly powered nodes, yard scale, ±10 ms sync, MB-scale OTA and audio uploads) is what a WiFi PHY does well and the low-power radios do badly. Comparison in §1.1. |
| **ESP-NOW flood, not painlessMesh** | painlessMesh trees break when nodes sleep (kills the Mini's battery story), concentrate RAM cost on well-connected nodes (worst on C3), and degrade past ~10 nodes. Flooding is connectionless: per-node cost is flat regardless of mesh size. |
| **Powered nodes relay; battery Minis never relay** | A sleeping leaf just misses traffic and rejoins invisibly. The mesh must never depend on a sleeping node as a path. One role flag in the heartbeat. |
| **Cues over the mesh, not pixel streams** | Nodes store sequences locally; the mesh carries "fire sequence N at mesh-time T" plus clock sync. Tiny packets, jitter-tolerant, scales with node count. Live sACN streaming is a bridge-local / 1-hop feature only. |
| **Logical channels, not raw GPIO** | Mesh messages address `RELAY_1`, `SERVO_2`, `LED_STRIP_1` — generated from `pinmap.yaml`, board-portable, and can't touch a strapping pin. (Lesson from `reference/prop-mesh`, which shipped raw GPIO numbers over the air.) |
| **Bridge is a role, not a SKU** | Every Pro image includes bridge capability (~1 MB of web assets in 8 MB flash); the console or button promotes one node. The Mini can't be a bridge (RAM, and no reason). |
| **One firmware core, two board profiles** | `pins_pro.h` / `pins_mini.h` + capability flags select drivers at compile time. |
| **USB stays in "Hardware CDC and JTAG" mode on the S3** | That mode is what lets esptool reset the chip into its bootloader over the cable with no auto-program transistors on the board (decided 2026-09-07). Switching the USB stack to OTG/TinyUSB disconnects the Serial/JTAG peripheral and loses the auto-reset — then only the BOOT button gets you back in. If a custom USB device class is ever wanted, it is a deliberate trade, not a default. |
| **PlatformIO + Arduino core 3.x (pioarduino platform)** | Matches the prototypes, the contributor community, and the libraries (FastLED, TMCStepper, AccelStepper). Drop to ESP-IDF APIs directly where Arduino lacks them (ESP-NOW, deep-sleep hold, RMT). Note: use the community **pioarduino** platform — the legacy `espressif32` platform is frozen on Arduino 2.x. |

### 1.1 Why the WiFi radio (asked 2026-09-06)

What this project needs from its radio: **yard scale** (tens of metres,
through props and walls) with relaying past the router's reach;
**±10 ms show sync** and cue latency well under 100 ms; small cue
traffic plus **MB-scale bulk** (a ~1.5 MB OTA image, audio clips,
sequences); **a phone / iPad path**; **mostly powered nodes**, with
battery Minis that deep-sleep and wake on a sensor; a $2–3 radio BOM;
hobbyist-flashable firmware. Against that profile:

| Radio | Range / penetration | Throughput → 1.5 MB OTA | Sync / latency | Phone path | Cost here | Verdict |
|---|---|---|---|---|---|---|
| **WiFi PHY, ESP-NOW** (chosen) | good at yard scale; U.FL external antenna; LR mode stretches relay links | tens of kB/s → ~1 min per node | ~1–3 ms per hop; ±10 ms achievable | yes — the same radio serves the console | $0, already there | **keep** |
| Zigbee / Thread (802.15.4) | same band, lower power, similar range | 250 kbps PHY, a few kB/s real → 5–15 min per node, worse multi-hop; no audio | 5–20 ms per hop plus stack jitter | none — the bridge still needs WiFi | a second radio (the S3 has none; the C6 lacks the Pro's GPIO and PSRAM) and a heavyweight stack | wins only for always-listening battery sensors, which this board deliberately doesn't have |
| BLE / BLE Mesh | same band, lower power | slow; OTA over BLE mesh impractical | worse and less deterministic; time-slices with WiFi on the bridge | a phone reaches ONE node — and the web console can't use BLE on iOS (no Web Bluetooth in Safari) | free on-chip | no — the 2026-09-02 "no Bluetooth" reasoning generalises |
| LoRa (sub-GHz) | km scale, best penetration | 0.3–50 kbps → hours | 50–500 ms airtime per frame | none | $3–5 module + antenna, own protocol | right for a farm haunt, wrong for a yard; bulk transfer kills it |
| 433 / 915 MHz OOK/FSK | good penetration | tens of kbps, no mesh | ms-ish | none | second radio | not a backbone — but an **RF key-fob receiver is a good plug-in trigger accessory** on a `DIGITAL_IN` (outdoors it beats IR) |
| Wired DMX / Ethernet | — | high | best | — | — | the reliable path already exists: sACN into the bridge |

**Hedges that cost nothing:** the mesh core (flood, dedup, time sync)
is header-only and radio-agnostic — a sub-GHz or 802.15.4 backhaul
later would be a transport swap in `pm_mesh.cpp`, not a redesign.
ESP-NOW LR mode is a configuration knob for relay-to-relay links (with
the phone caveat in §5.1) — measure it in the October field season.
The Mini's battery life is decided by sleep discipline, not by the
radio. Where WiFi-PHY genuinely loses — an always-listening battery
node that must catch a cue at any moment — is a product this board
does not try to be; the Mini's two modes (deep-sleep trigger-driven,
or powered always-on) are that decision made explicit.

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
| `CUE` | any → flood | fire sequence N on target group at mesh-time T (T in the future absorbs hop jitter), optionally from `start_offset_ms` into the sequence (console play-from-cursor) |
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
  FastLED/RMT (both Pro strip outputs are 3- or 4-wire), I²S audio
  (MAX98357A), sensors with debounce. **IR remote receive is a
  `DIGITAL_IN` mode, not a dedicated pin** (Pro dropped the onboard
  TSOP 2026-09-05 — a hidden board can't see a remote): a plug-in
  TSOP module on a sensor pigtail, the input configured as RMT RX.
- **Cue engine** — a sequence is a **timeline**: a list of
  `(t_ms, channel, action, params)` addressing logical channels, with
  effect references. Stepper actions carry motion primitives
  (`move_to`, `move_by`, speed, accel, easing) that map onto
  AccelStepper; relay/LED/servo actions are set-and-hold; **`ramp`
  (from, to, duration, easing) is a native action the node interpolates
  itself at ~50 Hz** — decided 2026-09-05, so a smooth sweep is one
  event, not fifty keyframes over the mesh; audio and projection tracks
  carry a per-target **pre-roll offset** (subtracted by the console's
  compiler, invisible to the node). A cue may start a sequence at
  `start_offset_ms` (play-from-cursor). Stored as JSON in LittleFS
  (compact binary later only if profiling demands it).
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

### 5.1 Reaching the mesh from the yard (proposed 2026-09-05)

The scenario: nodes around the house, some beyond the router's WiFi
(the reason for the mesh), and Colin standing among them with a phone
or a **WiFi-only iPad** wanting to set things up or author a sequence.
Two cases, two answers:

- **No internet, walking the yard → walk-up access point on any Pro.**
  Every powered Pro can raise a soft-AP (`PropMesh-Yard`, WPA2) and
  **front the whole mesh**: it serves the console (the bridge assets
  are in every Pro image) and carries the console's API over ESP-NOW
  via a small request/response wrapper. ESP-NOW and a soft-AP coexist
  on the one pinned channel. Good for cues, direct-set, scrub and
  sequence authoring (kilobytes); **not** for audio uploads (do those
  at the real bridge). Re-join the nearest node's AP as you walk —
  same SSID everywhere, no seamless roaming. iOS captive-portal
  handling as WLED-AP does it. Zero infrastructure, zero accounts;
  security = mesh key + AP password + the API token. **Target: beta
  (May–Jun 2027)** — it is what beta testers in yards will ask for
  first. The Mini can't host it (RAM); it needn't — Minis are leaves.

  **Radio facts this rests on** (checked 2026-09-05). ESP-NOW is
  vendor-specific 802.11 action frames on the ordinary WiFi radio, so
  it coexists with STA and AP modes — but **one radio means one
  channel**, and every failure mode below is that rule biting:
  - A plain node runs `WIFI_STA` *unassociated* + `esp_wifi_set_channel`
    (what `pm_mesh_init` does today), so nothing can move its channel.
    A walk-up node is AP-only and picks the mesh channel for its AP.
    The bridge is AP+STA, where **the association wins and drags the
    soft-AP's channel with it** — self-consistent here because the mesh
    channel is the router's channel, but users must fix the router's
    channel or an auto-hopping router will drop soft-AP clients.
  - **`esp_wifi_set_ps(WIFI_PS_NONE)` on every powered node that
    associates.** An associated station modem-sleeps between beacons and
    silently misses ESP-NOW frames. Today's code dodges this by never
    associating; the bridge cannot.
  - **`peer.ifidx` must match the active interface** — `WIFI_IF_STA`
    today, `WIFI_IF_AP` on an AP-only walk-up node, or the send fails.
  - **ESP-NOW long-range (LR) mode is exclusive of phones.** If LR is
    ever enabled for range, keep 802.11 b/g/n in the protocol bitmap;
    an LR-only node cannot host the console for a phone or iPad.
  - Node ids come from `ESP_MAC_WIFI_STA`, which is stable across mode
    changes — a node raising an AP keeps its identity.
- **On cellular, away from home → bring your own remote access, no
  project cloud.** A login service, TLS, device pairing and an always-on
  relay are an ops burden and a liability for an open-source hardware
  project. Users get the result from mature tools, at two levels:
  - **Trigger and monitor from anywhere: Home Assistant.** The bridge's
    MQTT client publishes **MQTT discovery** so each relay, cue and
    sensor appears in HA as an entity with no YAML; Nabu Casa (or any
    HA remote-access setup) then reaches those entities from cellular.
    Nabu Casa exposes HA's UI, **not** MQTT and not the bridge — it is
    entity-level control (fire a cue, switch a rail, see a dead node),
    never the console.
  - **Author from anywhere: a tunnel to the bridge.** Two ways, both
    the user's own setup (asked 2026-09-06):
    - **Today, zero firmware:** a Tailscale (or ZeroTier) **subnet
      router** anywhere on the home LAN — a Pi, a GL.iNet / OpenWrt /
      Unifi router, or an **Apple TV** (tvOS runs Tailscale as a subnet
      router) — advertises the bridge's LAN address to the tailnet.
      Tailscale and ZeroTier themselves **cannot run on the ESP32**:
      their control planes (key exchange, NAT-traversal relays, ACLs)
      are Go / C++ clients with no microcontroller port, and neither
      admits a plain WireGuard peer.
    - **v1.1 candidate, no extra box: the bridge firmware as a
      WireGuard peer.** Proven on ESP32 (`esp_wireguard`; ESPHome has
      shipped it since 2023). The bridge dials *out* over UDP with a
      persistent keepalive to any WireGuard endpoint the user has — a
      router that speaks it or a cheap VPS — so no port forward, no
      dynamic DNS, CGNAT-proof; the phone runs the WireGuard app to the
      same endpoint. Needs **SNTP** (handshake timestamps) and a
      **key UX** in the console (keypair generated on-device, public
      key as a QR, paste endpoint + its key). Tens of KB of RAM,
      low-Mbps ChaCha20 in software — ample for a PWA-cached console.
      Static keys, no accounts: consistent with "run nothing".

  Document the recipes; run nothing.

**Decide now, while cheap:** (1) the console talks through a
**transport abstraction** — local WebSocket today, mesh-proxied or
tunneled later; (2) **the bridge API requires a token from day one**
(anyone on the home WiFi must not be able to run the yard, and every
remote path assumes it); (3) reserve the request/response wrapper
message types in `schema/` so the walk-up AP is purely additive.

## 6. Console (control app)

**Stack:** Vite + React + TypeScript. No backend — the bridge is the
backend. Types generated from `schema/messages.yaml`.

**Served from the bridge — budget, decided 2026-09-05.** The bridge
serves the app; the browser runs it. All heavy work (timeline compile,
waveform peaks, graph layout) is client-side, so UI sophistication
never loads the ESP32. Constraints that keep it that way:
**≤ 600 KB gzipped total** (WLED ships a full UI at ~400 KB; React +
React Flow + app code lands at 300–500 KB); **one JS, one CSS, one
HTML** with everything else inlined — a browser's six parallel
connections would otherwise starve the socket pool; **no external
resources** (system fonts, inline SVG icons — the yard has no
internet); **gzip + long cache + a PWA service worker** so the bridge
serves the bundle once per browser; live data over one WebSocket.
**Assets embedded in the firmware image** for v1 — one artifact, one
schema version — a LittleFS web partition (UI updates without a
reflash) is a later option. Bundle size is checked in CI.

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

#### Timeline — implementation approach (decided 2026-09-05)

**Shipped early, 2026-10-05**, on the generic-board track
(`docs/generic-boards.md` §6b): native `ramp` steps on the node
(`pm_ramp.h`, anchored to the sequence clock), and the console Timeline
— tracks per output, draggable keyframes, ramp ⇄ jump, easing presets,
scrub with live preview, playhead. Deferred from the design below:
bezier/curve editor (presets only), audio tracks and waveforms, stepper
tracks, pre-roll offsets, zoom.

**Decided:** ramps are a native node action, and live scrub ships in
v1 — it is the demo that sells the board. `Cue.start_offset_ms` is in
the schema as of the same day.

**Feasibility:** high. The mesh, time sync, logical channels and the
`(t_ms, channel, action, params)` cue engine are the hard parts and are
already designed; the timeline is a well-understood editor over a small
data model. Estimate: a usable v1 (blocks, drag, params, play/stop)
in ~3–4 weeks of evenings once cues run end-to-end; live scrub on real
props another few days. Slot: Feb 2027 model + engine, Mar editor,
Apr scrub and polish.

**Data model (console-side, `schema/`):**

```
Sequence { id, name, length_ms, tracks[] }
Track    { channel (logical, from pinmap), kind, preroll_ms, blocks[] }
Block    { t_ms, dur_ms, action, params, ease }
```

Track kinds mirror channel kinds: `relay` (on/off blocks), `pwm` (LED
level, `ramp` from→to with ease), `servo` (position, `ramp`), `strip`
(effect id + params, no per-pixel data), `stepper` (`move_to` /
`move_by` with speed, accel, ease; `home`), `audio` (clip + offset),
`projection` (trigger). Blocks and numbers only; easing is a dropdown
(linear, in, out, in-out) — no curve editor in v1.

**Three dumb layers, one smart compiler:**

- **The console compiles.** Tracks flatten to a per-node, time-sorted
  event list — exactly the cue-engine format — split by which node owns
  each channel; pre-roll is subtracted at compile time so the node never
  knows about it. Pushed via `CONFIG` (chunked); each node stores only
  its own events in LittleFS.
- **The node plays.** One scheduler: `while next.t <= mesh_now - t0:
  exec(next)`. Set-and-hold actions are one write. **Ramps are a native
  action** the node interpolates at ~50 Hz (`from, to, dur, ease`) —
  never emit 50 keyframes over the mesh. Stepper actions hand off to
  AccelStepper and run asynchronously. Audio is `play(clip, offset)`.
- **The bridge does nothing at show time** (execution-model decision
  below): a sequence spanning several nodes fires on one mesh-time `T`
  and the ±10 ms sync does the rest.

**Editor (React, one `<canvas>` or SVG):** track list on the left,
horizontal time with a ruler and playhead, draggable/resizable blocks,
click a block → params form in a side panel, snap grid (50 ms), zoom.
Hand-rolled at ~1.5–2 k lines, or start from a small library
(`@xzdarcy/react-timeline-editor`-class) and replace it if it fights.
Keep state immutable from day one so undo/redo is free. Two cheap wins
that matter for props: draw the **stepper position profile** as a line
under its blocks, and show **audio waveform peaks** computed in the
browser at upload (Web Audio decode → peaks array stored with the clip
on the bridge; never decode on the ESP32).

**Preview — the part that makes it feel like a controller, not a
form:**

1. **Live scrub**: as the playhead is dragged, the console sends
   immediate `SET channel value` messages (the same direct-set the
   Nodes & Channels test-fire needs anyway) — interpolated values for
   ramps, `move_to` for steppers. Props move under the cursor. Nearly
   free once test-fire exists.
2. **Play from cursor**: compile, push, then `CUE` at `T = now + 500 ms`
   with a **start-offset** parameter. Add that field to the `CUE`
   message now — trivial in the schema today, painful after v1 ships.

**Build order:** (1) schema + `ramp` action + `CUE` start offset, with
host-native tests for the TS compiler and the C++ scheduler; (2) node
engine plays a hand-written JSON sequence on a devkit — no UI; (3)
console renders a sequence read-only + play/stop; (4) editing + save to
bridge; (5) live scrub; (6) waveform, stepper profile, copy/paste,
multi-select.

**Guardrails:** it is not a DAW — blocks and numbers. Sequences stay
under ~1 k events (JSON on nodes, chunked over 200-byte frames).
Stepper tracks assume "homed at t=0" or begin with a `home` block. The
timeline is the **standalone-prop** story; pixel-heavy whole-house
shows stay in xLights over sACN — the two coexist and neither replaces
the other.

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
drawing tools, Node-RED nodes, ESPHome, MQTT, BRMesh adapter (*built
early for October 2026 as the `BLE_LIGHT` output on generic boards —
docs/generic-boards.md §6a; BLE as a peripheral output, not the mesh*), projector
node, and multi-hop streaming. **Show Graph and Timeline are both v1**
— triggers-to-actions and action-authoring are the two halves of the
product's core, and neither is an extra — **and the Timeline's live
scrub is v1 too** (decided 2026-09-05): it rides on the Nodes view's
direct-set message and is the demo that sells the board. They are also the two largest
console builds of the winter; the Yard and Nodes views being largely
done is what makes room for them. Each is additive later; none blocks a working show.

## 9. Licensing

Firmware and console: **MIT** (per README). Protocol spec and this doc:
CC BY-SA 4.0. The schema file is MIT so third-party tools can generate
bindings without thinking about it.

**Socket DC mode (MP6603 carrier, verified 2026-09-07 — hardware-spec §2.4):**
per-socket setting `stepper` | `dc`. In `dc`: EN inverter output → enabled
(low at the socket); STEP GPIO = LEDC PWM for channel A (1A/1B), duty =
1 − speed (low drives, high brakes), forward only; DIR GPIO = LEDC PWM
for channel B (2A/2B), locked antiphase, 50 % = stop; the TMC UART line
must idle high and firmware must not transact on it while an MP6603 is
fitted (it is that chip's SLEEP pin). Duty ceiling from the user's
stated motor voltage vs VMOT, as already planned.

# Generic ESP32 boards — pins assigned from the console

Off-the-shelf ESP32 boards run PropMesh with **no compiled-in pin map**:
you plug the board in, open the console, and give each pin a job
(servo, relay, motor, LED strip, sensor…). The assignment is saved in
the board's flash and the board runs it from then on, laptop or not.

Started 2026-10-03 for the **October 2026 show** — the fallback when a
prop doesn't have a Pro board, and the way anyone with a $5 devkit joins
the mesh. First board: **ESP32 DevKit V1 (30-pin, ESP32-WROOM-32)**.

Status: **Stage 2 (bridge + config over the mesh) verified on 3 DevKit
V1s 2026-10-05** (bridge `321553bc`, remotes `3214b4a8`, `82c48c7c`;
bench, boards < 1 m apart). Per run: 20 × 16-channel `set_config`
(1.6 kB, 9 chunks), 20 × `get_config`, 40 × `set`. After the fixes
below, 3 runs = 240/240 OK, 0 retries; latency median `set` 54 ms,
`get_config` 260 ms, `set_config` 418 ms. All three nodes sync to the
bridge as conductor. Console ↔ real mesh still to be run by hand (§7b).

Stage 1 firmware verified on a real DevKit V1 (2026-10-05,
ESP32-D0WD-V3, node `321553bc`)** — boot event, `hello`, a config
rejected by the node's own validator (relay on input-only GPIO 34),
save + apply with a strapping-pin warning, LED `set` (fade/blink seen
on the onboard LED by Colin), `state`, and the
config surviving a reset. Console ↔ USB (Web Serial) path still to run
by hand in Chrome. Stages 2–3 not started (see [Plan](#8-plan-october-2026)).

---

## 1. How it fits the architecture

- **Pin → function creates a logical channel.** Assigning *Servo* to
  GPIO 13 creates `SERVO_1`. Everything outside the node — cues, the
  mesh, the console's test buttons — addresses `SERVO_1`, never GPIO 13.
  The locked decision *"Logical channels, not raw GPIO"*
  (software-plan §1) holds: GPIO numbers live only in the node's own
  config file.
- **The node is the authority.** The console checks an assignment as you
  make it, but `set_config` re-runs the firmware's validator and the
  node's verdict is what decides. A config that fails is rejected whole;
  the node keeps running the previous one.
- **One board is the bridge** (decided 2026-10-05). It stays on the
  laptop's USB cable, drives **no pins**, and is the console's way into
  the mesh: requests for other nodes go out over ESP-NOW and their
  replies, heartbeats and sensor events come back up the cable. It is
  also the mesh **conductor** — the time-sync election ranks
  (priority, node id), and a bridge has priority 1, so it beats every
  plain node whatever the ids. With no bridge on the mesh, the highest
  id still elects itself, so a show keeps its clock if the laptop goes.
  Bridge mode is the `bridge` flag in the node's config; a bridge with
  pin assignments is rejected (`bridge_has_pins`). This is the October
  stand-in for software-plan §5's WiFi bridge on a Pro.
- **Pro / Mini are unaffected.** Their pins stay in `pinmap.yaml` →
  `genpins.py`. Generic boards have a *capability* profile instead of
  an assignment.

## 2. Files

| What | Where | Notes |
|---|---|---|
| Board profile — what each pin **can** do | `boards/esp32-devkit-v1.yaml` | source of truth; one file per board |
| Function table — what a function **needs** | `boards/functions.yaml` | keys = `ChannelKind` in `schema/messages.yaml` |
| Generator | `tools/genboards.py` (`--check` in CI) | → `firmware/common/propmesh/src/boards_gen.h`, `console/src/lib/boards_gen.ts` |
| Config model + validator (firmware) | `firmware/common/propmesh/src/pm_config.h`, `pm_pinrules.h` | header-only, host-tested |
| Config JSON, drivers, flash store, API | `firmware/common/propmesh-node/src/` | `pm_config_json.h`, `pm_channels.*`, `pm_config_store.*`, `pm_api.*` |
| Node firmware | `firmware/node/` | one PlatformIO env per board profile |
| Console validator mirror | `console/src/lib/pinRules.ts` | same issue codes as `pm_pinrules.h` |
| Console transport | `console/src/lib/transport.ts` | USB (Web Serial) + simulated node |
| Mesh forwarding (node side) | `firmware/common/propmesh-node/src/pm_link.*` | request routing, retries, heartbeat/input events |
| Chunk reassembly | `firmware/common/propmesh/src/pm_reassembly.h` | header-only, host-tested |
| Mesh panel (node list) | `console/src/views/nodes/MeshPanel.tsx` | top of Nodes & Channels |
| Pin editor (one node) | `console/src/views/nodes/PinEditor.tsx` | below the node list |
| Tests | `firmware/test/test/test_pin_config/`, `test_reassembly/`, `test_mesh_core/` | 56 cases in all |

**Never hand-edit `boards_gen.*`** — edit the yaml and run
`python3 tools/genboards.py`.

## 3. Functions (v0)

| Function | Channel | Pins | Driver | `set` value |
|---|---|---|---|---|
| Relay / on-off | `RELAY_n` | 1 out | GPIO; *on = LOW* option for relay modules | 0 / 1 |
| LED dimmer | `LED_n` | 1 out | LEDC 1 kHz, 12-bit | 0–1000 |
| Servo | `SERVO_n` | 1 out | LEDC 50 Hz, 14-bit; per-channel end stops (µs); **reverse**; **calibrate**; **smoothing** | 0–1000 between the end stops; or `us` (raw pulse, calibration) |
| DC motor | `MOTOR_n` | 2 out (IN1, IN2) | LEDC 25 kHz, 10-bit, into an H-bridge (DRV8871, L298N, TB6612 IN pins) | −1000 … +1000, 0 = coast |
| LED strip | `LED_STRIP_n` | 1 out | WS2812 via RMT (Adafruit NeoPixel) | `0xRRGGBB`, whole strip |
| Sensor / button | `DIGITAL_IN_n` | 1 in | debounced 30 ms; pull none/up/down; *active = LOW* option | read-only |

PWM frequencies come from `pinmap.yaml` constants (`genboards.py` fails
if they drift). **Servos boot limp** — no pulses until first commanded,
because the node can't know which position is safe for your prop.
Outputs boot off; relays are set to their off level *before* the pin
becomes an output.

**Why NeoPixel and not FastLED:** FastLED takes the data pin as a C++
template argument, i.e. at compile time. Runtime pin choice is the
whole point here.

**Servo ends, reverse and calibration** (2026-10-05). `min_us` is the
pulse at 0 %, `max_us` the pulse at 100 %. Each must be 400–2600 µs and
they must be ≥ 50 µs apart; **min above max is allowed and is what
"reverse" means** — the console's *reverse* box swaps the two, so there
is no separate flag to disagree with the ends. *Calibrate* (servo rows,
once the servo is saved) swaps the test slider for the raw pulse
(400–2600 µs, `set` with `"us"`) so an end can be found beyond the
current ones; *Set as min / Set as max* captures the position into the
draft, and one *Save* keeps both. Calibrating works with unsaved edits —
it drives the servo the node is already running.

**Servo smoothing** (2026-10-05). Per servo, `travel_ms` (a full
0–100 % sweep at cruise speed) and `ease_ms` (time to reach cruise from
rest); 0 / 0 = snap, the default — right for a jump scare. Console
presets: Snappy 250/80, Smooth 600/200, Slow 1500/400, or Custom.
The node runs a **follower**, not a per-move curve (`pm_motion.h`,
50 Hz): it accelerates toward the target, cruises, and brakes to arrive
without overshoot, and a new target mid-move keeps the current velocity
— so a dragged slider (and, later, live scrub) is one fluid motion
instead of a stutter of restarts. Position is clamped to the travel
range, so reversing near an end never pushes past the end stop. The
first move after power-up (servo limp, real position unknown) is always
a snap; calibration pulses are immediate. This is also the engine the
Timeline's native `ramp` action will use. Limits: sweep ≤ 10 s, ease
≤ 5 s (`servo_motion`).

**Cut from October:** steppers, audio, analog input, APA102 strips,
effects beyond solid colour, sACN.

## 4. DevKit V1 pin rules

Encoded in `boards/esp32-devkit-v1.yaml`; the console greys out what a
pin can't do and shows the warning text on caution pins.

| Pins | Tier | Can do | Why |
|---|---|---|---|
| 4, 13, 16–19, 21–23, 25–27, 32, 33 | good | everything | — |
| 34, 35, 36 (VP), 39 (VN) | good | **input only**, no internal pull | no output driver in silicon — add an external resistor for a button |
| 14 | caution | everything | pulses at power-up — a relay or motor may twitch at boot |
| 12 | caution | **output only** | strapping: high at reset = 1.8 V flash = no boot. Never an input, and not a relay module that pulls high |
| 2 | caution | output only | strapping + onboard blue LED; held high blocks flashing |
| 5, 15 | caution | output only | strapping; pulled high and pulse at power-up — fine for LEDs/strips, not relays/motors |
| 1, 3 | reserved | — | USB serial: the console and the flasher |
| 0, 6–11 | not listed | — | not on the 30-pin header (6–11 are the module's flash) |

⚠ **Verify before trusting a relay to 5/14/15:** the power-up pulse
notes come from the datasheet's glitch table and community reports.
Put a scope (or an LED) on the pin through a power cycle.

Analog input is not offered yet; when it is, only ADC1 (32–39) —
ADC2 is unusable while the radio is on.

**Recommended pins** (2026-10-05) — advice, not rules. Each pin in
the profile has a `best` use and optional `also` uses, and the profile
has one `guide` line per function saying why. The console shows a *Pin
guide* above the pin list, ★ on recommended pins in each dropdown, a
"best for" hint on unused pins, and an ⓘ tip when a channel sits on a
pin that works but isn't ideal — it never blocks a save. `genboards.py`
refuses advice the rules would contradict: a use the pin can't do, or a
servo / motor / relay on a pin that glitches at power-up.

| Use | DevKit V1 pins | Why |
|---|---|---|
| Servos | D25, D26, D27, D13, D4 | quiet at power-up — nothing twitches at boot |
| DC motors | D18 + D19 | a quiet pair for IN1 / IN2 |
| Relays | D21, D22, D23 | quiet at power-up — nothing clicks on at boot |
| LED strips | RX2 (16), TX2 (17) | any output works; keeps strips together (level-shift 5 V strips) |
| LED dimmers | D2 (onboard), D5, D15, D14, D12 | the boot-quirk pins — a flicker doesn't matter for a light |
| Sensors | VP, VN, D34, D35 (PIR / beam); D32, D33 (buttons, internal pull-up) | input-only pins don't use up outputs |

**Resource limits** the validator also enforces: 16 LEDC channels
(LED, servo = 1; motor = 2), 8 RMT TX channels (one per strip), 16
channels per node.

## 5. Config JSON

What the node stores as `/config.json` (LittleFS) and what
`set_config` carries:

```json
{
  "v": 1,
  "name": "Porch skeleton",
  "bridge": false,
  "channels": [
    {"kind": "SERVO",      "index": 1, "label": "jaw",    "pins": [13], "min_us": 600, "max_us": 2400},
    {"kind": "RELAY",      "index": 1, "label": "fogger", "pins": [4],  "active_low": true},
    {"kind": "MOTOR",      "index": 1, "label": "shaker", "pins": [25, 26]},
    {"kind": "LED_STRIP",  "index": 1, "label": "eyes",   "pins": [16], "pixels": 60},
    {"kind": "DIGITAL_IN", "index": 1, "label": "PIR",    "pins": [27], "pull": "down"}
  ]
}
```

`index` is 1-based and per kind. Missing optional fields take the
defaults shown in the editor (servo 500–2500 µs, 30 pixels, pull none).
Limits: servo end stops 400–2600 µs and ≥ 50 µs apart (either order), strips 1–300 pixels, labels 23
characters, name 31.

**No-console fallback:** copy `firmware/node/data/config.example.json` to `firmware/node/data/config.json`, edit it,
and run `pio run -d firmware/node -t uploadfs`. The node validates it at
boot exactly as it would over USB; a rejected file leaves every pin
untouched and the boot line says `"config":"rejected"`.

## 6. Serial protocol

USB serial, 115200 baud, **one JSON object per line** each way. Lines
from the node that don't start with `{` are log text. Requests may
carry an `id`, echoed in the reply. Every reply has `ok`; failures add
`error`.

| `cmd` | Request fields | Reply |
|---|---|---|
| `hello` | — | `node` (8 hex), `fw`, `board`, `name`, `bridge`, `role` (NodeRole flags) |
| `get_config` | — | `config` |
| `set_config` | `config` | `issues[]` (`code`, `error`, `channel`, `gpio`); saved + applied only if no errors |
| `set` | `kind`, `index`, `value` — or, for a `SERVO`, `us` instead of `value` | — (value clamped to the function's range; `us` to 400–2600 and drives the raw pulse regardless of the end stops) |
| `state` | — | `channels[]` of `kind`, `index`, `value` (servo `-1` = limp) |
| `all_off` | — | — |
| `mesh` | — | `synced`, `role`, `conductor`, `hop`, `neighbors[]` |

**Any request can be sent to another node** by adding
`"node":"5c0ffee1"` (its 8-hex id). The USB node forwards it over the
mesh and writes the target's reply back verbatim (same `id`). If the
target doesn't answer after 3 tries × 0.9 s the USB node replies
`{"ok":false,"error":"no reply from node 5c0ffee1"}` itself.

Events (unsolicited, one per line):

| `evt` | Fields | When |
|---|---|---|
| `boot` | `node`, `board`, `fw`, `config` (`ok`/`none`/`rejected`/`flash error`), `bridge`, `channels` | the USB node started |
| `heartbeat` | `node`, `board` (BoardType), `role`, `fw`, `up` s, `heap` KB, `batt` mV, `hops` (0 = heard directly), `rssi` (last hop), `nbrs[]` | every 5 s per node on the mesh |
| `input` | `node`, `kind`, `index`, `value` | a `DIGITAL_IN` changed on any node |

**Over the mesh** (`schema/messages.yaml`): the request text rides in
`API_REQ` frames, the reply in `API_RESP` — `dst`, `req_id`, `chunk`,
`chunks`, `len`, then up to 180 bytes of the JSON (24 chunks, 4320
bytes max; a full 16-channel config is ~1.6 kB = 9 chunks, sent 6 ms
apart so relay queues drain). Remote sensor changes travel as `STATE`
(`SENSOR_TRIGGER` / `SENSOR_CLEAR`). The `TIME` beacon carries the
conductor's election `priority`.

Try it without the console — `pio device monitor`, then type:

```
{"cmd":"set_config","config":{"channels":[{"kind":"LED","index":1,"pins":[2]}]}}
{"cmd":"set","kind":"LED","index":1,"value":300}
```

The DevKit's blue LED should glow at 30 %.

Issue codes (shared by `pm_pinrules.h` and `pinRules.ts`):
`no_such_pin`, `pin_reserved`, `pin_cannot`, `pin_caution` (warning),
`pin_taken`, `no_pull`, `pin_count`, `duplicate_channel`, `bad_index`,
`unknown_kind`, `servo_range`, `pixel_count`, `pwm_budget`,
`strip_budget`, `too_many_channels`.

## 7. Bench test — Stage 1

1. Flash: `pio run -d firmware/node -t upload`. **Close any serial
   monitor** — only one program can hold the port.
2. Console: `cd console && npm run dev`, open the URL in **Chrome or
   Edge** (Web Serial; Safari and Firefox can't), go to *Nodes &
   Channels*.
3. *Connect USB node* → pick the CP210x / CH340 port. Opening the port
   resets the devkit; the console waits for it to boot.
4. Assign **D2 → LED dimmer**. *Save to node*. Drag the test slider —
   the onboard blue LED dims.
5. Assign **D13 → Servo**. Power the servo from its **own 5 V supply**
   (not the devkit's 5 V/VIN or 3V3 pins — §9), grounds joined, signal
   wire to D13. Save, drag the slider. Adjust min/max µs
   until the end stops are right for the prop.
6. Assign **D27 → Sensor**, pull *down*; jumper D27 to 3V3 — the row
   shows ● ACTIVE.
7. Unplug, plug back in, reconnect: the config is still there.

No hardware handy? *Simulated mesh* runs the same panel against an
in-browser USB node with two remote nodes behind it (configs kept in
localStorage, heartbeats every 5 s, each node's first input toggles
every 4 s).

## 7b. Bench test — Stage 2 (bridge + remote nodes)

1. Flash every devkit with `firmware/node` (same image for all):
   `pio run -d firmware/node -t upload --upload-port <port>`.
2. Leave one on the laptop's USB — the bridge. Power the others from
   any USB charger (or the laptop; only the bridge's port is opened).
3. Console → *Connect USB node*. In the editor: name it, switch
   **Bridge** on, *Save to node*. Its chip shows **BRIDGE** and ⏱.
4. Within ~5 s the other boards appear as chips with their signal
   strength — first as **connecting…** with a spinner while the console
   asks each for its name and board (retried every 3 s), then by name.
   Click one: its config is read over the mesh (spinner until it lands).
5. Assign **D2 → LED dimmer** on it, save, drag the slider — the
   *remote* board's blue LED dims.
6. Assign **D27 → Sensor** (pull *down*), save, jumper D27 → 3V3 on the
   remote board — the row shows ● ACTIVE.
7. Unplug a remote board: its chip turns red after ~16 s.
8. **Yard** (sidebar): Topology draws the bridge at the top and each
   board by hops from it, every radio link labelled with its signal
   (the weaker direction). Click a board for its role, uptime, memory
   and what it hears; *Edit pins →* jumps to it in Nodes & Channels.
   *Map*: drag the boards from the tray to where they sit in the yard
   (remembered per browser) — a weak link makes sense once you see it
   crosses the house.

**Adding a board:** copy the devkit yaml, fill in its pins from the
vendor pinout and the chip datasheet's strapping table, run
`genboards.py`, add an env to `firmware/node/platformio.ini` with
`-DPM_BOARD_PROFILE=PM_BOARD_<ID>`. The C3 Super Mini is the obvious
next one (6 LEDC channels — the budget check exists for it).

## 8. Plan (October 2026)

| Stage | Target | Scope | Test |
|---|---|---|---|
| **1 — one devkit on USB** | ~Oct 8 | everything above | §7 |
| **2 — config over the mesh** ✍ written 10-05 | ~Oct 15 | the USB node forwards requests to other node ids over ESP-NOW (`SET` + chunked `CONFIG` messages in `schema/`); real heartbeats replace the console's mock node list | one devkit on USB, two on wall power; configure and test-fire the remote two |
| **3 — triggers** | ~Oct 22, **then freeze** | per-node rules: `DIGITAL_IN_n` → timed step list (`t_ms`, channel, value, `ramp`) with cooldown; steps on other nodes go out as a `CUE` at mesh time T | shelf rehearsal (PIR on A → servo on B + relay on C), then a yard dress rehearsal ≥ 1 week before Halloween |

**Cut line:** if Stage 2 isn't solid by Oct 15, the show runs Stage 1
nodes with per-node configs and same-node triggers only. No new
features after Oct 22.

## 9. Known gaps

- **Fixed 2026-10-05 — a restarted bridge was ignored for 30 s+.**
  Opening a classic devkit's USB port resets it (DTR/RTS drive EN
  through the auto-program transistors), so connecting the console
  restarts the bridge and its frame counter starts again at 1. Receivers
  only recognised a restart after a jump back of 1024+ frames; a bridge
  a few minutes old had sent a few hundred, so all its frames were
  dropped as old duplicates until the new counter overtook the old one.
  Every frame now carries a random per-boot `boot_id`; a new one resets
  that sender's duplicate window. Measured after the fix: bridge reset
  alone, after 300 frames of traffic, ×3 — both remotes answered on the
  first try 0.9–1.0 s later and resynced to the bridge's clock. **Frame
  format change: every node must run the same firmware.**
- **Servos powered from a devkit corrupt flashing.** With two servos on
  the Type-C board's 5 V, its upload failed MD5 verify twice (at 460 800
  and 115 200 baud); with servo + disconnected it flashed first time.
  Power servos from their own 5 V supply (≥ 2 A), grounds joined, signal
  only to the GPIO — and that also keeps a stalling servo from browning
  out the board mid-show.

- **Measured fix, 2026-10-05.** First hardware run: 80 % of 9-chunk
  messages lost a chunk (rescued by the 0.9 s retry) and 1 in 20
  failed. Cause: chunks 6 ms apart while every relay rebroadcasts 2–10
  ms after hearing one, so the target's radio was transmitting (it
  can't receive then) as the next chunk arrived. Fixed by (a) a node
  not relaying API frames addressed to itself (`pm_mesh.cpp`), (b) 15
  ms between chunks (`pm_link.cpp`), (c) ±10 % heartbeat jitter so
  boards powered up together stop colliding every 5 s.
- **One unexplained bad run** right after reflashing all three boards:
  14 of 80 requests got "no reply". Not reproduced in the next three
  runs (240/240), and no resets were seen on the remotes. Unknown
  cause; candidates are boards still rebooting from the flash, or a
  power dip through the USB hub. If it recurs, the console's error
  names the node that didn't answer — note which one, and whether it
  is on the hub.

- Mesh requests are flooded to every node and acted on only by `dst`;
  at a dozen nodes that is fine, at fifty a full config push is ~450
  frames of airtime. Unicast is a later optimization.
- Two console requests to the same remote node in flight at once are
  fine; more than 6 across the mesh and the bridge replies "busy".

- The console's Web Serial connect has only run against the simulated
  node; the firmware side of the same protocol is verified on hardware.
- The console's validator is a hand-written mirror of the firmware's.
  Drift only affects hints while editing — the node decides on save —
  but a shared test-vector file would catch it.
- The serial link has no auth. Fine on a USB cable; the bridge API
  needs the token software-plan §5.1 already requires.

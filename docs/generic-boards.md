# Generic ESP32 boards — pins assigned from the console

Off-the-shelf ESP32 boards run PropMesh with **no compiled-in pin map**:
you plug the board in, open the console, and give each pin a job
(servo, relay, motor, LED strip, sensor…). The assignment is saved in
the board's flash and the board runs it from then on, laptop or not.

Started 2026-10-03 for the **October 2026 show** — the fallback when a
prop doesn't have a Pro board, and the way anyone with a $5 devkit joins
the mesh. First board: **ESP32 DevKit V1 (30-pin, ESP32-WROOM-32)**.

Status: **Stage 3 (sequences + triggers) verified on 3 DevKit V1s
2026-10-05** except the physical sensor → trigger path (§6b).
Stage 2 (bridge + config over the mesh) verified on 3 DevKit
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
presets: Snappy 250/80, Smooth 600/200, Gentle 1000/450, Slow
1500/400, or Custom. Abruptness at start/stop comes from the ease, not
the sweep — Gentle has the softest.
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
effects beyond solid color, sACN.

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
carry an `id`, echoed in the reply — **`id` is reserved for that**; no
command takes a parameter called `id` (sequence ids are `seq`). Every reply has `ok`; failures add
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

## 6a. Bluetooth flood lights (BRMesh, 2026-10-06)

Cheap BRMesh RGB flood lights are controlled by BLE **advertisements**
— no connection, nothing comes back on the control path — carrying a whitened,
key-XORed, CRC'd payload (manufacturer id 0xFFF0). A node with
`BLE_LIGHT` channels broadcasts them; one node near the floods is
enough (the lights relay among themselves).

- **Channel:** `BLE_LIGHT_n`, **no pin**; config `light` = the light's
  number in the BRMesh app. Value `0xRRGGBB`, 0 = off; brightness comes
  from the color's peak (the color goes out at full scale with a
  0–127 brightness, as the lights expect). Shows up everywhere an
  output does: test color picker, sequences and the timeline (color
  steps, like strips), live preview, STOP ALL (turns them off).
- **Key:** node config `brmesh_key` (8 hex digits). **The board makes
  its own** (`esp_random`) the first time it pairs a light, and saves it
  in its config **before** sending the pairing frame — so a reset never
  loses a pairing (the reference code kept its key in RAM, which is why
  its pairings didn't survive a reset). Stored on the node only, never
  in the repo. Typing a key in is only for taking over lights paired by
  another controller (e.g. the app's key via adb). Missing key with
  lights → `ble_no_key`; light numbers 1–255 (`ble_light_id`), unique
  per board (`ble_light_dup`).
- **Pairing** (no app, no key from the user): unpaired lights advertise
  18 bytes of manufacturer data — mac [6..11], type [12..13] (`A0A8`
  RGB, `A1A8` RGBW, `39AE` on/off), key [14..17] (all zero / the
  default key `5E367BC4` while unpaired). `ble_scan` listens; `ble_pair`
  sends a *wake* frame (class 0) then an *add-device* frame (class 2,
  default key; data = the light's mac, its new number, group 1, our key),
  and watches its adverts until they carry our key → `paired`. The
  firmware then adds a `BLE_LIGHT` channel ("flood N (type)") and saves.
  A light already paired to the BRMesh app keeps that key and does not
  answer — reset it first (usually: switch off and on several times).
  Pairing takes a light away from the app.
- **Lights have no Bluetooth address of their own** (found 2026-10-07):
  every flood advertises from the placeholder `11:22:33:44:55:66`. A
  light's identity is the key-independent part of its manufacturer data
  (`pm_brmesh_id`: bytes 6..17 with its key XORed out, minus the light
  number) — never the address. Keying the found-list on the address made
  every light collapse into one entry, so only one would ever pair. The
  console addresses a light by the mac field it advertises.
- **Scanning shares the radio with ESP-NOW.** Duty sweep (2026-10-06,
  Prop board): 100/100 ms heard 28 adverts/s but the node answered 2 of 4
  mesh requests; **50/100 (default)** heard 6/s and answered 10 of 11;
  20/100 answered everything and heard nothing. Colors pause while
  searching/pairing. After an 8 s search the mesh answered 20/20.
- **Encoder:** `pm_brmesh.h`, header-only; host tests compare it
  **byte-for-byte** with the reference code that drove the lights.
- **Radio:** no Bluetooth host stack — `pm_ble_tx.cpp` drives the BLE
  controller directly over VHCI with three HCI commands (advertising
  parameters 20 ms / non-connectable, advertising data, enable). The
  controller is started in BLE-only mode (the framework default is dual
  mode; enable must match). `btInUse()` is overridden so the Arduino
  core keeps the controller's memory (≈3 KB of heap observed). Each
  light's newest color goes out as a 200 ms advertising burst; a color
  that changes again before it went out replaces the queued one, so a
  dragged picker never builds a backlog. Flash 78 % → 91 % of the app
  partition.
- **Measured** (Prop board, test light with a dummy key, before pairing existed): controller
  confirmed 125 HCI commands, 0 failed; 41 color bursts for 50 color
  changes (merging); mesh requests during broadcasting 100/100, median
  42 ms — same as without Bluetooth. Not yet seen on the real floods.
- **API:** `{"cmd":"ble"}` → `running`, `bursts`, `cmd_ok`,
  `cmd_failed`, `last_status`, `last_opcode`, `reports`, `adverts_heard`
  — "is the radio sending / hearing?". `{"cmd":"ble_scan","ms":8000}`
  (optional `window_ms`, `interval_ms`; refused on the bridge).
  `{"cmd":"ble_found"}` → `mode` (idle/scanning/pairing),
  `remaining_ms`, `key_set`, `lights[{addr, type, rssi, state
  found|pairing|paired|failed, number}]`. `{"cmd":"ble_pair","addr":
  "aa:bb:…"}` (optional `number`; default = lowest free).
- **Console:** Nodes & Channels → **Floods** tab (§6a-ii) → **Find
  lights…**: switch the floods off, *Search (8 s)*, switch them on; each
  answering light gets *Pair* (or *Take over* if it holds another key);
  the pairing lands on the board searched from and is copied to every
  sending board. Simulated mesh: two unpaired lights and one paired
  elsewhere answer.
- **Bench facts, three Melpo BLFL-LFCA RGBW floods (2026-10-07):**
  lights announce themselves (18-byte manufacturer data, default key)
  **only for ~15 s after power-up** — hence "switch them off, Search,
  switch them on"; our wake frame does not make a powered light announce.
  The add-device burst (1.5 s, 20 ms interval) took **3 of 3** times —
  all three answered colors on the new key — but **no light ever came
  back advertising the new key**, so a pairing counts as done once its
  burst has gone out (`acked` marks the rare light that does answer).
  Power-cycling a light several times resets it to the default key (that
  is how a light paired to the app comes back). Pairing fast after the
  announcement is not required (12–28 s later still took).
- **Lesson — the first "successful" pairing was a false positive:** the
  old confirm logic accepted any light on the shared address answering
  with a non-default key, and a light still holding the app's key did
  exactly that. One real test light beats any amount of reasoning.

## 6a-ii. Floods as mesh-wide lights (plan, 2026-10-07)

Colin's ask: the floods should not belong to one node. Any node should be
able to drive them, so losing a node loses no lights, and in the console
they should look like one thing, not channels scattered across boards.
BRMesh already works that way — one key, light numbers unique under it,
lights relaying among themselves — so this is mostly moving where things
are stored.

**Built 2026-10-07 (console only — no firmware change).** Nodes & Channels
has a **Floods** tab next to the boards (`views/nodes/FloodsPanel.tsx`,
model in `lib/floods.ts`): tick the *sending boards*, Find lights from any
of them (the pairing lands on that board and is copied to the others),
name lights, test colors (sent to every sender), forget a light. Saving
writes the same key and the same `BLE_LIGHT` channels (index = light
number) to every ticked board and strips them from unticked ones. A
board's own page no longer shows its flood lights, only a pointer to the
tab. In Sequences the floods are one pseudo-node, **Floods**: `loadShow`
collapses each sender's copy of a flood step to one and hides the boards'
`BLE_LIGHT` channels; `saveSequence` writes a flood step into every
sender's part; live sliders fan out to every sender. If two boards hold
different keys the tab says so and offers to spread either one.

**On the Yard (2026-10-08).** Floods appear in both layouts as their own
glyph, filled with the last-sent color (warm white for white mode, a
dashed ring when off), with dotted lines to every board that sends to
them. Topology puts them in a row under the boards; on the Map they're
dragged into place like boards (positions per browser, `flood:<n>`).
The Yard reads the lights from the senders' configs and polls one
sender's `state` every 3 s, so cues show up live. Clicking one opens a
panel (light number, last sent, senders) with a link to the Floods tab.

**Design (no new mesh message):**

1. **One key, one light list, copied to every sender.** The console holds
   the "floods" set: key + lights (number, type, label). Each *sender*
   node gets the same key and the same `BLE_LIGHT` channels in its config
   (`set_config`, as today). Senders = nodes Colin ticks in the Floods
   view (default: every prop board that has Bluetooth running; never the
   bridge — its radio already shares USB and the mesh).
2. **Floods pseudo-node in the console.** Nodes & Channels shows a
   "Floods" entry: no heartbeat, pins, or triggers; one channel per light
   plus Find lights (runs on whichever sender is chosen) and the sender
   tick-boxes. Live `set` fans out to all senders; a cue's flood steps go
   into every sender's part of the sequence, so each sender transmits them
   at the same mesh time. Lights ignore repeats, so the redundancy is free.
3. **Pairing from any sender** adds the light to the floods set; the
   console then pushes key + channel to the other senders.
4. **Rate cap** per light (~10 Hz) so a ramp from several senders doesn't
   flood the air; group address (all lights were put in group 1 when
   paired) for steps that move every flood together — one burst instead
   of N.

**Status can't be read (2026-10-08).** BRMesh is one-way: a paired light
never transmits, so neither its color nor whether it is powered can be
asked. The Floods tab shows what the sending boards last *sent*
(`state`). The lights keep their color through a power cut (Colin,
bench), so the boards keep it too: `/lights.json` on each sender, saved at
most every 10 s when something changed, restored after every config apply
(boot included) but never re-sent. Drift remains possible if a light
misses a command (out of range, unpowered at the time) or is set from the
BRMesh app; the Floods page says so. Before this the tab started every
light at "off", and moving a slider jumped the light.

**White — DONE (bench 2026-10-07, Melpo RGBW):** white is a *mode*, not
a channel. Bytes 6 and 7 both 127 switch the light to warm white and the
brightness byte sets its level; partial values in 6/7 do nothing, and a
frame carrying RGB *and* white is rejected outright (not even the color
shows). Values are `0xWWRRGGBB`: W 1–127 = white at that level (RGB
ignored), W 0 = color. The picker's white slider replaces the color and
vice versa. A fade between a color and white snaps to white as soon as
W > 0.

**Frame layout, decoded:** the "command byte" is type 2 | length<<4 —
`0x72` = light command of 7 bytes, `0x22` = 1-byte off. The header's low
nibble is the high part of a 16-bit address in the app's code; the lights
**ignore it** (0x101 and 0x801 both drove light 1).

**Fade smoothness — measured:** bursts of 200 and 100 ms are caught every
time, 60 ms drops steps → default **100 ms**. Color ramps now run on the
board (`pm_lerp_color`, per component) and reach the radio (raw_out had
no strip/flood case). Three floods fading together: 58 bursts / 6.5 s =
**~3 updates/s per light**, visibly stepped and staggered (round-robin).
The lights do not smooth internally.

**Group addressing — PARKED (Colin, 2026-10-07):** every light was put in
group 1 at pairing, but no address byte we tried (0x00, 0xFF, 0x80, 0x81,
0x41, 0x100, 0x101, 0x1FF, 0xFFF, 0x801) reached more than one light, and
neither gateway port implements groups ("Ooops! use_22_data"). Plan when
resumed: pair one flood to the BRMesh app, read the app's key from the
light's advert, capture the app's frames with the board's scanner
(`ble_found.others` already keeps non-phone adverts — widen it to a
capture ring) and decode them; or `adb logcat | grep jyq` for plaintext.
Debug hooks kept for that: `ble_raw {data[8], hi}`, `ble_tx {window_ms}`.

**Order now:** Floods pseudo-node + senders → re-pair the three floods
under the mesh key → doc. Group addressing later.

## 6b. Sequences and triggers (Stage 3, 2026-10-05)

**Model.** A *sequence* is show-wide (id 1–65535, a name) and is a list
of timed steps `[t_ms, kind, index, value]` on any node's outputs. Each
node stores only **its own part** of each sequence, plus the
*triggers* on **its own sensors**, in `/show.json` — so the show runs
with no laptop and no bridge. A trigger (the 2026-10-05 form; v2 below
adds delay, lockout, fan-out, random and chaining): "when
`DIGITAL_IN_n` becomes active (or clear), play sequence N; then ignore
this trigger for
`cooldown_ms`".

**Ramps** (2026-10-05 — the Timeline's line between keyframes;
software-plan §6 decided ramps are a native node action). A step may
carry `dur_ms` and two **ease amounts** (2026-10-06): `ease_in` % of
the ramp spent speeding up, `ease_out` % slowing down, a steady cruise
between (a trapezoidal velocity profile; in + out ≤ 100). 0/0 is
linear, and 50/50, 100/0, 0/100 are exactly the earlier named curves
(`inout`, `in`, `out` — still accepted on the wire, so stored shows keep
their shape). Console presets: ease in & out 50/50, gentle 30/30,
linear, ease in, ease out, soft landing 15/70, or drag the two handles
of the ease bar (left = where speeding up ends, right = where slowing
down starts; they can't cross, and moving one never moves the other). A step is "arrive at `value` at `t_ms`, having started `dur_ms`
earlier from the channel's then-current value". The node interpolates
at 50 Hz (`pm_ramp.h`); the ramp is anchored to the sequence clock, so
a late cue lands mid-line rather than restarting, and every node is on
the same point of its line at the same mesh time. While a ramp runs it
takes over from a servo's smoothing; a direct `set` (console slider,
all_off) cancels it. Only servos, LED dimmers and motors ramp (relays
switch, strips step). Rules: `dur_ms ≤ t_ms`; a limp servo (position
unknown) takes the end value at once. Wire form: a 7-element step
`[t_ms, kind, index, value, dur_ms, ease_in, ease_out]` (the 6-element
`[…, dur_ms, "name"]` form is still read); plain steps keep the
4-element form. **Measured** on the heads board: hold → S-curve over
2.0 s → hold → linear 1.0 s back, sampled every ~170 ms, all on time.

**Firing.** The sensor's node broadcasts `CUE(sequence, fire_at =
mesh now + 200 ms)` three times (same `cue_id`; receivers play it once)
and plays its own part. Every node holding a part starts it at
`fire_at` on its own clock via mesh time, so a sequence spanning the yard
starts together. A late cue runs overdue steps at once (the prop still
ends in the right state); a start more than 5 s off (a node that just
rejoined with a different clock) plays now. Servo steps glide with the
servo's smoothing setting. Up to 4 sequences play at once per node;
re-firing a playing sequence restarts it.

**Rules, v2 (2026-10-12 — software-plan "Console sections").** A
trigger rule is *trigger → logic → actions*, all evaluated on the board
that holds it, which then broadcasts the cues (so the execution model
is unchanged: no bridge at show time).
- **Trigger:** a sensor edge on this board (`sensor`: `input`, `on`), or
  **a sequence starting anywhere** (`after`: its CUE heard, or fired
  here). Any board may hold an `after` rule — pick one that's always
  powered. Sensor rules fire only while armed; `after` rules in ambient
  too (a chain off an ambient loop is the point).
- **Logic:** `delay_ms` before the actions — "when X ends" is simply
  `after: X` with `delay_ms` = X's show-wide length, which the console
  sets; `cooldown_ms`; **lockout** `limit: {fires, window_min}` — at
  most N fires per window (0 = no limit).
- **Actions:** `seqs[]` (1–4): `pick: "all"` fires every one (fan-out),
  `"random"` one of them. Several rules may share a trigger — each that
  passes fires.
- A rule that restarts its own trigger sequence needs delay + cooldown
  ≥ 1 s (refused otherwise): a zero-delay self-loop would run as fast
  as the mesh carries cues.
- Firmware: `PmTriggers` arms a rule (cooldown, lockout), `due()` hands
  back rules whose delay ran out, `pick()` the sequences; host-tested
  (`test_show`: delay + fan-out, random + lockout, chaining). Console:
  the **Show** section's rows read as the sentence *When [sensor
  becomes active | sequence X starts/ends] (+ wait) play [all of | one
  of] [seqs] · wait N s · at most N times per M min [· on board]*; the
  **Show Graph** (Graph / List toggle, software-plan "Console sections")
  edits the same rules as chains of blocks.

**Arming.** Disarmed nodes ignore triggers and cues and stop playing.
Nodes **boot armed** (a power cut never leaves the show dead). STOP ALL
disarms every node, then turns every output off; RE-ARM SHOW arms them.

**Limits per node:** 16 sequences × 96 steps, 16 triggers, steps ≤ 10
min, cooldown ≤ 1 h. A full 96-step sequence fits one mesh message
(tested). If a pin change removes a channel a sequence uses, `get_show`
reports the problem and the console shows ⚠.

**API** (any node; add `"node"` to send over the mesh):

| `cmd` | Request | Reply |
|---|---|---|
| `get_show` | — | `armed`, `sequences[]` (`id`, `name`, `steps` count, `length_ms`, `problem?`), `rules[]` |
| `get_sequence` | `seq` | `sequence` (`id`, `name`, `steps[]` as `[t_ms, "KIND", index, value]` or `[…, dur_ms, "ease"]`) |
| `set_sequence` | `sequence` | — (replaces this node's part; steps must address its outputs) |
| `delete_sequence` | `seq` | — |
| `set_rules` | `rules[]` of `{trigger: "sensor"\|"after", input, on: "active"\|"clear", after, delay_ms, cooldown_ms, limit: {fires, window_min}?, pick: "all"\|"random", seqs[], enabled}` (the 2026-10-05 form `{input, on, seq, cooldown_ms, enabled}` still reads) | — (replaces all this node's triggers) |
| `get_yard` / `set_yard` | `yard: {v: 1, at, scale_ft, shapes[], pos{}}`, `at` | the Yard's map document (console `lib/yardMap.ts`), stored opaque in `/yard.json` on the board the console talks to; an older `at` is ignored (`stale`) |
| `cue` | `seq`, `offset_ms?` | — (fires show-wide from this node; refused while disarmed) |
| `arm` | `on` | `armed` |

Event: `{"evt":"cue","node":<who fired>,"seq":N,"cue":id,"armed":bool,"here":bool}`
— the USB node hears every cue on the mesh, so the console's activity
log shows each one with the sensor change that caused it.

**Timeline** (2026-10-05 — software-plan §6 item 5, pulled forward
from 2027). Above the step list, the same steps drawn as keyframes:
time across, value up, **one track per output** (servo/LED/motor as a
0–100 % line, motor −100…+100, relay on/off, strip as color bars).
The line into a keyframe is its ramp (eased curve) or a hold-then-jump.
Drag a key to move it in time and value (snaps 50 ms / 1 %; live
preview moves the real servo); double-click a track to add a key (on a
rampable track the line leads into it from the previous key, ease
in & out); click a line to select the key it leads into; **R** switches
the selected key's line between ramp and jump (its ease amounts are
kept for when it goes back to a ramp); Delete removes the selected key; drag the ruler to **scrub** every output to that moment;
▶ Play runs a playhead across. A key selected in the timeline is
highlighted in the list and vice-versa — `lib/timeline.ts` is the
model, `views/show/Timeline.tsx` the SVG. **Zoom and scroll**
(2026-10-06): − / + / Fit buttons, ⌘/ctrl + scroll zooms around the
pointer (4–2000 px/s); sideways scroll or shift + scroll pans; a
scrollbar under the tracks; dragging a key past the right edge scrolls
with it. The zoom is remembered per browser (Fit until you zoom);
another sequence opens at its start, same zoom. Not yet: bezier handles
(easing presets only), audio tracks.

**Console → Sequences** (the "Cues" view until 2026-10-12). Sequences list; step editor (time, board, output,
value, *get there over* + easing for rampable kinds — sliders for servos/LEDs/motors, on/off for relays, color for
strips — and a *Test* button per step; with *Live preview* on (default)
dragging a servo, LED or strip value moves the real output, coalesced
to one request in flight per output; relays and motors only change on
*Test*; preview works while disarmed, the safe way to pose a prop); *Save to boards* splits the
sequence into per-board parts (and deletes the part from boards that no
longer have steps); *▶ Play*; triggers ("When Porch · PIR becomes active
play Head turn, then wait 30 s"); *Arm all / Disarm all*; live activity
log. *Reload from boards* re-reads everything.

## 6c. Firmware updates over the air (2026-10-07)

**Over the mesh is the real path** — Colin's principle: nodes live in
props, out of reach and often out of home-WiFi range; anything that needs
a node unplugged or brought indoors defeats a mesh product. WiFi is a
bonus for when the laptop's network happens to reach.

- **Over the mesh (default):** the console streams the image through the
  USB bridge: `ota_begin {size, sha256}` → `ota_data {off, data}` (base64,
  2700 image bytes per request — fits the 4320-byte mesh request and the
  4096-byte serial line) → `ota_end`. Every chunk is answered with
  `written`, so a lost request resumes from the board's count; the board
  checks SHA-256 before committing (`pm_ota_begin/data/end`, Update
  library, 3 kB heap buffer — static RAM is full). ~475 requests for a
  1.28 MB image. At 115200 baud the cable cost ~150 s on its own (6 min a
  board in all), so the boards talk at **921600** since 2026-10-07
  (`PM_SERIAL_BAUD`; the console tries 921600 then 115200), leaving the
  mesh as the limit. **Measured 2026-10-07 on Prop (one hop): ~6 min at
  115200, ~3.5 min at 921600**, both verified by SHA-256 on the board and
  a clean reboot into the new image. The board reboots 1 s after
  acknowledging `ota_end`. Next lever is the mesh side: broadcast chunks
  to every board at once, so N boards take the time of one.
  Console: `lib/ota.ts` (`streamImage`), image from `ota_serve.py`'s URL
  (CORS) or a local .bin.
- **Over WiFi (bonus):** below.

- **Serve:** `python3 tools/ota_serve.py --build` builds, then serves
  `firmware/node/.pio/build/esp32-devkit-v1/` on port 8266 with CORS open
  and prints the URL. `build_id.py` (PlatformIO extra script) stamps every
  build with its git commit (`PM_BUILD`; uncommitted changes add "+" and
  a 6-character hash of them, e.g. `fca01a5+126655` — until 2026-10-09
  it was a bare "+", so two different uncommitted builds matched and the
  console called old boards "up to date") and writes
  `version.json` {build, size, sha256} next to `firmware.bin`.
- **Console:** Nodes & Channels → **↑ Firmware**: URL, WiFi name and
  password (kept in the browser's localStorage, never on a board), the
  served build, and one row per board with its build and an **Update**
  button; *Update all mesh boards* does every board but the USB one, which
  takes the console down when it reboots — do it last and reconnect.
- **Node:** `ota {url, ssid, pass}` answers at once, then 1.5 s later
  (reply gone) joins the WiFi, `HTTPUpdate`s the image into the spare app
  slot and reboots (`pm_ota.cpp`, its own 12 kB-stack task). The mesh is
  lost for the download (the channel follows the AP) and comes back on
  reboot. Failure → back to the mesh channel, `ota_status` says why.
  Credentials are used once (`WiFi.persistent(false)`).
- **Rollback:** the SDK's `BOOTLOADER_APP_ROLLBACK_ENABLE` is on;
  `verifyRollbackLater()` stops the Arduino core from blessing a new image
  at boot, and `main.cpp` marks it valid only after 20 s with the mesh up.
  A crash-looping image is rolled back by the bootloader. `hello.pending`
  shows an image still on probation.
- **Partitions:** `min_spiffs.csv` since 2026-10-07 — two 1.9 MB app
  slots and a 192 kB LittleFS (the default table's 1.25 MB slots were
  96 % full once HTTPUpdate came in). One USB flash to change; it wipes
  the filesystem, so configs were backed up and restored over the API.
- **Simulated mesh:** `ota` "downloads" for 6 s; the node then reports the
  build named by the URL's last path segment.

## 6d. WiFi bridge — decided 2026-10-07, built (stage A) 2026-10-07

The bridge joins Colin's home WiFi so the console reaches it over the
network (and, later, is served by it — software-plan §5). ESP-NOW shares
the one radio and a station follows its AP's channel, so **the mesh
follows the bridge**: the bridge announces its current channel in its
heartbeats; a node that stops hearing the bridge for ~30 s scans channels
1–13 for heartbeats and moves. The router may hop channels whenever it
likes; nothing is pinned. Fallback for show night away from a router: the
bridge as its own access point on the mesh channel (nearly free once the
WiFi stack is in). Rejected: a two-radio bridge (second ESP32 over
serial) — a dead end for the one-radio Pro board.

Costs to design around: airtime shared with the router (negligible for
console traffic; a modest slowdown during a firmware push), and the
"lost the bridge" case must not make nodes wander mid-show — test that
first.

**Design as built (2026-10-07, stage A — bridge on WiFi, mesh follows):**

- **Bridge config** gains `wifi: {ssid, pass}` (bridge only; the password
  is written but never read back — `get_config` reports `pass_set`, and
  a `set_config` without `pass` keeps the stored one). `pm_wifi.cpp`:
  the bridge joins as a station (`WiFi.persistent(false)`, auto-reconnect,
  mDNS `propmesh.local`); ESP-NOW keeps running on whatever channel the
  router put it on (the broadcast peer is registered with channel 0 =
  "current"). No WiFi configured → the bridge stays on its saved channel.
- **Heartbeats carry `channel`** (schema: appended u8; short old
  heartbeats still parse, channel 0 = unknown). The console shows the
  bridge's channel and IP (`mesh` reply: `ip`, `wifi`, `channel`).
- **Nodes follow the bridge** (`pm_mesh.cpp`): a node notes when it last
  heard a heartbeat from a BRIDGE-role node. 30 s without one → scan:
  hop channels 1–13, 1 s each, ESP-NOW listening; a bridge heartbeat on a
  channel = adopt it (saved to `/channel`, used at next boot). Nothing
  found → back to the old channel, try again in 2 min. Boards boot on
  their saved channel (else `PM_CHANNEL`). A bridge never scans.
- **Cost of a scan**: ~13 s off-channel, so peer traffic (local triggers
  firing cues on other nodes) is missed during it — only while the bridge
  is absent, and at most every 2 min.
- **Bench test without touching the router:** `mesh_channel {ch}` on a
  bridge with no WiFi forces its channel; nodes should follow within ~45 s.
- **Nodes also move on the heartbeat itself (2026-10-08).** Scanning alone
  wasn't enough: neighboring channels overlap, so at bench range Prop on
  10 heard the bridge on 11, never scanned, and stayed off-channel. A
  bridge heartbeat now carries `ch` and a node on another channel moves to
  it; a bridge between WiFi attempts sends 0 (unknown), so nobody follows
  a scan.
- **Console over WiFi verified 2026-10-08** (stdlib WebSocket client
  against the real bridge): handshake, hello 19 ms, Prop via WiFi→mesh
  31 ms, 10/10 status requests at 67 ms average, heartbeats streaming.
  The first build turned every browser away: the handshake's bounds check
  allowed 23 key characters and every key is 24.
- **Verified 2026-10-07:** build 72cc220 rolled out to all three boards
  over the mesh ("Update all", then the bridge); WiFi entered on the
  bridge's page → it joined, moved from channel 1 to the router's 11, and
  Prop and Skellitor Head reappeared on 11 on their own. Note: the
  devkit's USB-serial chip stays enumerated through an ESP32 reboot, so
  the console does *not* lose the port when the bridge updates.
  **A board that has never heard anyone searches differently (2026-10-21).**
  Fresh out of the installer a board starts on channel 1; with the 1 s
  dwell it had one chance in three per pass of catching the bridge on
  11, and a new C6 sat on 1 for ten minutes as its own conductor, its
  heartbeats reaching the bridge once a minute with an empty neighbor
  list, every request to it timing out. Now, until it has heard a frame
  from any PropMesh board: the first sweep starts 5 s after boot, each
  channel gets a heartbeat period plus a second (6 s), the first valid
  frame from our net ends the sweep on that channel (nodes sit where the
  bridge is), and sweeps repeat after a 5 s rest instead of two minutes.
  Worst case to join: one pass, about 80 s. A board that has heard
  someone keeps the old rules, so a bridgeless mesh still spends only a
  tenth of its time off channel. **Tried on that C6 (2026-10-21):**
  stored channel set to 1 over USB, power-cycled; its heartbeat reached
  the bridge from channel 10 at 59 s after boot (the sweep's tenth step:
  5 s + 9 × 6 s), and from 11, hearing the bridge, at 64 s. One pass,
  no hands. (A first reading of 60 s was taken before the power-cycle
  and measured nothing; this one is the test.)
  **Second night (2026-10-21):** stopping on any frame was wrong — two
  fresh boards sweeping together could stop on each other's channel; now
  only a bridge frame ends a sweep, "fresh" means no stored channel (a
  configured board whose bridge is off keeps the slow search and its
  show), and five empty sweeps drop a board to the slow search. Not the
  cause of what Colin saw that night, which was the bridge sending
  every reply to every console: request numbers from two consoles (his,
  and the server's tools at 1001 up) collided, and his got the other's
  reply or "no reply from node"; a page reload restarted his numbers
  and it worked. Replies now go only to the client that asked
  (`pm_link_request` carries the slot; `pm_ws_send_to`); events still
  go to everyone. Request numbers in the console and `bridge.py` are
  random 52-bit values now, not counters, so a collision stays
  impossible even if the routing ever changes. And the bridge takes
  three consoles (a laptop, a phone, the server's watch tool); buffers
  are on demand, so an idle slot costs a socket. **Tested on the bridge
  (2026-10-21):** two clients sending identical request numbers 1–40 at
  once, one asking `hello`, the other `mesh`: 40/40 correct each, no
  cross-talk, nothing unanswered. The same over the mesh to a node is
  to be run when one is powered: with none on, each client got only its
  own `no reply from node`, which is the right half of the answer.

**A bridge that can't reach its router must not wreck the mesh
(2026-10-08).** A station trying to join scans every channel, on the
mesh's radio; with the core's auto-reconnect that ran back to back, and a
mesh firmware update to Prop failed with "no reply" while the header said
"joining WiFi". Now: auto-reconnect off; one attempt at a time, started on
the mesh's channel (the router is normally still there, so nothing else is
scanned); pauses of 15 s doubling to 2 min. The `mesh` reply carries
`wifi_reason` in plain words (wrong password, network not found, weak
signal) and the console header shows it. A failed attempt left the
radio on whatever channel its scan ended on (seen: 14), so the bridge
now returns to the mesh's channel after each one.

**The password was never saved (fixed 2026-10-08).** `pm_config_to_json`
served both the console (`pass_set` only) and the board's own
`/config.json` — so the file had no password, and the bridge lost its
WiFi at its first reboot (the update to b27f7f3). The store now writes
the password (`secrets = true`); the console still never receives it.
Host test: `test_wifi_password_kept_in_flash_not_shown`.

**Stage B — console over the network (built 2026-10-07):** the bridge
runs a small hand-rolled WebSocket server on port 81 once WiFi is up
(`pm_ws.cpp`: RFC 6455 text frames, ping/pong, close; two clients, 4 kB
messages, buffers on the heap) speaking exactly the JSON lines of the USB
link — every reply and event goes to the cable *and* every console.
mDNS advertises `propmesh.local` / `_propmesh._tcp`. Console: **Connect
over WiFi** (address box, default `ws://propmesh.local:81`, remembered);
`WsLink` shares the line protocol with `SerialLink` (`LineLink`).
Firmware updates over WiFi-to-bridge-to-mesh work unchanged, and faster
than over the cable. Serving the console *from* the bridge comes later
(software-plan §5): the 192 kB LittleFS is tight for the SPA.

## 6e. Show schedule (built 2026-10-09, Stage 3b — host-tested, not yet on hardware)

Design: software-plan §4.1. **Status:** firmware builds; 14 host tests
(`test_schedule`) pass, sunrise/sunset/dawn/dusk within 2 min of the
`astral` reference at five places; console checked in Chrome against the
simulated mesh. **Not yet run on real boards** — bench test below.

**Modes.** `off` (nothing plays, every output off) · `ambient`
(sequences marked *Ambient loop* repeat; sensors ignored) · `armed`
(ambient + sensor triggers). Cues from the console play in `ambient`
or `armed`, never `off`.

**Schedule** (`/schedule.json`, same copy on every board):

```json
{"enabled": true, "lat": 40.71, "lon": -74.01, "manual_max_min": 60,
 "windows": [{"start": "sunset-60", "end": "21:30", "mode": "armed"},
             {"start": "21:30", "end": "22:30", "mode": "ambient"},
             {"days": ["fri","sat"], "start": "sunset-60", "end": "22:30", "mode": "armed"},
             {"dates": ["10-31","10-31"], "start": "sunset-60", "end": "23:00", "mode": "armed"}]}
```

A time is `"HH:MM"` or `dawn` / `sunrise` / `sunset` / `dusk` with an
optional minute offset (`"sunset-60"`, `"dusk+15"`). `days` / `dates`
are optional. **Later windows win**; outside every window → `off`. An
end at or before its start runs past midnight. At most 12 windows.

**Manual buttons** (Off / Ambient / Armed, STOP ALL, RE-ARM) hold until
the schedule's next change — except a mode *more* active than the
schedule's (Armed at 23:00) lasts at most `manual_max_min` (60), so
the yard still goes quiet. **A manual mode survives a restart**
(2026-10-10): it is saved to `/mode.json` with its end, so a power
blip or a firmware update after STOP ALL doesn't re-arm the yard.
With no schedule it holds until a button changes it. Boards boot
armed only when nothing was set by hand.

**What you set by hand comes back with the show** (2026-10-10).
Every board remembers the outputs set by hand from the console — flood
colors, a porch-light relay, an LED level, a servo pose. Going `off`
turns everything off; coming back to `ambient`/`armed` (button or
schedule) turns those by-hand outputs back on, unless one was changed
meanwhile. **Not restored:** whatever a running sequence had set (a
fogger relay caught mid-burst by STOP ALL would stay on with no
sequence to turn it off) — a sequence step on an output takes it off
the by-hand list, and the show's own ambient sequences restart anyway;
the sequence editor's live preview and Test (`"preview": true`); and
anything after a plain **All off** pressed while the show is on (that
means "off, stay off"). Kept in `/parked.json` while off, so a restart
keeps it.

**Clock.** Each board keeps UTC as an offset from its own timer (not
from mesh time, which jumps when the conductor changes) plus the UTC
offset and its next DST change. Sources: the console on every connect
(`set_clock` from the laptop/phone), the conductor's `TIME` beacon
(new fields; 14-byte beacons from older firmware still read), and SNTP
on a bridge with WiFi. With a schedule but no clock a board stays
`off` for 60 s after boot waiting for a beacon, then falls back to
`armed` (as before schedules). No schedule = armed at boot, as before.

**Ambient loops** start on multiples of `loop_ms` in mesh time, so every
board's part of a loop repeats on the same beat with no messages.
Entering `ambient` mid-period runs the overdue steps at once (the
lights come on; a fog relay ends in its right state).

| `cmd` | Request | Reply (all add the mode block below) |
|---|---|---|
| `set_clock` | `utc_ms`, `tz_offset_min`, `tz_next_change_s`, `tz_next_offset_min` | — |
| `set_schedule` | `schedule` (above) | — saved to `/schedule.json` |
| `get_schedule` | — | `schedule` |
| `set_mode` | `mode` | — manual, held as above |
| `arm` | `on` | `armed` — the old API: armed / off, held like `set_mode` |
| `get_show` | — | as before + the mode block |

Mode block: `mode`, `reason` (`schedule` / `manual` / `no clock` / `no
schedule` / `waiting for the clock`), `clock`, `scheduled`, `utc_s`,
`tz_min`, `next_s` + `next_mode`, `hold_until_s`, `sunset_s`,
`sunrise_s`. Event `{"evt":"mode","node","mode","reason"}` on every
change. Sequences gain `ambient` and `loop_ms` (the console sends one
show-wide period to every part).

**Console → Show:** header shows the mode (ARMED / AMBIENT / OFF /
MIXED) with why and the next change ("next: Ambient at 21:30 · sunset
18:28"); Off / Ambient / Armed buttons; **Schedule…** opens the editor
(location typed or *Use this device's location*, today's sunrise/
sunset, one row per window with day chips, optional dates, from/to with
presets, mode, and what it resolves to today; Save to boards also sets
their clocks). Sequence editor: *Ambient loop* toggle + "every N s".

**Files:** firmware `pm_sun.h`, `pm_schedule.h` (pure), `pm_time.h`
`PmWallClock`, `pm_schedule_json.h`, `pm_show.cpp` (runtime),
`pm_mesh.cpp` (beacon), `pm_wifi.cpp` (SNTP); console
`lib/schedule.ts`, `views/show/SchedulePanel.tsx`.

**Bench test (Stage 3b)** — two boards on the shelf, one sequence
marked Ambient loop (an LED on, 5 s loop), one PIR trigger:
1. Flash both (frame format changed — every node must match).
2. Console → Show → Schedule…: your location; set row 1 to start
   2 minutes from now; Save. Header: OFF, "next: Armed at …".
3. At that minute both go ARMED, the LED loop starts on both boards
   together, the PIR fires its sequence.
4. Press **Off**: outputs off, "set by hand until …" the next edge.
5. Power-cycle one board with the console unplugged: it comes back
   `off`/`waiting for the clock`, then takes the schedule's mode from
   the other board's beacon within ~5 s.

## 6f. Boards on battery (started 2026-10-11)

The Mini's battery story (software-plan §3, module-selection-2026-09-19:
sensor/timer deep sleep, leaf role) rehearsed on a board you can buy: the
**Adafruit HUZZAH32 Feather** (`boards/esp32-huzzah32.yaml`, env
`esp32-huzzah32`) — LiPo JST input with a 500 mA charger, battery sense
on GPIO 35 through 2:1. ⚠ Pin map written from Adafruit's pinout page;
verify against the board's silkscreen (the V2 Feather differs).

- **Profiles may declare a battery sense pin** (`battery: {gpio,
  divider}` → `pm_board_t.battery_gpio/divider`); the heartbeat's
  `battery_mv` is read from it (8-sample average of
  `analogReadMilliVolts`), 0 on boards without one. The Yard's detail
  panel shows it (amber under 3.5 V).
- **Power setting, every board** (config `power: "mains" | "battery"`,
  the "On battery" toggle beside Bridge): on battery the board is a
  **leaf** — never RELAY, never conductor — so the mesh never depends on
  it. Default mains.
- **Next (not built): sleeping.** On battery, deep sleep between
  triggers: wake on the DIGITAL_IN pin (ext0/ext1) or a timer check-in,
  rejoin on the saved channel, resync the clock, run the trigger's cue,
  sleep again. A sleeping leaf misses cues fired by others — by design;
  its own triggers still work. Needs: RTC-memory state across sleeps,
  wake-pin rules in `pm_pinrules`, console affordances ("asleep · wakes
  on PIR"), and the mode schedule honored on wake. Measure the HUZZAH32's
  sleep current first (the devkit's regulator/USB chip may dominate).
- **Sleep design (decided 2026-10-11, Colin + Claude; an earlier chat on
  this was never written down):** *asleep by default, awake for what it
  can predict.* (1) Its own sensor wakes it (ext0/ext1) — reactive, no
  prediction needed. (2) Anything on the **schedule** is predictable:
  the board knows the show schedule and the mesh clock, so it sets a
  timer wake for `T − lead` (~2 s), syncs, and is listening when a
  scheduled cue or a mode change lands. (3) **Check-ins** every N minutes
  (~1.5 s awake: hear heartbeats, resync, pick up config/firmware
  changes); N is the battery dial — 5 min ≈ <1 % duty. Sensor-fired cues
  from *other* boards are unpredictable and are missed while asleep —
  accepted; put that board's outputs on a scheduled cue or let its own
  sensor fire it. Through "off" schedule windows it sleeps entirely.
- **Two tiers (Colin, 2026-10-11).** The radio can't half-listen, so
  "less deep" sleep means *listening on a rhythm* with senders repeating
  into it. **Show tier** (any schedule window that isn't off): light
  sleep with a listen window, e.g. 100 ms every 1 s (~10 mA of radio
  averaged vs ~100 mA awake); a cue aimed at a battery board is sent
  with a 1 s lead and repeated through the period, so it lands on time
  with everyone else; the period is a per-board setting (100 ms / 300 ms
  ≈ 0.3 s latency at ~35 mA when a scare needs it); its own sensor wakes
  it at once regardless. **Off tier** (schedule off, STOP ALL): deep
  sleep, sensor wake, check-ins every 15–60 min. The schedule drives the
  switch; the board timer-wakes for the next window. Rough budget, 2000
  mAh: ~8–10 days of continuous show tier; months in off tier *if the
  board's floor is low* — measure the HUZZAH32's deep-sleep draw first
  (regulator + USB chip), the Mini's PCB designs that floor away.
- **Build plan (2026-10-11, Feather on battery this Halloween):**
  *Toolchain facts:* the Arduino core's prebuilt SDK has `CONFIG_PM_ENABLE`
  off, so the CPU cannot auto-light-sleep; the ESP-NOW wake-window API
  (`esp_now_set_wake_window` + `esp_wifi_connectionless_module_set_wake_interval`)
  is present. So the **show tier is modem sleep**: the RF wakes for
  `window` ms every `interval` ms, the CPU stays up — ~25 mA average
  instead of ~100, a 4× saving, not 10×. The **off tier is deep sleep**
  (microamps for the chip) and is where battery life really comes from.
  Settings per board, in the console: show listen window/interval and
  the off-tier check-in (minutes; Colin expects 1–5, not 15–60).
  *Stage 1 — off tier + plumbing:* config `sleep: {interval_ms,
  window_ms, checkin_ms}`; on a battery board with mode `off`, after a
  10 s dwell with nothing in flight: deep sleep until the sensor pin
  (ext1 on the DIGITAL_IN pins, which must be RTC-capable: 0,2,4,12–15,
  25–27,32–39), the check-in timer, or 5 s before the next schedule
  window — whichever first. State across sleeps in RTC memory (channel,
  mode, wake reason); `hello.reset` says "deep sleep" and the boot event
  the wake cause. A console request to the board holds it awake for 10
  min (`hold_awake`), so pages and updates work. Bridge: requests to a
  LEAF retry longer. Console: "asleep · wakes by HH:MM / on PIR" on the
  roster and Yard; the sleep settings on the board page.
  *Stage 2 — show tier:* in any mode but off, `esp_wifi_set_ps(MIN_MODEM)`
  + wake window; the bridge/conductor sends cues and requests to leaves
  repeated across one interval (window ≥ spacing) so one copy lands;
  TIME beacons likewise; clocks tolerate the sparser sync.
  *Stage 3 — measure* on the Feather with a battery (deep-sleep floor
  of the board, show-tier average) and tune defaults.
- **Built and bench-tested 2026-10-11 (stages 1 and 2).** Off tier: the
  Feather, on battery with a 1-minute check-in and the show off, deep-slept
  3 s after its hold was released, woke on the timer 60 s later (reset
  reason "deep sleep"), mode and settings intact. Show tier: at 100 ms of
  every 1000 ms it received **4 of 4 cues** fired from the bridge (also
  4/4 at 50 % and 100 %); the bridge learned its interval from the
  heartbeat (`listen_ms`), repeated the cue every 100 ms across it, and a
  console request reached it in **0.8 s** via the hold_awake burst, after
  which requests ran at normal speed. Builds: the Feather image has no
  Bluetooth (floods) — IRAM holds WiFi + Bluetooth or WiFi + deep sleep;
  the DevKit image keeps Bluetooth and never sleeps (`hello.sleeps`).
  Any DIGITAL_IN on an RTC pin wakes the board; a button with no trigger
  is a plain wake button. Same-day fixes: console polls (hello/mesh/
  state/ota_status) no longer hold a board awake; bridge time beacons
  count as bridge presence (a leaf hears beacons, not heartbeats); the
  announced channel is read by field (the last-byte read broke when
  listen_ms was appended, and nodes sat on channel 10); check-in is
  `checkin_ms` like the other two settings; the timer-wake dwell is 6 s.
- **Power budget from published figures (not yet measured here).** Adafruit
  gives the ESP32 module ~200 mA active on a 500 mA regulator; the chip
  alone is ~10 µA in deep sleep, but users measure the *original*
  HUZZAH32 at **~6.5 mA** in deep sleep: the CP2104 USB chip runs from
  the 3.3 V rail, so it's powered on battery too, and with no USB host
  its D− line floats and it never enters USB suspend. A pull-down
  resistor from D− to GND puts it in suspend: **~200–250 µA** whole
  board (voneicken.com, 2018; value not given — 10–100 kΩ is the usual
  range, ⚠ check before soldering). The V2 Feather measures ~420 µA. So as bought the
  floor sets off-tier life: ~6.5 mA + ~2 mA for a 6 s dwell every 5 min
  ≈ 8.5 mA ≈ **~10 days** on 2000 mAh. With the D− pull-down the dwell
  dominates instead: ~2.3 mA ≈ **~5 weeks**, and the check-in period
  becomes the knob that matters. Show tier (modem sleep, CPU up): ~25–30 mA average
  ≈ **3 days** continuous, or ~5 h a night for a week with the off tier
  in between. Measure to confirm (Colin has a meter; stage 3).
- **Relaying while awake: yes.** The rule is that the mesh never
  *depends* on a battery board, not that it never relays. A rebroadcast
  costs ~1 ms of radio per frame, negligible against ~100 mA of simply
  being awake; the flood's dedup handles the extra copies. What it must
  never do is stay awake *because* it is a path. So: relay
  opportunistically while awake, sleep on its own schedule regardless,
  lay the mesh out to work without it. (The LEAF role today = no relay
  at all; this becomes "relay while awake" when sleep lands.)
- **Updates (done 2026-10-11):** `tools/ota_serve.py` serves the whole
  build root — `<root>/<board id>/firmware.bin` for every env (`--build`
  builds them all) — and the Firmware panel picks each board's own image
  from its profile id (`imageUrlFor`), over the mesh or over WiFi. A
  sleeping board is woken by the bridge's hold_awake burst first.

## 6g. ESP32-C6 SuperMini (added 2026-10-11, not yet on hardware)

The board from the lantern fire test, as a third profile:
`boards/esp32-c6-supermini.yaml`, env `esp32-c6-supermini`
(`board = esp32-c6-devkitm-1`, the same as the lantern project).

- **What it brings.** A few dollars, 22 × 18 mm, USB-C with *native* USB
  serial — no CP2104, so its deep-sleep floor should be hundreds of µA,
  not the Feather's milliamps. No battery input: a cell goes through an
  external charger/regulator. 4 MB flash, so the same `min_spiffs`
  partition table and OTA slots. 6 LEDC channels (ESP32: 16) and 2 RMT
  channels, so **at most two strips** — the profile's budgets say so.
- **Pins.** "SuperMini" is not one official board and vendors order the
  headers differently, so the profile labels pins by the GPIO number on
  the silkscreen. GPIO **0–7 are the low-power pins** — the only ones
  that wake the board from deep sleep (0–6 also read analog). 12/13 are
  USB (reserved), 8 the onboard RGB pixel (LED_STRIP with 1 pixel lights
  it), 9 the BOOT button, 15 the status LED + JTAG strap, 16 UART0 TX
  (boot ROM chatter at power-up). Strapping: 4, 5, 8, 9, 15.
- **Wake pins now come from the profile.** A new `wake` capability in
  `boards/*.yaml` (ESP32: the RTC GPIOs; C6: LP 0–7) replaces the
  hardcoded ESP32 list in `pm_pinrules.h`, `pm_sleep.cpp` and
  `pinRules.ts`; the console's "can't wake the board" warning lists the
  board's own wake pins.
- **Chip differences handled in the build.** `ESP_EXT1_WAKEUP_ALL_LOW` is
  ESP32-only (the C6 takes `ANY_LOW`); the BLE controller config has no
  `mode` field outside the ESP32.
- **Bluetooth floods on the C6 go through NimBLE** (ported same day;
  the ESP32 IRAM story that first made the C6 the only battery board
  with floods is resolved above — the Feather has them too now).
  The C6's prebuilt libs have no VHCI (`esp_vhci_host_*` undefined) but
  ship NimBLE with legacy advertising/scanning (`CONFIG_BT_NIMBLE_EXT_ADV`
  off) and WiFi/BT coexistence on. `pm_ble_tx.cpp` now has two radio
  backends under the same five jobs — raw advert data, non-connectable
  advertising at 20 ms, active scan with the duty cycle, adverts heard,
  per-call status for the stats (filed under the HCI opcode each stands
  for). ESP32 keeps the bench-proven VHCI path unchanged; the C6 uses
  `ble_gap_adv_set_data/adv_start/adv_stop/disc/disc_cancel`. Pairing,
  identity matching and burst timing are shared code. Bluetooth starts
  only with a BLE_LIGHT channel or a console search, so a C6 that drives
  no floods never powers it. Image is 1.64 MB of the 1.9 MB slot (83 %).
  ⚠ Not yet on hardware: the one unknown is whether NimBLE's controller
  accepts the 20 ms non-connectable interval (the stats would show
  `failed_opcode` 0x200A).
- **Native USB caveats.** `Serial` is the USB-JTAG CDC port
  (`ARDUINO_USB_CDC_ON_BOOT=1`); the baud rate is ignored. **Plugged into a
  computer that isn't reading the port, writes blocked** (up to 2 s each)
  and the watchdog rebooted the board every few minutes (first real C6
  run, 2026-10-15); `main.cpp` now sets a zero TX timeout and a 4 KB TX
  buffer on native-USB builds, so unread output is dropped instead. After a deep
  sleep the port re-enumerates, so a USB-connected console drops and
  reconnects on every wake — on battery, talk to it over the mesh
  instead. Flashing: the same `pio run -e esp32-c6-supermini -t upload`;
  if the port isn't found, hold BOOT while plugging in. **From the browser
  installer (2026-10-17, Colin):** auto-reset into download mode over the
  USB-Serial/JTAG port is unreliable on a Mac ("Failed to initialize"),
  and a fresh board's factory demo reboots so the port flaps in the
  chooser. Dependable sequence: close anything holding the port (a USB
  console tab), unplug, hold BOOT, plug in, release, Install, pick the
  port that just appeared, then press RESET afterwards (the ROM doesn't
  start the new image by itself). The flash page shows these steps when a
  native-USB board is selected. To confirm on Colin's next new board.
  Colin also sees an **LED by the USB socket (silkscreen "CL") light on
  some BOOT-and-plug attempts, and those never show a port or install**;
  a fresh board plugged in normally keeps it off, so it is *not* the
  factory demo (first guess, withdrawn). "CL" is usually the charge
  indicator, driven by the charger, which would make it a symptom of how
  power/USB came up rather than a chip state. Unknown. To settle it next
  time: did the Mac's accessory prompt appear; is the lit LED the blue
  GPIO 15 one or the green charge one; does the board appear in System
  Report → USB at all. Rule for the docs meanwhile: LED on = retry.
  **Resolved from the datasheet and the board schematic (2026-10-17).**
  ESP32-C6 datasheet §3.1: download boot needs **GPIO8 = 1 and GPIO9 = 0**
  at reset, and Table 3-1 says GPIO8 is **floating** by default (only
  GPIO9 has a weak pull-up). The SuperMini schematic
  (mischianti.org/wp-content/uploads/2026/04/esp32-c6-supermini-board-schematic.pdf)
  ties GPIO8 only to the WS2812's DIN — high impedance — so holding BOOT
  gives download mode only when GPIO8 happens to float high; floating
  low is the undefined 0/0 combination, the "sometimes" Colin sees. Fix:
  hold GPIO8 high during the BOOT press — a jumper from pin 8 to 3V3
  while plugging in, or a permanent 10 kΩ pull-up (the WS2812 DIN idles
  high, harmless; PropMesh drives it when assigned). The same schematic
  settles the LEDs: PD4 **green** on the TP4054's CHRG pin (on charging,
  off full, blinks with no battery — the "BAT"/"CL" pair by the USB
  socket), PD2 **blue** on **GPIO15 via 1 kΩ to GND, lit when GPIO15 is
  HIGH**; GPIO15 (the JTAG-source strap) has no internal pull either.
  And the charger (2026-10-20, the candle took a night to reach 3.96 V):
  the TP4054's PROG pin has **PR3 = 10 kΩ**, which sets the charge
  current at **100 mA**. Power path: USB VBUS → PD1 → VCC → the 3.3 V
  regulator; BAT → PD2 → VCC. So on USB the board itself runs from USB
  and the whole 100 mA goes into the cell, less whatever hangs off the
  cell directly (the candle's LED and coil, 10–25 mA while lit). A cell
  of 1500–2000 mAh from empty is 15–20 hours, charging ends at 4.2 V
  (green LED off), and the console reads the charger's voltage while
  plugged in, not the cell's resting voltage. For a big cell, charge it
  off-board; the SuperMini's charger is for small ones.
  Raising it (Colin asked, 2026-10-20; not done): the TP4054 sets
  I = 1000 / R_PROG (10 kΩ → 100 mA), 500 mA at most, so 2 kΩ is the
  ceiling; a resistor soldered on top of PR3 in parallel avoids
  removing the 0201 (10 k ∥ 2.49 k ≈ 2 k → 500 mA; 10 k ∥ 4.99 k ≈
  3.3 k → 300 mA). The chip limits its own junction to ~120 °C by
  cutting current, so it can't cook itself, but in SOT-23-5 on this
  board it dissipates (5 V − V_cell) × I — up to 1 W at 500 mA on a
  flat cell — and will throttle to well under 500 mA while the board
  runs hot next to the module, inside the candle. The cell must take
  it (≤ 1C: 500 mA needs ≥ 500 mAh) and the USB supply must give
  ~600 mA. 300 mA is the comfortable choice. The PROG pin reads the
  real charge current: I = V_PROG / R_PROG × 1000.
  What lights the blue LED in the failed state isn't proven, but it is
  no longer needed to diagnose it. **Colin's rule from the second and
  third boards (2026-10-21):** BOOT held at plug-in puts the *factory*
  program into install mode every time, blue LED off; once PropMesh is
  on the board, BOOT held at plug-in gives the lit blue LED and no USB
  device every time, while plugging in *without* BOOT lets the
  installer restart the board into install mode itself. So the site
  now says: hold BOOT only for the factory program. Why the floating
  GPIO8 reads differently under the two programs is still open. The C3 SuperMini has the same
  GPIO8/GPIO9 boot table with GPIO8 wired to its blue LED — check its
  default pull before assuming the same trick.
- **Sleep on the C6: same tiers, same limit (checked 2026-10-11).** The
  Bluetooth stack doesn't change sleep: on battery the off tier is deep
  sleep (radio off, Bluetooth included). The limit on both chips is the prebuilt Arduino SDK:
  `CONFIG_PM_ENABLE` off (no automatic light sleep between ESP-NOW
  listen windows, so the CPU stays up in the show tier) and on the C6
  also `CONFIG_BT_LE_SLEEP_ENABLE` off. What differs is the board: no
  USB bridge chip, so the deep-sleep floor is the regulator plus the
  SuperMini's always-on **power LED** and the **RGB pixel on GPIO 8**
  (~1 mA quiescent) — likely ~1–3 mA as bought, tens of µA with both
  removed. Measure.
- **Battery boards DO send to floods when awake** (Colin, 2026-10-11:
  "if it is on and available it should in a pinch rather than
  restricting it"). Nothing restricts it: a battery board ticked as a
  sender gets flood commands in its listen windows (senders repeat into
  them) and bursts them out, so a change can land up to one listen
  interval late; in the off tier it's asleep and the other senders cover.
  It finishes a queued burst before deep-sleeping (`pm_ble_busy()`).
  hello carries `ble` (false on a build without Bluetooth — none shipped
  since the IRAM fix below, but older Feather images say so). The Floods tab tags senders **ON BATTERY** / **NO BLUETOOTH**
  (a no-Bluetooth board can be unticked, never ticked, and isn't offered
  for searching), and explains the lag — loudly if no mains board is
  ticked.
- **IRAM, and why the Feather lost Bluetooth for a day (2026-10-11).**
  The ESP32's 128 KB IRAM holds the code that must run from RAM: WiFi,
  the Bluetooth controller (33 KB), FreeRTOS, flash, heap, sleep — all
  Espressif's prebuilt libraries, none of ours. With WiFi + Bluetooth +
  deep sleep the Feather build overflowed by **104 bytes**, so each ESP32
  build dropped one feature (`PM_NO_SLEEP` on the DevKit, `PM_NO_BLE` on
  the Feather). Colin asked for an audit instead. The map showed the
  only elective IRAM was the strip driver: Adafruit_NeoPixel goes through
  the Arduino core's `esp32-hal-rmt.c`, which links the RMT **receive**
  driver (523 B), a copy encoder (248 B) and carrier code a strip never
  uses. `pm_ws2812.{h,cpp}` drives WS2812 straight on the IDF `rmt_tx`
  bytes encoder (hardware timing, no bit-banging) — NeoPixel is gone
  from `lib_deps`, and **every build now carries every feature**; the
  DevKit sleeps on battery too. ⚠ Strip timing (0.4/0.85, 0.8/0.45 µs at
  10 MHz) is unverified on a real strip — bench-check a WS2812 before
  relying on it. The `PM_NO_BLE` / `PM_NO_SLEEP` flags remain as escape
  hatches if IRAM fills again; `firmware.map` says who grew.
- **The real lever (winter, not before the freeze):** pioarduino's
  `custom_sdkconfig` rebuilds the Arduino libs with `CONFIG_PM_ENABLE`,
  `CONFIG_FREERTOS_USE_TICKLESS_IDLE` (and `CONFIG_BT_LE_SLEEP_ENABLE` on
  the C6), so the chip light-sleeps between listen windows instead of
  idling in modem sleep. Costs: a slow first build, PWM outputs
  (servo/LED/motor) need a PM lock while active or they glitch, and the
  USB console drops while the chip sleeps. Applies to the ESP32 too.
- **Bench test (to do):** flash, Connect in the console, confirm the
  profile shows 22 pins with 0–7 marked wake-capable; assign 8 = LED_STRIP
  (1 pixel) and 15 = LED and test-fire; tick the C6 as a flood sender and
  change a flood's color (then a search with a light power-cycled); mesh join on channel 11 with a
  heartbeat on the roster; OTA its own image from `ota_serve.py`
  (`esp32-c6-supermini/firmware.bin`); On battery + a button on GPIO 1
  → deep sleep and wake.

## 6h. Clocked strips and the fire effect (built 2026-10-11, not yet on hardware)

Colin's lantern prop — an ESP32-C6 SuperMini driving a 2 × 4 **SK9822**
matrix (data 20, clock 19, BGR) with Fire2023 — becomes a node without
losing its look, and fire becomes something any strip can do.

- **FastLED, measured, and where it ended up.** On the ESP32 FastLED's
  strip output sits on the same IDF RMT driver as ours and costs slightly
  *more* IRAM (the build overflowed by 4 bytes with it), and it bakes
  the pin into the type (`addLeds<WS2812, PIN>`), refusing some pins at
  compile time — incompatible with assigning pins from the console. Its
  **math** (`inoise16`, `scale8`, gradient palettes) costs ~11 KB flash
  and no IRAM. So: FastLED 3.10.3 (pinned — 3.10.7 doesn't compile on
  this core) for the fire's math only; output stays on our drivers.
- **`SPI_STRIP`** — "LED strip (SK9822 / APA102, clocked)": DATA + CLOCK
  pins, bit-banged (`pm_apa102`) — a clocked protocol has no timing to
  meet, so no peripheral, no IRAM, interrupts stay on; 100 px ≈ 1 ms.
  `LED_STRIP` (WS2812, RMT) is unchanged. Both are a `PmPixels`
  (`pm_pixels.h`), and both take a color **order** (`grb` default for
  WS2812, `bgr` for SK9822).
- **Effect per strip: `solid` or `fire`.** Fire2023 ported to
  `pm_fire.{h,cpp}` with its constants turned into `PmFireCfg` fields,
  the lantern's values as defaults: columns × height (must equal the
  pixel count, height ≥ 2), zigzag wiring (odd columns run back down —
  the lantern's `{3,4,2,5,1,6,0,7}` table generalized), brightness 128,
  speed 2, flame 3.0 (stored ×10), noise 0, smoke speed 25, smoke 250,
  smoke scale 125. The lantern's arithmetic is kept to the truncation
  (`d / smoke_dim` into a byte) so the look is the same. Runs every 8 ms
  in `pm_channels_loop` for every burning fire strip.
- **A fire strip's value is a switch:** 0 = out (black), anything else =
  burning at its configured brightness. So cues, triggers, ramps and the
  by-hand restore all work unchanged — "flames on at the scare, out 10 s
  later" is a plain step. The editor's Test shows **Burn / Out** instead
  of a color picker. (Tinting the flames from the cue color is a
  possible later use of the value.)
- **Console:** strips get clock pin (SPI_STRIP), pixels, order and effect
  in the options column; choosing fire opens the FIRE row of knobs with
  a tooltip per knob saying which way it pushes the look. Validation
  (both sides): `fire_matrix` — columns × height ≠ pixels, or height
  < 2. Config JSON: `"order"`, `"effect"`, `"fire": {w, h, zigzag,
  brightness, speed, flame10, noise, smoke_speed, smoke_dim,
  smoke_scale}`.
- **Bench test (to do) — the lantern:** flash `esp32-c6-supermini`,
  Connect, assign GPIO 20 = SPI_STRIP with clock 19, pixels 8, order
  BGR, effect fire (defaults load the lantern's 2×4 zigzag) → Save →
  **Burn**. Watch for: the same flame as the old sketch (seeded at the
  bottom, rising, smoke veils). If columns look upside down, toggle
  zigzag; if colors are off, order. Then a cue with the strip at a
  color → out, fired from another board.

## 6i. Pinout drawing (2026-10-11)

The editor's **Pinout** panel (above the pin guide) draws the board from
its profile — `header: {usb, left, right}` in `boards/<id>.yaml`, the
two headers as printed, top to bottom — with this node's assignments on
the pads (output ember, input blue, free, caveat amber, reserved
hollow); click a pad to jump to its row. Drawn, not fetched: the console
will be served from the bridge in the yard with no internet, vendor
images have licensing and hotlink problems, and a drawing can show
your assignments. Each profile's `pinout_url` links the vendor's own
page ("vendor pinout ↗") for the photo-style reference. A profile
without `header` (the C6 SuperMini — vendors order its pins
differently) shows a list of GPIO numbers to match to the silkscreen.
`genboards.py --check` fails if a usable GPIO is missing from the
drawing. Checked in the simulated console; the DevKit and Feather
headers are from the DOIT 30-pin and Adafruit layouts — ⚠ confirm
against a board in hand.

## 6j. Boards that go quiet — diagnosis (2026-10-12)

**Seen:** the morning after a quiet night (show off), the console
couldn't reach the bridge over WiFi, and **Prop could hear the mesh but
not be heard**: it listed the bridge (−35 dBm) and the Feather as
neighbors and received their heartbeats, yet neither listed Prop, and
every request to *and from* Prop timed out. Bluetooth was idle (all 10
bursts closed cleanly). Nothing on any log; the firmware didn't count
failed sends. Opening the bridge's USB port to ask rebooted it and erased
its state (pyserial with DTR/RTS forced low toggles the auto-reset
circuit — leave both asserted, the default, to listen without a reset).
Reflashing cleared both. **Root cause still unknown** — this round adds
the instruments to catch it next time, and a self-heal.

- **Send errors counted:** `mesh` now reports `tx`, `tx_err` and
  `last_tx_err` (the esp_err name) — an ESP-NOW buffer leak would show
  as `ESP_ERR_ESPNOW_NO_MEM`.
- **"Nobody hears me" detector** (`pm_mesh_unheard_ms`): a neighbor's
  heartbeat lists who it hears; if mains neighbors with room in their
  lists keep talking but none lists this node, its frames aren't getting
  out. `mesh` shows `unheard_s`. After **2 min** unheard the board
  restarts ESP-NOW (`pm_mesh_recover`); after 2 more, it reboots — at
  most 3 times in a row (RTC counter), reset by 10 min of being heard,
  so a genuinely one-way link at the edge of range can't reboot forever.
- **Last words** (`pm_lastwords`, `/last.json`): WiFi lost (+ reason),
  WiFi back, mute → radio restarted, mute → rebooted, with uptime and
  wall time — at most one write per 10 s. The previous boot's record is
  in the boot event and `hello.last`; the console's node editor shows
  **Last restart** (reason, uptime) and **Before that** (the saved
  record) whenever either is worth reading.
- **Caught, and matched to a known ESP-IDF bug (2026-10-18/19).** The
  bridge (DevKit, build d73db6b, Arduino core 3.3.12 on ESP-IDF 5.5.5)
  rebooted itself twice: at 22:46:48 UTC after 10651 s up — `hello.last`:
  *mute: rebooted — neighbors heard but none hear us for 120 s; send
  errors 492 (last ESP_ERR_ESPNOW_NO_MEM)* — and again at 22:51:16, four
  and a half minutes into the next run, with 743 errors. The radio
  restart two minutes before each reboot had not cleared it. After the
  second reboot: WiFi up at −26 dBm, channel 11, `tx_err` 0, and no
  trouble for hours since (an 18k-frame OTA included). From the console
  this was the bridge dropping off WiFi for a few minutes at a time.

  **What it is.** espressif/esp-idf
  [#18682](https://github.com/espressif/esp-idf/issues/18682) (opened
  June 2026, still open, IDF 5.5.4/5.5.5 — ours): ESP-NOW broadcast
  sends leak WiFi TX buffers. Send-complete callbacks stop coming for
  some frames, their buffers are never returned to the pool, and after
  tens of thousands of frames (20k to 103k in the reports) `esp_now_send`
  returns `ESP_ERR_ESPNOW_NO_MEM` on every call. Receiving keeps working.
  `esp_now_deinit`/`init` does not recover it, nor `esp_wifi_stop`/
  `start`; a full driver teardown (`esp_wifi_deinit` + `init` — in the
  Arduino core, `WiFi.mode(WIFI_OFF)` then `WIFI_STA`, which does both)
  recovers in about a second, and so does a reboot. That is exactly the
  shape here: `pm_mesh_recover` is ESP-NOW-only, so stage 1 could not
  help, and the stage-2 reboot did. It also fits Prop's September mute
  (received everything, sent nothing, nothing in the log — the "root
  cause still unknown" above). Same family: [#19238](https://github.com/espressif/esp-idf/issues/19238)
  (C5, IDF 6.1, TX stops for good under TCP load while RX keeps working).
  Reporters' workarounds, unconfirmed by Espressif: pace sends to one in
  flight, clocked by the send callback with a 2 s dead-man; keep blocking
  work off the loop; a clean channel. No fix from Espressif as of
  October 2026. For scale: the bridge's own sends run at about 0.4/s
  idle (1200 in 50 min) and an OTA is about 18k in five minutes, with
  relays (every frame heard is rebroadcast) on top — so a day of idle
  mesh is one OTA's worth, and the yard on show night is well inside the
  reported range.

  **What does not fit:** the second mute began within the first minutes
  of a fresh boot. A fresh driver has a fresh pool, so either the first
  reboot came up into the same jam from outside (a busy channel) or the
  detector misjudged a fresh boot. The watch log (below) is there to
  catch which.

  **Proposed fix, not built — Colin to say which:**
  1. `pm_mesh_recover` becomes the full teardown: `WiFi.mode(WIFI_OFF)`,
     `WIFI_STA`, ESP-NOW init, peer, callbacks, channel; the bridge then
     rejoins WiFi on its own schedule (`pm_wifi_loop`). Stage 1 would
     then actually work, in a second or two, uptime and state kept.
  2. Register a send callback and count frames in flight; when callbacks
     stop (eight or more outstanding and none completing for 5 s),
     rebuild the radio at once and note it in last words — the bridge
     back in seconds instead of four minutes, before anyone notices.
     `mesh` reports `tx_cb` and `tx_inflight`.
  3. The prevention the reporters found: a one-in-flight send queue in
     `pm_mesh` (sends and relays alike), the next frame dispatched from
     the loop when the last completed, TIME beacons re-stamped at
     dispatch so queueing never becomes clock error. The DevKit's static
     RAM is already at 96.6 KB, so the queue is heap-allocated in init.
     The biggest change of the three; worth it only if 1–2 still leave
     visible gaps.

  **Inside the library (2026-10-19).** The leak cannot be read: ESP-IDF is
  open source except the WiFi MAC, PHY and ESP-NOW layers, which ship as
  precompiled archives (`libespnow.a`, `libnet80211.a`, `libpp.a`,
  `libcore.a`, `libphy.a`) with headers only. Disassembling them (xtensa
  objdump on the archives in the Arduino 3.3.12 package) gives the path
  of the failure: `esp_now_send` → `mt_send` → `ieee80211_send_action_
  vendor_spec` → `ieee80211_construct_action_vendor_spec` → `ieee80211_
  alloc_action_vendor_spec`; when that returns null the construct step
  returns the generic `ESP_ERR_NO_MEM` (0x101) and `mt_send` translates
  it to `ESP_ERR_ESPNOW_NO_MEM`. The allocator underneath is `esf_buf_
  alloc` in `libpp.a`: a static cache first, then the dynamic pool
  (`CONFIG_ESP_WIFI_DYNAMIC_TX_BUFFER_NUM` = 32 in these builds), then a
  default handler, then null. So "no memory" means every transmit buffer
  is owned by a frame the driver never finished. The library's
  statistics dumps (`esp_wifi_statis_dump`, `esf_buf_statis_dump`),
  which the issue reporters used to watch their buffers go missing, are
  useless in Arduino builds: the open log wrapper they print through
  (`lib_printf` in `libesp_wifi.a`) is compiled with the maximum log
  level ERROR, so it formats the line and discards it. The pool's
  globals (`g_eb_list_desc`, `eb_space`) are named but their layout is
  not, so the counters are not read directly either.

  **What can be measured, from our side:** the ESP-NOW send callback —
  which the mesh had never registered. Every frame the radio accepts
  should complete with one; a frame whose completion never comes is a
  buffer gone for good. `pm_mesh` now counts `tx_sent`, `tx_done`,
  `tx_failed` and reports `tx_inflight` (sent − done) and `tx_stuck_s`
  in `mesh` (PR #34). On the bridge, `tx_inflight` sampled by the watch
  below should sit near zero between sends; a floor that climbs over
  hours is the leak, its slope the rate, and the pool size (about 32 +
  cache) the time to the next mute. That also decides between the fix
  steps: if the floor climbs steadily, prevention (step 3) is needed; if
  it jumps at events (OTA, a console attaching, a WiFi retry), those
  events are the trigger and step 2's fast recovery is enough.
  Nothing acts on the counters yet.

  **Measured overnight (2026-10-19, 01:15–01:50 UTC), bridge on the
  instrumented build.** The send callback is now registered and counted
  (PR #34). Through two full transfers (18k frames each, relays
  included) and the idle time between, `tx_inflight` never left zero:
  every frame the radio accepted completed. So the driver leak of
  #18682 did not show in 36k frames on this build; it is not excluded at
  the 60–100k counts the reporters saw, and the counters keep running.
  What did show is the bridge's **heap**. The `mesh` command now reports
  free heap, the largest block, the low-water mark since boot, the
  lowest main-loop sample since it was last asked, the WebSocket client
  count, and the last 16 commands with the heap before and after each
  (same PR). Scripted runs, each against a fresh window, with one
  console attached throughout (Colin's browser, polling every 6 s):

  | Bridge, DevKit V1 | free | largest block | lowest loop sample |
  |---|---|---|---|
  | idle, 100 s | 31.9 KB | 30.7 KB | 27.0 KB |
  | a second console loading the Yard and Nodes pages (45 requests in 40 s) | 32.0 KB | 30.7 KB | **15.1 KB** |
  | an OTA to a node through the bridge, 6 min | 26.6 KB | **12.3 KB** | **4.4 KB** |
  | low-water mark since boot, two boots | | | **1.2 KB** and 11.8 KB |

  The WiFi driver's dynamic transmit buffers (the pool the disassembly
  points at) are `malloc`ed from this heap: a frame costs about its own
  size plus a descriptor, and 32 may be outstanding. At 4 KB free that
  is two or three frames; at the boot low-water mark it is none. A
  failed `malloc` there is the same `ESP_ERR_ESPNOW_NO_MEM` as the leak.
  Heap starvation also fits the part the leak did not: a mute within
  minutes of a fresh boot, when two consoles reconnect at once and ask
  every board hello, get_yard, set_clock and the show sync in a burst.
  Where the bridge's RAM goes (`nm` on the DevKit image; DRAM is one
  320 KB pool shared by static data and heap, so static bytes are heap
  bytes not available): `PmShow` **31.9 KB** on the heap (16 sequences ×
  96 steps, preallocated — on a bridge, which has no channels, it holds
  nothing); reassembly `s_reasm` 13.0 KB static (3 slots × 4320);
  `emit` and `on_api` reply buffers 4.4 + 4.3 KB static; the serial line
  4.1 KB static; two `PmSequence` temporaries 2 × 2.0 KB static; the
  WebSocket buffers 2 × 4.1 KB on the heap while consoles are attached;
  up to 6 pending request texts × 4.3 KB on the heap during an OTA; and
  ArduinoJson documents for every reply (the yard map alone is a 7.7 KB
  reply). The DevKit's `RAM:` line is 96.7 KB, past the 95.5 KB rule in
  CLAUDE.md.

  **Revised proposal (replaces the three steps above; Colin to say):**
  0. **Heap headroom on the bridge first**, because it is the one cause
     we have evidence for and it is ours to fix: allocate `PmShow` only
     when a board has a part to play (saves 31.9 KB on every bridge);
     allocate a WebSocket client's buffer only while a message is being
     received; reassembly down to 2 slots; and have the yard map stream
     from its file to the socket instead of through a document. About
     45 KB more free, which doubles the bridge's margin.
  1. Recovery as a full driver teardown (`WiFi.mode(WIFI_OFF)` then
     `WIFI_STA`, ESP-NOW re-init) — still right for a wedge of either
     kind, since it also returns the driver's buffers.
  2. Act on `tx_stuck_s` only if `tx_inflight` ever reads non-zero in
     the watch log; the detector is in place, nothing uses it.
  The mute record (`hello.last`) now carries `inflight` and `heap /
  largest block` at the moment it fires, which settles leak-or-heap on
  the next occurrence without anyone watching. Logs on the server:
  `~/propmesh-logs/heap-experiments.log`, `bridge-ota-experiment.log`,
  `bridge-watch.log`.

  **Instrument:** `tools/bridge.py watch` logs the bridge's channel, WiFi,
  `tx`/`tx_err`/`last_tx_err`, the send-callback counters above,
  `unheard_s`, neighbors and every board's heap and uptime once a minute, each sample its own short connection so
  it never holds a console slot. Running on the server since 2026-10-19
  00:45 UTC into `~/propmesh-logs/bridge-watch.log`.
- **Next time it happens:** open the board in the console (over WiFi,
  or USB) *before* power-cycling — `hello.last`, `mesh.tx_err` and
  `unheard_s` say what happened, and if the detector fired the board
  will already have healed itself and said so.

## 6k. The show follows the conductor (2026-10-12)

**Why:** the Feather joined after the schedule was saved, never got it,
and sat in a stale manual "armed" all night — so it never slept. Each
board held its own copy of every mesh-wide document and only the console
wrote them, one board at a time; a board that was asleep, rebooting or
out of range missed the write (or a STOP ALL) and nothing ever retried.

**Model (Colin's):** mesh-wide state vs. per-node state.

| Mesh-wide — follows the conductor | Per node — stays on the board |
|---|---|
| Schedule (+ location, time zone) | Pin assignments, channels |
| Mode held by hand / STOP ALL | Name |
| Each board's part of the sequences and triggers | Battery / sleep settings |
| Floods key + light list (sending boards) | Bridge WiFi |

**Edit stamps, newest wins.** Every mesh-wide document carries the UTC
second it was edited — stamped once per edit by the console
(`editStamp()`, the same `at` on every board's copy). Not a counter: a
counter resets with the board that holds it (a replaced or reflashed
bridge would restart at 0 and every node would think itself ahead),
while a timestamp is monotonic across reboots and owners, is comparable
between boards, means something ("saved 09:41"), and lasts to 2106.
Every `set_*` handler ignores an `at` older than what it holds
(`"stale": true`), so no late, retried or replayed request can undo a
newer edit. No clock anywhere (`at` 0) applies as before.

**How it moves:**
- The conductor's time beacon (every second while a battery board
  listens, else every 5 s) carries `mode_manual/mode_at/mode_until`,
  `sched_at`, `show_at`, `floods_at` (schema `Time`).
- **Mode** comes straight from the beacon: a follower takes a newer hold
  (or its end) with no request. STOP ALL still goes to every board at
  once; the beacon is the backstop that reaches the ones that missed it.
- **Schedule:** a follower behind sends `get_schedule` to the conductor.
- **Sequences + triggers:** the **bridge** keeps a copy of every
  `set_sequence` / `delete_sequence` (a tombstone, so a deletion reaches
  a board that was away) / `set_rules` the console sends any board
  (`/m/<node>_*.json`). A board whose `show_synced` is behind the beacon's
  `show_at` asks `pull_index` for its own part and fetches what's newer
  (`pull_seq`, `pull_rules`). Unknown-to-the-bridge parts are never
  deleted — a replaced bridge starts with an empty copy and loses nothing.
- **Floods:** the bridge keeps the key + light list from any sender's
  `set_config`, only when they actually change (editing one board's pins
  must not restart every sender's outputs). A board holding a key with an
  older copy pulls it (`pull_floods`); one that already matches only takes
  the stamp.
- **Ahead of the conductor** (the bridge was replaced, or missed the
  console's write): a follower pushes its newer mode or schedule to the
  conductor, and the rest of the mesh follows from there.
- Battery boards hold themselves awake 20 s while a pull is in flight;
  a board waking for its check-in catches up in that window.
- A mesh **without a bridge** still shares schedule and mode through
  whichever board is conductor; sequences/triggers/floods then stay as
  each board holds them (nothing to heal from).
- Schedules saved before stamps count as edited at 1 — the oldest — so a
  board with none pulls one, and any real edit beats it.
- `hello.sync` shows each board's stamps: `sched_at`, `mode_at`,
  `show_synced`, `floods_at`.

**Bench, 2026-10-12** (bridge, Prop, Feather): the Feather pulled the
schedule within a minute of booting. Mode set on the bridge alone: Prop
followed in 1.6 s, the Feather at once. Schedule re-saved on the bridge
alone: Prop pulled it in 4.8 s. Prop's copy of a sequence deleted behind
the bridge's back came back by itself 3.2 s after the next show change.
Floods copy created from Prop's config; Prop took the stamp without a
rewrite. **Lesson on the way:** a 4 KB static buffer in pm_sync left
FreeRTOS no heap for its timer task and the ESP32 builds boot-looped
(`assert failed: vApplicationGetTimerTaskMemory`) — static RAM must stay
≤ ~95.7 KB; transient buffers go on the heap.

**Bench test still to do (needs Colin):** unplug a board, edit and save a
sequence that uses it in the console (the save reports it unreachable),
plug it back in — it should have the edit within seconds.

## 6l. ESP32-C3 SuperMini, and board versions (added 2026-10-14, not yet on hardware)

Colin has a C3 SuperMini, and §7b already called it the obvious next
profile. Added as `boards/esp32-c3-supermini.yaml`, env
`esp32-c3-supermini` (`board = esp32-c3-devkitm-1`, CDC-on-boot like the
C6), `BoardType` 5. Builds: 1.56 MB of the 1.9 MB slot (80 %), 81.8 KB
static RAM. DevKit and C6 builds unchanged.

- **Pins.** 13 on the header: 0–10, 20, 21. USB is native on 18/19
  (reserved, not on the header). Strapping 2, 8, 9 (datasheet). **Wake
  pins 0–5** (the C3's RTC domain); 0–4 read analog (ADC1), 5 is ADC2 and
  blocked by the radio, so the profile lists it digital-only. 6 LEDC
  channels, 2 RMT TX channels — same budgets as the C6. GPIO 2 is a
  strapping pin that must be high at reset, so it is outputs-only (a
  PIR's output idles low and would stop the boot); 8 is the onboard blue
  LED (on = LOW) and also strapping; 9 the BOOT button; 21 is UART0 TX
  (boot ROM chatter), 20 UART0 RX.
- **Deep sleep: the C3 has no ext1.** `pm_sleep.cpp` now switches on
  `SOC_PM_SUPPORT_EXT1_WAKEUP`: ESP32 and C6 keep the ext1 path; the C3
  arms `esp_deep_sleep_enable_gpio_wakeup` once per polarity (it takes a
  level per call, so active-high and active-low inputs can both wake it —
  better than ext1's one-polarity rule), and the wake cause is
  `ESP_SLEEP_WAKEUP_GPIO` with `esp_sleep_get_gpio_wakeup_status()`.
- **Bluetooth floods** go through the NimBLE backend (`#if
  !CONFIG_IDF_TARGET_ESP32`), untouched. Same unknown as the C6: whether
  the controller accepts the 20 ms non-connectable interval.
- **Versions of a board** (`variants:` in the profile, 2026-10-14).
  "SuperMini" is a board format, not a product; sellers' boards differ
  in LEDs, antenna, charger pads and header order. The profile now
  carries a list of plain-text notes, validated by `genboards.py`,
  emitted to `boards_gen.ts` (`Board.variants`) and rendered as a
  "Versions of this board" section on the site page and a "VERSIONS
  DIFFER" note under the console's Pinout panel. Written for the C3
  (black board: blue LED on 8, weak ceramic antenna; red "Plus": U.FL
  socket and a WS2812 on 8) and the C6 (charger pads on some; RGB pixel
  reportedly elsewhere on one seller's; the pixel + power LED ≈ 1 mA of
  the sleep floor). Sources: espboards.dev, esp32.co.uk, mischianti.org;
  none of it measured here.
- **The antenna caveat matters for the mesh.** The standard C3's ceramic
  antenna sits against the ground plane without the reference layout's
  clearance, and range is the board's most common complaint. ESP-NOW
  uses the same radio, so expect weaker links than a DevKit at the same
  distance; a Plus with an external antenna, or the reported 31 mm wire
  on the feed pad, are the fixes people use. Measure RSSI on the Yard
  before trusting one at the far end of the yard.
- **Bench test (to do):** flash (hold BOOT while plugging in if the
  port isn't found), Connect, confirm 13 pins with 0–5 wake-capable;
  assign 8 = LED and test (it should go *dark* at 100 % if it is the
  active-low blue LED — if so, tick nothing: the LED dimmer's polarity is
  whatever the board does, and the note says so); 10 = LED_STRIP on a
  real strip; a flood color change as a sender; mesh join with RSSI
  compared to a DevKit at the same spot; OTA its own image; On battery +
  a button on GPIO 1 → deep sleep and wake, with `hello.reset` saying
  "deep sleep" and the boot event naming GPIO 1.

## 6m. Battery repeater (built 2026-10-14, simulator only)

Colin's ask: a Feather on a large battery as a **repeater** for the far
end of the yard, with a sensor or nothing else wired to it.

**Today** that works by leaving *On battery* **off**: the board then
relays, keeps its radio on, fires its sensor instantly, and still reports
its battery voltage (the sense pin is read whatever the switch says). The
cost is runtime: a relay can't sleep, because ESP-NOW has no
store-and-forward — a dozing relay drops whatever the others send
meanwhile. Awake with the radio listening is ~100 mA (design figure,
§6f; not yet measured on the Feather): a 2,000 mAh cell lasts under a
day, 10,000 mAh ~4 days, 20,000 mAh ~a week.

**The mode to add: relay during the show, sleep outside it.** A battery
board with `sleep.relay = true`:

| | Show tier (any mode but off) | Off tier (schedule off, STOP ALL) |
|---|---|---|
| Today's battery board | modem sleep, listens `window/interval`, never relays | deep sleep, check-ins, sensor wake, wakes 5 s before the next window |
| Battery repeater | **radio always on, RELAY role**, `listen_ms` 0 (cues need no lead for it) | **unchanged** — deep sleep, check-ins, sensor wake, pre-window wake |

So the show costs ~100 mA while it runs and the rest of the day costs
the off-tier floor. Five hours of show a night on 10,000 mAh ≈ 2
weeks (corrected 2026-10-14: the check-ins on the grid are ~14 s awake per
5 min, ~4 mA averaged — most of the off-tier cost) (as bought; the Feather's 6.5 mA CP2104 floor eats ~1/3 of that —
the D− pull-down in §6f matters more here than anywhere). Never the
conductor and never the bridge (unchanged from a battery board).

**What the boards behind it experience.** While the show runs, nothing
different from a mains relay: cues, requests, heartbeats and beacons all
pass. When the schedule goes off and the repeater sleeps, the boards
behind it lose their path to the bridge: after 30 s without a bridge
heartbeat they start the channel scan (§6d — 13 s off-channel every
2 min, harmless with the show off); their own schedule still runs on
their own wall clock, so they come on at the next window by themselves;
the repeater wakes 5 s before that window and the beacon reaches them
again; edits saved meanwhile reach them through the show-sync pull (§6k)
once the beacon carries a newer stamp. To reach them from the console
after hours: wait for the repeater's check-in (`checkin_ms`, 5 min
default) — a request then holds it awake 10 min (`hold_awake`, as for
any battery board), and the boards behind it are reachable for that
long. This bends the mesh-first rule knowingly: **a prop whose only
path is a battery repeater is cut off outside show hours.** The console
should say so.

**Design**
- Config: `sleep.relay` (bool, default false), alongside `interval_ms`
  / `window_ms` / `checkin_ms`. `pm_config.h` `sleep_relay`; JSON both
  ways; ignored unless `power` is `battery`.
- `pm_node_apply`: battery + relay → keep `RELAY`, still strip
  `BRIDGE` and `CONDUCTOR`.
- `pm_sleep.cpp`: `set_show_tier(on)` with relay → `WIFI_PS_NONE`, no
  wake window, `pm_sleep_listen_ms()` returns 0 (other boards then send
  cues at the normal 200 ms lead and don't repeat into a window). Off
  tier unchanged.
- `hello`/heartbeat: nothing new — `role` already carries RELAY, and
  the config carries `power` + `sleep.relay`.
- Console, board page: under SLEEP, a toggle **Relay for other boards
  while the show runs** with the cost in the same sentence (about 100 mA
  while the show runs instead of ~25; the off tier is unchanged) and
  the caveat (boards behind it are cut off outside show hours).
- Console, Yard: a board whose every route to the bridge passes through
  a battery board shows **via battery relay** in its detail panel and an
  amber note on the topology — `lib/topology.ts` already walks routes.
- Host test: config JSON round trip with `sleep.relay`; `test_pin_config`.
- Docs site: a "Using a battery board as a repeater" section on the
  battery page: when to leave *On battery* off (big battery, short
  season), when to use the relay toggle (weeks on a battery), what the
  boards behind it lose after hours.

**As built (2026-10-14).** Exactly the design above. Firmware:
`PmNodeConfig.sleep_relay`; `pm_node_apply` keeps RELAY for it;
`set_show_tier` with relay leaves the radio on (`WIFI_PS_NONE`, no wake
window) and `pm_sleep_listen_ms()` reports 0, so the bridge treats it
like a mains relay during the show; changing the setting mid-show leaves
the tier so it re-enters the right way; `hello.relay`. Host test
`test_battery_repeater_setting_round_trips`. Console: the toggle under
SLEEP (the listen row dims when it's on); the simulator now gives
battery boards the leaf / relay role the firmware does; `topology.ts`
walks the routes a second time without passing through battery
repeaters, and whoever that misses gets `viaBattery` — the Yard header
counts them ("☾ N via battery relay") and the detail panel says which
repeater and what that means. Checked in the simulator with Skeleton as
a repeater: Porch lantern (reached only through it) is flagged. Not on
hardware.

**Other tricks, considered**
- **A relay that listens in windows (modem sleep + RELAY).** The
  bridge already repeats cues and hold-awake bursts across a leaf's
  interval, and a windowed relay would catch those. But heartbeats and
  beacons go out once per 5 s and are not repeated: at 100/1000 ms it
  hears ~10 % of them, so every board behind it loses the bridge within
  30 s and starts scanning channels mid-show, and the console shows
  them red. Fixing that means repeating every mesh-wide frame through
  the window — a protocol change for a 4× saving. **Rejected** for now;
  the schedule-gated relay gets most of the benefit with no protocol
  change.
- **CPU at 80 MHz on battery boards** (`setCpuFrequencyMhz(80)`).
  Saves roughly 10–20 mA of the ~100; WiFi needs ≥ 80 MHz, LEDC and RMT
  run from the 80 MHz APB clock so servo/strip timing is unaffected;
  the fire effect's math gets slower. **Worth trying after a baseline
  measurement**, not before: cheap, but unverified, and it touches
  every battery board.
- **Automatic light sleep** (`CONFIG_PM_ENABLE`, §6g "the real lever"):
  the CPU would sleep between frames while the radio listens; the radio
  is the larger draw, so the saving is the CPU's ~30 mA at best. Needs
  the SDK rebuilt. Winter.
- **Lower transmit power.** A relay transmits for milliseconds per
  frame; the receive current dominates. **Negligible**, skip.
- **The Feather's USB-chip floor** (§6f): ~6.5 mA around the clock from
  the CP2104 with no host. On a repeater that sleeps 19 h a day it is
  most of the off-tier cost; the D− pull-down fix is the single biggest
  win after the relay mode. Measure before and after.
- **Charging.** The Feather's charger is 500 mA: 10,000 mAh takes ~20 h.
  Charge big packs off-board, or run the Feather from a **USB power
  bank** on its USB port — at ~100 mA most banks don't auto-off (the
  deep-sleep floor is another story: many banks switch off below
  ~50 mA, so a power bank suits the always-on setup, a LiPo on the JST
  suits the relay mode).
- **Solar.** 100 mA × 5 h ≈ 2 Wh a night; a 5–10 W panel covers that on
  most October days. A future note once something has been measured.
- **Just use mains.** A porch-light socket-to-USB adapter or an outdoor
  extension with a USB charger beats every trick above, where it
  exists. The battery repeater is for where it doesn't.

**Synchronized check-ins (built 2026-10-14, one grid for every battery board — Colin; simulator and host tests only).** Colin:
battery repeaters should check in *at the same time*. Today a board
sleeps `checkin_ms` from whenever it fell asleep, so the moment drifts
with every sensor wake, console hold and dwell; two repeaters in a
chain almost never wake together, and a board two repeaters deep is
unreachable after hours even at check-in time. Design:
- **Wake on a UTC grid**: the next multiple of `checkin_ms` since
  midnight UTC, not "now + checkin_ms". Boards with the same period wake
  together; a 10-min board meets the 5-min ones every other slot. A
  sensor wake or a console hold no longer shifts it. Schedule windows
  still win (wake 5 s before one, as now).
- **Guard for clock drift.** The deep-sleep timer runs from the chip's
  internal RC oscillator (no 32 kHz crystal on the Feather or the
  SuperMinis): roughly 1 % off, temperature-dependent — ~3 s over 5 min.
  So wake `guard` early and stay until `guard` after the slot plus the
  dwell. Start with guard = 1 % of the sleep + 1 s. Later: each wake
  compares its clock with the conductor's beacon, keeps the error in RTC
  memory, and corrects the next sleep — that shrinks the guard to ~1 s
  and the cost back to today's.
- **Cost** with the fixed guard: ~6 s more awake per 5-min check-in,
  roughly 2 mA → 4 mA average in the off tier. Worth it only for boards
  that relay or sit behind a relay; leaves could keep the old rule, but
  one rule for all battery boards is simpler to explain. Decide at
  build time.
- **Console**: the bridge knows the grid, so a request for a sleeping
  board can say "next check-in 21:35:00" and be queued to go out in that
  slot, instead of the user retrying blind.
- No protocol change; `checkin_ms` stays per board (the console can
  nudge "boards with the same check-in wake together").

*As built:* `pm_checkin.h` (pure, three host tests in `test_schedule`)
plans the next slot with guard = 1 % of the period + 1 s; `pm_sleep_loop`
sleeps to it whenever the board has a wall clock (else the old "a period
from now"), a schedule window that comes first still wins, and the guard
rides in RTC memory so the timer wake holds `dwell + 2 × guard`. The
console shows "next check-in HH:MM:SS" for a sleeping board (roster
tooltip, Yard) from the same grid (`nextCheckin` in `lib/connection.ts`).
**Not built yet:** queueing a console request to go out in the slot —
today you still retry by hand, but now you know when.

**Shorter check-ins and drift self-correction (built 2026-10-14; host
tests and builds only).**
- *Early release.* A check-in used to hold a fixed `dwell + 2 × guard`
  (14 s at 5 min). Now that is only the ceiling: the first heartbeat goes
  ~0.5 s after a wake (it used to wait 5 s), and the board sleeps again
  once the bridge has been heard and 1.5 s more have passed (time for a
  sync pull to start and hold it). A repeater also stays until
  `slot + guard + 6 s` — the latest a board behind it can wake, plus one
  beacon period — so its saving is smaller; a leaf's check-in should
  drop to roughly 3–5 s (most of it waiting for the next beacon). No
  bridge heard: the old ceiling applies.
- *Drift.* The wall clock rides through deep sleep on the same RC
  oscillator as the wake timer, so the jump it takes at the first
  conductor beacon (`pm_wall_first_step`, recorded in `pm_mesh.cpp`)
  over how long the RTC thought it slept is the oscillator's error.
  Measured each wake (sleeps ≥ 60 s, jumps within ±5 %), blended 3:1
  with the last value, kept in RTC memory; the next sleep asks for
  `real × (1 + ppm)`. Once measured the guard drops from 1 % to 0.3 %
  of the period + 1 s (4 s → 1 s at 5 min). Pure math in `pm_checkin.h`,
  two more host tests.
- *Visible:* `hello.awake_ms` (how long the last wake lasted) and
  `hello.drift_ppm`; the Yard's detail panel shows them as **LAST
  CHECK-IN**, and the serial log prints both at every sleep. That is
  the bench check without a meter: watch `awake` fall to a few seconds
  and the clock error settle after two or three check-ins.

**Bench test without a battery.** *On battery* is a setting, not a
sensor: a board on USB power sleeps and relays exactly as on a cell, and
every build carries deep sleep, so the repeater can be tested on two
DevKits plus the bridge, all on USB chargers. Only the current and
runtime figures need a real battery and a meter. (2026-10-14: both of
Colin's Feathers have damaged chargers; a reversed-polarity LiPo is the
likely cause.)

**Bench test (to write once built):** Feather on a 2,000 mAh LiPo,
relay toggle on, schedule with a 10-minute window starting 3 min out, a
DevKit placed out of the bridge's range but within the Feather's. Watch:
the DevKit appears on the roster only once the Feather is awake and
relaying; a cue from the bridge reaches the DevKit at the normal lead;
at the window's end the Feather deep-sleeps and the DevKit turns red
within ~20 s; before the next window the Feather wakes first and the
DevKit comes back. Meter on the Feather in both tiers.

## 6n. Electric candles (built 2026-10-15, simulator and host tests only)

Colin's prop: a flameless candle with a plastic flame on a pivot, lit by
one plain LED, swung by a small coil (YMT-LZ06 board, its controller
removed), with an ESP32-C6 SuperMini inside. A sketch from another
session drove it directly (`reference/candle_esp32.ino`); this brings it
into PropMesh so it turns on and off, and is tuned, from the console.

- **Why not the strip fire effect.** Fire2023 is a 2-D pixel
  simulation for addressable strips; the candle is one PWM LED and a
  coil. The sketch's flicker was written for exactly this hardware and
  couples the coil to the gusts, which is what sells it.
- **A NeoPixel instead of the LED** was considered: a sharpened
  through-hole WS2812 for color, powered straight from the LiPo (no
  level shifter needed at that supply), optionally ground-switched by an
  AO3400A with the data pin released when off. Shelved for this year
  (Colin, 2026-10-15): the pixels on hand are 5 mm and the candle LED is
  smaller. The design is here for later; it would be a `candle` effect on
  a 1-pixel LED_STRIP plus a coil pin.
- **Function `CANDLE`** (ChannelKind 9): pins LIGHT (LEDC, 1 kHz, 12-bit,
  gamma 2.2; `active_low` for a board that sinks the LED) and COIL (plain
  GPIO into the candle's transistor). Value 0–1000 = brightness of the
  flicker, 0 = out; it ramps like an LED dimmer. 1 LEDC channel.
- **Model** `pm_candle_core.h` (pure, host-tested): the sketch's four
  LED layers (wander, shimmer, gusts, sputters, exponential gaps) and its
  coil pattern (bursts of 3–5 kicks at the swing frequency then 0.5–1.5 s
  rest; during a gust, continuous in-phase kicks 1.4× wider). Seeded
  xorshift instead of `esp_random` so tests are repeatable.
  `PmCandleCfg`: drama10, floor %, gust_s, sputter_s (0 = never),
  swing_chz, kick_ms (4–80), coil. Validator issue `candle_settings`.
- **Driver** `pm_candle.cpp`: ticks every 5 ms from `pm_channels_loop`;
  each coil pulse is ended by a one-shot `esp_timer`, not the loop, so a
  stalled loop can't leave the coil energized; off / STOP ALL / release
  stop the timer and drive the coil low. Allocated on the heap only when
  a candle is assigned. `{"cmd":"candle","index":N,"event":"gust"|"sputter"}`
  fires one now (the console's test buttons).
- **Dropped from the sketch:** the 4 h / 8 h auto-off and its mode switch
  (the schedule does it), battery compensation (wants a board-wide
  battery sense — on the list), the IR input, the serial tuning keys.
- **Cost:** static RAM +~450 B on the classic ESP32 builds (the candle
  settings ride in every channel slot): HUZZAH32 96.5 KB, ~1.3 KB under
  the limit. Flash +~8 KB.
- **Open hardware question:** in deep sleep the coil pin floats. If Q3's
  base has no pull-down on that board, add 10 kΩ to ground (the site page
  says so) — or the firmware will need to hold the pin through sleep.
- **Swing finder (2026-10-16).** Colin couldn't find the flame's rate by
  editing and saving. The sketch had a "steady kick" key for this; now
  `core.tune(chz)` kicks every cycle at `chz` with no rests and no gust
  pumping, `{"cmd":"candle","event":"tune","chz":285}` (0 stops), and the
  driver stops it after 2 min (`PM_CANDLE_TUNE_MAX_MS`) or on Out. The
  console's **Find the swing…** sweeps 1.00–5.00 Hz by 0.10 every 2.5 s,
  ± nudges by 0.05; a KICK row nudges the pulse width by 2 ms (`"ms"` on
  the tune command, rides along without saving) — the method is: at the
  found rate, shorten until the swing shrinks, then one step back up;
  **Use** writes `swing_chz` and `kick_ms` into the draft. While tuning
  the LED holds steady (85 % of the set level): with the flicker running
  Colin couldn't tell whether the flame moved at all (2026-10-16). Host test: 57
  kicks in 20 s at 2.85 Hz, never the gust width, a trial width applies.
- **First run on the candle (2026-10-16, Colin).** C6 (e076df14) with
  LED on GPIO 1 (on = LOW) and coil on GPIO 2, build 8022b97. The LED
  flickers. The finder's sweep didn't step (timer reset on every render —
  fixed, PR #28) and the flicker hid any flame motion (LED held steady
  while tuning, PR #27). With the sweep working, Colin measured the
  drive pulsing at the 2.70 Hz shown, but saw **no flame movement — not
  even with GPIO 2 held on for 2 s as a relay.** So the coil isn't acting
  on the magnet: either not energized (Q3 not switching from 3.3 V
  through R2, or its supply cut when the stock chips came off) or
  mechanical (flame piece stuck, magnet out of reach, open coil). Next:
  meter across the coil leads during a hold; coil leads briefly across
  the battery with the board off; flame piece swung by hand (count the
  swings: that is the resonant rate). If Q3 won't switch from 3.3 V, an
  AO3400A in its place, driven straight from the pin. Colin then noticed
  the stock drive rests between sets of kicks; a centered magnet gets no
  sideways torque from a steady pull, so the 2 s hold was a weaker test
  than claimed, and the finder gained **Bursts** (`"burst": true` on the
  tune command: the normal 3–5-kick sets with rests, at the tuned rate
  and width). To be tried.
- **Found it (2026-10-16, Colin with the meter):** the coil wasn't getting
  current. *Measured:* holding GPIO 2 on as a relay, the coil saw a 2 V
  spike that fell to under 0.1 V, the candle LED went out and the
  SuperMini's charge LED lit — the rail collapsing. Coil 26 Ω (140 mA
  from a LiPo if fed directly). Power off: BAT+ → coil+ **180 Ω**, coil+ →
  LED+ **67 Ω**, the added 100 Ω LED feed reads **117 Ω** in circuit.
  *Inferred, not seen:* 117 + 67 ≈ 180, and the only resistors on the
  board that make 67 are a 47 and a 20 — so the coil's supply reaches it
  through the LED node and those two, a chain the removed charge pump
  presumably used to drive. **Fix that doesn't depend on the inference:**
  switched BAT+ straight to coil+ (the coil's own supply lead), and lift
  one end of either the 47 or the 20 so battery voltage on coil+ can't
  feed the LED a second way (it would double the LED's ~12 mA). Verify:
  BAT+ → coil+ ≈ 0 Ω, coil+ → LED+ open. Kicks are then 140 mA; a
  resistor in the new wire tames it if too strong. Designator noted by
  Colin: **R5** (which one — to confirm). Lesson: a 2 s hold is only a
  valid coil test when the coil's supply can source it; here it never
  could.
- **Working (2026-10-17).** Colin confirmed the chain by continuity (the
  20 Ω's far pad shares a node with one end of the 47 Ω), lifted the 47 Ω,
  wired switched BAT+ to that node — the 20 Ω stays as the stock coil
  limit — and **the flame swings.** First coil-driven motion from
  PropMesh. Finder result on this candle (read back from the board's
  config, 2026-10-18): **swing 3.35 Hz, kick 40 ms**, LED on GPIO 1,
  coil on GPIO 2, both active-low.
- **Brownout after an update (2026-10-18).** Two OTAs of the rest-sway
  build in a row finished (`end ok` after 389 s and 314 s) and the candle
  came back on the *previous* build, reset reason `brownout (supply
  sagged)`, uptime about 18 s at the first hello — so the new image died
  within seconds of its first boot and the bootloader rolled back. The
  image itself is not the suspect: the only firmware changes since the
  build on the board are inside the candle model (drafts, rest sway);
  nothing new runs at boot. Between attempts the board ran for minutes
  with no further brownout, and the candle output was off (coil cold)
  throughout. The asymmetry that makes this look like "the new build
  fails" is the rollback rule: a fresh image gets **one** boot to prove
  itself, while the old image may brown out at boot and simply retry.
  So the likely cause is a supply that is marginal at the C6's boot
  surge (radio start, a few hundred mA for a moment), and the candle
  board's switched BAT+ path (its slide switch, traces, Colin's wires)
  plus the SuperMini's LDO headroom at 3.9 V decide whether a given boot
  survives. Battery read 3.99 then 3.92 V during the attempts, well above
  any limit, so it is sag under the surge, not a flat cell. To check and
  fix: where the SuperMini's 5V pin is fed from (BAT+ side, not the LED
  node); a 100–470 µF capacitor across the SuperMini's 5V and GND, as
  close to the board as possible; short, thick feed wires. A software
  softening worth adding later: stop the radio and switch outputs off a
  moment before the OTA restart so the supply is at rest when the surge
  comes. `tools/bridge.py ota` now reports a rollback in plain words with
  the uptime and the seconds since `end`. **Third attempt, same result:**
  `back: 2ecf9a9 … brownout … up 11 s, 15 s after end`. The restart is
  1 s after `end`, so the new image lived under 3 s: it dies during
  start-up (the radio comes up in the first second), every time, while
  the old image then boots and runs on the same supply. Three for three
  is not luck, so something about the *first* boot of a fresh image is
  different, and the two candidates are: the supply right after five
  minutes of flash writing and radio traffic (a sagged cell plus a lossy
  feed path), or a boot-after-software-reset difference (a brownout
  reset follows a hold-off with the load gone). The test that separates
  them: run the same OTA with the SuperMini fed from a USB supply instead
  of the candle's cell — if it takes, it is the supply, and a 100–470 µF
  capacitor at the SuperMini's 5V/GND plus a direct, short feed from BAT+
  is the fix; if it still rolls back, the fault is in the restart path
  and the firmware should stop the radio, hold the output pins off and
  pause half a second before the restart. The browser installer over USB
  is the way to get this build onto the candle meanwhile. Nothing is
  broken: the candle runs the previous build as before. (A further
  brownout reset and readings jumping between 3.1 and 4.2 V later that
  evening were Colin handling the candle and its battery lead — not
  evidence either way.)
- **Running on the cell (2026-10-18 evening).** The candle's board is set
  to *mains* power, so it never sleeps and the radio runs all day: the
  cell read 3.99 V at 02:40 and 3.53 V at 21:00, and at that level the
  board browned out (reset eight minutes before the reading) and came
  back with the output off — "the candle went out". Two fixes, neither
  firmware: tick **On battery** for the board, so it deep-sleeps outside
  the show and listens in windows during it (the LED and coil keep
  running; only the radio naps); and give it an **ambient loop** — one
  sequence, one step, Candle 1 → full, *Ambient loop* every 10 min. The
  show's mode machinery then owns the candle: it lights whenever the
  show is Ambient or Armed, including seconds after a restart (ambient
  loops start on entering a mode), and goes out with Off, the schedule
  or STOP ALL. A per-output "on at boot" would fight exactly that
  machinery, so it is not added. Documented on the site's candle page.
- **The wobble follows the flicker (2026-10-17, Colin's ask).** First cut:
  sets of 2–6 kicks with rests and lulls, pumping scaled by the gust
  envelope. On the candle: *less* motion, and a violent flicker couldn't
  build momentum in time — a pendulum needs several swings, and the rests
  let it die. Now: at rest, runs of 4–10 kicks whose strength drifts
  0.6–1.0×, 0.2–0.6 s pauses, one kick in ten skipped — the swing never
  dies (2026-10-18: lifted to 0.75–1.0×, 0.15–0.45 s pauses, one in
  fourteen skipped — the resting flame read as a touch too still); from
  400 ms *before* a gust's dip (the firmware schedules the
  gust, so it knows) to 1.2 s after, in-phase kicks at kick × (1 + 0.7 ×
  drama), ×1.15 in a sputter, capped at 100 ms. **On the candle
  (2026-10-17): "looking how I envisioned" — Colin.** Host test
  `test_coil_follows_the_flicker`. The console's CANDLE row has a **?**
  that explains every knob and links the site page.
- **Bench test (to do):** C6 in the candle, LED and coil assigned, LED on
  = LOW. Watch: Light → steady flicker with occasional gusts; Gust → quick
  dips and a big swing; Sputter → near-blowout, stutter, flare; tune
  swing ±0.05 Hz for the largest motion and note the value; Out and STOP
  ALL → dark and still, coil cold; a 30-minute run with a finger on the
  coil for heat.

- **Drafts (2026-10-17, Colin's ask):** candles in the same `draft` (1–8,
  console A–H) gust and sputter together, on any board. No message: each
  mesh second is a lottery, `hash(draft, second) % gust_s == 0` starts a
  gust in that second (same odds as the local timer, ~1/gust_s per
  second) and the hash picks its depth, length and speed, so every
  candle in the draft runs the same gust from the same instant (the mesh
  clock agrees to ms); sputters likewise with `sputter_s`. Shimmer, wander
  and the coil's drifting strength stay individual. Without a conductor
  (`pm_time_synced()` false) a candle falls back to its own timers. The
  coil's 400 ms pre-gust pump is off in a draft (the gust isn't known
  ahead). Host test: two candles in draft 3 never disagree over an hour;
  draft 4 is independent.

## 6o. Battery voltage from a divider (built 2026-10-17, not on hardware)

Colin added a resistor divider to the C6 in the candle. New function
`BATTERY` (ChannelKind 10): one ADC pin (`need: adc`), config
`divider` (float, stored ×100, 1.0–20.0; validator `battery_divider`),
one per board (`battery_dup`). The driver samples 8× every 2 s and keeps
mV at the battery as the channel's value (read-only, like DIGITAL_IN).
`pm_channels_battery_mv()` feeds the heartbeat's `battery_mv` when the
board profile has no sense pin of its own (the Feather's wins). Percent:
`pm_battery.h` `pm_lipo_pct()` — a resting 1S lithium curve in 5 % steps,
mirrored in `console/lib/battery.ts`; shown as "3.87 V · 62 %" in the
TEST column (re-read every 5 s while the page is open), the roster and
the Yard. Host tests: curve endpoints, 50 % at 3.84 V, monotonic; config
round trip, ADC-pin rule, divider range, one per board. Site: "Reading
the battery on a board without a sense pin". Not calibrated against a
meter yet: the C6's ADC and the resistors' tolerance both move the
reading — compare with the meter and adjust the divider value. **On the
candle's C6 (2026-10-17):** console 3.79 V against the meter's 3.83 V with
two nominally equal resistors — 1.1 % low, within tolerance; divider
2.00 → 2.02 corrects it.

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
`-DPM_BOARD_PROFILE=PM_BOARD_<ID>`. The C3 SuperMini was added
2026-10-14 (§6l).

## 8. Plan (October 2026)

| Stage | Target | Scope | Test |
|---|---|---|---|
| **1 — one devkit on USB** | ~Oct 8 | everything above | §7 |
| **2 — config over the mesh** ✍ written 10-05 | ~Oct 15 | the USB node forwards requests to other node ids over ESP-NOW (`SET` + chunked `CONFIG` messages in `schema/`); real heartbeats replace the console's mock node list | one devkit on USB, two on wall power; configure and test-fire the remote two |
| **3b — schedule** ✅ built 10-09, bench test §6e pending | ~Oct 20 | §6e: wall clock in `TIME`, `set_clock` on connect, `set_schedule` windows (sunset ± offset from lat/lon), modes `off`/`ambient`/`armed`, ambient sequences loop, Schedule panel | two boards on the shelf with the clock set to 16:50 local: ambient sequence starts at sunset − 60, triggers go live, lights-only at 21:30, all off at 22:30; STOP ALL at 20:00 stays stopped until 21:30 |
| **3 — triggers** ✍ written 10-05 | ~Oct 22, **then freeze** | per-node rules: `DIGITAL_IN_n` → timed step list (`t_ms`, channel, value, `ramp`) with cooldown; steps on other nodes go out as a `CUE` at mesh time T | shelf rehearsal (PIR on A → servo on B + relay on C), then a yard dress rehearsal ≥ 1 week before Halloween |

**Cut line:** if Stage 2 isn't solid by Oct 15, the show runs Stage 1
nodes with per-node configs and same-node triggers only. No new
features after Oct 22.

## 9. Known gaps

- **Fixed 2026-10-11 — a board "never came back" from a WiFi update.**
  Prop's serial log showed it: the join failed (stale password in the
  panel), and the failure path turned the WiFi driver off and on to get
  back to the mesh channel, which silently deleted the ESP-NOW
  registration — every mesh send then failed ("esp now not init") until a
  power cycle, with the loop running fine (so no watchdog). Now the
  failure drops the AP only, re-registers ESP-NOW (`pm_mesh_recover`),
  and logs the WiFi status. Also fixed: a *successful* same-build update
  read "didn't come back" — the panel now counts an uptime restart.
- **OPEN — the bridge went dead during servo slider moves (2026-10-08).**
  Console over WiFi, sliding one servo on Skellitor Head; within 5–10 s
  the bridge dropped off WiFi and the mesh and stayed dead (no reboot)
  until power-cycled. Prop and Heads kept running (uptimes intact). Not
  reproduced on 2026-10-08 with a serial log attached (3 min of sliding).
  Every board now runs under the task watchdog (verified attaching:
  "wdt: watching the main loop") and reports its reset reason, so a
  repeat reboots itself and says why.

- **OPEN 2026-10-11 — the bridge froze updating ITSELF over the mesh
  path.** Console on WiFi, Bridge → *Update (last)* in "Over the mesh"
  mode: stopped at 43 %, the bridge dropped off WiFi (no ping) for 2+
  min and needed a power cycle — so its reset reason read "power on" and
  the cause was lost. Prop updated over the mesh the same session
  without trouble. Suspects: the WebSocket server (3.7 kB frames) while
  the flash writes, or WiFi not rejoining after a watchdog reset.
  **Workaround: update the bridge with "Over WiFi"** (it downloads the
  image itself, no per-chunk round trips). To diagnose a repeat: USB
  cable + serial monitor during the update. **Retried the same day with the
  bridge on laptop USB power and a serial log: the identical transfer
  over WiFi took 58 s (~100 ms a chunk, no stalls), installed and
  confirmed.** So the freeze didn't reproduce; suspects now are the
  bridge's own power supply (flash writes + WiFi transmit are its peak
  draw) and the task watchdog not watching the loop (boot log:
  "esp_task_wdt_reset: task not found") — firmware now prints at boot
  whether the watchdog is watching.

- **Fixed 2026-10-09 — mesh updates to a weak-link board never
  finished** (Prop at −69 dBm, failing partway, every time). The bridge
  tries each 2.7 kB chunk 3 times and then answers "no reply from node
  …"; the console treated that one answer as fatal, cancelled the
  transfer on the board, and the next try started from zero — over ~490
  chunks one bad patch is near-certain. Now (console `lib/ota.ts`) a
  lost chunk is re-sent, only 3 minutes with no progress gives up, and
  a failed transfer is left on the board; pressing Update again with the
  same image **resumes** where it stopped (firmware `pm_ota_begin`, kept
  10 min). A lost reply to the final install step no longer reads as a
  failure. The Update panel asks each board `ota_status` when it opens,
  so a transfer interrupted by a page refresh shows "paused at N %".
  The retry fix is console-side and helps boards on older firmware too;
  resume needs the new firmware.
- **Fixed 2026-10-09 — the console showed what it last clicked, not
  what the boards are doing.** Audit of every piece of board state the
  console holds: STOP ALL was a page-local flag (a refresh after STOP ALL
  showed the show running); the Cues mode badge was read once per visit
  (a scheduled change at 21:30 didn't show); the update panel forgot a
  half-sent image on refresh; the sidebar called a WiFi connection
  "SIM". Now every board's `hello` carries its mode block and is re-asked
  every 15 s (`lib/connection.ts`); STOPPED = every board reports off
  *by hand*; the badge uses the live status. Checked and already right:
  flood colors, Yard values, pin-editor values, the light search,
  sequences, triggers, schedule, pin config (all read from the boards).
  The activity log is events since connecting — boards keep no history.

- **Fixed 2026-10-06 — timeline/step-list editing bugs** (found by
  Colin; reproduced in Chrome with real mouse and keyboard input):
  (1) double-clicking ON a line to add a key toggled the later key's
  ramp off on the first click, wiping its easing — a click on a line now
  only selects, R toggles; (2) steps were tracked by list position, so
  a key added between two others went to the end and edits could land on
  the wrong step — steps now carry a console-only uid and the list is
  always in time order (a typed time re-sorts when the field loses
  focus); (3) the two ease number boxes adjusted each other (50/50 is
  already 100) — replaced by a two-handle bar; (4) Fit re-scaled the
  view on every edit, shifting keys under the pointer — Fit is measured
  when a sequence opens or Fit is pressed, then held; (5) a background
  reload as boards reported in could wipe a new unsaved sequence, and a
  saved one could still show "unsaved" — reloads keep unsaved edits and
  "unsaved" compares content, not JSON key order; (6) a ramp typed or
  re-timed in the list could overlap the previous key's — every edit
  clamps a ramp to the gap back to the previous key on its output;
  (7) the arm badge said DISARMED before any board had answered.

- **Fixed 2026-10-05 — Stage 3 firmware crash-looped every board.**
  `show = PmShow()` built a 19 KB temporary on the 8 KB loop-task stack;
  the overflow corrupted the WiFi task (StoreProhibited / lwip assert /
  watchdog resets before the first print). Host tests can't see it — a
  PC has megabytes of stack. Now cleared in place, and `firmware/node`
  builds with `-Wframe-larger-than=3072` (it flags the old line as a
  19 248-byte frame).
- **Fixed 2026-10-05 — `get_sequence {id}` collided with the request
  id.** Sequence ids are now `seq`; the console refuses a body field
  named `id`. Hardware check after both fixes (3 boards): parts
  stored and validated (a step for a servo a board lacks is refused);
  cue from the bridge and from a remote board both ran the heads
  board's steps on time; disarm refused cues, re-arm restored; a part
  survived a reflash + reboot.

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

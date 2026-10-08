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
  from the colour's peak (the colour goes out at full scale with a
  0–127 brightness, as the lights expect). Shows up everywhere an
  output does: test colour picker, sequences and the timeline (colour
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
  20/100 answered everything and heard nothing. Colours pause while
  searching/pairing. After an 8 s search the mesh answered 20/20.
- **Encoder:** `pm_brmesh.h`, header-only; host tests compare it
  **byte-for-byte** with the reference code that drove the lights.
- **Radio:** no Bluetooth host stack — `pm_ble_tx.cpp` drives the BLE
  controller directly over VHCI with three HCI commands (advertising
  parameters 20 ms / non-connectable, advertising data, enable). The
  controller is started in BLE-only mode (the framework default is dual
  mode; enable must match). `btInUse()` is overridden so the Arduino
  core keeps the controller's memory (≈3 KB of heap observed). Each
  light's newest colour goes out as a 200 ms advertising burst; a colour
  that changes again before it went out replaces the queued one, so a
  dragged picker never builds a backlog. Flash 78 % → 91 % of the app
  partition.
- **Measured** (Prop board, test light with a dummy key, before pairing existed): controller
  confirmed 125 HCI commands, 0 failed; 41 colour bursts for 50 colour
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
  all three answered colours on the new key — but **no light ever came
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
name lights, test colours (sent to every sender), forget a light. Saving
writes the same key and the same `BLE_LIGHT` channels (index = light
number) to every ticked board and strips them from unticked ones. A
board's own page no longer shows its flood lights, only a pointer to the
tab. In Cues the floods are one pseudo-node, **Floods**: `loadShow`
collapses each sender's copy of a flood step to one and hides the boards'
`BLE_LIGHT` channels; `saveSequence` writes a flood step into every
sender's part; live sliders fan out to every sender. If two boards hold
different keys the tab says so and offers to spread either one.

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
never transmits, so neither its colour nor whether it is powered can be
asked. The Floods tab shows what the sending boards last *sent* (`state`,
remembered until a board reboots) — wrong if the light was power-cycled or
set from the BRMesh app. Before this the tab started every light at "off",
and moving a slider jumped the light.

**White — DONE (bench 2026-10-07, Melpo RGBW):** white is a *mode*, not
a channel. Bytes 6 and 7 both 127 switch the light to warm white and the
brightness byte sets its level; partial values in 6/7 do nothing, and a
frame carrying RGB *and* white is rejected outright (not even the colour
shows). Values are `0xWWRRGGBB`: W 1–127 = white at that level (RGB
ignored), W 0 = colour. The picker's white slider replaces the colour and
vice versa. A fade between a colour and white snaps to white as soon as
W > 0.

**Frame layout, decoded:** the "command byte" is type 2 | length<<4 —
`0x72` = light command of 7 bytes, `0x22` = 1-byte off. The header's low
nibble is the high part of a 16-bit address in the app's code; the lights
**ignore it** (0x101 and 0x801 both drove light 1).

**Fade smoothness — measured:** bursts of 200 and 100 ms are caught every
time, 60 ms drops steps → default **100 ms**. Colour ramps now run on the
board (`pm_lerp_colour`, per component) and reach the radio (raw_out had
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
with no laptop and no bridge. A trigger: "when `DIGITAL_IN_n` becomes
active (or clear), play sequence N; then ignore this trigger for
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
| `set_rules` | `rules[]` of `{input, on: "active"\|"clear", seq, cooldown_ms, enabled}` | — (replaces all this node's triggers) |
| `cue` | `seq`, `offset_ms?` | — (fires show-wide from this node; refused while disarmed) |
| `arm` | `on` | `armed` |

Event: `{"evt":"cue","node":<who fired>,"seq":N,"cue":id,"armed":bool,"here":bool}`
— the USB node hears every cue on the mesh, so the console's activity
log shows each one with the sensor change that caused it.

**Timeline** (2026-10-05 — software-plan §6 item 5, pulled forward
from 2027). Above the step list, the same steps drawn as keyframes:
time across, value up, **one track per output** (servo/LED/motor as a
0–100 % line, motor −100…+100, relay on/off, strip as colour bars).
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

**Console → Cues.** Sequences list; step editor (time, board, output,
value, *get there over* + easing for rampable kinds — sliders for servos/LEDs/motors, on/off for relays, colour for
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
  build with its git commit (`PM_BUILD`, "+" = dirty tree) and writes
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

## 6d. WiFi bridge — decided 2026-10-07, not yet built

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
  wasn't enough: neighbouring channels overlap, so at bench range Prop on
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
| **3 — triggers** ✍ written 10-05 | ~Oct 22, **then freeze** | per-node rules: `DIGITAL_IN_n` → timed step list (`t_ms`, channel, value, `ramp`) with cooldown; steps on other nodes go out as a `CUE` at mesh time T | shelf rehearsal (PIR on A → servo on B + relay on C), then a yard dress rehearsal ≥ 1 week before Halloween |

**Cut line:** if Stage 2 isn't solid by Oct 15, the show runs Stage 1
nodes with per-node configs and same-node triggers only. No new
features after Oct 22.

## 9. Known gaps

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

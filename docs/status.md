# Project status and handoff — 2026-10-13

**Start here** when picking the project up on another machine or in a new
session. This is the one place that says where things stand; the details
live in the docs it links to. Update it when a bench test runs, a feature
lands, or the plan changes.

- **Software** (firmware, console, docs site, tools) moves to Colin's home
  server. **Hardware** (KiCad, `hardware/`) stays on the Mac.
- Designs and decisions: [`software-plan.md`](software-plan.md) (architecture,
  console, licensing), [`generic-boards.md`](generic-boards.md) (the firmware
  that runs today, its serial/WS protocol, every feature's design note and
  bench result), [`hardware-spec.md`](hardware-spec.md) (Pro / Mini boards).
- Working rules for Claude: [`../CLAUDE.md`](../CLAUDE.md).

## 1. Where things stand

**The October 2026 show runs on off-the-shelf ESP32 dev boards** with the
generic-board firmware (`firmware/node`). The Pro v0.1 PCB is after
Halloween. The software freeze was dropped (2026-10-12): push software as
far as it goes, every step shippable.

Built and working on Colin's yard boards (bridge, "Prop", "Skellitor
Head", Feather):

| Area | State |
|---|---|
| ESP-NOW flood mesh, conductor time sync, channel follows the bridge | ✅ hardware |
| Pins assigned from the console; relay, LED, servo, motor, WS2812, sensor | ✅ hardware |
| Bridge on home WiFi; console over WebSocket (port 81) or USB | ✅ hardware |
| Sequences (timeline editor), triggers v2 (delay, cooldown, lockout, random, after-sequence chains), Show Graph | ✅ hardware (chain fired 2026-10-12) |
| Schedule with sunset/dusk offsets, modes off / ambient / armed, STOP ALL | ✅ runs; formal bench test still listed in generic-boards §6e |
| Show follows the conductor: edit stamps, newest wins, boards pull what they missed | ✅ hardware 2026-10-12 (§6k) |
| BRMesh Bluetooth flood lights: pairing, sending boards | ✅ hardware |
| OTA over the mesh and over WiFi, resume after interruption | ✅ hardware |
| Yard: topology, map with drawing tools and clip art, map stored on the bridge | ✅ hardware |
| Battery boards: leaf role, listen windows, deep sleep, wake pins | ✅ built; Feather partly tested |
| SK9822/APA102 clocked strips + fire effect (FastLED Fire2023 math) | built, **not on hardware** |
| pm_ws2812 (WS2812 on the IDF RMT driver, replaced NeoPixel) | built, **not on hardware** |
| ESP32-C6 SuperMini profile + NimBLE floods | mesh, OTA, candle, battery sense ✅ hardware 2026-10-15..17; floods, sleep, strips still untried |
| ESP32-C3 SuperMini profile (GPIO deep-sleep wake path) | built 2026-10-14, **never flashed** |
| Battery repeater: relay during the show, sleep outside it (generic-boards §6m) | built 2026-10-14, **simulator only** |
| Battery voltage from a resistor divider (`BATTERY` input, LiPo percent; generic-boards §6o) | ✅ hardware 2026-10-17 (C6 in the candle; 1 % low before the divider tweak) |
| Electric candle output (flicker LED + flame coil, from the candle sketch; generic-boards §6n) | ✅ hardware 2026-10-17: flicker, swing finder, wobble that follows the flicker, on the C6 in the candle |
| Board `variants` notes (sellers' versions) on site pages and in the console Pinout panel | ✅ built 2026-10-14 |
| Docs site https://mrwillson2u.github.io/propmesh/ with browser flasher and hosted console (`?sim=1`) | ✅ live; flasher **not yet used on a real board** |

Branches: work goes to `dev` by PR; `main` takes PRs from `dev` only and
publishes the site. The site text was audited and rewritten 2026-10-13
([`site-audit-2026-10-13.md`](site-audit-2026-10-13.md)); it goes live
on the next `dev` → `main`.

## 2. Bench tests waiting for Colin

- **Sleep management on a candle (2026-10-26, branch `sleep/check-ins`).**
  Flash one C6 candle with the branch build. Watch for: (1) after
  switching it on, its row reads "awake for you · 2:59 left" and it
  stays reachable 3 min before sleeping; (2) once asleep, **⏰ Stay awake
  next time** on its page → at its next check-in (≤ 5 min) it reads
  "awake for you · 10:00 left"; (3) **⏻ Power off** → its LED goes out,
  the row reads "switched off", and it only comes back with reset or a
  power cycle; (4) unplug another candle while asleep → within one
  check-in its row reads "off or unplugged? (signal was …)".
  `docs/console-nodes-list.md` §9.

- **Battery drain rate on a C6 candle (2026-10-24).** Flash a candle
  with a build from `console/node-list` (or the next dev build), run
  it on its cell for two nights, then `python3 tools/bridge.py ask
  <id> hello` while it is awake: expect `batt_mv_per_h` and
  `batt_span_h`, and the Nodes row to read "about N nights left (from
  2 days of readings)". Compare the rate with the candle's measured
  drain in generic-boards §6n. Both firmware builds pass; nothing has
  run on a board. `docs/console-nodes-list.md` §8.

- **A lit candle's `state` value (2026-10-24).** Colin saw a lit candle
  read as "out" when its pins page opened. With a candle visibly lit,
  `python3 tools/bridge.py ask <candle id> state` — CANDLE_1 non-zero
  means the console showed a stale read (the page now re-reads every
  5 s, fixed); zero means the firmware lights it past the runtime
  value (a firmware fix). `docs/console-nodes-list.md` §5.

Run these with the boards in hand. Protocol: write out what to watch,
**wait for Colin's "go"**, make tests self-announcing (CLAUDE.md).

1. **C6 SuperMini** — generic-boards §6g "Bench test (to do)": flash,
   22 pins with 0–7 wake-capable, LED strip on 8, LED on 15, flood sender,
   mesh join, OTA. Open question: does the C6 controller accept the 20 ms
   non-connectable advert interval?
1b. **C3 SuperMini** — generic-boards §6l "Bench test (to do)": 13 pins
   with 0–5 wake-capable, the blue LED on 8 (active low), a strip on 10,
   flood sender, mesh RSSI next to a DevKit (antenna caveat), OTA, deep
   sleep + wake on GPIO 1.
1c. **Battery repeater** — generic-boards §6m "Bench test": Feather on a
   LiPo with the relay toggle on, a DevKit out of the bridge's range;
   the DevKit should appear only while the Feather relays, and drop
   when it sleeps. Meter both tiers.
1d. **Candle: OTA rolls back with a brownout** — generic-boards §6n
   "Brownout after an update": three OTAs of the rest-sway build on
   2026-10-18 each came back on the old build, reset reason brownout,
   the new image dead within 3 s of its first boot. Decider: the same
   OTA with the SuperMini on a USB supply instead of the cell. Then
   either a 100–470 µF capacitor and a direct BAT+ feed, or a gentler
   restart in the firmware. Meanwhile flash it over USB. Also: the
   candle drained its cell to 3.53 V in a day because it is set to mains
   power — tick On battery, and light it with an ambient loop (§6n).
1d2. **Fresh board finds the mesh** — §6d note of 2026-10-21: a new
   C6 on channel 1 took ten minutes to find the bridge on 11. Fix built
   and ✅ tried on that C6 the same night: from channel 1 at power-on to
   hearing the bridge in 64 s. A board on an older build that won't
   show up can still be put on the bridge's channel over USB with
   `{"cmd":"mesh_channel","ch":11}`.
1e. **C6 vs DevKit range** (low priority, Colin 2026-10-17): a C6
   SuperMini and a DevKit at the same spot in the yard, compare RSSI on
   the Yard. Puts a number on the C6's ceramic antenna for its board
   page; the C3 is the one with the known range complaint.
1f. **Bridge mute reboots — cause found and fixed 2026-10-19**
   (generic-boards §6j): the router's once-a-minute mDNS burst made the
   bridge's WiFi driver ask for ~40 KB of receive buffers against 32 KB
   free; under load the failures reached the transmit path. Built in
   PR #34: the show engine only where a board holds a part (bridge heap
   32 → 71 KB, 0 failed allocations since), and recovery as a full
   driver rebuild tripped on evidence after 15 s (bridge away 4 s, no
   reboot). On the bridge and the C6 since 2026-10-19; Skellitor Head
   and Prop get it with the next update. Field check: the watch log on
   the server (`~/propmesh-logs/bridge-watch.log`) should show `fails 0`
   and no `mute` for days. Still open: the AP-mode bridge (longer term),
   and Prop's September mute, which this does not explain. 2026-10-23:
   under load (four nodes, two consoles, an OTA) the bridge still ran
   out, the 15 s evidence rebuild caught it, and the bridge then
   browned out on the server's shared USB hub. **Give the bridge its
   own supply** (done 2026-10-23). The one-in-flight send queue is
   built (PR #47): zero send errors from our own bursts, but the driver
   still fails under an OTA's TCP load with 48 KB free; the 15 s
   rebuild recovers in ~20 s and `bridge.py ota` now resumes across
   it. Done the same night: buffers on demand (PR #54), backpressure on
   OTA chunks and a narrower rebuild trigger (PR #55). Baseline after:
   94 KB free idle, 45 KB at the bottom of a router burst, no failures
   in fifteen minutes. Field check: `~/propmesh-logs/bridge-watch.log`
   staying at `fails 0`, `rebuilds 0` over the coming days, and an OTA
   through the bridge finishing without a rebuild.
2. **The lantern as a node** — §6h: C6, GPIO 20 data / 19 clock, 8 px BGR,
   fire, 2×4 zigzag. Same flame as the old sketch?
3. **pm_ws2812 on a real WS2812 strip** (any ESP32 board).
4. **Feather: Bluetooth floods + deep sleep in one image**, and a battery
   board ticked as a flood sender.
5. **Away-board edit** — §6k: unplug a board, edit a sequence that uses
   it, plug it back in; it should have the edit within seconds.
6. **Schedule** — §6e bench test, formally.
7. **Browser installer** — install from the live site onto each board type
   (C6 especially: native USB). Erase only on a board never set up.

After each: update `status` / `status_note` in `boards/<board>.yaml`
(shown on the site) and the table above.

### Lantern update, and Candle 1's range at 13 dBm

Candle 1 browned out at full radio power on every restart (USB too);
ec0c892 runs such boards at 13 dBm and its update now sticks
(docs/console-nodes-list.md, end of §9). To do:
1. Firmware → My own build →
   `http://ubuntubot.local:5180/firmware-test/esp32-c6-supermini/firmware.bin`
   → Load image → Update the Lantern. Watch for **✓ updated — now ec0c892@check-ins**.
2. Over the next evening, watch Candle 1's row for "missed check-in" —
   7 dB less range on a link that was already weak.

## 3. Open bugs and loose ends

- **Sequences save / play audit (2026-10-24 evening):** every
  board-away scenario is listed with before/after in
  `docs/console-show-sync.md` §2; fixes built and run in the simulator
  (§3e), the bridge-copy pull proved on the yard (§3c). Also there:
  §3b the floods "forgotten" (no sender on the mesh; the bridge's copy
  now stands in), §3d firmware updates running outside the panel and a
  rollback read as success (Candle 1), and §4 **loops as Show rules**
  (Colin's ask; proposal, waiting on him before the rule format
  changes). Bridge heap min hit 17.3 KB during tonight's updates (§3d).

- **"Nothing turned on at the scheduled time" (2026-10-24):** the
  schedule worked — every board armed at sunset−60 — but no board holds
  a sequence or rule, so there was nothing to play. Needs an ambient
  loop for the candles (generic-boards §6e note, candle page). Also
  seen: Candle 1 and Candle 2 not heard by the bridge at all tonight;
  Candle 3 (mains) rebuilt its radio at 14:44 after 121 s unheard; the
  bridge rebuilt its own at 21:02 the night before with 15.8 KB free.

- **Node list overhaul (2026-10-24)** — built: the roster (boards
  remembered per browser, on the list at connect, asleep or not
  heard), name order, Arrange mode, zzz with sleep age, hide / forget,
  live `state` on a board's page, the list-beside-editor layout (phone:
  list → page → back), battery low / critical / overdue / ran-out
  marks, the ⚠ alarm, and the drain-rate estimate (firmware log in RTC
  memory + console forecast; bench test above). Next: the heartbeat
  output summary for a live second line per board.
  `docs/console-nodes-list.md`.

- **C6 SuperMini crash-loop on its first real run (2026-10-15) —
  cause found, fix built, not yet on the board.** e076df14 on the release
  firmware (`d73db6b`), nothing assigned: it joined the mesh and answered
  requests, then the **task watchdog** rebooted it every few minutes
  (`hello.reset` "task watchdog", uptime 210 s → 8 s). It was plugged
  into a laptop with no serial monitor open; moved to a USB charger it
  ran normally. Cause: on native-USB chips (C3, C6) `Serial` is the
  chip's USB port, and the Arduino core's write waits up to 20 × 100 ms
  per write for a host that isn't reading — a few dozen log lines pass
  the 30 s watchdog. Fix (`main.cpp`): `setTxTimeoutMs(0)` and a 4 KB TX
  buffer on native-USB builds. Bench check: the fixed build on a C6 plugged
  into a computer with no monitor open, uptime past 10 min. The second
  C6 (e0761d54) went silent the same way. The flashing BAT LED on one C6
  is the charger's "no battery" signal, not a fault.
- **Bridge went dead during servo slider moves** (2026-10-08, not
  reproduced) and **froze updating itself over the mesh** (2026-10-11, not
  reproduced; suspect its power supply). Workaround: update the bridge
  "Over WiFi". Details: generic-boards §9.
- **Floods panel error text points to a key field that doesn't exist**
  ("enter it above the light list", `console/src/lib/pinRules.ts`).
  Pairing makes the key; decide whether a manual key field is wanted or
  fix the text.
- ~~README board table is stale~~ — README rewritten 2026-10-14. Still
  stale: `docs/hardware-spec.md` locked-decisions table says the Mini
  stores audio in flash because "ESP32-C3 has no SDMMC" (hardware doc —
  Colin's to update).
- **Console's Firmware panel says "About six minutes a board"** for mesh
  updates; measured 3.5 min since the 921600 baud change (generic-boards
  §6c). Site audit 2026-10-13 lists the other small ones.
- **`software-plan.md` §8 milestones** describe the original plan (real
  stack as winter work); most of it was pulled into October. The table is
  history; this file is current.
- **GitHub Actions** warn that `checkout`/`setup-node`/`cache`/
  `upload-artifact` @v4 run on deprecated Node 20 — bump when touching
  the workflows.
- **Console validator** is a hand mirror of the firmware's — a shared
  test-vector file would catch drift. Serial link has no auth (fine on a
  cable); the WS API needs the token software-plan §5.1 calls for.

## 4. Not built yet (roughly in order)

**Before / around Halloween 2026 (on the yard boards)**
- Console on a phone: design in `docs/console-phone.md` (2026-10-24).
  The frame is built (bottom tabs, STOP ALL bar, sheets, home-screen
  install, landscape hints; PR #57); next the Yard map, Show, the
  moments list and scrub ruler for sequences, then perform mode, then
  placement mode. Also still on the list: **locate** (blink a board's
  LED to find it), **last-fired** time on each trigger rule,
  signal-strength heat on the map.
- ~~Console's OTA panel loading the update image straight from the docs
  site~~ — built 2026-10-13 ("Latest release" in the Firmware panel), but
  it fetched `firmware.bin` + `version.json`, which the site never staged
  (404 on the live site, found 2026-10-14 by screenshot). Fixed in
  `stage-firmware.mjs`; works from the next `main` publish.

**Winter 2026–27**
- **Versioned spec of the console ↔ board JSON API** — before any native
  app (software-plan §6 "Where the console runs").
- **Bridge-served console**: the bridge hosts `console/dist` (needs a
  bridge partition table — recommend a 16 MB ESP32-S3 bridge).
- First-boot setup (captive portal / AP) and the API token.
- **E1.31 / sACN input** — highest-value adoption feature (xLights, Vixen).
- Walk-up access point on any powered node (software-plan §5.1).
- Unicast mesh requests (flooding is fine at a dozen nodes, not fifty).
- Audio (I²S), steppers, analog inputs — the Pro/Mini feature set.
- Pro and Mini board profiles in the node firmware (after v0.1 boards).
- Native app (Capacitor, same React code) after the protocol spec.
- **Custom effects / a code editor** (Colin, 2026-10-15): write an effect
  like the candle in the console and push it to boards. Needs an on-board
  interpreter (Berry — what Tasmota runs on ESP32, MIT — is the first
  candidate; ~100–200 KB flash, the C6 has ~250 KB left), per-frame time
  limits so a bad script can't hang a prop, an in-browser preview that
  matches the board exactly, and a slot in the versioned API spec. Until
  then, built-in effects with console settings.

**Hardware (on the Mac):** Pro v0.1 after Halloween; Mini v0.1 Nov–Dec;
v0.2 Jan–Feb 2027; beta May–Jun; launch season 2027 (hardware-spec §7).

## 5. Setting up the server for software work

```
git clone https://github.com/mrwillson2u/propmesh.git && cd propmesh
git checkout dev
python3 -m venv .venv && . .venv/bin/activate     # Mac uses pyenv "propmesh-env"
pip install -r requirements.txt platformio pyserial
npm ci --prefix console && npm ci --prefix website
```

Check it all: `python3 tools/genboards.py --check` (and `genpins`,
`genmsg`), `pio test -d firmware/test -e native`,
`pio run -d firmware/node -e esp32-devkit-v1`, `npm run typecheck --prefix
console`, `npm run build --prefix website`. Node 22; Linux USB serial
needs your user in the `dialout` group.

**Reaching the boards from the server**
- **Over the network** (server at home, same LAN as the bridge):
  `python3 tools/bridge.py --host <bridge-ip> status` — requests, status
  and OTA without touching USB. The bridge was 192.168.175.209 on
  2026-10-12; `propmesh.local` if mDNS works there.
- **USB**: a devkit plugged into the server flashes with
  `pio run -d firmware/node -e <board> -t upload`. Opening a classic
  devkit's port resets it; pyserial must not force DTR/RTS low.
- **The console in a browser** runs on the machine you're sitting at.
  Run the dev server on the server and tunnel it so the page is
  `localhost` (Web Serial needs a secure context; `ws://` to the bridge is
  allowed from an `http://localhost` page):
  `ssh -L 5181:localhost:5181 server`, then on the server
  `npm run dev --prefix console -- --port 5181` (5180 is the always-on
  copy below), open
  http://localhost:5181. USB connects to the board on *your* machine;
  WiFi connects need your machine on the home network.

**The always-on console on the server (set up 2026-10-15).** A user
service serves a built copy of the console to the home network and
Tailscale at **http://192.168.175.9:5180** (LAN) — phones in the yard can
use it and connect to the bridge over WiFi. USB doesn't work from it
(browsers allow Web Serial only on https or localhost; use the SSH
tunnel for that). No login: anyone on the home network can open it.
- Built from a separate checkout, `~/propmesh-live`, pinned to
  `origin/dev`, so switching branches in `~/propmesh` never changes it.
- Service: `~/.config/systemd/user/propmesh-console.service`
  (`python3 -m http.server` on 0.0.0.0:5180; linger is on, so it starts
  at boot). `systemctl --user status propmesh-console`.
- **From anywhere, over Tailscale (checked 2026-10-24):** the server
  (`ubuntubot`, 100.115.150.41, `ubuntubot.llama-arctic.ts.net`) is a
  subnet router for 192.168.175.0/24 and the route is approved, so a
  phone on the tailnet reaches both the console and the bridge. Open
  **http://100.115.150.41:5180** (or `http://ubuntubot:5180` with
  MagicDNS). The bridge's mDNS name `propmesh.local` does not resolve
  off the home network: the console remembers the bridge's LAN IP from
  its `mesh` status (`propmesh.bridge.ip`) and retries a failed `.local`
  address there by itself; or type `ws://192.168.175.209:81`. The
  phone's Tailscale app must have "use subnet routes" on (default on
  iOS). Web Serial still needs https or localhost, so USB flashing is
  not possible this way.
- Update after merging to dev: `~/bin/propmesh-console-update`.
  If Chrome says "address unreachable" for that page while Safari or
  `curl` loads it, quit Chrome fully (Cmd-Q) and reopen: its network
  process keeps stale routes after a change of network (2026-10-21).
  Port 5181 is only a temporary dev server; 5180 is the console.

**What a build's name means (2026-10-24):** `<commit>` is a build of
`main`, the published release. `<commit>@dev` is from dev (the dev
site's firmware). `<commit>@<branch>` is a branch build, put on a board
by hand for testing. `+<hash>` after the commit means uncommitted edits
were in it. Every build also carries the time it was built, which the
console uses to say "newer than this site's build" for a board on a
branch build instead of offering the older release; commit names have
no order of their own. "Up to date" still means exactly the build this
site serves.

**The docs site, dev build, on the LAN (2026-10-23):**
**http://ubuntubot.local:5190/propmesh/** — the whole site as the
publish workflow builds it, from `origin/dev` instead of `main`:
firmware for every board profile, the console, the installer manifests
(version stamped `<sha>-dev`) and the pages. For trying a page or a
build before a dev → main publish.
- Checkout `~/propmesh-site` (a git worktree pinned to `origin/dev`);
  served by `~/.config/systemd/user/propmesh-site.service` (`python3 -m
  http.server` on 0.0.0.0:5190 from `~/propmesh-site-www`, where
  `propmesh` links to the built `website/dist`, so the site's `/propmesh`
  base path works unchanged).
- Rebuild after merging to dev: `~/bin/propmesh-site-update` (about
  six minutes: four firmware builds, the console, the site).
- **The install button needs a secure context.** Browsers allow Web
  Serial only on `https://` or `localhost`, so on a plain LAN address
  the button is dead. On the laptop, once: `chrome://flags/#unsafely-
  treat-insecure-origin-as-secure`, add `http://ubuntubot.local:5190`
  (and the IP form if you use it), relaunch. The published site on
  GitHub Pages is https and needs none of this.

**Not in git — copy or recreate deliberately**
- **Claude's memory** — `~/.claude/projects/<path>/memory/` on the Mac
  (preferences and reminders; the important rules are also in CLAUDE.md).
  Copy the folder to the matching path on the server (the folder name is
  the repo path with `/` → `-`, e.g. `/home/colin/propmesh` →
  `-home-colin-propmesh`).
- **`reference/old_files/`** — the raw pre-PropMesh dump. **Contains live
  WiFi and MQTT credentials; gitignored; never commit.** Only copy it if
  needed, by `scp`, not through git or a cloud folder. The scrubbed copies
  under `reference/` are tracked.
- `.claude/launch.json` — the Mac's preview-server config (port 5180);
  recreate if wanted.
- `hardware/pro/routing-draft/` — untracked KiCad scratch; stays on the
  Mac with the hardware work.

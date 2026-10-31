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

- ~~**Sleep management on a candle**~~ — **ran 2026-10-26 on Candle 3:
  tests 1–4 worked** (setup window, stay awake next time, power off,
  "off or unplugged?"). The follow-ups built that afternoon (the
  SLEEPING announcement, mark as off, no false missed check-ins) have
  been on the candles since; the check that no false "missed" shows
  across a few slots is not recorded. `docs/console-nodes-list.md` §9.

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

### Branch `sleep/check-ins`: what's left before its PR (2026-10-30)

The branch is PR #58 (open: the node list) plus 37 commits: sleep
management, the image-probation and clock-wait fixes, floods, settings
kept on the bridge, the bridge's memory guards, the update window and
the fire option. Most of it has run on the yard boards since 10-26..28.
Before its PR into `dev`:
1. The update-window test (below): the only bridge firmware on the
   branch that has never run.
2. Settings kept on the bridge, steps 2–5 (below): a change delivered
   at a check-in with every console tab closed.
3. Candle 1 and the Lantern armed through a window (below): a look at
   their rows during one, for the clock-wait fix.
4. The fire strip (below), or the PR says it is untested.
The PR will name what stays open: the bridge crash of 10-29 (§3; the dev
build also reset with a crash, on 10-26), the drain-rate estimate (two
nights on a cell), and the floods On/Off button (simulator only). #58
can merge first; the branch's PR then shows only the 37. The fire
commit is also on `fire/starts-at-top`; one of the two goes.

### Lantern update; Candle 1 over a night

Candle 1 browns out and reboots once on every wake (its own board; USB
too); 179c024 caps the radio only while a new image is on probation,
and a board waiting for its clock no longer sleeps
(docs/console-nodes-list.md, end of §9). To do:
1. ~~Update the Lantern~~ — done over USB 2026-10-27 00:38, booted on
   179c024@check-ins.
2. This evening, check Candle 1 and the Lantern are armed through the
   window (the row shows the mode) and that their check-ins land. The
   "don't sleep while waiting for the clock" fix hasn't run on hardware
   inside a window yet.

### Settings kept on the bridge (2026-10-28, branch `sleep/check-ins`)

The console is already live at :5180. With today's bridge it keeps the
copies in the browser, as before. The bridge needs the new build to
keep them itself. Flash **the bridge** with the hosted DevKit build
(Firmware panel → the bridge → My own build), or over USB. Then:
1. Its row reads normally. `python3 tools/bridge.py --host 192.168.175.209
   ask hello` shows `copies: 1` and `fs_used` / `fs_total`. Note both
   numbers in the docs.
2. Open a sleeping candle's page. It reads "kept on the bridge". A
   candle never read shows "No copy… on the bridge yet" until its next
   check-in.
3. Rename it, press **Save for next check-in**, then **close every
   console tab**.
4. After its next check-in, open the console. The new name shows and
   nothing is waiting. The candle went back to sleep on time and did
   not stay awake 10 min (its next check-in lands).
5. While a console is open, `bridge.py ask mesh` on the bridge, or its
   row, shows `heap_win_min` still ≥ 70 KB.
The candles don't need the new build for this. With it, a delivery
skips one read. docs/console-nodes-list.md §9 "Settings kept on the
bridge".

*Run 2026-10-28, afternoon (show off).* The bridge (321553bc, DevKit)
was updated over WiFi with `tools/bridge.py ota`, which took 98 s. It
was on ee66b9b, whose firmware tree is the same as dev at PR #55. It is
now on 95e5a36@check-ins, confirmed at 20 s, at normal radio power.
Step 1 passed: hello has `copies: 1` and `fs_used` 53248 of 131072.

| bridge memory | heap | `heap_win_min` | `heap_min` |
|---|---|---|---|
| before, ee66b9b, up 46.7 h after a crash, 3 consoles | 57476 | 47636 | 2564 |
| after, 95e5a36, up 23 s, 2 consoles | 86188 | 49136 | 8164 |

The old build was already under the 70 KB rule.

Within 90 s of the restart the bridge had copies of six boards (Candles
1–4 and 6, the Repeater) and a seventh, c51c54dc (named Candle 5 by
15:25), at the 15:20 slot. The copies hold no floods key and no
password. Over the next seven minutes heap stayed 69–86 KB; the
short-window minimum dipped to about 28 KB twice, the same lows as on
10-24 before this change; no send errors.

**Candles held awake: found and fixed.** Colin saw most candles held
awake and renewed without asking. Two causes:
1. *Mine:* the bridge counted "a console is working on this board" when
   a request was sent, not when the board answered. The console reload
   at 15:19:36 had asked every board, so after the first visits the
   bridge left Candles 1–4 and 6 held 10 min. Candle 5, unknown to that
   console, was released and slept. Now counted on the answer, and a
   visit skips the release only for a console request answered during
   the visit (01ab9ea; the bridge was flashed again at ~15:47).
2. *Older, console:* the Show, Yard and Floods views read every board
   (settings, show, sequences) whenever a board is heard, goes quiet or
   moves a sync stamp, and any such request holds a battery board
   10 min. Six candles waking in one slot renewed each other's holds.
   Survey reads now carry `bg` and let a free battery board on old
   firmware sleep again after (8cb5982, console deployed).
Not the WiFi or ESP-NOW libraries, and not the hardware.

**Candle updates: stopped — the bridge ran out of memory (15:55).**
Colin said queue them. Six candles were held awake 15 min and Candle 2's
update started at 15:50. It stalled at 27 %, and Colin's console couldn't
connect. The bridge had not restarted (01ab9ea, up 9 min), but:

| bridge at 15:55 | value |
|---|---|
| heap low since boot | 3.9 KB, then 3.3 KB |
| failed allocations | 9: the WiFi driver's 2308-byte receive buffer, 5 at boot and the rest at 556 s up |
| send errors | 191, `ESP_ERR_ESPNOW_NO_MEM` |
| radio rebuilds | 1, at about 15:54:20 |

This is §6j's "bridge goes mute" failure. The load was the update stream
plus six candles awake at once, all pulling their show copies from the
bridge (`pull_index` / `pull_seq` / `pull_rules` in its heap ring) while
the console read them. On 10-24 an update stream alone took the heap to
17.3 KB. The queue was stopped and the candles released at 15:56. Since
then: heap 74 KB, send errors flat. Candle 2 stayed on 179c024, and its
29 % partial image is dropped by its 10-min session timeout.

**Second mute, 16:00–16:02.** The radio rebuild at 15:54 didn't hold.
The radio stuck again around 16:00, and the mute watch rebooted the
bridge at 16:02:08. Its last words: "neighbors heard but none hear us
for 121 s; send errors 359 (last ESP_ERR_ESPNOW_NO_MEM); inflight 4;
heap 69952/45044; alloc fails 9". It was off WiFi too: no ping
16:00:36–16:02:04. The heap was back to 70 KB by then, so a radio that
has stuck once can stick again with memory to spare. For §6j: after a
NO_MEM mute, prefer a reboot to a rebuild. Colin restarted it by hand
at about 16:04.

*Correction:* the `pull_index` / `pull_seq` / `pull_rules` requests in
the bridge's heap ring at 15:56 were not candles pulling their show.
They were the console: the Show view reads a board's part from the
bridge's copy when the board doesn't answer, and it reconnected just
after the candles were let sleep. The candles' sync stamps matched the
bridge's at 15:38.

**Fix before any more updates (a55da1c, Colin asked; bridge flashed
16:17).** The bridge turns work away when memory runs low, with "bridge
busy", which the console and `bridge.py` retry:
- An OTA chunk waits below 64 KB free, as well as below a 44 KB block,
  which was the only test before.
- Any other request for a board waits below 40 KB free, and so do the
  bridge's own show and board copy replies.
- The copies stay out of the way below 56 KB free and while an update
  is streaming.

**Gentle run (Colin: "over the mesh gently"), from 16:18.** One candle
at a time, caught at its own check-in; only that candle is held. Pace
150 ms. The bridge's memory is read every 25 chunks. The run stops on a
radio rebuild, on 30 more send errors, or on two window lows under
20 KB, and by 17:05 at the latest (show window ≈ 17:12). Order:
Candles 2, 6, 4, 3, 5, then 1. Results below when done.

*Found during the run (16:36): the survey fix had a loop.* Candles 1, 3,
4 and 5 had been awake the whole time: Candle 1 for 77 min, Candle 5 for
3.5 h. Each had about 570 s of hold left, renewed together at about
16:36:20, when the bridge's heap ring shows the console's Show view
reloading. The 8cb5982 survey let a board sleep again only if it was
free, and left a held board alone. But an old-firmware candle ignores
`bg`, so every survey read renewed its 10 min, and the next survey found
it held again. Fixed in 6bd3740 (console deployed at 16:38): a held old
battery board is not asked at all, and the view uses its last copy.
Candles 1, 3 and 5 were released at 16:38. Candle 4 is next in the run.
A console tab loaded before 16:38 still runs the old survey until it is
reloaded.

*Run result (stopped 17:07 for the show window):*

| Candle | Before | After | Transfer |
|---|---|---|---|
| 2 | 179c024 | a55da1c | 536 s |
| 6 | 09f5b19 | not confirmed; asleep at −92 dBm at 17:08 | 803 s, `ota_end`: "no update in progress" |
| 4 | 179c024 | a55da1c | 649 s |
| 3 | b171708 | a55da1c | 842 s, `ota_end`: "no update in progress", yet booted the new build |
| 5, 1 | 179c024 | not run: after the show | — |

A transfer took 9–14 min at 150 ms pacing. The 15:50 run at 60 ms went
at about the same rate (~8.5 min an image), so the pace was not the
limit; the "about 3.5 min" said here at first was a 1.28 MB image
through a USB bridge on 10-07, not comparable with the C6's 1.83 MB
through WiFi (corrected 2026-10-29; where the time goes: generic-boards
§6c). The bridge stayed up throughout: no radio rebuild, no send
errors, window lows down to 33 KB. But its WiFi receive-buffer failures
rose from 8 to 30, so the driver dropped some incoming frames during
bursts. The guards kept that from turning into a mute.

At 17:08 every candle that answered had been held 10 min again within
the last 30 s, including the three on a55da1c, which honor `bg`. Only
console code from before 15:44 sends those non-background reads, so some
console tab was still on the old code. The candles were released at
17:08 so they sleep until the window. Every console tab and phone needs
a reload.

*After the show (read 2026-10-29 00:18).* The bridge, up 8 h on
a55da1c, had rebuilt its radio once at about 23:27 with no last words,
and its heap had touched 472 bytes (`heap_min`); 70 failed allocations,
all the WiFi driver's 2308-byte receive buffer; 3 consoles attached,
65–77 KB free, largest block 41 KB. Under a55da1c's 44 KB block line
that bridge would have refused every OTA chunk.

### Faster updates and the update window (2026-10-29, branch `sleep/check-ins`)

Colin asked for faster uploads, and for the bridge to manage the rest
of the mesh's traffic while an update runs. Built, **not run on the
yard yet**; design and numbers in generic-boards §6c "Through the WiFi
bridge, and the update window". Only the bridge needs the new firmware.
- Chunks go straight to a board the bridge hears at −86 dBm or better
  (TTL 0, frames 4 ms apart instead of 15): ~85 ms a chunk on the air
  instead of ~400, and the relays stay quiet. Unanswered in 500 ms, the
  chunk is resent the old way.
- While a transfer runs, reads for other boards go one at a time (at
  most 3 waiting; past 3.5 s, "bridge busy"), the bridge's copy visits
  wait, and consoles are told (`evt: updating`). The Show view holds
  its reloads until the update is over.
- Memory lines: 56 KB free (was 64) and a 16 KB block (was 44).
- `ota_end` gets 2.5 s before the bridge resends it; "no update in
  progress" after the last chunk counts as taken, settled by the build.
- Consoles no longer ask a board that said it was going to sleep for its
  hello every 15 s.

**Bench test, waiting for Colin's go:**
1. Flash the bridge over WiFi from the server: `python3 tools/bridge.py
   --host 192.168.175.209 ota 321553bc
   firmware/node/.pio/build/esp32-devkit-v1/firmware.bin` (~100 s; the
   consoles reconnect after it restarts). `ask hello` shows the new
   build.
2. Reload every console tab and phone.
3. Update Candle 5, then Candle 1, each at its check-in, with the
   scratchpad's gentle runner at the 60 ms pace. Keep one console on the
   Show view.
Watch:
- Time per image: about 3 min for a candle the bridge hears directly
  (Candle 1 was at −79 dBm); Candle 6 (−89) would stay by flood at about
  9 min.
- `mesh.update` after each: `direct_ok` / `direct` at 80 % or better
  means the direct links hold.
- The bridge: no radio rebuild, `tx_err` flat, window low above 20 KB.
- The Show view reads "A firmware update is running on Candle 5: this
  page reads the boards again when it's done." and reloads when it is.
Stop if the radio rebuilds, send errors climb, or the window low is
under 20 KB twice (the runner stops itself on all three).

### Fire strips that start at the top (2026-10-29, branch `fire/starts-at-top`)

Colin's strip (cut in half into two zigzag columns, data in at the top)
burned upside down: the layout assumed every strip starts at the
bottom. A fire strip's FIRE row now has **starts at top**. Built and
host-tested, **not run on a strip yet**; generic-boards §6h "Starts at
top". The console is deployed; the board driving the strip needs this
firmware (on `sleep/check-ins` too, so the yard's images carry it).

**Bench test, waiting for Colin's go:**
1. Update the strip's board: over WiFi once the bridge has the new
   build (above), or over USB.
2. On its page, FIRE → tick **starts at top** → **Save to node** →
   **Burn**.
Watch: both columns seeded at the bottom, flames rising, the
white-yellow pixels at the bottom. On a phone, the pin's ⓘ drawer lists
zigzag and starts at top (checkboxes were missing from it before).

## 3. Open bugs and loose ends

- **Candle 4 (c516df70) silent since 03:48 on 2026-10-29 (cause not
  known).** Read 2026-10-30 18:50 from the watch log
  (`~/propmesh-logs/bridge-watch.log`; the awake stretches come from the
  uptime in each 2-min sample) and the bridge:
  - The night before, it was awake 10.3 h straight, from 17:10 to 03:30,
    long past the show window's end at 22:58. Candles 1, 2, 3 and 5 were
    awake 5–13 h past it the same night, most likely held by a console
    tab still on the code from before the 10-28 fixes. On the night of
    10-29 every candle slept at 22:58.
  - At 03:34 it restarted, came back 8 dB weaker (−78 → −87 dBm), and
    was last heard 13 min later.
  - Since then nothing: the bridge's copy has no `seen` since its
    restart at 14:49 on 10-29, and on 10-30 at 18:50 neither the bridge,
    the Repeater nor Candle 1 heard it.
  - Colin, 18:55: plugged in, in range, the cell at 4.0 V. So it is not
    a flat cell now. The firmware has no low-battery lockout, and a
    check-in sleep is capped at ~5 min, so the only state it can't leave
    by itself is ⏻ Power off; the other candidate is a board that hung
    while its cell ran down. Plugging in USB restarts neither.
  - Next: press its reset button, or unplug the cell and USB for a few
    seconds. Its next hello gives the reset reason and last words. If it
    stays silent, read its boot log on the server's USB.
  - Also not heard on 10-30: Candle 3 (last 00:10), Candle 5 (last 09:40)
    and the Lantern (last 15:00 on 10-29).

- **The bridge crashed at 14:49 on 2026-10-29 (cause unknown, not
  fixed).** Read at 15:05: `reset: crash` (a software panic,
  `ESP_RST_PANIC`), up 976 s, still on a55da1c. It had been up about
  22.5 h, with a second radio rebuild at 00:28 after the one at 23:27
  (its last words: `ESP_ERR_ESPNOW_NO_MEM`, 91 failed allocations, 40.9 KB
  largest block). Within 16 minutes of the restart its free memory had
  already touched 3,292 B (`heap_min`), though idle it sits at 84 KB free
  with an 81.9 KB block (window low 78.4 KB, 3 consoles attached). That
  is the receive-buffer burst of generic-boards §6j again. A panic
  leaves no record without a serial log, so what crashed is not known.
  Next: catch the backtrace on USB, or keep the panic's cause across the
  reboot so `hello` can report it.

- **A follower skips a sequence whose pull got no answer (found
  2026-10-29, not fixed).** In `pm_sync_loop` the part's index moves on
  when the request goes out (`q_ids[q_i++]`); if `pull_seq` gets no reply
  after the link's three tries, the next part is fetched, and at the end
  the board records the show as synced. It then lacks that sequence until
  the next show edit. Needs three lost replies in a row, so it is rare.
  The fix (fetch the same part again after a timeout) is on the boards,
  so it reaches each one with its next update.

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

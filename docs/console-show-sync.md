# Saving and playing sequences when boards come and go (2026-10-24)

Colin, trying to build the first sequences on the yard boards: "a lot
of things are broken" — boards in the picker reported as unavailable on
save though their pin editor works; Save and Play inconsistent; after
a partial save, Play dead and Save dead; boards marked yellow never
clearing when they came back. "Think through every possible scenario."

This is that audit: how a sequence moves between the console and the
boards, every state a board can be in while it does, what the console
did in each, and what it does now. One doc, so the logic has one place.

## 1. The moving parts

- A sequence is stored **on each board that has steps in it**, as that
  board's part. Save = one `set_sequence` per board (parallel), each
  stamped with the same `at` (UTC second from the console's clock).
- The console talks to boards **through the bridge** over WiFi. A
  request to a board that doesn't answer times out on the bridge after
  6 s (`REMOTE_TIMEOUT_MS`); the bridge holds at most 6 forwarded
  requests at once (`MAX_PENDING`, `pm_link.cpp`).
- The bridge **mirrors** every `set_sequence` / `delete_sequence` /
  `set_rules` it forwards (`pm_show_mirror`), whether or not the board
  answered, and bumps `show_at` on its time beacon. A board whose
  `show_synced` is behind pulls its own part (`pull_index`, `pull_seq`)
  when it next hears the beacon — a battery board on its check-in, or
  a mains board within seconds (generic-boards §6k).
- A board holding a **newer** `at` than a request's answers `ok` with
  `stale: true` and keeps its own copy.
- **Play** is one `cue` to the connected board, which broadcasts it;
  every board that holds a part and is not `off` plays. The connected
  board refuses the cue only when *it* is off.
- A battery board in the show tier listens in windows; a request to it
  is preceded by a wake burst (`pm_link.cpp` "waking"). Any
  non-background request holds it fully awake for 10 min; `hello`,
  `mesh`, `state`, `ota_status`, `ble` don't.
- The Sequences view **loads** from every board that has introduced
  itself this session: `get_config` (pins, for the pickers), `get_show`
  and one `get_sequence` per part. A board that doesn't answer is
  *unreachable*; through a bridge its part is shown from the bridge's
  copy (`fromBridge`) and its pins from the previous load.

## 2. The scenarios

| # | Situation | Before | Now |
|---|---|---|---|
| 1 | Save; every board answers | Saved; reload shows it | same |
| 2 | Save; a board is asleep / out of range (through a bridge) | `set_sequence` times out → *queued*; message "X is off the mesh — the bridge kept a copy"; `pending` watcher polls X's hello every 5 s (each a 6 s timeout on the bridge while X sleeps); reload shows the bridge's copy, so the sequence reads as saved, Save goes dead, and the board's pins are missing so its steps read "(gone)" / "(not on this board)" | Message says which boards **did** get it and that X didn't answer (asleep, or out of range), the bridge holds it, X picks it up when next awake, *or press Send again*. The editor shows "⚠ X hasn't confirmed this version yet" with a **Send to X again** button once X is heard. The watcher asks only boards heard in the last 16 s. The pins of an away board are kept from the last load, so its steps stay named. |
| 3 | Save; a board is asleep; **not** through a bridge (USB to a leaf) | *failed*: "not on the mesh right now" or "no reply"; draft stays dirty | same, and the draft stays dirty so Save works again when the board is back (the reload on its return keeps unsaved edits) |
| 4 | The away board comes back | Nothing reloaded unless the pending watcher saw `show_synced ≥ at`; a board that hadn't synced, or had failed for another reason, stayed yellow for good | **Any board going from not-heard to heard reloads the view** (`heardKey`). Its pins come into the pickers, its part is read from it, and "unconfirmed" clears when it has pulled the edit. |
| 5 | Play after a partial save | Disabled: `anyOff` counted every board with a hello — including remembered/asleep boards whose last hello said `off` from the daytime | Play is gated on the **connected board's** mode only. Boards that are off, not heard, or unconfirmed just don't play, and the message after Play names them and why. |
| 6 | Play while the connected board is off | Disabled, tooltip "off on some boards" | Disabled, tooltip names the board and says Ambient or Armed |
| 7 | Save when the board holds a newer edit (console clock behind, or another console saved) | `ok` + `stale` read as saved; the reload then showed the board's version and the draft looked reverted | Counted as **not saved** on that board, with the board's edit time, "reload and try again" |
| 8 | Save with no clock on the console or board | `at` 0 applies as before | same |
| 9 | Save a sequence with a flood step and no sending board | fails for FLOODS with the floods-tab hint | same |
| 10 | Delete while a board is away | queued, same watcher | same text and watcher as 2; the tombstone on the bridge deletes it on return |
| 11 | A board is removed from the picker (its pins changed) | step reads "(not on this board)" in amber; board's `get_show` reports the orphan as a `problem` | same, and "(board not read yet)" when the board's pins are simply unknown this session |
| 12 | Step on a board that is not on the mesh at all | "(gone)" | "(not on the mesh)" |
| 13 | Load overlapping (boards introduce themselves one by one) | newest load wins, unsaved edits kept | same |
| 14 | Two consoles edit the same sequence | newest `at` wins on each board; the loser's save reads as saved | the loser's save now reports 7 |
| 15 | Roster: a remembered board, not heard this session | asked at load (timed out), never re-asked | not asked until heard (`isReachable`); reloads when heard |
| 16 | Battery board in show tier, console idle > 10 min | requests reach it through the wake burst; a 4 KB `set_sequence` may miss the window and time out → 2 | same path; 2 now recovers by itself |
| 17 | A board goes to sleep after a save (not through a bridge, or the bridge has no copy) | the reload at the sleep transition read only the awake boards' parts and **replaced the draft with a shorter sequence** — one step where two were saved; a save then would have deleted the sleeping board's part (seen in the simulator) | the loader keeps an away board's pins, part and rules from the last read (`fromLast`); the message says "asleep or out of range — showing its part as last read" |
| 18 | The "Saved …" confirmation | wiped at once by the reload every save triggers (`load()` cleared the message) | a load only replaces a message a load wrote |

## 3. What is still weak

- **No test on hardware yet.** The simulator has a board that sleeps on
  a 2-minute cycle and refuses requests while asleep; scenarios 1, 3,
  4, 5, 17 and 18 ran against it (2026-10-24, 19:58–20:00): save with
  both awake → both parts; sleeper asleep → both rows kept, Play
  enabled, "Playing — except on Sleeper: not heard"; edit + save while
  asleep → "Not saved on Sleeper (no reply)", draft stays unsaved with
  both rows; sleeper wakes → reload, draft still unsaved; save → both
  rows, Play enabled. The bridge-copy path (2, 10) needs the
  yard: unplug a candle, save, plug it in, watch the ⚠ line clear.
- `pending` is kept per view: leaving the Sequences tab and coming back
  forgets which boards were away for a save. The reload on return
  recomputes `unconfirmed` from the bridge's copy, so nothing is lost,
  but the "picked up" message is.
- The bridge's six request slots are shared by every console poll (hello
  every 15 s to every board, `mesh` every 5 s, `state` every 5 s on an
  open pin page). A save to four boards plus a reload can briefly fill
  them, and a request refused for lack of a slot reads the same as a
  board not answering. Worth a counter on the bridge.

## 3b. The floods "forgotten" (2026-10-24, evening)

Colin: "I am not able to connect to the floods and for some reason it
forgot the ones I previously had paired."

Nothing was forgotten. The key (`38282d4f`) and the five lights are on
the bridge's copy (`pull_floods`, saved Oct 12). The floods *live on
the sending boards*: each board ticked as a sender holds the key and a
BLE_LIGHT channel per light, and the console derives the light list
from the configs of boards on the mesh. The senders were the two
DevKits (Skellitor, Prop), unplugged since Oct 20; no board on the mesh
tonight holds a key, so the Floods tab, the sequence pickers and the
Yard all read as if no light had ever been paired, and there was no
board to "connect" through.

**Now:** when no board holds a key, the console reads the bridge's copy
(`readFloodsCopy`, `lib/floods.ts`) and shows the lights from it, with
the SENDING BOARDS line in amber: "no board is sending — the bridge
holds the key and 5 lights (saved Oct 12); tick a board, then Save to
boards." Ticking a board and saving writes the key and lights to it
(`syncFloods` takes the key from the copy), and it becomes the sender.
The Cloffice Repeater is a mains C6 with Bluetooth and is the natural
one. The sequence pickers and the Yard take the copy the same way, so
flood steps in a saved sequence keep their track while no sender is up
(saving such a sequence still refuses, correctly, until a board sends).

## 3c. Catching up is automatic; the console follows (2026-10-24, late)

Colin: "Can the bridge automatically send a node the saved sequence
when it connects rather than me having to press send?" It already does
(§1, generic-boards §6k) — and the yard proved it tonight: the bridge
held Sequence 1 (`pull_index` for each candle: `at 1792895666`), and
Candle 4 and Candle 6 both pulled it by themselves, Candle 6 after a
reboot; their `show_synced` equals the bridge's. "Send again" was only
ever the backstop. What was missing was the console noticing.

**Now:** every board's hello carries `show_synced`, and lib/connection
re-asks hellos every 15 s. The Sequences view keys its reload on the
set of boards' stamps (`syncKey`): when any stamp moves — a board
pulled its part — the show is read again, and the message says "X
picked up the saved show." The bridge's own stamp is the newest edit it
holds, so a heard board below it is *catching up*; the ⚠ line shows a
spinner for those, "asleep — picks it up when next awake" for the ones
not heard, and the "Send now" button only for a board awake and still
behind. The save-scoped watcher (which polled hellos itself and was
lost on a tab change) is gone.

## 3d. Firmware updates run in the background (2026-10-24, late)

Colin: "Is there a reason I have to stay on the firmware page for the
firmware to upload? Is the bridge not able to do other things?" The
bridge was never the limit. A mesh update is the **console** streaming
the image through the bridge in 2.7 KB chunks, and that loop lived in
the Firmware panel's component: leaving the panel unmounted it and the
transfer stopped (the board kept the part it had; Update resumed it).

**Now:** transfers and the "did it come back" check live in
`lib/otaJobs.ts`, a store outside any view. The panel reads it; so does
the node list, whose row shows "↑ updating 42 %" / "↑ update sent —
rebooting…" / "✕ update failed" while one is on. Leaving the panel,
opening a board's page, the Yard — the transfer goes on. Only a page
reload stops it (and then Update resumes from the board's `written`).
Simulator: start → leave the panel → list shows progress → come back
to "✓ updated — now meshnew01" (2026-10-24 pass 5).

**Rollback read as success (Colin, Candle 1).** Candle 1 took the new
image, rebooted, browned out (`hello.reset` "brownout (supply
sagged)") and rolled back to `da2db50`; the checker saw a restart on a
build it knew and said "✓ updated — restarted on da2db50". That branch
was for *re-sending the same build*. Now the job remembers the build
it sent: back on the old build after a different one was sent is
"✕ rolled back to da2db50 — the new image didn't run 20 s (restart:
brownout (supply sagged)); a weak supply usually, check its power".
Simulated with an image named `rollback…` (the sim's test hook).

**"Boards are sleeping while I send the update."** The firmware holds a
board awake 10 min on every non-background request, `ota_begin` and
each `ota_data` included, and `pm_sleep_loop` never sleeps while an OTA
is downloading (`pm_api.cpp`, `pm_sleep.cpp`). A board does not go to
sleep mid-transfer. What it can do is **brown out**: Candle 1 did (its
rollback above), and Candle 2 was at 3.58 V (4 %) while its update ran
— a cell that low sags under the flash writes. That is the "connection
dropped", and it is also why the battery thresholds were wrong: 3.55 /
3.45 V sit below 2 % on the curve; they are now 3.73 / 3.69 V (20 % /
10 %), so Candle 2 reads "battery critical" (console-nodes-list §8).

**Bridge heap during the updates:** the watch log's heap minimum fell
to **17.3 KB** at 20:06 (from 28 KB) while the candles updated, with no
alloc failures and no radio rebuild. That is the OTA load §6j
describes; it held, barely. Worth the `heap_win_min` check after any
change on the bridge path (CLAUDE.md), and an argument for the C6/S3
bridge.

## 3e. Test passes (2026-10-24, simulator)

Run against the deployed console with Playwright, a planted roster and
the sim's sleeping board. Pass 1: battery low / critical / ran out? /
overdue / ok rows, sidebar alarm (3 boards), not-heard mains board,
hide → "+1 hidden" → forget, name order. Pass 3: Arrange survives a
reload, sleeping-board hide confirm, save confirmation survives the
reload, Play after save. Pass 5: an update finishes while the panel is
closed, the list shows its progress, a rollback reads as failed with
the brownout; phone: no overflow, list → page → back, the candle card's
ⓘ drawer, cards fit, the map opens locked, the connect panel's address
field. Three earlier FAILs were test selectors (a name in a nested span,
"Hide it" matching the dialog text and its button, "✕" matching the
list's hide mark), not the console. Not covered by the sim: the
bridge-copy pull (no `pull_index` in the sim; proved on the yard, §3c)
and catching-up spinners (the sim's hello has no `sync`).

## 4. Loops belong to the Show (Colin, 2026-10-24) — proposal, not built

"The ambient loop should be set by the show page because I need to set
start and stop sequences. I don't like the ambient loop section. There
should be named loops, and we should be able to trigger them in the
show section."

Today a sequence carries an `ambient` flag and loops by itself whenever
the show is ambient or armed; the only control is the mode. There is no
way to start a loop from a trigger, stop it for a scare and restart it
after, or run different loops at different times.

**Proposed model.** A sequence is a sequence; whether it loops is a
property of *how it is started*. The Show's rules get two actions
besides "play": **start loop** and **stop loop**, and two triggers
besides sensor and after: **show on** (the mode became ambient or armed)
and **show off**. So:

- *show on* → start loop "Candles" (every 600 s)
- *show off* → stop loop "Candles" (the mode change already parks the
  outputs; this is for symmetry and for loops stopped early)
- *sensor* → stop loop "Candles", play "Scare", after "Scare" → start
  loop "Candles"
- *21:30* already exists as a schedule window; a window change is a
  *show on* / *show off* event.

Each loop is named (it is the sequence's name) and has its period on
the rule, not the sequence. The Ambient toggle on the sequence goes
away; the "every" box moves to the start-loop action.

**Mesh-first.** A loop runs on every board that holds a part, on the
mesh clock (`ambient_tick` already does this: period, loop index,
same beat everywhere). Start/stop would be a **cue** with a loop flag:
`cue {seq, loop: period_ms}` starts the loop on every board that hears
it; `cue {seq, loop: 0}` stops it. Boards keep the loop state in RAM
and re-derive it from the rules on boot (a board that reboots mid-show
asks: is any *show on* rule's loop running? — the rules say yes, the
mode is on, so it starts). No console needed once the rules are saved.

**Firmware.** `PmRule` gains `action` (play / start_loop / stop_loop)
and `period_ms`; triggers gain `PM_TRIG_SHOW_ON` / `PM_TRIG_SHOW_OFF`
(evaluated in `apply_mode`); the cue gains a `loop_ms` field (the cue
struct has room; old boards ignore it). `ambient_tick` reads a running
set instead of the per-sequence flag. The `ambient` flag stays
readable for a release so saved shows don't break, and the console
converts an ambient sequence into a *show on → start loop* rule on
first load.

**Console.** The Ambient toggle and "every" leave the sequence header.
The Show graph gets the two new trigger nodes and the two actions on a
rule; the rows view gets the same. The Show page's header shows the
loops running now (from the boards: `get_show` would list them).

**Not decided**: whether a loop restarts from its beginning after a
scare or resumes on the beat (proposed: on the beat, so candles don't
all blink at the restart); whether "stop loop" also turns the loop's
outputs off (proposed: no — a scare that dims the candles sets them
itself; a loop stop leaves them as they are).

Colin to confirm the model before it is built; it touches the rule
format on every board.

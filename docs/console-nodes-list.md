# The node list — overhaul (2026-10-24)

Colin, 2026-10-24: the row of boards across the top of the Nodes view
"feels a little under done". What he asked for, and where each stands:

| Ask | State |
|---|---|
| Boards remembered, so a sleeping battery board is on the list when the console opens | **Built** (§1) |
| The same order every time, not the order boards were heard | **Built** (§2) |
| A clear mark for a board asleep a long time (color or zzz) | **Built** (§3) |
| Hide a board that has stopped answering | **Built** (§4) |
| Rearrange the order by hand | **Built** (§2): Arrange mode, drag or arrows |
| Reconsider the row across the top; how it looks with few and with many | **Built**: option B (§6), chosen 2026-10-24 |
| A board's page shows its real state when opened, and follows changes | **Built** (§5); one check still to run on a real candle |
| Battery: ran out, low, a central alarm, an estimate | **Built** (§8); the on-board rate needs two nights on a board to show |

Everything built is in PR #57 (console only; no firmware change).

## 1. The roster: boards this browser has met

`console/src/lib/connection.ts`. Every board heard on a mesh is written
to `localStorage` under `propmesh.roster.<bridge id>` — a mesh is its
bridge — with its last hello (name, board type, battery, check-in
period) and when it was last heard. On connect, every remembered board
is put on the list at once, before any of them has spoken:

- a battery board shows **asleep** (zzz, dimmed, "last heard 6 h ago");
- a mains board shows **not heard**, red, with a ✕ to hide it (§4).

A remembered board that has not spoken this session is **not polled**:
no hello every 15 s, no part in STOP ALL. A request to a sleeping board
only sits on the bridge until it times out, and the bridge's request
slots are the scarce thing (generic-boards §6j). Its first heartbeat
clears the flag and polling starts as for any new board.

Why the morning candles were invisible: the list was built only from
heartbeats, a sleeping board sends none until its check-in (every
`checkin_ms`, 5 min by default, longer if set), and a page opened
between check-ins had nothing to show. The roster is per browser, so
the phone and the laptop each meet a board once. A roster held on the
bridge (it hears everyone) would make them agree and is mesh-first, but
costs bridge heap per board (CLAUDE.md memory rules); not done.

Writes are batched (one save per 2 s at most) so heartbeats every 5 s
from a dozen boards don't rewrite the store continuously.

**A remembered board is not "known" to the views (fixed 2026-10-24,
evening).** The Show, Schedule, Floods, Firmware and Yard views load
from the set of boards with a hello, and reload when that set changes.
With the roster, a sleeping candle had a hello from connect, so it was
asked (and timed out) at the first load, and when it woke the set did
not change — no reload, and its candle never reached the sequence
picker (Colin saw only Candle 6's tracks). Views now key on
`isReachable()` — a hello *and* heard this session — which flips when
a remembered board first speaks, and that re-runs the loads.

## 2. Order

`orderedEntries()` in `connection.ts` is the one order every view uses:

1. the board on the cable / the bridge, first;
2. then the hand order from the roster (`order: [ids]`), if any;
3. then by **name**, case-insensitive; unnamed boards after named ones;
4. then by id, so two boards without names stay put.

Before, the row sorted by hop count, then id — so boards swapped
places as signal changed and came up in a different order each visit.

**Arrange** (a button in the list header, shown when there is more
than one movable board) turns on ▲ ▼ on every row and lets rows be
dragged onto each other on a laptop; Done ends it. The bridge stays
first. Moving one board writes the whole order to the roster, so the
rest keep their places; boards heard later (not in the order) follow
in name order. Kept in this browser.

## 3. Asleep

A battery board not heard for 16 s is asleep (as before). It now reads
**z z z** in falling sizes with how long it has been asleep ("zzz 6 h"),
and the chip is dimmed to 70 %. The hover text gives the last-heard
time, the next check-in on the grid, and the period. A battery board
listening in windows (awake, between cues) keeps the ☾ + window mark.

## 4. Hide and forget

A **mains** board not heard for 16 s shows red and a small ✕ at its
end: *Hide this board until it speaks again*. Hidden boards leave the
list and the Yard counts; a "+N hidden" dashed chip shows them again on
a click, each with **forget** in red (off the roster for good; it comes
back only if it is ever heard again, as a new board would). A hidden
board that sends a heartbeat is **unhidden by itself**: a hide is for a
board that died, and a board that speaks has not.

A sleeping battery board has a ✕ too (Colin, 2026-10-24), behind a
confirm that says when it was last heard, when it next checks in, and
that hiding only takes it off the list — it comes back by itself the
moment it is heard. For a board that is really gone (dead battery,
taken inside) or just a tidier list.

## 5. A board's page shows its real state

`PinEditor.tsx` already asked the board for its outputs (`state`) when
opened; the values then stood until the console itself changed one.
Now the page re-reads `state` every 5 s while open and again when the
tab comes back into view, so a candle lit by the show, a relay the
schedule switched, read as they are. The firmware counts `state` as
background polling: it does not hold a battery board awake
(`pm_api.cpp`), and one small request every 5 s to one board is well
inside the bridge's budget.

**Not yet verified on a real candle.** Colin saw a lit candle read as
"out" when its page opened. The firmware returns the level the candle
is flickering at (`pm_channel_get` → `rt.value`, set by every path that
lights it), so the open-time read should have been right; the poll
covers a value that changed after opening. Check, tonight when the
candles are awake, with the candle visibly lit:

```
python3 tools/bridge.py ask <candle id> state
```

If `CANDLE_1`'s value is 0 while the flame runs, the firmware is
lighting it through a path that bypasses the runtime value, and that
is a firmware fix; if it is non-zero, the console was showing a stale
read and the poll is the fix.

## 6. The layout — options; B chosen and built (2026-10-24)

**Built as B.** On a laptop a 256 px column on the left lists the
boards one per row (state mark, name, BRIDGE / ⏱ tags, a second line
of facts: signal, sleep age and next check-in, battery), then
"+N hidden", Floods and Firmware as rows, Disconnect at the bottom;
the editor sits to the right and never moves. On a phone the Nodes
tab *is* the list; a tap opens the board's page full-screen with
"‹ Boards" in a sticky header, and the connect-time default (the
bridge) does not open a page by itself — the Yard's "open" does.
The chips' hover facts are now in the row's text. The second line of
*live output values* (C's best part) waits on the heartbeat summary in
the firmware.

The options as they were put to Colin:

The row of chips across the top is fine for three boards and poor for
fifteen: it wraps into a block, the editor below it jumps as the block
grows, and on a phone it is a scrolling strip with nothing to say which
board is which beyond its name. Three shapes, each shown with 3 boards
and with 14.

### A. The row (now)

```
few:   [● Bridge BRIDGE] [● Porch candle -54] [zzz Grave 6 h] [Floods] [Firmware]
       ─────────────────── editor for the selected board ───────────────────

many:  [● Bridge BRIDGE] [● Porch candle -54] [● Fog -61] [zzz Grave 1 6 h] [zzz Grave 2 6 h]
       [● Skeleton -70] [● Spider -58] [✕ Old fog] [● Gate -66] [● Window L] [● Window R]
       [● Pumpkins] [zzz Lantern 2 h] [● Repeater] [Floods] [Firmware] [Disconnect]
       ─────────────────── editor ───────────────────
```

Cheap and known. Reorder would be drag-within-the-row, which is fiddly
on a touch screen. The block of chips pushes the editor down.

### B. A list beside the editor (recommended)

Laptop: a fixed column on the left (220 px), one board per line,
scrolling on its own, the editor to its right and never moving. Phone:
the Nodes tab **is** the list; tapping a board opens its page
full-screen with a back arrow (the convention Settings apps use).

```
laptop, many:
┌ BOARDS ──────────────┬─ Porch candle ────────────────────────────┐
│ ● Bridge      BRIDGE │  name, board, firmware · Save · All off    │
│ ● Porch candle   -54 │  ┌ pins ───────────────────────────────┐   │
│ ● Fog            -61 │  │ D32  Candle  CANDLE_1   ⓘ           │   │
│ zzz Grave 1     6 h  │  │ ...                                 │   │
│ zzz Grave 2     6 h  │  └─────────────────────────────────────┘   │
│ ● Skeleton       -70 │                                            │
│ ● Spider         -58 │                                            │
│ ✕ Old fog   not heard│                                            │
│ ⋮ (scrolls)          │                                            │
│ ───────────────      │                                            │
│ ✺ Floods  ↑ Firmware │                                            │
└──────────────────────┴────────────────────────────────────────────┘

phone, list:                  phone, one board:
┌──────────────────────┐      ┌ ‹ Boards   Porch candle ┐
│ ● Porch candle   -54 │      │ name / board / fw        │
│ ● Fog            -61 │      │ D32 Candle CANDLE_1  ⓘ  │
│ zzz Grave 1     6 h  │      │ ...                      │
│ ● Skeleton       -70 │      └──────────────────────────┘
│ ...                  │
└──────────────────────┘
```

Each line carries the same facts as a chip (state dot or zzz, name,
signal or sleep age, battery, BRIDGE / ⏱ tags) with room for them. With
three boards the column is mostly empty, which is fine: the editor is
the point. Reorder: a drag handle (⋮⋮) at the left of each line on the
laptop; on the phone an **Arrange** button in the list header turns on
handles (the iOS Edit-mode convention). Asleep boards keep their place
in the order (a candle is still the second candle when asleep) but are
dimmed. Hidden boards fold under "+N hidden" at the bottom.

### C. Cards

A grid of cards, each showing the board's name, state, battery, signal
and its outputs' current values, with the editor opening from a card.

```
many:
┌ Porch candle ─┐ ┌ Fog ──────────┐ ┌ Grave 1  zzz ─┐ ┌ Skeleton ─────┐
│ ● -54  3.9 V  │ │ ● -61         │ │ 6 h   3.7 V   │ │ ● -70         │
│ candle 80 %   │ │ relay off     │ │ candle —      │ │ servo 40 %    │
└───────────────┘ └───────────────┘ └───────────────┘ └───────────────┘
```

Best overview of *what every board is doing* without opening any, and
the most work: live values for every board mean polling `state` from
all of them, which is mesh traffic the row and the list don't need.
Good for a wall display; heavy for the yard.

**Recommendation: B, with C's best part folded in.** Colin was torn
between B and C (2026-10-24). They answer different questions: B is
*which board do I want to work on*, C is *what is every board doing*.
B is the structure the Nodes view needs — it scales from one board to
thirty, gives reorder and hide an obvious home, matches the phone frame
(list → page → back), and keeps the editor still. What makes C
attractive is the live line under each name, and that fits on a B row
as a second line, dimmed:

```
│ ● Porch candle          -54 │
│   candle 80 % · relay off   │
```

The cost of C is where it bites: live values for every board means
asking every board for `state` on a timer, and every request is a
flood through the bridge. The cheap way is for the **heartbeat** to
carry an output summary — it is broadcast every 5 s already, costs the
bridge nothing extra, and works over the mesh alone. A heartbeat is a
250-byte ESP-NOW frame with room to spare; one byte per output
(0–100 % or a color's brightness) for up to 8 outputs adds 9 bytes.
That is a small firmware change and a second-line in the row, and
then B shows everything C would, with C's grid available later as a
view on the Yard tab (a wall display) if it is ever wanted. So: build
B now with one line per board; add the heartbeat summary and the
second line when the firmware next goes out.

Whichever wins, the chips' hover facts (hops, dBm, check-in time) move
into the line's own text and its ⓘ drawer, since a phone has no hover.

## 7. Not done, and why

- **Hand reorder control** — waits on §6.
- **A roster on the bridge** — costs heap on the bridge path; the
  browser roster covers the morning case. Revisit if the phone and the
  laptop disagreeing about who exists turns out to matter.
- **Overdue battery boards** — open question: should a battery board
  not heard for three check-in periods turn amber ("overdue") and then
  red? See §8, where it becomes the "ran out" indicator.

## 8. Battery: ran out, running low, and an estimate (design, 2026-10-24)

Colin asked for three things: an indicator that a board **ran out** of
battery, a **central alarm** when one is about to or has, and, if
possible, an **estimate** ("not likely to last the next show").

### What the console can know

- Every heartbeat carries the cell voltage (`batt` mV) while the board
  is awake; the console maps it to a percent on a resting 1S curve
  (`lib/battery.ts`). Under load it reads low (a coil pulse sags it).
- A board's hello says why it last restarted; **brownout** on a
  battery board is the cell giving out (the candle rollbacks, §6n).
- The check-in period is known, so "overdue" is computable: not heard
  for 3 × `checkin_ms` when it should have been awake.
- The schedule (show windows, sunset) is known to the console and to
  the boards, so "tonight's show" has a start and an end.
- The roster (§1) is where readings can accumulate per board across
  sessions, in this browser.

### Ran out

A battery board is **out** when any of: its last heard voltage was
under 3.4 V and it is now overdue; its hello reported a brownout
restart; or it is overdue by more than a day. The row shows a red
battery glyph and "ran out?" — with the question mark, because the
console only infers it. Overdue-but-not-low shows amber "overdue"
(a board can also be out of range or switched off).

### Low

Under 3.55 V (~20 %) a board's row shows the voltage in amber; under
3.45 V (~10 %) in red. These come straight from heartbeats, no history
needed.

### The alarm

One place, always visible: the top bar (phone) / sidebar header
(laptop) gets a **⚠ N** badge next to the board counts when any board
is low, out, or (with the estimate) not expected to last the next
show. Tapping it lists them with the reason and a Go-to-board link.
The Yard's board detail says the same. Nothing modal, nothing that
needs dismissing: the badge stays until the cause goes.

A board can't ring its own bell — it is asleep — but the mesh-first
version exists: a mains board could show the alarm on its status pixel.
Not planned; the console is where someone looks.

### The estimate — mesh-first, on the board

The honest answer: an estimate from voltage alone is rough, but a
**drain rate** is not. Voltage vs. charge on lithium is a flat curve
in the middle, so percent-per-hour from the console's few readings is
noisy. The board, though, samples its cell every 2 s all the time it
is awake and keeps data across sleep in RTC memory (`pm_sleep.cpp`
already does for the clock). It can keep a short history of
(wake time, resting voltage at wake) pairs — resting, because at wake
nothing has fired yet — and compute mV per hour over the last two or
three days. That survives the console being closed, works over the
mesh alone (CLAUDE.md: mesh-first), and is the same number from the
phone and the laptop. It goes out in the hello (`batt_mv_per_h`,
`batt_hours`), and the console does the arithmetic against tonight's
window:

- hours left = (mV now − 3400) / rate;
- "**should last tonight**" if hours left > hours to the end of the
  next show window + 2 h margin;
- "**not likely to last the next show**" otherwise;
- "**about N nights**" when there is more than one night's margin.

Shown with its basis so nobody trusts it blindly: "estimate from 3
days of wake readings". Below a day of readings: "no estimate yet".
A night's drain is very different from a day's (the candle runs all
show, then sleeps), so the rate is taken over whole days, and a board
that just got charged (voltage went up) restarts its history.

**Built 2026-10-24 (console):** `batteryState()` in `connection.ts`
— low ≤ 3.73 V (20 % on the resting curve), critical ≤ 3.69 V (10 %;
the first thresholds, 3.55 / 3.45 V, were below 2 % — Candle 2 read
"4 %" with no warning, 2026-10-24), overdue = quiet for 3 × check-in
period (+16 s), ran out? = overdue and last heard < 3.55 V, or overdue
after a brownout restart, or quiet > 36 h. The roster keeps each
board's last voltage, so a board asleep since last night still shows
its last reading and can be judged. The row shows the state in amber
or red before the facts; the dot turns amber / red for low / critical.
The **alarm** is a "⚠ N battery" badge in the phone's top bar and a
block in the laptop sidebar listing each board and why; both open the
Nodes view. Counts everywhere now say "N up · N asleep · N missing"
(asleep is not missing), and hidden boards are left out of counts and
off the Yard map.

**Built 2026-10-24 (firmware + console), untested on a board:** the
drain log in `pm_sleep.cpp`. Once an hour the board writes (UTC
seconds, mV) to a 72-entry ring in RTC memory — at sleep entry, when
it has been resting with the show off, and hourly while awake for a
battery board that stays up. The voltage is the heartbeat's reading,
handed over by `main.cpp`. A rise of 50 mV or more (it was charged)
restarts the log. Once the log spans 20 h, hello carries
`batt_mv_per_h` (fall from oldest to newest over the hours between)
and `batt_span_h`. The DevKit's no-sleep build has stubs and reports
nothing. RTC memory does not survive a power cycle, so a board that is
switched off starts over; that is also right, since it was probably
charged.

In the console, `batteryForecast()` (`connection.ts`): hours left =
(mV now − 3400) / rate, less the time since that reading; the end of
the next show window comes from the boards' own mode block (`next_s`:
a board in a window says when it changes next; one that is off says
when the next window starts, taken as a 4 h show). "Should last
tonight" when hours left clear that end by 2 h; "about N nights left"
with two or more nights of margin; "not likely to last the next show"
otherwise, which also raises the alarm as "may not last the show".
With no schedule: "about N days / N h left". Always with its basis,
"(from 2 days of readings)". A rate of 0.5 mV/h or less reads "barely
draining". Below 20 h of log: nothing.

**Bench check (status.md §2):** after a C6 candle has run two nights
on the new build, its hello should carry `batt_mv_per_h`, and the
Nodes row an estimate; compare the rate with the candle's measured
drain (§6n). Colin's call on the thresholds and the wording.

## 9. Sleep management (2026-10-26)

Colin: catching a sleeping board in its wake window to change settings
or update firmware is "really hard"; a board just switched on goes to
sleep at once; an unplugged board looks asleep for ever. Built on branch
`sleep/check-ins` (firmware + console), simulator-tested, **not yet on a
board**.

**Setup window after power-on (firmware).** A battery board turned on by
hand — power-on or the reset button (`ESP_RST_POWERON` / `ESP_RST_EXT`)
— holds itself awake 3 min (`PM_SETUP_HOLD_MS`) before its sleep
pattern starts. A software restart (an update) or a sleep wake gets the
old 6 s. Hello carries `hold_s`, the seconds any hold has left; the
board's row reads "awake for you · 2:40 left", and its page has **Let it
sleep** (`hold_awake {min: 0}`).

**Stay awake next time (console).** On an asleep board's page, **⏰ Stay
awake next time** puts it on a list (kept in the roster, so it survives
a reload). The moment its next heartbeat arrives — it is awake a few
seconds at each check-in — the console sends `hold_awake {min: 10}`,
and the normal pin page and Update work. No firmware or protocol change:
the heartbeat is the signal, and the console is the only one that needs
the board awake, so the hold is asked for only while a console is open
(nothing wakes a board for nobody).

**Update when awake (console, Colin's idea).** On the Firmware panel a
sleeping battery board's button reads **Update when awake**, and **⏰
Update N sleeping boards when awake** queues them all. A queued board's
next heartbeat starts its update: hold it awake 15 min, stream the image
(lib/otaJobs `queueMeshUpdate`). Rules: one transfer at a time — if one
is running, the waking board is left to sleep and tried next check-in;
a board at **battery critical** or **ran out?** waits "for a charge"
(Candles 1 and 2 browned out mid-update, 2026-10-24); a transfer cut
short resumes from the board's `written`. Nothing is cached on the
bridge (the image is 1.4 MB); the queue lives in the browser, so the
console tab stays open. Boards on the same period wake in the same
slot, so with a 5 min check-in and a ~3.5 min transfer the queue moves
one board per check-in.

**Settings for a sleeping board (console, built 2026-10-28).** Option 2
of the 2026-10-26 plan, put off then in favor of "Stay awake next time"
and built once Colin found an asleep board's page still blank: it showed
pins only if the page had been open since the board was last awake.
`lib/configCache.ts`; no firmware or protocol change.
- *The copy.* This browser keeps each board's settings, per bridge, under
  `propmesh.configs.<bridge id>`. It is written whenever the page reads or
  saves them. A board heard with no copy yet is read once at its next
  check-in. The floods key is left out of the copy, since it lives only on
  the boards, and the board never sends the WiFi password.
- *The page.* An asleep or remembered board's page shows the copy, with
  "as last read, Wed 1:16 PM". Pins, sleep settings and the name can be
  edited. The test controls wait for the board to be awake, and **Save for
  next check-in** replaces **Save to node**. A board held awake for the
  console opens live by itself. An awake one offers "It's awake — read
  its live settings".
- *Delivery.* The change waits in the browser ("⏳ settings waiting" on
  the row). At the board's next heartbeat the console runs three steps:
  1. It reads the board's settings and updates the copy.
  2. It sends the change, keeping the board's own floods key and lights,
     which the Floods tab owns.
  3. It lets the board sleep again with `hold_awake {min: 0}`, since any
     console request holds a battery board 10 min.
  It does not release the board when something else wants it up: the
  setup window after a power-on (hello's `hold_s`), "stay awake next
  time", or a queued update.
- *Safety.* The change is sent only if the board still has the settings
  it was edited from. Otherwise it reads "✕ not sent — its settings
  changed since this edit" and waits for a fresh save. A refusal stops it
  the same way. A missed wake leaves it waiting for the next check-in. A
  board that already has the change, after a save whose reply was lost,
  just clears it.
- *Limits.* Like Update when awake, it needs a console tab open; nothing
  is stored on the bridge. The copy is per browser, so a phone and a
  laptop each keep their own.
- *Tested:* in the simulator against its sleeping board. The copy was
  read at a check-in, without a key or password, and shown while asleep.
  A rename saved while asleep was delivered at the next check-in and
  cleared from the row, and after a reload the copy was still shown. No
  page errors. The "changed underneath" and refusal paths are not
  exercised. Not yet run on a real candle.

**Settings kept on the bridge (built 2026-10-28; simulator and host
tests only).** Colin's follow-up: the bridge does what
`lib/configCache.ts` did in the browser. Every console that connects
sees the same list and settings, and a change goes out at the board's
check-in with no tab open. Firmware `pm_copies.cpp`, with the decision
logic in `pm_copies_core.h` (host tests `test_copies`).
- *The most efficient split (Colin asked for it, reflash or not).* The
  copy follows the console's own traffic as it passes the bridge: an
  accepted hello, `get_config` or `set_config`. Boards built from
  2026-10-28 on stamp their settings (the `at` of the `set_config` that
  made them, kept in `/sync.json`). They report the stamp in every
  heartbeat (`cfg_at`, appended to schema Heartbeat) and in `get_config`.
  So the bridge knows its copy is current without asking.
  - *Nothing waiting:* the bridge sends nothing at all.
  - *A change waiting:* hello, `set_config` with `keep_floods`, then
    `hold_awake {min: 0}`. The board keeps its own floods key and lights,
    so the change needs no read first.
  - *An older board without the stamp:* read once for the copy. To
    deliver a change, the bridge reads it again, compares, and hands the
    board back its own floods key and lights.
  The candles therefore need the new firmware only to drop that one
  read, and can take it with their next update.
- *Stored* in `/m`, beside the show copies:
  - `<node>_c.json`: the hello's list fields, the settings without the
    floods key or any WiFi password, their stamp, and `rev`.
  - `<node>_w.json`: the waiting change and the copy it was edited from.
  - `wake.json`: the "stay awake next time" list.
  RAM holds one small slot per board (32), so a heartbeat is decided
  without touching flash. Flash is written only when something changes.
  The copies stop growing when less than 24 KB of the 128 KB area is
  left, so the sequence copies keep room. Each board then reads
  "full" (event `copy`, what `full`).
- *A visit* happens only when a board needs one: a change waiting,
  "stay awake next time", no copy yet, or a stamp that doesn't match.
  It skips a board a console is already talking to. A visit that gets no
  answer waits 30 s before trying again.
- *Holds (corrected before the first flash, 2026-10-28).* Any console
  request holds a battery board awake 10 min. The first version let the
  board go after its visit unless its hello showed any hold up to 3 min,
  meant for the setup window. But Candles 1 and 2 and the Lantern reset
  once at every wake and show the 6 s dwell after a reset as a hold. They
  would have stayed up 10 min after each visit. The setup window would
  have stretched from 3 min to 10, which Colin objected to on 10-26. Now:
  - *Boards from 2026-10-28 on* take a request marked `bg` as
    background: a 3 s hold, enough for the visit's next request. Nothing
    is released, so no other hold is ever cut short. The bridge asks such
    a board for its hello only the first time, or for "stay awake next
    time".
  - *Older boards* ignore `bg`, so the bridge releases them after the
    visit with `hold_awake {min: 0}`. A visit goes ahead only when
    nothing else holds the board: no hold, or up to the 6 s dwell after a
    reset. It also goes ahead for a 10-min hold no console has used in
    10 min, which the release then ends. A sensor wake (60 s), a sync
    pull (20 s), the setup window or a console at work waits for a later
    check-in. No release follows a visit for "stay awake next time".
  - *"Stay awake next time"* is spent only in the setup window, a hold of
    60–185 s. The console's own version (`holdNow`) treated any hold as
    the setup window, so it spent the request on Candles 1 and 2 and the
    Lantern without holding them. Fixed the same way.
  - The browser copy follows the same rules: `bg` for newer boards, and a
    later check-in when an older board is held.
- *Safety.* A waiting change is sent only if the board still has what
  it was edited from: the stamps match, or, without stamps, the settings
  compare equal, ignoring floods and defaults. Otherwise the change is
  marked "✕ not sent". A refusal is marked the same way. A board that
  already has the change just clears it. `queue_config` carries the
  `rev` the page edited, so a second console editing an older copy is
  told to reopen the page.
- *"Stay awake next time"* is kept on the bridge too (`stay_awake`).
  The bridge holds the board at its check-in whether or not a console is
  open. "Update when awake" still runs from the console tab: the image
  doesn't fit on the bridge.
- *Commands* (to the bridge): `get_copies {from}`, paged with `more`,
  which returns each board's hello, stamps, `rev`, wake flag and waiting
  summary, plus `fs_used` / `fs_total`. Also `get_copy {for, waiting?}`,
  `queue_config {for, config, rev, at}`, `cancel_config {for}`,
  `stay_awake {for, on}` and `forget_copy {for}`. Each change is
  announced to every console as `{"evt":"copy", node, what, rev, ...}`.
  Every board's hello now carries `fs_used` / `fs_total`. A bridge's
  hello carries `copies: 1`.
- *The console* checks the bridge's hello for `copies`. With it, the
  console reads the list on connect, so boards this browser never met
  join as remembered. It fetches a board's copy when its page opens and
  keeps nothing in the browser. Without it, the browser copy above runs
  as before, so today's bridge behaves exactly as it does now.
- *Tested.*
  - Host tests: `test_copies`, 13 cases, covering the copy's contents,
    settings comparison, the visit plan, the send verdict, the hold rules
    for older boards, the setup window and the release rule.
  - Builds: all four boards. DevKit static RAM is 68.9 KB.
  - Simulator: the sim's bridge keeps copies the same way, 17 checks. It
    read the copy at a check-in, kept nothing in the browser, and stored
    the waiting change on the bridge. A second console with an empty
    browser listed the asleep board and showed the waiting name. The
    bridge delivered it at the next check-in, the row cleared, and the
    list name followed. With a bridge without copies, the browser
    fallback ran.
- *Not tested:* nothing has run on hardware. Not yet measured on the
  bridge: its flash use and its `heap_win_min` during a visit (the
  70 KB rule). "No tab open" can't be shown in the simulator, because
  its bridge lives in the page.
  One race to watch, older boards only: a board held by "Update when awake" could
  be released by a visit that finishes before the console's hold
  arrives, since a release overrides any hold. A visit only happens when
  the board needs one, and a console request in the last 10 min blocks
  the release.

**Asleep, off, or out of range (console).** `presence()` in
`connection.ts`. A battery board checks in on a UTC grid, so its silence
is predictable:
- still inside its grid → **asleep** (zzz);
- its last slot (+20 s) passed with no word and nobody else on its
  period checked in → **missed check-in at 8:25** (amber);
- others on its period checked in at that slot, or 3 slots missed →
  likely gone; the last signal decides the hint: weaker than −82 dBm →
  **out of range? (signal was −88 dBm)**, stronger → **off or
  unplugged? (signal was −55 dBm) — others checked in at 8:25** (red);
- last voltage below 3.55 V → **ran out?**;
- a mains board that goes quiet gets the same signal hint at once.
Within one check-in (5–6 min for the candles) an unplugged board stops
reading as asleep. The roster keeps the last signal for remembered
boards.

**Power off (firmware + console).** **⏻ Power off** on an awake board's
page: the board turns its outputs off and enters deep sleep with no wake
source (`power_off`; only reset or a power cycle starts it again). The
list then says **⏻ switched off 8:12**, not asleep, until it is heard
again. A build without deep sleep (the DevKit) answers that it can't,
and is just marked off, to be unplugged.

**Simulator.** The sim's sleeping board honors `hold_awake` (stays
awake past its 20 s window) and `power_off` (silent until reload), and
reports `hold_s`. Test results below.

**Simulator results (2026-10-26, 09:06–09:09).** All pass: a board 3
slots late with a −90 dBm last signal reads "out of range? (signal was
−90 dBm)"; with −55 dBm and a peer that checked in, "off or unplugged?
(signal was −55 dBm) — another board checked in at 9:08"; one missed
hourly slot, no peers, "missed check-in at 9:00"; a quiet mains board
"off or unplugged?"; the sleeper reads asleep inside its grid; **Stay
awake next time** held it awake past its 20 s window ("9:29 left");
**Let it sleep** returned it to sleep; **Power off** reads "⏻ switched
off 9:09" and stays so once quiet; **Update when awake** queued the
sleeper, started at its next check-in and finished ("✓ updated — now
wakeup01"). Found on the way: the missed-slot count was one short (a
board 3 slots late read as 1–2), fixed. Three earlier FAILs were the
test script (seeding the roster under a connected page, which saved over
it; loading the page while the sleeper slept). **Not yet on hardware**:
the 3 min setup window and `power_off` are firmware; the four builds
pass. Bench test in status.md §2.

**On Candle 3 (2026-10-26, morning).** The branch build went to Candle 3
over the mesh at 09:28 and came back as `7a540a7@check-ins`; the first
power cycle then booted the *old* build (`e0fcc2a@dev`). Cause: an image
is confirmed only after 20 s up (`confirm_image`), and a battery board
restarted by an update slept after its 6 s dwell, so the image stayed
unconfirmed and the bootloader rolled it back at the next restart. Any
battery board updated while the show was off would have done the same;
it may also be part of the earlier "rolled back" candles. Fixed in
`d9ed9ab`: `pm_sleep_loop` never sleeps while `pm_ota_pending()`.
Candle 3 took `d9ed9ab@check-ins` at 10:04 and reported `pending: false`
at 10:05. Bench tests 1–4 (status.md §2) to run again on it.

**After Colin's bench run on Candle 3 (2026-10-26, midday).** Tests 1–4
worked. Three follow-ups, built the same day:
- **3 min became 10.** He had pressed Stay awake next time, then
  power-cycled the board; on its first heartbeat the console sent the
  waiting 10 min hold over the 3 min setup window. Now the console asks
  the board's hello first: if it is already in a setup window (`hold_s`
  > 0), the request is spent and no hold is sent.
- **Asleep late.** A board going to deep sleep sent nothing, so the
  console waited 16 s of silence. Now its last heartbeat carries
  NodeRole **SLEEPING** (8, `schema/messages.yaml`), sent twice just
  before deep sleep and before Power off; the console marks it asleep on
  receipt. Firmware only ever tests other boards' BRIDGE bit, so older
  boards ignore the flag.
- **Mark as off.** A quiet board's page has **⏻ Mark as off**, and the
  list header **⏻ N off** marks every board that isn't heard and isn't
  just asleep, at once. They read "switched off" (gray) until heard
  again; it survives a reload (roster `offAt`).
- Also: a flat board read "ran out? ran out?"; the battery text is
  dropped when the presence line says the same.
Simulator: all pass (asleep within one heartbeat of going to sleep;
3 quiet boards marked off in one press; the sleeper left alone; survives
a reload).

**Afternoon: "missed check-in" on boards that hadn't missed one
(2026-10-26).** Colin saw battery boards flagged as missing check-ins
again and again. Two causes, both in the console's `presence()`:

- **The SLEEPING announcement made every check-in look missed.** To show
  a board asleep at once, the console back-dated its last-heard time by
  17 s. A board goes to sleep ~8 s after its slot, so that put it
  *before* the slot it had just checked in for, and 20 s later the slot
  counted as missed. Now `seen` keeps the real time and a separate
  `sleptAt` makes the board quiet (`isMissing`). This only affects
  boards running the SLEEPING firmware (5fc6548).
- **Waking early counted as a miss.** A board wakes up to its guard
  early (`pm_checkin.h`: 1 + 1 % of the period on an uncorrected clock,
  4 s for 5 min) and may send its only heartbeat before the slot. Now a
  board heard up to 20 s (`SLOT_MARGIN_MS`) before a slot counts for
  that slot, and the same applies to the peers that did check in.

Scripted checks against `presence()` (announced sleep, woke 4 s early,
real skip after each, a held board): all six as expected. The bench
check still to do: watch the list across a few slots with the candles
running and confirm no false "missed".

**Evening: the lantern and Candle 1 "rolled back" (2026-10-26).** Both
were updated from the console's release, 848c2d7 (published from
`main`, 2026-10-23). That build has the bug fixed in d9ed9ab: a
battery board restarts into the new image and sleeps 6 s later, before
the image confirms at 20 s, so the bootloader puts the old one back at
the next wake (the lantern in the heartbeat log: restarted 16:32:12,
one heartbeat at 5 s up, then nothing). Not the battery: both read
about 4.0–4.1 V. The fix is hosting the newer build, not working
around the old one in the console. Until the sleep work reaches `main`,
the branch build is on the server for **My own build**:
`http://<server>:5180/firmware-test/esp32-c6-supermini/firmware.bin`
(one URL serves every board type; b171708@check-ins). The rollback
message no longer says "a weak supply usually": it names the confirm
and the last restart reason. Candle 1 reports "brownout" as its last
restart at an ordinary 16:29:52 check-in wake, so that field isn't
evidence about the update; worth a look on the bench separately.

**Later: the real cause — the board browns out at full radio power
(2026-10-26, 17:40–18:50).** Colin: power is fine, and Candle 1 was on
USB when its update failed. Its serial log on USB, every boot (5 of 5):
boot, mode line, then `E BOD: Brownout detector was triggered` about
1 s in, a restart, and a second boot that runs normally (it reports
"brownout" as its reset reason from then on — that was the "brownout"
on ordinary wakes). A test build capped at 13 dBm booted clean 2 of 2.
So the board itself, a C6 SuperMini, can't take its first full-power
frames after a restart; Candle 3 (same board type, same config) can.
A confirmed image shrugs that off; a new one on probation is rolled
back by the bootloader, so no update could stick on Candle 1 or the
lantern.

Fix, `pm_mesh_low_power` (ec0c892, then 179c024): the radio runs at
**13 dBm while a new image is on probation** and goes to the driver's
full power once it confirms (hello says `radio_low: true` meanwhile).
Result: Candle 1 updated over the mesh (474 s), restarted, confirmed,
slept, and woke at 18:49 still on the new build. ec0c892 also kept
13 dBm for good on a board that had ever browned out; Colin chose the
reboot over the lost range ("I'd rather have a reboot if that is all it
really does"), so 179c024 drops that and the `/radio_low` flag (a stale
file on Candle 1 is ignored). Why the second boot survives at full power
is not known — an earlier note here said the framework lowers the
power after a brownout; that was a guess, withdrawn.

**What the reboot per wake costs, and the bug it uncovered.**
- The board's "last restart" always reads "brownout", so that field
  says nothing about a real crash on Candle 1. The console used it as a
  hint for "ran out?"; it no longer does (connection.ts `batteryState`).
- ~1–2 s of a ~10 s check-in window, and a little battery.
- **It slept through the show.** The second boot is a plain reset, not
  a timer wake, so the wall clock isn't restored from the RTC; the show
  reads "waiting for the clock" — which is mode *off* — and a battery
  board sleeps 6 s after any ordinary boot when the show is off. Candle
  1's log at 17:49: boot, "waiting for the clock", asleep 10 s later,
  never armed; at 17:54 the beacon came at 10 s and it went armed. So
  a board could sleep through a window whether or not it held a
  sequence. 179c024: `pm_sleep_loop` doesn't sleep while
  `pm_show_clock_pending()` (up to pm_show's 60 s wait). This fix is
  for every board, not only brownout ones: any plain reset inside a
  window had the same 6 s race.
- Not a downside of the choice but noted: Candle 1's hello at its
  17:39:53 wake (up 1 s) gave `utc_s` 65 min behind the bridge; by
  19:36 it was right. Unexplained; worth a look if a board ever fires
  at the wrong time.

Should a board without a sequence sleep during the show? No: armed or
ambient is not off, so it stays awake and listens for cues; only the
clock bug above put them to sleep. Tonight they are all in ambient
(manual, to 23:00) and awake.

Hosted for **My own build** (every board type behind one URL):
`http://<server>:5180/firmware-test/esp32-c6-supermini/firmware.bin`.
The lantern (on `90196f0+60e656`, an old uncommitted build) couldn't be
reached over the mesh — one heartbeat at 00:20 on 10-27, then nothing
for two slots — so it was flashed over USB on the server (esptool,
bootloader + partitions + boot_app0 + app) at 00:38 and booted on
179c024@check-ins. A USB flash isn't on probation, so nothing to roll
back. Both C6 boards that rolled back are now on the branch build.

**Candle 2 (e0771e84), 2026-10-27 22:01.** The mesh update didn't stick
on it either (on `7d8ea74`), so it was flashed over USB on the server
the same way. Its first boot on 179c024 shows the same pattern as
Candle 1: `E BOD: Brownout detector was triggered` about 1 s in, then a
restart that runs normally. So three of the C6 SuperMinis (Candles 1
and 2, and the lantern by its reports) brown out at full power after a
restart; Candle 3 doesn't. A USB flash isn't on probation, so it runs
at full power at once and keeps the image regardless.

**Floods went dark after the Cloffice Repeater's update (2026-10-27,
~22:05).** The repeater is the only board holding the flood lights. On
any restart inside a show it boots without a clock, the show reads
"waiting for the clock" (mode off), and that was applied as a real
show-off: `pm_channels_all_off` sent "off" to every flood. The by-hand
flood colors lived in RAM only, so when the clock came and the show
went back on there was nothing to restore. Not new with this build —
any restart of a flood board in a window did it. Fix (pm_show
`eval_mode`): the boot's first wait for the clock just reports off and
switches nothing; the floods keep the state they hold themselves.

**The Floods panel forgot each light's color when it was off** (Colin:
"the controls are reset to red dark"). A light at value 0 has no hue,
and the picker started at red. The panel now keeps the last color each
light was lit with (`propmesh.floods.lastLit` in this browser; from
the sliders and from what the boards report), and an off light's
picker shows that color at brightness 0, so raising the brightness
brings it back. Kept per browser, not on the boards: a phone and a
laptop each remember their own. Simulator: hue kept across a reload,
brightness up restores it, swatch not red.

**On / Off per light (2026-10-27).** Colin: "Can the floods toggle so I
can turn them on and it saves the last brightness also?" Each light's
Off button becomes **On** while it is off; On sends the last value it
was lit with — color at its brightness, or a warm-white level — and a
light never lit from this browser comes on full warm white. The
remembered value now includes white (it was color-only). Simulator: off
→ On after a reload restores hue 120 at 35 %; a white light restores
its white level.

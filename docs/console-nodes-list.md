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
— low < 3.55 V, critical < 3.45 V, overdue = quiet for 3 × check-in
period (+16 s), ran out? = overdue and last heard < 3.40 V, or overdue
after a brownout restart, or quiet > 36 h. The roster keeps each
board's last voltage, so a board asleep since last night still shows
its last reading and can be judged. The row shows the state in amber
or red before the facts; the dot turns amber / red for low / critical.
The **alarm** is a "⚠ N battery" badge in the phone's top bar and a
block in the laptop sidebar listing each board and why; both open the
Nodes view. Counts everywhere now say "N up · N asleep · N missing"
(asleep is not missing), and hidden boards are left out of counts and
off the Yard map.

**Next: the on-board drain rate** (firmware), then the estimate line.
Colin's call on the thresholds and the wording.

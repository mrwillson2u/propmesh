# The node list — overhaul (2026-10-24)

Colin, 2026-10-24: the row of boards across the top of the Nodes view
"feels a little under done". What he asked for, and where each stands:

| Ask | State |
|---|---|
| Boards remembered, so a sleeping battery board is on the list when the console opens | **Built** (§1) |
| The same order every time, not the order boards were heard | **Built** (§2) |
| A clear mark for a board asleep a long time (color or zzz) | **Built** (§3) |
| Hide a board that has stopped answering | **Built** (§4) |
| Rearrange the order by hand | Data built (§2); the control waits on the layout (§6) |
| Reconsider the row across the top; how it looks with few and with many | **Options in §6 — Colin to pick** |
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
The hand order has a data path and a setter (`setOrder`) but **no
control yet**: a drag handle or an Arrange mode depends on which
layout wins (§6).

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

A sleeping battery board gets no ✕: asleep is a state, not a fault.

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

## 6. The layout — options for Colin

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

**Recommendation: B.** It scales from one board to thirty, gives
reorder and hide an obvious home, matches the phone frame already
built (list → page → back), and keeps the editor still. C could come
later as a "board" view on the Yard tab, where live values belong.

Whichever wins, the chips' hover facts (hops, dBm, check-in time) move
into the line's own text and its ⓘ drawer, since a phone has no hover.

## 7. Not done, and why

- **Hand reorder control** — waits on §6.
- **A roster on the bridge** — costs heap on the bridge path; the
  browser roster covers the morning case. Revisit if the phone and the
  laptop disagreeing about who exists turns out to matter.
- **Hide for a sleeping board** — deliberately none; a board that
  sleeps is working. If a battery board is really gone (dead cell,
  taken inside), **forget** it from the "+N hidden" view after hiding
  … which it cannot be, since it has no ✕. Open question: should a
  battery board not heard for, say, three check-in periods turn red
  with a ✕ as well? (Proposed: yes — after 3 × `checkin_ms`, "overdue"
  in amber, then the ✕.)

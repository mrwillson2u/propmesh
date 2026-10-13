# Docs site audit — 2026-10-13

An editing pass over every page of the user docs site (`website/`) after
the software work moved to the home server. Two goals: fix claims that
did not match the firmware and console as built, and make the writing
read like a person wrote it for a newcomer. Checked against
`generic-boards.md`, `boards/*.yaml`, the console source (every quoted
button, column and block name) and the firmware constants in
`pm_config.h` / `pm_show.cpp` / `pm_sleep.cpp`.

## Claims that were wrong or stale

| Page | Was | Is now | Source |
|---|---|---|---|
| Your first scare | "Armed won't last forever — holds until the schedule's next change" | Without a schedule the boards boot armed and a pressed mode holds until the next press. A schedule is what turns the show off at night. | generic-boards §6e, "With no schedule it holds until a button changes it" |
| Battery props | "reacts to cues up to a second late while the show runs" | A cue for a mesh with a listening board is sent with a lead of one listen interval + 150 ms, so every board fires together. The scare starts about a second after the sensor, on all boards. | `pm_show.cpp` `lead_ms = leaf + 150`; §6f "lands on time with everyone else" |
| Battery props | "checking in every few minutes" | "every five minutes by default" | `pm_config.h` `sleep_checkin_ms = 300000` |
| Running the show | Only Armed "during quiet hours (outside every window)" expires after an hour | Any mode *more* active than the schedule's expires after `manual_max_min` (60, editable in the panel). No schedule: nothing expires. Also added the 12-window limit. | §6e |
| Updating | "Each board takes about six minutes" | "a few minutes" | §6c: 6 min at 115200, 3.5 min at 921600 (default since 2026-10-07) |
| Updating | "you never need to plug it in again" | "you shouldn't need to" | OTA is beta; the bridge froze once updating itself (§9) |
| LED strips | WS2812, SK9822 and fire presented as working | Caution aside: the WS2812 driver was rewritten 2026-10-11 and neither it, the clocked driver nor fire has run on a real strip | status.md §1 |
| Relays | "PropMesh is for low voltage — up to 30 V" stated as a system limit | 30 V is the PropMesh boards' relay rating; the mains advice stands as advice | CLAUDE.md locked decision "No mains switching on board" |
| What is PropMesh | same 30 V claim | points to the relay page | — |
| Troubleshooting | After a power cut, "connect the console once so they know the time again" | Added: a board with a schedule and no clock waits 60 s, then runs Armed until it learns the time | §6e "Clock" |
| Flood lights | A light paired to the app: "Take over moves it" only | Added: if take-over fails, power-cycle the light a few times to reset it | §6a bench facts |

Everything else quoted from the console (labels, block names, easing
presets, smoothing presets, RSSI colors, map tools, hold-to-stop, the 16 s
red timeout, 255 / 16 light limits, 300 pixels, 500 / 2500 µs) matched
the source and was kept.

## Writing changes

Every page was rewritten in the same voice. The rules are now in
`website/README.md` ("How to write a page") so new pages don't drift
back. In short: short sentences, commas and periods instead of em-dashes,
no catchphrases ("your mileage may vary" appeared three times), no
emoji in prose, no jokes at the reader's expense, and say plainly what
has not been tested. The console's own glyph labels (⌁ Connect USB node,
⊙ Sensor) stay, because that is what the reader sees on screen.

The generated board pages (`website/scripts/gen-boards.mjs`) got the
same pass on the prose it emits. The pin notes and guide lines come from
`boards/*.yaml` and are shared with the console; they were left as they
are. Changing them means regenerating `boards_gen.*` (a firmware and
console change), which is a separate task.

## Loose ends found on the way (not changed here)

- **Console: `OtaPanel.tsx` says "About six minutes a board."** Stale
  since the 921600 baud change (measured 3.5 min). Console text, so it
  belongs in a console PR.
- **README board table** still lists the Mini as C3 + microSD (known;
  status.md §3).
- **Board YAML pin notes** use dashes heavily ("input only, no internal
  pull — a button here needs an external resistor"). Fine as console
  hints, but they read terse on the site. If reworded, regenerate with
  `genboards.py` and update the site in the same commit.
- **Over-WiFi updates** still need `tools/ota_serve.py` on a computer;
  the site says "see the project's developer notes" because there is no
  user-facing page for it. Status.md already lists loading the image
  from the docs site as the next step.
- `website/README.md` said the firmware for the flasher is staged by CI;
  the flasher has still not been used on a real board (status.md §2
  item 7). The flash page's beta note says so.

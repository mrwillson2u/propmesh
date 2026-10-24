# The console on a phone — design (2026-10-24)

Where this comes from: `docs/software-plan.md` §5.1 (a phone or iPad
in the yard is a stated use), `docs/status.md` §4 (phone layout and a
placement mode on the handoff list), and Colin's direction on
2026-10-24: follow common mobile conventions; where a view really needs
landscape, say so and detect it; and make a real attempt at **editing a
sequence from the yard** — standing next to the prop, shaping its
animation — because that would change how the show gets built.

What a phone showed on 2026-10-24, before any of this: the sidebar took
176 of 390 px, the Show view split into two columns with the left one a
word per line, the Yard drew into a strip, and every control was mouse
sized. Screenshots in the session log; the simulator at `?sim=1` is how
to reproduce them at any width.

## 1. Who is holding it, and for what

Someone standing among the props, usually at dusk, often with one hand.
In order of how often, the phone is for:

1. Seeing what is up: which boards answer, battery, signal, the mesh
   drawing. (Yard)
2. Arming, stopping, STOP ALL, and watching the activity feed. (Show)
3. Firing a test on one output while looking at the prop. (Nodes)
4. Placing a board on the map while standing beside it. (Yard, later)
5. Editing a sequence while watching the prop do it. (Sequences)
6. Everything else — pin assignment, firmware, floods pairing — works
   but needn't be comfortable; those are laptop jobs.

## 2. The frame

- **One breakpoint.** Under 700 px wide is the phone layout; at and
  above it the current layout stands (a tablet keeps the sidebar, a
  phone turned sideways mostly does too). One hook, `useLayout()`,
  returns `{ phone, landscape }` from two media queries; everything
  reads it. The app styles inline, so there is no stylesheet to fork.
- **Bottom tab bar**, the convention on both platforms: Yard, Nodes,
  Sequences, Show, and a More tab holding Settings, Docs, Firmware and
  Disconnect. Labels under icons, 44 px tall plus the home-indicator
  inset.
- **STOP ALL is a fixed bar across the top**, always visible on every
  tab, the same hold-to-fire as now; the mode (Off / Ambient / Armed)
  and the bridge state sit in it. The one control that must never need
  finding.
- **Sheets, not side panels.** A board's detail on the Yard, a step's
  editor in Sequences, a confirm — a bottom sheet that slides up over
  the view and drags down to close. The browser's back gesture closes
  it too (a history entry per open sheet), because on a phone back is
  how people leave things.
- **Touch sizing.** 44 px minimum on anything tapped, 12 px between
  targets, text inputs at 16 px so iOS Safari does not zoom the page,
  no hover-only affordances (tooltips become a tap on an ⓘ).
- **Opens like an app.** A web-app manifest and icon so "Add to Home
  Screen" gives a full-screen console in the dark theme; the viewport
  set to `viewport-fit=cover` with the safe-area insets honored on the
  bars. The console keeps reconnecting by itself, so no pull-to-refresh.
- **Orientation.** `matchMedia("(orientation: landscape)")` on the same
  hook. A view can *prefer* landscape (the timeline does); in portrait
  it shows its portrait form plus a one-line, dismissable hint with a
  rotate glyph: "The timeline is easier sideways." Nothing is ever
  blocked on orientation; the hint is the whole affordance.

## 3. Yard

The map is what a phone opens to (the topology is a tap away). Pinch
to zoom, one finger to pan, tap a board for its sheet: name, state,
battery, signal, LAST CHECK-IN, the hears / heard-by lists, and the
test buttons for its outputs. **Placement mode** comes after the frame:
tap a board, tap where it stands, done; the map holds its position in
`propmesh.yard.doc` as it does from a laptop.

## 4. Show

One column: the mode buttons large across the top under the STOP bar,
the schedule line, then the activity feed. The show graph (React Flow)
prefers landscape and says so; in portrait it lists the rules as cards.

## 5. Nodes

The board tabs become a row that scrolls sideways. A board's rows stack
one setting per line; the TEST column's controls become full-width
buttons and sliders; the pinout drawing stays behind its toggle, closed
by default. Pin assignment works here but is not the point of a phone.

## 6. Sequences — the creative pass

The laptop editor is a timeline: tracks, keyframes, a ruler to scrub, a
step table. A phone cannot hold a timeline in portrait, and typing
times into a table with a thumb is misery. But a phone has two things a
laptop lacks: it is **next to the prop**, and it is held in a **hand
that can perform**. The design leans on both.

### 6.1 Moments, not a table

In portrait a sequence is a vertical list of **moments**: "at 0.0 s",
"at 0.2 s", "at 1.0 s". Each moment is a card listing what changes
then — chips like `jaw → 80 %`, `eyes → red`, `fog ON` — and tapping a
chip opens its sheet: a big slider or color control for the value, how
long to get there, the ease, and **nudge buttons** (±50 ms, ±5 %) in
place of precise typing. "+ at …" adds a moment, "+ after last" adds
one a beat later. This is the same data as the table (`Step {t_ms,
kind, index, value, dur_ms, ease}`), only grouped by time, so nothing
on the boards or in the laptop editor changes.

### 6.2 Scrub the prop with a thumb

A ruler along the bottom edge, thumb-draggable, with the moments as
ticks. Dragging it computes every track's value at that time (the
interpolation the boards do, done in the console) and sends it to the
boards as the existing live preview does. **The prop follows your
thumb.** Scrubbing to a point and pressing ▶ plays from there, which
the boards already support (`cue` takes `offset_ms`).

### 6.3 Perform mode — record the animation on the prop

This is the game changer Colin asked for. Pick the outputs you want to
animate (one or several). Press **REC**. The screen becomes big
controls, one per output: a slider for a servo, dimmer or candle, a
color pad for a strip or flood, a toggle for a relay or fog. A clock
runs. **Everything you do is sent to the prop live, and captured as
steps at the moment you did it.** You move the jaw with your thumb
while watching the skull; you tap the eyes red when it feels right.
Press STOP: the recording is a sequence.

How a gesture becomes steps: a slider drag from A to B over 400 ms
becomes one step — value B at the time the drag ended, reached over
400 ms, linear — not a hundred samples. A tap becomes a step at its
time. Times quantize to 50 ms. The result is the same `Step` list the
timeline shows, so it can be tidied in the moments list or on a laptop
afterward.

**Overdub:** with a sequence already recorded, REC again with a new
output selected plays the existing part on the boards (a `cue`) while
you perform the new track on top, in time with it. Layer by layer, one
output at a time, which is also how a thumb works.

**Why it fits the system:** the boards need no new command — live
values use `set`, playback uses `cue`, saving uses `set_sequence` as
today. The console does the capturing. The mesh latency (tens of ms)
is below the quantization, and the boards play the saved sequence on
the shared clock, so what you performed is what the show plays.

### 6.4 Landscape: the timeline, with fingers

Turned sideways, the full timeline appears, with touch: drag a keyframe
to move it, long-press to add one, pinch to zoom, two-finger drag to
pan, the ruler to scrub. In portrait the hint says it is there. Nobody
has to use it; the moments list and perform mode cover the yard case.

## 7. Order of work

1. **Frame**: the hook, the tab bar, the STOP bar, sheets, touch
   sizing, manifest and icon, orientation hint plumbing. One PR. The
   laptop layout is untouched by it.
2. **Yard** on a phone: map first, pinch and pan, the board sheet.
3. **Show** one-column.
4. **Sequences**: the moments list and the scrub ruler (6.1, 6.2).
5. **Perform mode** (6.3), after Colin has tried 4.
6. **Nodes** polish; the landscape timeline (6.4); placement mode.

Each step ships on its own and is tried on a real phone in the yard
before the next; what the phone showed goes here, candidly.

## 8. Open questions for Colin

- Perform mode records absolute times from REC; should REC wait for the
  first touch, so the sequence starts at the first move rather than
  with dead air? (Proposed: yes, start at first touch, with a 3-2-1
  count-in option for overdubs.)
- A relay or fog in perform mode: hold-to-fire (on while held) or tap
  to toggle? (Proposed: toggle, since holds are hard to time.)
- Strip colors: a color wheel, or a row of the sequence's recent colors
  plus the wheel? (Proposed: recent colors first — in the yard you reuse
  three colors, not thirty.)
- Should a phone be allowed to Save to boards, or only to edit and ▶
  Play, leaving save to the laptop? (Proposed: allowed; the yard is
  where you know it is right.)

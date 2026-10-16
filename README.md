# PropMesh

Open-source wireless control for Halloween and holiday props.

Small ESP32 boards hidden in your props talk to each other by radio. A
sensor at the gate can set off a skeleton by the porch, a light show can
come on at dusk, and nothing needs wires across the lawn or an internet
connection. You set it all up from a web page, with no code.

**Using PropMesh?** Start at the docs site:
**[mrwillson2u.github.io/propmesh](https://mrwillson2u.github.io/propmesh/)**.
It has step-by-step guides, a page for each supported board, an installer
that puts the firmware on a board from your browser, and a copy of the
console you can try with no hardware.

This README is for people working on PropMesh itself.

> **Beta.** PropMesh runs the project's own yard for Halloween 2026 on
> off-the-shelf boards, and it changes quickly. Some features haven't
> been tried on real hardware yet. The docs site and
> [`docs/status.md`](docs/status.md) say which.

## What works today

The firmware runs on inexpensive ESP32 dev boards. You plug a board in,
open the console, and tell it what each pin does: relay, LED dimmer,
servo, DC motor, LED strip, or sensor. The board stores that and runs on
its own.

- **Mesh.** Boards pass messages to each other over ESP-NOW, so a far
  prop only needs to hear another board, not your WiFi. One board is the
  **bridge**: it connects the console to the mesh by USB or home WiFi and
  keeps the shared clock.
- **Shows.** Timed sequences across any outputs on any boards, triggers
  built as a graph (delay, cooldown, lockout, random pick, chains), a
  schedule tied to sunset, and STOP ALL. The show is stored on the boards
  and keeps running with the laptop closed.
- **Lights.** WS2812 and SK9822/APA102 strips, a fire effect, and BRMesh
  Bluetooth flood lights paired straight from the console.
- **Updates over the air,** through the mesh or over WiFi, resumable,
  with automatic rollback.
- **Battery boards.** Deep sleep, check-ins on a shared clock grid, and
  an optional repeater mode that relays while the show runs.
- **Yard view.** Mesh health by signal strength, and a map of your yard
  you can draw on.

| Board | Status |
|---|---|
| ESP32 DevKit V1 (30-pin) | Runs the project's yard |
| Adafruit HUZZAH32 Feather | Partly tested |
| ESP32-C6 SuperMini | Built, not yet flashed |
| ESP32-C3 SuperMini | Built, not yet flashed |

Each board's page on the docs site has the details. To support another
board, see [Adding a board](#adding-a-board).

## PropMesh's own boards (in design)

Two purpose-built boards run the same firmware and console. The PCBs
come after Halloween 2026, aiming at the 2027 season. Designs are in
[`hardware/`](hardware/) under CERN-OHL-S.

| | **PropMesh Pro** | **PropMesh Mini** |
|---|---|---|
| For | a prop that does everything | a small prop on a battery |
| MCU | ESP32-S3-WROOM-1 / 1U (N8R2) | ESP32-S3-WROOM-1U-N16R2 |
| Power | 12–30 V DC | 1S Li-ion |
| Motors | 2 stepper sockets (each can run 2 brushed DC) + 2 brushed DC | — |
| Servos | 6 | pending |
| Relays (dry contact, 30 V max) | 3 | pending |
| Addressable LED | 2 (3- or 4-wire) | pending |
| Dimmable LED | 6 | pending |
| Sensors | 3 digital, 2 analog | pending |
| Audio | I²S + microSD | I²S, sounds stored in flash |
| State | schematic done; layout next | module chosen; pin allocation being redone for the S3 |

"Pending" means the Mini's earlier ESP32-C3 plan was replaced on
2026-09-19 and its new allocation isn't finished. Neither board switches
mains power. That is a design decision; see [`CLAUDE.md`](CLAUDE.md).

## Origins

PropMesh grew out of one-off prop controllers built for the 2024 and
2025 seasons: a painlessMesh network of ESP32-C3s, a stepper-driven prop
lid, a fire-effect lantern, and a bridge for Bluetooth flood lights.
Those prototypes are kept in [`reference/`](reference/), with
credentials removed. This repository started in September 2026 to turn
them into one system.

## How it is tested

A feature counts as done when it has run on real boards. The host test
suite (`firmware/test/`) covers the pure logic: pin rules, show
scheduling, sunrise and sunset, ramps, mesh framing and reassembly.
Bench results, with dates and numbers, are recorded in
[`docs/generic-boards.md`](docs/generic-boards.md) next to each
feature's design; anything that has not yet run on hardware is marked
there, in [`docs/status.md`](docs/status.md), and on the docs site.

## Repository layout

```
docs/status.md          START HERE: where things stand, what's next, bench tests waiting
docs/generic-boards.md  the firmware that runs today: design, APIs, bench results per feature
docs/software-plan.md   architecture, mesh protocol, console plan, licensing
docs/hardware-spec.md   Pro and Mini: BOM, costs, mechanical, manufacturing

firmware/node/          the node firmware (PlatformIO), one env per board profile
firmware/common/        shared code: propmesh/ (mesh core, pure logic, generated
                        headers) and propmesh-node/ (drivers, API, sleep, OTA, sync)
firmware/test/          host tests (pio test -e native)
firmware/mesh-node/     the early ESP-NOW testbed (Sept 2026), kept building in CI

console/                the web console (Vite + React + TypeScript), with a simulator
website/                the docs site (Astro Starlight), browser flasher, screenshots

boards/                 SOURCE OF TRUTH: what each pin of a supported dev board can do
pinmap.yaml             SOURCE OF TRUTH: Pro / Mini pin assignments
schema/messages.yaml    SOURCE OF TRUTH: mesh messages and enums

tools/                  generators (genboards, genmsg, genpins), bridge.py, ota_serve.py,
                        and KiCad helpers for the hardware (checknet, checksetup, …)
hardware/               KiCad projects for the Pro and the Mini
reference/              pre-PropMesh prototypes (2024–25), scrubbed; see its README
```

Generated files are never edited by hand. Edit the source, regenerate,
and commit both. CI fails if they disagree.

```
python3 tools/genboards.py     # boards/*.yaml   -> boards_gen.h, boards_gen.ts
python3 tools/genmsg.py        # schema/*.yaml   -> proto_gen.h, proto_gen.ts
python3 tools/genpins.py       # pinmap.yaml     -> pins_*.h
# add --check to verify instead of write
```

## Getting started as a developer

You need Python 3, Node 22, and PlatformIO.

```
git clone https://github.com/mrwillson2u/propmesh.git && cd propmesh
git checkout dev
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt platformio pyserial
npm ci --prefix console && npm ci --prefix website
```

**Firmware**

```
pio test -d firmware/test -e native                         # host tests
pio run  -d firmware/node -e esp32-devkit-v1                # build
pio run  -d firmware/node -e esp32-devkit-v1 -t upload      # flash a board on USB
```

Board envs: `esp32-devkit-v1`, `esp32-huzzah32`, `esp32-c6-supermini`,
`esp32-c3-supermini`. On Linux, USB serial needs your user in the
`dialout` group.

**Console**

```
npm run dev --prefix console        # then open http://localhost:5173/?sim=1
```

`?sim=1` connects to a simulated bridge with two boards behind it, so you
can work on the UI with no hardware. USB connections need Chrome or Edge.

**Docs site**

```
npm run dev --prefix website        # http://localhost:4321/propmesh/
```

`website/README.md` covers the board pages, the flasher, the screenshots
and how to write a page.

**Talking to a live mesh from a terminal**

```
python3 tools/bridge.py --host propmesh.local status
```

This reaches the bridge over WiFi, so nothing gets reset by opening a USB
port. `docs/status.md` §5 covers working on a separate server, tunnels,
and serving firmware for updates.

## Adding a board

A board works with PropMesh once it has a **profile**: a YAML file in
[`boards/`](boards/) listing what each pin can do and what to warn about.

1. Copy an existing profile and fill it in from the seller's pinout and
   the chip datasheet's strapping-pin table.
2. Add its `board_type` to `BoardType` in `schema/messages.yaml`.
3. Run `python3 tools/genmsg.py && python3 tools/genboards.py`. The
   generator refuses advice the pin can't follow.
4. Add an env to `firmware/node/platformio.ini` with
   `-DPM_BOARD_PROFILE=PM_BOARD_<ID>`.

The board's page on the docs site and its pinout in the console are
generated from the same file. Not comfortable doing this? Use the
[board request form](https://github.com/mrwillson2u/propmesh/issues/new?template=board-request.yml).

## Contributing

Pull requests go to **`dev`**. `main` only takes PRs from `dev` and
publishes the docs site. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first:
it has the checks to run and the sign-off each commit needs.

The decisions in [`CLAUDE.md`](CLAUDE.md) under "Locked design decisions"
were settled after analysis. To change one, say why its reasoning no
longer holds. Bugs, questions and reports from real yards go in
[issues](https://github.com/mrwillson2u/propmesh/issues).

## License

Copyleft open source: use it, change it, sell things built with it, but
share your changes and keep the credit. Details and reasoning:
[`LICENSING.md`](LICENSING.md).

| Part | License |
|---|---|
| Firmware, tools, board profiles | GPL-3.0-or-later |
| Console (web app) | AGPL-3.0-or-later |
| Board designs (`hardware/`) | CERN-OHL-S-2.0 |
| Docs and the docs site's text | CC BY-SA 4.0 |

The PropMesh name and logo: [`TRADEMARK.md`](TRADEMARK.md). Credits and
third-party code: [`THIRD_PARTY.md`](THIRD_PARTY.md).

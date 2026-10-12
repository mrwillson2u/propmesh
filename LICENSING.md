# Licensing

PropMesh is open source under **copyleft** licenses: use it, change it,
share it, sell things built with it — but if you distribute a changed
version, you publish your changes under the same license and keep the
credit. What it rules out is a closed, proprietary product built on this
work.

Copyright © 2024–2026 Colin Willson.

| What | Where | License | File |
|---|---|---|---|
| Firmware, tools, board profiles, protocol schema — everything not listed below | `firmware/`, `tools/`, `boards/`, `schema/`, `pinmap.yaml`, `reference/` | **GPL-3.0-or-later** | [`LICENSE`](LICENSE) |
| Control console (web app) | `console/` | **AGPL-3.0-or-later** | [`console/LICENSE`](console/LICENSE) |
| Board designs (KiCad sources, fabrication notes) | `hardware/` | **CERN-OHL-S-2.0** | [`hardware/LICENSE`](hardware/LICENSE) |
| Documentation | `docs/`, the Markdown in the repository root | **CC BY-SA 4.0** | [`docs/LICENSE`](docs/LICENSE) |

## What that means in practice

- **Build it, run your show, change it** — no permission needed, nothing
  owed, commercial or not. A paid haunted attraction running PropMesh is
  fine.
- **Make your own boards from these designs, or variations of them** —
  fine, and welcome. Sell them if you like; if you changed the design,
  publish your changed KiCad sources under CERN-OHL-S-2.0.
- **Ship a product with changed PropMesh firmware or console** — publish
  that source under the same license to everyone you ship it to (GPL),
  and to everyone who uses a changed console over a network (AGPL).
  GPL-3.0 also means owners must be able to install their own firmware.
- **Keep the credit.** Copyright notices and license files stay with the
  code, the designs and the docs.
- **The name is separate.** These licenses cover the work, not the
  PropMesh name or logo — see [`TRADEMARK.md`](TRADEMARK.md).

## Commercial licenses

Want to build a closed-source product on PropMesh? That is what the
licenses rule out by default, but the copyright holder can grant an
exception. Open an issue or get in touch through GitHub.

## Why these (decided 2026-10-12)

The concern was a company taking the work, changing it and selling a
closed product. Copyleft answers exactly that while staying open source
(a "non-commercial" clause would not be open source, and would also shut
out the haunted-attraction and display community this is for). The same
pressure moved WLED from MIT to a copyleft license in 2023; Tasmota and
ESPHome's device code are GPL-3.0. The console is AGPL so a hosted,
changed console can't be kept closed by never "distributing" it. The
boards are CERN-OHL-S rather than the weak -W: variations are welcome,
closed variations aren't. Earlier drafts said MIT / CERN-OHL-W / CC BY-SA
(hardware-spec §6, 2026-09) — superseded.

Third-party code and the work this builds on: [`THIRD_PARTY.md`](THIRD_PARTY.md).

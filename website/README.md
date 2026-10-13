# PropMesh docs site

The user documentation at **https://mrwillson2u.github.io/propmesh/** —
guides, a page per board, the browser flasher, and a "try it" copy of
the console running its simulator. Built with
[Astro Starlight](https://starlight.astro.build).

```
npm install
npm run dev        # http://localhost:4321/propmesh/
npm run build      # → dist/
```

- **Pages** are Markdown/MDX in `src/content/docs/`; the sidebar is in
  `astro.config.mjs`. Write for someone who has never soldered: lead
  with what they'll build, one happy path, details in `<Aside>`s. The
  voice rules are below.
- **Board pages are generated** from `boards/*.yaml` by
  `scripts/gen-boards.mjs` (runs before `dev` and `build`) — fix a board
  page by editing its yaml. They, `public/boards/`, `public/firmware/`
  and `public/console/` are gitignored.
- **Firmware for the flasher**: `.github/workflows/site.yml` builds every
  board with PlatformIO and runs `scripts/stage-firmware.mjs`. Locally,
  run it after `pio run -d firmware/node -e <board>` to stage what you built.
- **Try it**: the workflow builds `console/` and copies `dist/` to
  `public/console/`; the page links `console/?sim=1`.

Design notes for the project itself stay in `../docs/` — this site is for
people using PropMesh.

## How to write a page

The reader is someone building a yard display who may never have used a
microcontroller. Professional, friendly, and never showy. Audited
2026-10-13 (`../docs/site-audit-2026-10-13.md`); keep new pages to this.

- **Short sentences, one idea each.** Commas and periods, not em-dashes.
  A dash in a table cell is fine; a dash joining two clauses is not.
- **Say what the reader does, then what they see.** "Press **Save to
  node**. The LED dims." Quote the console's labels exactly, glyphs
  included, and check them against `console/src` before publishing.
- **No catchphrases or jokes.** No "your mileage may vary", "gold",
  "👻". No exclamation marks. Wit is fine; a wink at the reader is not.
- **Be plain about what is untested.** If a feature hasn't run on real
  hardware, say so in a caution aside on that page (see LED strips),
  and take it out when it has. `boards/*.yaml` `status` is the board
  version of this.
- **Numbers come from the source**, not from memory: firmware
  constants, `generic-boards.md` bench figures, `boards/*.yaml`. If a
  figure has a date in the design notes, check it is still current.
- **Don't state project policy as a hardware limit.** "No mains
  switching" is advice and a design decision; "D12 must be low at boot"
  is a chip limit. Say which.
- **US English** (color, gray, center).

Page text is CC BY-SA 4.0; the site's code is GPL-3.0-or-later
(`../LICENSING.md`).

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
  with what they'll build, one happy path, details in `<Aside>`s.
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

Page text is CC BY-SA 4.0; the site's code is GPL-3.0-or-later
(`../LICENSING.md`).

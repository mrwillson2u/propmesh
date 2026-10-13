// Board pages for the docs site, generated from boards/*.yaml — the same
// files the firmware and console are generated from, so the site can't
// disagree with what the console offers.
//
//   node scripts/gen-boards.mjs        (runs before `dev` and `build`)
//
// Writes src/content/docs/boards/<id>.md, the comparison page
// (boards/index.md) and public/boards/<id>.svg (the pinout drawing).
// All generated — never edit them; they are gitignored.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const pagesDir = join(here, "..", "src", "content", "docs", "boards");
const svgDir = join(here, "..", "public", "boards");

const fns = parse(readFileSync(join(root, "boards", "functions.yaml"), "utf8")).functions;
const boards = readdirSync(join(root, "boards"))
  .filter((f) => f.endsWith(".yaml") && f !== "functions.yaml")
  .map((f) => parse(readFileSync(join(root, "boards", f), "utf8")))
  .sort((a, b) => a.name.localeCompare(b.name));

// Plain-English names for what a pin can do, in the order people care about.
const CAPS = { out: "output", in: "input", pullup: "pull-up", pulldown: "pull-down", adc: "analog", wake: "wakes from sleep" };
const SHORT = { RELAY: "relay", LED: "LED", SERVO: "servo", MOTOR: "motor", LED_STRIP: "strip", SPI_STRIP: "strip", DIGITAL_IN: "sensor" };
const TIER = { good: "✅ good", caution: "⚠️ caution", reserved: "⛔ reserved" };
const fnLabel = (k) => fns[k]?.label ?? k;
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// The pinout drawing: the two headers as printed, USB at the bottom, each
// GPIO colored by tier and tagged with what it's best for.
function pinoutSvg(b) {
  const h = b.header;
  const byLabel = new Map(b.pins.map((p) => [String(p.label), p]));
  const rows = Math.max(h.left.length, h.right.length);
  const ROW = 24, TOP = 34, W = 560, BODY_X = 200, BODY_W = 160;
  const H = TOP + rows * ROW + 46;
  const color = (p) => (!p ? "#5b6270" : p.tier === "good" ? "#4fbf6a" : p.tier === "caution" ? "#e8a33a" : "#e05252");
  const side = (labels, left) => labels.map((lab, i) => {
    const p = byLabel.get(String(lab)), y = TOP + i * ROW + ROW / 2;
    const padX = left ? BODY_X - 1 : BODY_X + BODY_W - 13;
    const tx = left ? BODY_X - 20 : BODY_X + BODY_W + 20;
    const tag = p?.best ? SHORT[p.best] ?? p.best : p?.tier === "reserved" ? "reserved" : "";
    const tagX = left ? 18 : W - 18;
    return `<rect x="${padX}" y="${y - 6}" width="14" height="12" rx="2" fill="${color(p)}"/>`
      + `<text x="${tx}" y="${y + 4}" text-anchor="${left ? "end" : "start"}" class="l${p ? "" : " pw"}">${x(lab)}${p ? `<tspan class="g"> ${p.gpio}</tspan>` : ""}</text>`
      + (tag ? `<text x="${tagX}" y="${y + 4}" text-anchor="${left ? "start" : "end"}" class="t" fill="${color(p)}">${x(tag)}</text>` : "");
  }).join("");
  const usbY = h.usb === "bottom" ? TOP + rows * ROW + 6 : TOP - 30;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">
<style>.l{font-size:12px;fill:#e6e8ec;font-weight:600}.pw{fill:#8b93a1;font-weight:500}.g{fill:#8b93a1;font-weight:400;font-size:10.5px}.t{font-size:11px;font-weight:600}</style>
<rect width="${W}" height="${H}" rx="12" fill="#14171c"/>
<rect x="${BODY_X}" y="${TOP - 10}" width="${BODY_W}" height="${rows * ROW + 20}" rx="8" fill="#1f3a2c" stroke="#2f5a43"/>
<rect x="${BODY_X + 35}" y="${TOP + 14}" width="${BODY_W - 70}" height="${Math.min(110, rows * ROW * 0.4)}" rx="4" fill="#2a2e35" stroke="#3a3f48"/>
<text x="${BODY_X + BODY_W / 2}" y="${TOP + 14 + Math.min(110, rows * ROW * 0.4) / 2 + 4}" text-anchor="middle" font-size="10" fill="#8b93a1">${x(b.mcu)}</text>
<rect x="${BODY_X + BODY_W / 2 - 22}" y="${usbY}" width="44" height="22" rx="4" fill="#9aa3b3"/>
<text x="${BODY_X + BODY_W / 2}" y="${usbY + 15}" text-anchor="middle" font-size="10" font-weight="700" fill="#14171c">USB</text>
${side(h.left, true)}${side(h.right, false)}
</svg>
`;
}

function boardPage(b) {
  const L = [];
  const strips = b.rmt_tx_channels;
  L.push("---", `title: ${JSON.stringify(b.name)}`,
    `description: ${JSON.stringify(`Which pins to use on the ${b.name} with PropMesh, and why.`)}`,
    "---", "",
    "{/* GENERATED from boards/" + b.id + ".yaml by website/scripts/gen-boards.mjs — edit the yaml, not this file. */}", "");
  L.push("import { Aside, Badge } from '@astrojs/starlight/components';", "");
  L.push(`| | |`, `|---|---|`,
    `| **Chip** | ${esc(b.mcu)} |`,
    `| **Dimmers, servos & motors** | ${b.ledc_channels} PWM channels (a motor takes 2) |`,
    `| **LED strips (WS2812)** | up to ${strips} |`,
    `| **Battery** | ${b.battery ? "built-in LiPo connector and charger — battery level is reported" : "no — power it from USB or a 5 V supply"} |`,
    `| **Firmware** | \`${b.id}\` — [install it from your browser](/propmesh/start/flash/?board=${b.id}) |`, "");
  L.push("## Pinout", "");
  if (b.header) {
    L.push(`![Pinout of the ${b.name}: each GPIO colored green (good), amber (caution) or red (reserved), labeled with what it's best for](/propmesh/boards/${b.id}.svg)`, "");
    L.push("Green pins are good for anything they can do. Amber pins work but have a quirk — read the note below before putting a relay or motor on one. Red pins are taken by the board itself. Gray pins are power and control (GND, 3V3, EN…).", "");
  } else {
    L.push(`<Aside>Different sellers lay this board's pins out in a different order, so there is no drawing here — go by the **GPIO numbers printed on the board** and the table below.</Aside>`, "");
  }
  if (b.pinout_url) L.push(`The seller-style pinout with photos: [${new URL(b.pinout_url).hostname}](${b.pinout_url}).`, "");

  L.push("## Which pin for what", "",
    "The console marks these with ★ when you assign pins. They're advice — any pin that *can* do a job is allowed.", "",
    "| To connect… | Use | Why |", "|---|---|---|");
  for (const [k, why] of Object.entries(b.guide ?? {})) {
    const best = b.pins.filter((p) => p.best === k).map((p) => `\`${p.label}\``);
    L.push(`| ${esc(fnLabel(k))} | ${best.join(" ") || "—"} | ${esc(why)} |`);
  }
  L.push("");

  L.push("## Every pin", "", "| Pin | GPIO | | Can be | Note |", "|---|---|---|---|---|");
  for (const p of b.pins) {
    const can = (p.caps ?? []).map((c) => CAPS[c] ?? c).join(", ");
    L.push(`| \`${esc(p.label)}\` | ${p.gpio} | ${TIER[p.tier] ?? p.tier} | ${esc(can)} | ${esc(p.note ?? "")} |`);
  }
  L.push("");
  if (b.battery) L.push(`<Aside title="Battery sense">GPIO ${b.battery.gpio} reads the battery through a ${b.battery.divider}:1 divider. It isn't on a header and can't be assigned — the board reports its battery voltage on its own.</Aside>`, "");
  return L.join("\n");
}

function indexPage() {
  const L = ["---", "title: Choosing a board", "description: The boards PropMesh runs on today, side by side.", "sidebar:", "  order: 0", "---", "",
    "{/* GENERATED from boards/*.yaml by website/scripts/gen-boards.mjs. */}", "",
    "PropMesh runs on inexpensive ESP32 development boards. Every board below runs the **same firmware features** — the mesh, triggers, LED strips and fire, Bluetooth flood lights, updates over the air — and you can mix them in one show.", "",
    "| Board | Chip | PWM channels | LED strips | Battery | Pick it if… |", "|---|---|---|---|---|---|"];
  const why = {
    "esp32-devkit-v1": "you want the easy default: cheap, everywhere, lots of pins.",
    "esp32-huzzah32": "the prop runs on a battery — it has a LiPo charger built in.",
    "esp32-c6-supermini": "you need it tiny, or a battery prop with a very low sleep current.",
  };
  for (const b of boards) L.push(`| [${b.name}](/propmesh/boards/${b.id}/) | ${esc(b.mcu)} | ${b.ledc_channels} | ${b.rmt_tx_channels} | ${b.battery ? "built in" : "external"} | ${why[b.id] ?? ""} |`);
  L.push("", "**Not sure? Get an ESP32 DevKit V1.** It's the board everything is tested on first.", "",
    "One board in every show is the **bridge**: it stays plugged into your computer or on WiFi and connects the console to all the others. Any board can be the bridge — it's a switch in the console.", "",
    "Using a board that isn't listed? It needs a profile — a short file describing what each pin can do. See [Contributing](/propmesh/contribute/).");
  return L.join("\n");
}

rmSync(pagesDir, { recursive: true, force: true });
rmSync(svgDir, { recursive: true, force: true });
mkdirSync(pagesDir, { recursive: true });
mkdirSync(svgDir, { recursive: true });
for (const b of boards) {
  writeFileSync(join(pagesDir, `${b.id}.mdx`), boardPage(b));
  if (b.header) writeFileSync(join(svgDir, `${b.id}.svg`), pinoutSvg(b));
}
writeFileSync(join(pagesDir, "index.mdx"), indexPage());
console.log(`gen-boards: ${boards.length} boards → src/content/docs/boards, public/boards`);

// Regression test for the console's number fields (2026-10-16): type into
// every one like a person (click, select all, type, Tab) and check the field
// keeps what was typed. Needs a console dev server:
//   npm run dev --prefix ../console -- --port 5182   then   npm run test:fields
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const base = process.argv[2] ?? "http://127.0.0.1:5182";
const show = JSON.parse(readFileSync(new URL("./seed.json", import.meta.url)));
const seed = {
  ...show,
  "propmesh.sim.5c0ffee2": { v: 1, name: "Candle", bridge: false, power: "battery", brmesh_key: "5e367bc4",
    sleep: { interval_ms: 1000, window_ms: 100, checkin_ms: 300000 }, channels: [
    { kind: "CANDLE", index: 1, label: "taper", pins: [25, 26], active_low: true,
      candle: { drama10: 10, floor: 3, gust_s: 18, sputter_s: 150, swing_chz: 270, kick_ms: 25, coil: true } },
    { kind: "LED_STRIP", index: 1, label: "flame", pins: [17], pixels: 8, order: "grb", effect: "fire",
      fire: { w: 2, h: 4, zigzag: true, brightness: 128, speed: 2, flame10: 30, noise: 0, smoke_speed: 25, smoke_dim: 250, smoke_scale: 125 } },
    { kind: "DIGITAL_IN", index: 1, label: "doormat", pins: [35], pull: "none", active_low: false },
  ] },
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addInitScript((s) => { localStorage.clear(); for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v)); }, seed);
const p = await ctx.newPage();
const results = [];
async function typeInto(name, box, typed, want) {
  try {
    await box.scrollIntoViewIfNeeded({ timeout: 3000 });
    await box.click({ timeout: 3000 });
    await p.keyboard.press("Control+A");
    const seen = [];
    for (const ch of typed) { await p.keyboard.type(ch); seen.push(await box.inputValue()); }
    await p.keyboard.press("Tab"); await p.waitForTimeout(200);
    const got = await box.inputValue();
    results.push({ name, typed, want, got, ok: got === want, seen: seen.join(" → ") });
  } catch (e) { results.push({ name, typed, want, got: "(not found)", ok: false, seen: e.message.split("\n")[0] }); }
}
const byLabel = (text) => p.locator(`xpath=//label[starts-with(normalize-space(.), "${text}")]//input[not(@type="checkbox")]`).first();
const afterSpan = (text) => p.locator(`xpath=//span[normalize-space(.)="${text}"]/following-sibling::input[1]`).first();

// Pin editor: Candle board
await p.goto(`${base}/?sim=1&view=nodes`); await p.waitForTimeout(5500);
await p.getByText("Candle", { exact: true }).first().click(); await p.waitForTimeout(1500);
for (const [l, t, w] of [["swing", "2.85", "2.85"], ["swing", "3", "3.00"], ["drama", "1.3", "1.3"], ["drama", "0.5", "0.5"], ["floor", "12", "12"],
  ["gust every", "45", "45"], ["sputter every", "600", "600"], ["kick", "18", "18"], ["kick", "8", "8"], ["kick", "200", "80"],
  ["flame", "4.5", "4.5"], ["brightness", "200", "200"], ["smoke speed", "40", "40"], ["pixels", "8", "8"]])
  await typeInto(`pins: ${l}`, byLabel(l), t, w);
await typeInto("sleep: listen for", afterSpan("While the show runs, listen for"), "50", "50");
await typeInto("sleep: ms of every", afterSpan("ms of every"), "750", "750");
await typeInto("sleep: check in every", afterSpan("When the show is off, deep-sleep and check in every"), "600000", "600000");
// Skeleton: servo
await p.getByText("Skeleton", { exact: true }).first().click(); await p.waitForTimeout(1500);
await typeInto("servo: min", byLabel("min"), "650", "650");
await typeInto("servo: max", byLabel("max"), "2350", "2350");
// Sequences
await p.goto(`${base}/?sim=1&view=sequences`); await p.waitForTimeout(5500);
await p.getByText("Skeleton pops up").first().click(); await p.waitForTimeout(1500);
const stepRow = p.locator('xpath=//span[text()="AT (s)"]/parent::div/following-sibling::div[1]');
await typeInto("sequence: AT", stepRow.locator("input").first(), "0.35", "0.35");
{ // the list re-sorts by time on leaving the field: look for the step anywhere
  const ats = await p.locator('xpath=//span[text()="AT (s)"]/parent::div/following-sibling::div').evaluateAll((rows) => rows.map((r) => r.querySelector('input')?.value).filter(Boolean));
  const r = results[results.length - 1];
  r.ok = ats.includes("0.35"); r.got = r.ok ? "0.35 (re-sorted)" : r.got; r.seen += "  rows now: " + ats.join(", ");
}
// Show: graph cooldown + lockout, then schedule
await p.goto(`${base}/?sim=1&view=show`); await p.waitForTimeout(5500);
await typeInto("graph: cooldown", p.locator(`xpath=//span[contains(., "before it fires again")]/parent::label//input`).first(), "1.5", "1.5");
await p.getByText("Schedule…").first().click(); await p.waitForTimeout(900);
await typeInto("schedule: latitude", p.getByPlaceholder("latitude"), "40.71", "40.71");
await typeInto("schedule: longitude", p.getByPlaceholder("longitude"), "-74.01", "-74.01");
await typeInto("schedule: quiet-hours limit", p.locator(`xpath=//span[contains(., "lasts at most")]/following-sibling::input[1]`).first(), "90", "90");
// Yard map scale
await p.goto(`${base}/?sim=1&view=yard&layout=map`); await p.waitForTimeout(5000);
await typeInto("yard: 1 square =", p.locator(`xpath=//span[contains(., "1 square =")]//input`).first(), "10", "10");

for (const r of results) console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(26)} typed ${String(r.typed).padEnd(7)} → ${String(r.got).padEnd(8)} want ${r.want.padEnd(7)} typing: ${r.seen}`);
console.log(`${results.filter((r) => r.ok).length}/${results.length} pass`);
await b.close();

// Screenshots of the PropMesh console for the docs site, taken from the
// simulator with a seeded show.   node shoot.mjs <outdir> [baseUrl]
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? join(here, "out");
const base = process.argv[3] ?? "http://127.0.0.1:5180";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function session(seedFile, run) {
  const seed = JSON.parse(readFileSync(join(here, seedFile), "utf8"));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: "dark" });
  await ctx.addInitScript((seed) => {
    localStorage.clear();
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, JSON.stringify(v));
    localStorage.setItem("propmesh.yard.unplaced", "hide");
  }, seed);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  const shot = async (name, wait = 400) => { await page.waitForTimeout(wait); await page.screenshot({ path: join(out, name + ".png") }); console.log("shot", name); };
  const go = async (q, settle = 6500) => { await page.goto(`${base}/?sim=1&${q}`); await page.waitForTimeout(settle); };
  const step = async (name, fn) => { try { await fn(); } catch (e) { console.log(`SKIP ${name}: ${e.message.split("\n")[0]}`); } };
  await run({ page, shot, go, step });
  await ctx.close();
}

await session("seed.json", async ({ page, shot, go, step }) => {
  await go("view=yard&layout=topology"); await shot("yard-topology");
  await step("yard-topology-detail", async () => { await page.getByText("Skeleton", { exact: true }).first().click(); await shot("yard-topology-detail"); });
  await go("view=yard&layout=map"); await shot("yard-map");

  await go("view=nodes"); await shot("nodes-roster");
  await step("nodes-pins", async () => {
    await page.getByText("Skeleton", { exact: true }).first().click(); await page.waitForTimeout(1500); await shot("nodes-pinout");
    await page.evaluate(() => document.getElementById("pin-row-13")?.scrollIntoView({ block: "start" }));
    await shot("nodes-pins", 800);
  });
  await step("nodes-floods", async () => { await page.getByText("Floods").first().click(); await page.waitForTimeout(1500); await shot("nodes-floods"); });
  await step("nodes-firmware", async () => { await page.getByText("Firmware").first().click(); await page.waitForTimeout(1500); await shot("nodes-firmware"); });
  await step("nodes-bridge", async () => { await page.getByText("Bridge", { exact: true }).first().click(); await page.waitForTimeout(1500); await shot("nodes-bridge"); });

  await go("view=sequences");
  await step("sequences", async () => { await page.getByText("Skeleton pops up").first().click(); await page.waitForTimeout(1500); await shot("sequences"); });

  await go("view=show"); await shot("show-graph");
  await step("show-list", async () => { await page.getByText("List", { exact: true }).first().click(); await shot("show-list", 800); });
  await step("show-schedule", async () => {
    await page.getByText("Schedule…").first().click(); await page.waitForTimeout(800);
    await page.getByPlaceholder("latitude").fill("40.71"); await page.getByPlaceholder("longitude").fill("-74.01");
    await page.getByPlaceholder("longitude").blur(); await shot("show-schedule", 1200);
  });
  await step("stop-all", async () => {
    await go("view=show", 3000);
    const b = page.getByText("STOP ALL", { exact: true }).first();
    const box = await b.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.waitForTimeout(1900); await page.mouse.up();
    await shot("stop-all", 1500);
  });
});

await session("seed-first-scare.json", async ({ page, shot, go, step }) => {
  await go("view=nodes");
  await step("first-scare-pins", async () => {
    await page.getByText("Skeleton", { exact: true }).first().click(); await page.waitForTimeout(1500);
    await page.evaluate(() => document.getElementById("pin-row-2")?.scrollIntoView({ block: "start" }));
    await shot("first-scare-pins", 800);
  });
  await go("view=sequences");
  await step("first-scare-sequence", async () => { await page.getByText("Eyes flash").first().click(); await page.waitForTimeout(1500); await shot("first-scare-sequence"); });
  await go("view=show"); await shot("first-scare-graph");
});

await browser.close();

// Stage built firmware for the browser flasher (ESP Web Tools).
//
//   node scripts/stage-firmware.mjs <version>
//
// For every board in boards/*.yaml whose build exists
// (firmware/node/.pio/build/<id>/firmware.factory.bin — the merged image
// the platform writes beside firmware.bin, flashed at offset 0), copies
// it to public/firmware/<id>/ and writes the manifest the install button
// reads. CI runs `pio run` for every env first; locally, whatever you've
// built gets staged. public/firmware is gitignored.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "..", "public", "firmware");
const version = process.argv[2] || "dev";

// ESP Web Tools' chip names, from the board profile's module/chip.
const family = (mcu) => {
  const m = String(mcu).toUpperCase();
  for (const f of ["ESP32-C6", "ESP32-C3", "ESP32-S3", "ESP32-S2", "ESP32-H2"]) if (m.startsWith(f)) return f;
  return "ESP32";
};

rmSync(out, { recursive: true, force: true });
let n = 0;
for (const f of readdirSync(join(root, "boards"))) {
  if (!f.endsWith(".yaml") || f === "functions.yaml") continue;
  const b = parse(readFileSync(join(root, "boards", f), "utf8"));
  const bin = join(root, "firmware", "node", ".pio", "build", b.id, "firmware.factory.bin");
  if (!existsSync(bin)) { console.log(`stage-firmware: no build for ${b.id} — skipped`); continue; }
  const dir = join(out, b.id);
  mkdirSync(dir, { recursive: true });
  copyFileSync(bin, join(dir, `propmesh-${b.id}.bin`));
  // The plain app image too: what the console's "↑ Firmware" panel sends
  // over the air ("from file").
  copyFileSync(join(dirname(bin), "firmware.bin"), join(dir, `propmesh-${b.id}-update.bin`));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    name: `PropMesh for ${b.name}`,
    version,
    new_install_prompt_erase: true,
    builds: [{ chipFamily: family(b.mcu), parts: [{ path: `propmesh-${b.id}.bin`, offset: 0 }] }],
  }, null, 2));
  n++;
}
console.log(`stage-firmware: ${n} board(s) staged as ${version}`);

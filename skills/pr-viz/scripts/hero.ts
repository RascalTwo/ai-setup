#!/usr/bin/env node
// hero.ts — a PR's hero, as two files:
//
//   node hero.ts <viz-dir> [--out <prefix>]   → <prefix>.hero.png (1920×1080) and <prefix>.hero.gif (960 px wide)
//
// The default prefix is ~/Desktop/pr-<hero.json "pr", else the viz folder's name>.
// still: the page's last frame (t = timeline.total), no controls or cursor.
// gif:   `viz render` shoots the 6 s timeline at 20 fps, ffmpeg palette-optimises it to 960 px wide. Over 5 MB
//        (GitHub refuses images over 10 MB) it retries with fewer frames, then fewer colours, and fails naming the size.
// Needs the viz skill (its server, `viz render`, its puppeteer-core + Chrome lookup), node and ffmpeg.

import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const VIZ = process.env["VIZ_SKILL_DIR"] ?? path.resolve(import.meta.dirname, "../../viz");
const { default: puppeteer } = await import(pathToFileURL(createRequire(path.join(VIZ, "package.json")).resolve("puppeteer-core")).href);
const { chromePath } = await import(path.join(VIZ, "lib/verify/chrome.ts"));
const { PORT, start } = await import(path.join(VIZ, "server-control.ts"));

const MAX_BYTES = 5_000_000;
// [fps, colours]: 10 and 20 fps give whole-centisecond GIF frame delays.
const TRIES = [[20, 256], [10, 256], [10, 128], [10, 64]] as const;

const args = process.argv.slice(2);
const dir = path.resolve(args[0] ?? ".");
const hero = JSON.parse(readFileSync(path.join(dir, "hero.json"), "utf8"));
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? path.resolve((args[outAt + 1] ?? "").replace(/^~/, os.homedir())) : path.join(os.homedir(), "Desktop", `pr-${hero.pr ?? path.basename(dir)}`);

const run = (cmd: string[]) => {
  const [bin = "", ...rest] = cmd;
  const r = spawnSync(bin, rest, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")} failed:\n${r.stdout}\n${r.stderr}`);
};

await start();
const url = `http://127.0.0.1:${PORT}/${path.relative(os.homedir(), dir)}/`;

// Still: seek to the end, hide the controls.
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__viz && window.__viz.timeline", { timeout: 60000 });
  await page.addStyleTag({ content: "[data-viz-chrome],#viz-feedback,#viz-status{display:none!important}" });
  await page.evaluate("window.__viz.timeline.pause(); window.__viz.timeline.seek(window.__viz.timeline.total)");
  await page.evaluate("document.fonts.ready");
  await page.screenshot({ path: `${out}.hero.png` });
  console.log(`✓ ${out}.hero.png`);
} finally {
  await browser.close();
}

// GIF: render the frames once, then encode.
const mp4 = `${out}.hero.tmp.mp4`;
run([process.execPath, path.join(VIZ, "viz.ts"), "render", "start", url, "--fps", "20", "--out", mp4, "--wait"]);
let bytes = 0;
try {
  for (const [fps, colors] of TRIES) {
    run(["ffmpeg", "-v", "error", "-y", "-i", mp4, "-vf",
      `fps=${fps},scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}[p];[b][p]paletteuse=dither=none`,
      "-loop", "0", `${out}.hero.gif`]);
    bytes = statSync(`${out}.hero.gif`).size;
    console.log(`  gif ${fps} fps, ${colors} colours: ${(bytes / 1e6).toFixed(2)} MB`);
    if (bytes <= MAX_BYTES) break;
  }
} finally {
  rmSync(mp4, { force: true });
  rmSync(mp4.replace(/\.mp4$/, ".chapters.txt"), { force: true }); // viz render's sidecar
}
if (bytes > MAX_BYTES) throw new Error(`${out}.hero.gif is ${(bytes / 1e6).toFixed(1)} MB even at ${TRIES.at(-1)?.join(" fps, ")} colours: over the 5 MB limit; simplify the drawing (fewer gradients, less motion)`);
console.log(`✓ ${out}.hero.gif`);

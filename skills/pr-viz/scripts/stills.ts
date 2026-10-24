#!/usr/bin/env bun
// stills.ts — the two pictures a PR shows above its film:
//
//   bun stills.ts <viz-dir> [--out <prefix>]   → <prefix>.hero.png, <prefix>.poster.png
//                                                 (+ the hero as <prefix>.mp4's and <prefix>.short.mp4's first frame)
//
// hero:   plan.json `hero` (a scene title) at its last moment, 1920×1080, without the chapter
//         bar, cursor or pointer highlights — the one picture that says what the PR is about.
// poster: the page in poster mode ({"mode":"poster"}), full height at 2×, so it stays sharp
//         when GitHub scales it to its column. GitHub refuses images over 10 MB; a poster that
//         big is re-shot at 1.5×.
// video:  GitHub's player drops a poster attribute but shows a video's first frame, so when
//         <prefix>.mp4 (or .short.mp4) exists the hero is painted onto frame 0 only —
//         timing, audio, captions and chapters are unchanged. Run it after the render.
//
// Needs the viz skill (its server, and its puppeteer-core + Chrome lookup).

import { existsSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const VIZ = process.env.VIZ_SKILL_DIR ?? path.resolve(import.meta.dir, "../../viz");
const { default: puppeteer } = await import(Bun.resolveSync("puppeteer-core", VIZ));
const { chromePath } = await import(path.join(VIZ, "lib/verify/chrome.ts"));
const { PORT, start } = await import(path.join(VIZ, "server-control.ts"));

const args = process.argv.slice(2);
const dir = path.resolve(args[0] ?? ".");
const plan = JSON.parse(readFileSync(path.join(dir, "plan.json"), "utf8"));
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? path.resolve(args[outAt + 1].replace(/^~/, os.homedir())) : path.join(os.homedir(), "Desktop", `pr-${plan.pr?.number ?? path.basename(dir)}`);

const scenes = plan.scenes ?? [];
const hero = scenes.findIndex((s) => s.title === plan.hero);
if (hero < 0) {
  console.error(`plan.json "hero" must name a scene title — one of:\n  ${scenes.map((s) => s.title).join("\n  ")}`);
  process.exit(1);
}

await start();
const url = `http://127.0.0.1:${PORT}/${path.relative(os.homedir(), dir)}/`;
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
const HIDE = "[data-viz-chrome],#viz-captions,#viz-status,#viz-feedback,#film-bar,#film-cursor,#to-review{display:none!important}";
try {
  // Hero: the film, sought to the end of that scene's chapter (as verify shoots chapter frames).
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction("window.__viz && window.__viz.timeline && window.__viz.timeline.chapters", { timeout: 60000 });
  await page.addStyleTag({ content: `${HIDE} [data-h]{--h:0!important}` });
  await page.evaluate((i: number) => { const c = (window as any).__viz.timeline.chapters[i]; (window as any).__viz.timeline.seek(Math.max(c.t0, c.t0 + c.dur - 0.6)); }, hero);
  await Bun.sleep(300);
  await page.screenshot({ path: `${out}.hero.png` });
  console.log(`✓ ${out}.hero.png — "${plan.hero}"`);
  for (const mp4 of [`${out}.mp4`, `${out}.short.mp4`]) {
    if (!existsSync(mp4)) continue;
    const tmp = mp4.replace(/\.mp4$/, ".hero-frame.mp4");
    const ff = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-i", mp4, "-i", `${out}.hero.png`,
      "-filter_complex", "[0:v][1:v]overlay=enable='eq(n,0)'[v]", "-map", "[v]", "-map", "0:a", "-map", "0:s?",
      "-map_metadata", "0", "-map_chapters", "0", "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p",
      "-c:a", "copy", "-c:s", "copy", "-movflags", "+faststart", tmp]);
    if (ff.exitCode !== 0) throw new Error(`ffmpeg hero frame failed: ${ff.stderr.toString()}`);
    renameSync(tmp, mp4);
    console.log(`✓ ${mp4} — first frame is the hero`);
  }

  // Poster: the page in poster mode, 1400 CSS px wide.
  for (const scale of [2, 1.5]) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1400, height: 1000, deviceScaleFactor: scale });
    await p.goto(`${url}#${encodeURIComponent(JSON.stringify({ mode: "poster" }))}`, { waitUntil: "networkidle0" });
    await p.waitForSelector("#review .rscene");
    await p.addStyleTag({ content: HIDE });
    await p.evaluate(() => document.fonts.ready);
    // One screenshot tops out at 16,384 device px (Chrome's limit) and repeats the page past it,
    // so shoot 4,000 CSS px bands and stack them.
    const H: number = await p.evaluate(() => document.documentElement.scrollHeight);
    const bands: string[] = [];
    for (let y = 0; y < H; y += 4000) {
      const band = `${out}.poster-${bands.length}.png`;
      await p.screenshot({ path: band, clip: { x: 0, y, width: 1400, height: Math.min(4000, H - y) }, captureBeyondViewport: true });
      bands.push(band);
    }
    const stack = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", ...bands.flatMap((b) => ["-i", b]),
      ...(bands.length > 1 ? ["-filter_complex", `vstack=inputs=${bands.length}`] : []), "-frames:v", "1", `${out}.poster.png`]);
    for (const b of bands) rmSync(b);
    if (stack.exitCode !== 0) throw new Error(`ffmpeg vstack failed: ${stack.stderr.toString()}`);
    const mb = statSync(`${out}.poster.png`).size / 1e6;
    if (mb <= 10 || scale === 1.5) { console.log(`✓ ${out}.poster.png — ${scale}×, ${mb.toFixed(1)} MB${mb > 10 ? " — still over GitHub's 10 MB image limit" : ""}`); break; }
  }
} finally {
  await browser.close();
}

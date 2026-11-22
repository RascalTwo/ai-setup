#!/usr/bin/env node
// Screenshots a web page the way the critic is meant to see it, and prints one PNG path per line.
// Usage: node shoot.ts <url> <out-dir> [--widths 1280,390] [--screens 1] [--frames 0]
//   --screens N  N window-heights down the page, per width (for pages read by scrolling)
//   --frames N   N extra shots 250 ms apart at the first width, for anything that moves
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** The viz skill's installed packages (puppeteer-core, pngjs), which this skill borrows instead of installing its own. */
export const vizRequire = createRequire(join(process.env.HOME ?? "", ".claude/skills/viz/package.json"));

// One headless page per call; reused by the proof scripts so every screen is taken the same way.
export async function openBrowser() {
  const puppeteer = (await import(pathToFileURL(vizRequire.resolve("puppeteer-core")).href)).default;
  return puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
}

// The viz server's feedback pill is not part of the page being judged.
export const HIDE_WIDGET = "#viz-feedback { display: none !important; }";

export async function shoot(url: string, out: string, opts: { widths?: number[]; screens?: number; frames?: number } = {}) {
  const { widths = [1280, 390], screens = 1, frames = 0 } = opts;
  mkdirSync(out, { recursive: true });
  const browser = await openBrowser();
  const paths: string[] = [];
  try {
    const page = await browser.newPage();
    for (const [wi, width] of widths.entries()) {
      const height = width >= 1000 ? 800 : 844;
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      const still = !(frames && wi === 0);
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: still ? "reduce" : "no-preference" }]);
      // A page that keeps a request open (a three.js page from a CDN did) never reaches networkidle, so idle is capped.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }).catch(() => {});
      await page.addStyleTag({ content: HIDE_WIDGET });
      await new Promise((r) => setTimeout(r, 1500));
      for (let s = 0; s < screens; s++) {
        await page.evaluate((y: number) => window.scrollTo(0, y), s * height);
        await new Promise((r) => setTimeout(r, 300));
        const p = join(out, `w${width}-s${s + 1}.png`);
        await page.screenshot({ path: p });
        paths.push(p);
      }
      if (!still) {
        await page.evaluate(() => window.scrollTo(0, 0));
        for (let f = 0; f < frames; f++) {
          const p = join(out, `w${width}-frame${f + 1}.png`);
          await page.screenshot({ path: p });
          paths.push(p);
          await new Promise((r) => setTimeout(r, 250));
        }
      }
    }
  } finally {
    await browser.close();
  }
  return paths;
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    options: { widths: { type: "string", default: "1280,390" }, screens: { type: "string", default: "1" }, frames: { type: "string", default: "0" } },
    allowPositionals: true,
  });
  const [url, out] = positionals;
  if (!url || !out) {
    console.error("usage: node shoot.ts <url> <out-dir> [--widths 1280,390] [--screens 1] [--frames 0]");
    process.exit(2);
  }
  const paths = await shoot(url, out, {
    widths: values.widths!.split(",").map(Number),
    screens: Number(values.screens),
    frames: Number(values.frames),
  });
  console.log(paths.join("\n"));
}

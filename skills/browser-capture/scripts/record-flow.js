#!/usr/bin/env node
/*
 * record-flow.js — record SMOOTH video of a browser flow, fully automated, no human.
 *
 * Records via puppeteer's page.screencast() (CDP-backed), which works in HEADLESS Chrome.
 * This is the answer to "the GIF is a slideshow": a real video at your chosen fps.
 *
 *   node record-flow.js --url <url> --out <file.webm> [options]
 *
 * Options:
 *   --url <url>            page to record (required)
 *   --out <file.webm>      output path (required; .webm — convert after with --gif/--mp4)
 *   --flow <file.js>       module exporting `async (page, wt) => {}` — your steps.
 *                          `wt(fnBody, ...args)` is a shorthand for page.evaluate against
 *                          the injected window.__wt kit. Omit for a plain scroll-through.
 *   --fps <n>              default 30
 *   --viewport <WxH>       default 1280x800
 *   --scale <n>            deviceScaleFactor, default 1 (2 = retina, 4x the pixels)
 *   --no-kit               skip injecting assets/walkthrough-kit.js
 *   --gif                  also write a .gif beside the webm (palette-optimised)
 *   --mp4                  also write an .mp4 beside the webm
 *   --headful              run with a visible window (default headless — recording works either way)
 *   --chrome <path>        Chrome executable (default: macOS Google Chrome)
 *
 * Requires: puppeteer-core + ffmpeg on PATH. See SKILL.md for how the pieces fit.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ---- args ------------------------------------------------------------------
const A = process.argv.slice(2);
const arg = (k, d) => { const i = A.indexOf(k); return i === -1 ? d : A[i + 1]; };
const has = (k) => A.includes(k);

const URL_ = arg('--url');
const OUT = arg('--out');
if (!URL_ || !OUT) {
  console.error('usage: record-flow.js --url <url> --out <file.webm> [--flow f.js] [--fps 30] [--viewport 1280x800] [--gif] [--mp4]');
  process.exit(2);
}
const FPS = +arg('--fps', 30);
const [VW, VH] = arg('--viewport', '1280x800').split('x').map(Number);
const SCALE = +arg('--scale', 1);
const CHROME = arg('--chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
const FLOW = arg('--flow');

// puppeteer-core is not bundled here; reuse an installed copy.
function loadPuppeteer() {
  const candidates = [
    'puppeteer-core', 'puppeteer',
    path.join(process.env.HOME, '.claude/skills/viz/node_modules/puppeteer-core'),
  ];
  for (const c of candidates) { try { return require(c); } catch (_) {} }
  console.error('Could not load puppeteer-core. Install it (npm i puppeteer-core) or pass a path.');
  process.exit(3);
}
const puppeteer = loadPuppeteer();

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: !has('--headful'),
    args: [`--window-size=${VW},${VH}`, `--force-device-scale-factor=${SCALE}`],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: VW, height: VH, deviceScaleFactor: SCALE });
    await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 60000 });

    // Inject the visual layer BEFORE recording starts, so frame 1 already has the cursor.
    if (!has('--no-kit')) {
      const kit = path.join(__dirname, '..', 'assets', 'walkthrough-kit.js');
      if (fs.existsSync(kit)) await page.evaluate(fs.readFileSync(kit, 'utf8'));
    }
    await new Promise(r => setTimeout(r, 600)); // let fonts/layout settle

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const recorder = await page.screencast({ path: OUT, fps: FPS });

    if (FLOW) {
      const flow = require(path.resolve(FLOW));
      // wt(fnBody, ...args) -> page.evaluate, with the kit available as __wt in the page
      const wt = (fn, ...args) => page.evaluate(fn, ...args);
      await flow(page, wt);
    } else {
      // Default: a smooth scroll to the bottom. Proves motion and is often all you need.
      await page.evaluate(async () => {
        const h = document.body.scrollHeight - window.innerHeight;
        await window.__wt?.smoothScrollTo?.(h, Math.min(8000, Math.max(1500, h * 1.6)));
      });
    }

    await new Promise(r => setTimeout(r, 400)); // let the last frames land
    await recorder.stop();
    await browser.close();

    // ---- verify: a real video has many frames. This is the check that catches a
    // silent failure (blank/1-frame output) before you hand it to anyone.
    const frames = sh('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', OUT]).trim();
    const bytes = fs.statSync(OUT).size;
    console.log(`wrote ${OUT}  (${(bytes / 1e6).toFixed(2)} MB, ${frames} frames @ ${FPS}fps)`);
    if (+frames < 10) console.warn('WARNING: very few frames — the flow may not have animated anything.');

    if (has('--gif')) {
      const gif = OUT.replace(/\.webm$/, '.gif');
      sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT, '-vf',
        `fps=${Math.min(FPS, 20)},scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, gif]);
      console.log(`wrote ${gif}  (${(fs.statSync(gif).size / 1e6).toFixed(2)} MB)`);
    }
    if (has('--mp4')) {
      const mp4 = OUT.replace(/\.webm$/, '.mp4');
      // yuv420p + even dimensions: required for QuickTime/Slack/browsers to play it at all.
      sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', OUT, '-movflags', 'faststart',
        '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', mp4]);
      console.log(`wrote ${mp4}  (${(fs.statSync(mp4).size / 1e6).toFixed(2)} MB)`);
    }
  } catch (e) {
    await browser.close().catch(() => {});
    console.error('FAILED:', e.message);
    process.exit(1);
  }
})();

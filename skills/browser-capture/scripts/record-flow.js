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
 *                          the injected window.__narrate kit. Omit for a plain scroll-through.
 *   --fps <n>              default 30
 *   --viewport <WxH>       default 1280x800
 *   --scale <n>            deviceScaleFactor, default 1 (2 = retina, 4x the pixels)
 *   --no-kit               skip injecting the ui-narration overlay
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
// Chrome discovery. Same logic as `viz/verify.ts` chromePath() — deliberately COPIED,
// not imported: skills are installed as independent directories, so a cross-skill import
// breaks silently when someone takes one without the other. If you fix a case here, fix it
// there too.
function findChrome() {
  const explicit = arg('--chrome', '');
  if (explicit) return explicit;
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  console.error('No Chrome found. Pass --chrome <path> or set PUPPETEER_EXECUTABLE_PATH.');
  process.exit(1);
}
const CHROME = findChrome();
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

    // Inject the kit with evaluateOnNewDocument, NOT evaluate. This is load-bearing:
    // a real hyperlink / cross-document navigation destroys the JS context, taking
    // window.__narrate with it — so a one-time evaluate() leaves every step after the first
    // navigation throwing "__narrate is undefined". evaluateOnNewDocument re-injects into
    // EVERY document (including cross-origin ones, and iframes) before its own scripts
    // run, so the kit survives navigation and multi-page apps work.
    if (!has('--no-kit')) {
      // HARD DEPENDENCY on the `ui-narration` skill. It used to live here as
      // assets/walkthrough-kit.js; it was extracted so a live (unrecorded) walkthrough can
      // use the same choreography. Resolve the installed skill first, then the sibling repo
      // checkout, so this works both installed and from a clone.
      const kitCandidates = [
        path.join(process.env.HOME || '', '.agents', 'skills', 'ui-narration', 'ui-narration.js'),
        path.join(__dirname, '..', '..', 'ui-narration', 'ui-narration.js'),
      ];
      const kit = kitCandidates.find((c) => fs.existsSync(c));
      if (!kit) {
        console.error('ui-narration not found. Install the `ui-narration` skill, or pass --no-kit.');
        console.error('looked in:\n  ' + kitCandidates.join('\n  '));
        process.exit(1);
      }
      if (fs.existsSync(kit)) await page.evaluateOnNewDocument(fs.readFileSync(kit, 'utf8'));
    }

    await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise(r => setTimeout(r, 600)); // let fonts/layout settle

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    const recorder = await page.screencast({ path: OUT, fps: FPS });

    if (FLOW) {
      const flow = require(path.resolve(FLOW));
      // wt(fn, ...args) -> page.evaluate with the kit available as window.__narrate.
      //
      // A click that navigates tears down the JS context while this evaluate is still
      // awaiting, so puppeteer rejects with "Execution context was destroyed". That is
      // the EXPECTED outcome of a navigating click, not a failure — swallow it. Use
      // nav(fn) below when you know a step navigates.
      const GONE = /Execution context was destroyed|Target closed|Cannot find context|frame got detached/i;
      const wt = async (fn, ...args) => {
        try { return await page.evaluate(fn, ...args); }
        catch (e) { if (GONE.test(e.message)) return undefined; throw e; }
      };
      // nav(fn): run an in-page step that causes a cross-document navigation, and wait for
      // the new document to settle. The kit re-injects itself there automatically.
      const nav = async (fn, ...args) => {
        const [, r] = await Promise.all([
          page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
          wt(fn, ...args),
        ]);
        await new Promise(r2 => setTimeout(r2, 400));
        return r;
      };
      await flow(page, wt, nav);
    } else {
      // Default: a smooth scroll to the bottom. Proves motion and is often all you need.
      await page.evaluate(async () => {
        const h = document.body.scrollHeight - window.innerHeight;
        await window.__narrate?.smoothScrollTo?.(h, Math.min(8000, Math.max(1500, h * 1.6)));
      });
    }

    await new Promise(r => setTimeout(r, 400)); // let the last frames land
    await recorder.stop();
    // Read caption cues BEFORE closing — the page owns them, and it is about to go away.
    // No try/catch: if the flow captioned and we cannot read them back, that is a bug worth
    // seeing, not swallowing.
    let vttText = null;
    if (await page.evaluate(() => !!(window.__narrate && window.__narrate.cues && window.__narrate.cues.length))) {
      vttText = await page.evaluate(() => window.__narrate.vtt());
    }

    await browser.close();

    // ---- verify: a real video has many frames. This is the check that catches a
    // silent failure (blank/1-frame output) before you hand it to anyone.
    const frames = sh('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames', '-of', 'default=nw=1:nk=1', OUT]).trim();
    const bytes = fs.statSync(OUT).size;
    console.log(`wrote ${OUT}  (${(bytes / 1e6).toFixed(2)} MB, ${frames} frames @ ${FPS}fps)`);
    if (+frames < 10) console.warn('WARNING: very few frames — the flow may not have animated anything.');

    // One recording ships either burned-in (captions visible) or clean + <name>.vtt.
    // Same format extract-video-subtitles already reads.
    if (vttText) {
      const vp = OUT.replace(/\.webm$/, '.vtt');
      fs.writeFileSync(vp, vttText);
      const n = (vttText.match(/-->/g) || []).length;
      console.log(`wrote ${vp}  (${n} cue${n === 1 ? '' : 's'})`);
    }

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

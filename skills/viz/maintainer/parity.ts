// maintainer/parity.ts — did converting a viz change what it draws? (the TypeScript migration)
//
//   bun maintainer/parity.ts shoot <url> <dir> [--hide <sel>]…   screenshot every state a reader can reach
//   bun maintainer/parity.ts compare <before> <after>  pixel-diff two shoots; diffs beside <after>
//
// A conversion is only safe if the page looks the same afterwards, and only one viz in the
// corpus has tests of its own — so the page is its own oracle: shoot it before, shoot it
// after, diff. "Every state" is what a reader can drive without knowing the page: the first
// paint, every step the arrow keys reach (stepper() and most hand-rolled steppers listen to
// them), and every tab. Time and randomness are frozen, motion is off, and the server's
// build-status pill is hidden, so two shoots of an unchanged page match; what is left over is
// either rendering noise or a real change, and telling those apart is a person's (or an
// agent's) call — this only measures. It never reaches the viz's backend: every request to the
// page's api/ and _log/ is answered with a 503.
//
// compare prints JSON: { states, identical, differing: [{ name, pixels, ratio, diff }], missing }.
// Exit 0 when every state matches exactly, 1 otherwise.
import { launch, type Page } from "puppeteer-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromePath } from "../lib/verify/chrome.ts";

const MAX_STEPS = 80;
const SETTLE_MS = 350;

// Same seed, same clock, no motion, before and after — so only the code differs.
const FREEZE = `(() => {
  let s = 0x2545f491;
  Math.random = () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0), (s >>> 8) / 16777216);
  const T = 1767225600000; // 2026-01-01T00:00:00Z
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(T); }
    static now() { return T; }
  };
  const css = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}#viz-status{visibility:hidden!important}";
  addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = css; document.head.append(st); });
})();`;

/** What a screenshot shows, not how it was encoded: PNG bytes can differ for identical pixels. */
function pixelKey(png: Buffer): string {
  const x = PNG.sync.read(png);
  return createHash("sha1").update(`${x.width}x${x.height}`).update(x.data).digest("hex");
}

async function snap(page: Page, dir: string, name: string): Promise<Buffer> {
  await Bun.sleep(SETTLE_MS);
  // SMIL (<animate>, <animateMotion>) ignores CSS: hold every SVG timeline at 0 for the shot.
  await page.evaluate(() =>
    document.querySelectorAll("svg").forEach((s) => {
      s.pauseAnimations();
      s.setCurrentTime(0);
    }),
  );
  const png = Buffer.from(await page.screenshot({ fullPage: true }));
  writeFileSync(path.join(dir, `${name}.png`), png);
  return png;
}

async function shoot(url: string, dir: string, hide: string[]): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const browser = await launch({ executablePath: chromePath(), headless: true });
  const errors: string[] = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await page.evaluateOnNewDocument(FREEZE);
    // Shooting presses keys and clicks tabs on a LIVE page, so it never reaches the viz's own backend.
    // Not only writes: api.ts routes don't care about the method, and some act on a plain GET at page
    // load — rewrite a decisions file, spawn demo servers, rotate a credential. A Rank tab records a
    // vote per ArrowRight. Every api/ and _log/ request gets a 503, the same before and after, so a
    // comparison is still like for like; what a page draws from live data isn't compared.
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      if (/\/(?:api|_log)\//u.test(new URL(r.url()).pathname))
        // oxlint-disable-next-line no-void -- fire-and-forget in a sync event handler
        void r.respond({
          status: 503,
          body: "parity.ts: the viz's backend is blocked while shooting",
        });
      // oxlint-disable-next-line no-void -- fire-and-forget in a sync event handler
      else void r.continue();
    });
    // Live chrome the page itself doesn't control (a model-download counter, a clock): hidden by selector.
    if (hide.length > 0)
      await page.evaluateOnNewDocument(
        `addEventListener("DOMContentLoaded", () => { const st = document.createElement("style"); st.textContent = ${JSON.stringify(`${hide.join(",")}{visibility:hidden!important}`)}; document.head.append(st); });`,
      );
    page.on("pageerror", (e) => {
      errors.push(`pageerror: ${e instanceof Error ? e.message : String(e)}`);
    });
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
    await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
    const seen = new Set([pixelKey(await snap(page, dir, "000-initial"))]);

    // Steps: press → until a press shows a state already seen — unchanged at the end, or a
    // film's last frames flipping back and forth — and drop that repeat.
    for (let i = 1; i <= MAX_STEPS; i++) {
      // oxlint-disable-next-line no-await-in-loop -- each press builds on the page state the last one left
      await page.keyboard.press("ArrowRight");
      const name = `step-${String(i).padStart(3, "0")}`;
      // oxlint-disable-next-line no-await-in-loop -- the shots are of one live page, in order
      const key = pixelKey(await snap(page, dir, name));
      if (seen.has(key)) {
        unlinkSync(path.join(dir, `${name}.png`));
        break;
      }
      seen.add(key);
    }

    // Tabs: anything that says it is one.
    const tabs = await page.$$('[role="tab"], .tabs > button, nav.tabs a, [data-tab]');
    for (let t = 0; t < tabs.length; t++) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- clicks drive one live page, in order
        await tabs[t]!.click();
      } catch {
        continue;
      } // hidden or detached: not reachable by a reader
      // oxlint-disable-next-line no-await-in-loop -- the shots are of one live page, in order
      await snap(page, dir, `tab-${String(t).padStart(2, "0")}`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(dir, "errors.json"), JSON.stringify(errors, null, 1));
  console.log(
    JSON.stringify({
      dir,
      states: readdirSync(dir).filter((f) => f.endsWith(".png")).length,
      errors: errors.length,
    }),
  );
}

function compare(before: string, after: string): boolean {
  const pngs = (d: string) =>
    readdirSync(d)
      .filter((f) => f.endsWith(".png") && !f.endsWith(".diff.png"))
      .toSorted();
  const a = pngs(before),
    b = new Set(pngs(after));
  const differing: { name: string; pixels: number; ratio: number; diff: string }[] = [];
  const missing = [...a.filter((f) => !b.has(f)), ...[...b].filter((f) => !a.includes(f))];
  let identical = 0;
  for (const f of a.filter((n) => b.has(n))) {
    const x = PNG.sync.read(readFileSync(path.join(before, f))),
      y = PNG.sync.read(readFileSync(path.join(after, f)));
    if (x.width !== y.width || x.height !== y.height) {
      differing.push({
        name: f,
        pixels: -1,
        ratio: 1,
        diff: `size ${x.width}x${x.height} → ${y.width}x${y.height}`,
      });
      continue;
    }
    const out = new PNG({ width: x.width, height: x.height });
    const n = pixelmatch(x.data, y.data, out.data, x.width, x.height, { threshold: 0.1 });
    if (!n) {
      identical++;
      continue;
    }
    const diff = path.join(after, f.replace(/\.png$/u, ".diff.png"));
    writeFileSync(diff, PNG.sync.write(out));
    differing.push({ name: f, pixels: n, ratio: n / (x.width * x.height), diff });
  }
  const errs = (d: string): string[] => {
    if (!existsSync(path.join(d, "errors.json"))) return [];
    const parsed: unknown = JSON.parse(readFileSync(path.join(d, "errors.json"), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === "string") : [];
  };
  const before_ = new Set(errs(before));
  const newErrors = errs(after).filter((e) => !before_.has(e));
  console.log(
    JSON.stringify({ states: a.length, identical, differing, missing, newErrors }, null, 1),
  );
  return differing.length === 0 && missing.length === 0 && newErrors.length === 0;
}

if (import.meta.main) {
  const [cmd, x, y] = process.argv.slice(2);
  if (cmd === "shoot" && x && y)
    await shoot(
      x,
      y,
      process.argv.slice(5).flatMap((a, i, all) => (all[i - 1] === "--hide" ? [a] : [])),
    );
  else if (cmd === "compare" && x && y) process.exitCode = compare(x, y) ? 0 : 1;
  else {
    console.error(
      "usage: parity.ts shoot <url> <dir> [--hide <selector>]… | compare <before> <after>",
    );
    process.exitCode = 2;
  }
}

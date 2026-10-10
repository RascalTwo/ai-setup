// lib/testing/preload.ts — the `viz` global a viz's own tests get when `viz verify` runs them (ADR 0022).
//
// A global rather than an import: a viz lives in any repo, anywhere under $HOME, and has no
// package.json to resolve the skill from. `bun test` already hands tests globals (expect, test);
// this adds one more, and verify is the only thing that runs these files.
//
//   const page = await viz.open();                  // the viz under test, in headless Chrome
//   const page = await viz.open({ type: "wifi" });  // with a hash: an object is JSON-encoded, as the kit's links are
//   await viz.open(hash, { before: (p) => p.setRequestInterception(true) })  // runs before the page loads
//   page.errors                                      // uncaught page errors so far
//   await viz.screenshot(page, "plain-look", { selector: "#frame", mask: ["#clock"] })
//       compares with tests/__screenshots__/plain-look.png. New or different → the test fails and the
//       picture waits in __screenshots__/.pending/ for a person: `viz shots <viz> --open`.

import { registerKitResolver } from "../server/kit-resolve.ts";
import { afterAll, afterEach, beforeEach } from "bun:test";
import { launch, type Browser, type Page } from "puppeteer-core";
import { chromePath } from "../verify/chrome.ts";
import type { OpenOptions, ScreenshotOptions, VizGlobal, VizPage } from "./global.ts";
import path from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

registerKitResolver(); // a test imports a backend (or the page's modules) that import the kit by its alias
const url = process.env.VIZ_URL!.replace(/#.*$/u, "");
let browser: Promise<Browser> | undefined;
const open_ = new Set<Page>();

// A video of every page a test opens; verify keeps the failures' and deletes the rest. Needs ffmpeg on
// PATH (Puppeteer's screencast) — without it there's just no video. Markers go to stderr, where bun
// prints its "(fail) <name>" lines, so verify can pair them by order: bun has no current-test name.
// Concurrent tests (it.concurrent) get no video: the pairing is by order, and overlapping tests have
// none — a video filed under the wrong test is worse than no video.
// ponytail: a page opened in beforeAll is filmed until the first test ends, then not again.
const filming: { stop: () => Promise<unknown>; path: string }[] = [];
let films = 0,
  running = 0;
beforeEach(() => {
  running++;
});
// oxlint-disable-next-line typescript/promise-function-async -- async would then trip require-await: there is nothing to await
const noStop = (): Promise<void> => Promise.resolve(); // what a page that is not filmed hands back
async function film(page: Page) {
  if (running > 1) return noStop;
  const file = path.join(
    process.env.VIZ_OUT!,
    "videos",
    `${process.pid}-${films++}.webm`,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- puppeteer's screencast path is typed `${string}.webm`; this one is built to end that way
  ) as `${string}.webm`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    const rec = await page.screencast({ path: file });
    let stopped: Promise<unknown> | undefined;
    const stop = async () => {
      await (stopped ??= rec.stop().catch(() => {
        /* already stopped */
      }));
    };
    filming.push({ stop, path: file });
    return stop;
  } catch {
    return noStop;
  }
}
afterEach(async () => {
  const alone = running-- === 1;
  for (const f of filming.splice(0)) {
    // oxlint-disable-next-line no-await-in-loop -- one film at a time: its VIZ-VIDEO marker must come out in order, verify pairs them with tests by position
    await f.stop();
    if (alone) console.error(`VIZ-VIDEO ${f.path}`);
    else rmSync(f.path, { force: true });
  }
  console.error("VIZ-TEST-END"); // every test, so a concurrent failure can't inherit the last test's videos
});

// Chrome's own coverage of the page's scripts, handed to verify as raw V8 data (it maps it to lines).
// Chrome only reports scripts still alive when coverage stops, so a reload or navigation would throw
// away everything that ran before it: collect before each one, then start again.
let saved = 0;
const COVERAGE = {
  resetOnNavigation: false,
  includeRawScriptCoverage: true,
  useBlockCoverage: true,
};
async function writeCoverage(page: Page) {
  const entries = await page.coverage.stopJSCoverage().catch(() => []);
  const scripts = entries.flatMap((e) =>
    e.rawScriptCoverage
      ? [{ url: e.url, text: e.text, functions: e.rawScriptCoverage.functions }]
      : [],
  );
  writeFileSync(
    path.join(process.env.VIZ_OUT!, `browser-coverage-${process.pid}-${saved++}.json`),
    JSON.stringify({ test: opener.get(page) ?? null, scripts }),
  );
}
// Which test opened a page, for coverage attribution: bun has no current-test name, but the call
// stack of viz.open() runs through the test file — its file:line is the test's own call site. That
// holds with tests running concurrently. (A test generated in a loop has one call site for all its
// copies, so it is attributed as one test.)
const opener = new WeakMap<Page, string>();
// Every test-file frame, innermost first: a helper in the test file (a `website()` that calls viz.open)
// comes before the test that called it, so verify picks the first frame that sits inside an it().
function callSite(): string | undefined {
  const sites = [
    ...(new Error().stack ?? "").matchAll(
      /(\/[^\s()]*\/tests\/[^\s()/]+\.test\.[cm]?[jt]sx?):(\d+):\d+/gu,
    ),
  ].map((m) => `${m[1]}:${m[2]}`);
  return sites.length > 0 ? sites.join("|") : undefined;
}
async function saveCoverage(page: Page) {
  if (open_.delete(page)) await writeCoverage(page);
}
// ponytail: a navigation the PAGE starts (a link click) isn't caught — only goto/reload from a test.
function keepCoverageAcrossNavigation(page: Page) {
  for (const name of ["goto", "reload"] as const) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- wrapping puppeteer's goto/reload, whose real signatures differ; only the call is forwarded
    const go = (page[name] as (...a: unknown[]) => Promise<unknown>).bind(page);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- assigning over a method of puppeteer's Page needs an index view of it
    (page as unknown as Record<string, unknown>)[name] = async (...a: unknown[]) => {
      if (open_.has(page)) {
        await writeCoverage(page);
        await page.coverage.startJSCoverage(COVERAGE);
      }
      return go(...a);
    };
  }
}

async function open(
  hash?: string | object,
  { width = 1280, height = 800, before }: OpenOptions = {},
): Promise<VizPage> {
  browser ??= launch({ executablePath: chromePath(), headless: true, protocolTimeout: 300000 });
  // Its own browser context, not just a tab: a tab that isn't in front gets NO requestAnimationFrame in
  // headless Chrome (measured: 0/s vs 62/s), which silently stalls anything animated — and a context
  // also gives each page its own storage, so tests can't leak state into each other.
  const site = callSite();
  const context = await (await browser).createBrowserContext();
  const page = Object.assign(await context.newPage(), { errors: [] as string[] });
  page.on("pageerror", (e) => {
    page.errors.push(e instanceof Error ? e.message : String(e));
  });
  await page.setViewport({ width, height });
  await page.coverage.startJSCoverage(COVERAGE);
  open_.add(page);
  if (site) opener.set(page, site);
  keepCoverageAcrossNavigation(page);
  const stopFilm = await film(page);
  const close = page.close.bind(page);
  page.close = async (o) => {
    await stopFilm();
    await saveCoverage(page);
    await close(o);
    await context.close();
  };
  // The live server's hot-reload socket reloads the page whenever a file in the viz is saved — while
  // someone edits, every open test page died mid-journey ("Execution context was destroyed"). A test
  // page never reloads on its own: its _reload socket is a dead end. (Request interception can't
  // catch a WebSocket, so it's replaced in the page.)
  await page.evaluateOnNewDocument(() => {
    const Real = window.WebSocket;
    window.WebSocket = new Proxy(Real, {
      construct: (T, [u, p]: [string | URL, (string | string[])?]) =>
        /\/_reload(?:\?|$)/u.test(String(u))
          ? {
              close() {
                /* dead end */
              },
              send() {
                /* dead end */
              },
              addEventListener() {
                /* dead end */
              },
              readyState: 3,
            }
          : new T(u, p),
    });
  });
  await before?.(page);
  const h =
    hash === undefined
      ? ""
      : "#" + (typeof hash === "string" ? hash : encodeURIComponent(JSON.stringify(hash)));
  await page.goto(url + h, { waitUntil: "networkidle2" });
  return page;
}

// A picture that changed isn't necessarily wrong, and a new one isn't necessarily right — only a person
// can say. So neither becomes the baseline by itself: it waits in __screenshots__/.pending/ and the test
// fails until someone looks (`viz shots <viz> --open`) and approves. `--update-snapshots` accepts
// without looking. A small per-pixel tolerance absorbs anti-aliasing; `mask` covers elements that
// change on their own (a clock, a random id) with a solid box first.
async function screenshot(
  page: Page,
  name: string,
  { selector, mask = [], maxDiffPixels = 0, threshold = 0.2 }: ScreenshotOptions = {},
): Promise<void> {
  const el = selector ? await page.waitForSelector(selector) : null;
  await page.evaluate((sels: string[]) => {
    for (const e of sels.flatMap((s) => [...document.querySelectorAll(s)])) {
      const r = e.getBoundingClientRect(),
        box = document.createElement("div");
      box.dataset.vizMask = "";
      box.style.cssText = `position:absolute;z-index:2147483647;background:#ff00ff;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px`;
      document.body.append(box);
    }
  }, mask);
  const shot = Buffer.from(await (el ?? page).screenshot({ type: "png" }));
  await page.evaluate(() =>
    document.querySelectorAll("[data-viz-mask]").forEach((e) => e.remove()),
  );

  const file = name.replaceAll(/[^\w.-]+/gu, "-") + ".png";
  const dir = path.join(process.env.VIZ_DIR!, "tests", "__screenshots__");
  const base = path.join(dir, file),
    pending = path.join(dir, ".pending", file);
  const park = (why: string) => {
    mkdirSync(path.dirname(pending), { recursive: true });
    writeFileSync(pending, shot);
    throw new Error(
      `screenshot "${name}" ${why} — awaiting approval: viz shots ${process.env.VIZ_TARGET} --open`,
    );
  };
  if (process.env.VIZ_UPDATE_SNAPSHOTS) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(base, shot);
    rmSync(pending, { force: true });
    return console.error(`VIZ-BASELINE-SAVED ${base}`);
  }
  if (!existsSync(base)) return park("is new");
  const a = PNG.sync.read(readFileSync(base)),
    b = PNG.sync.read(shot);
  if (a.width !== b.width || a.height !== b.height)
    return park(`changed size, ${a.width}×${a.height} → ${b.width}×${b.height}`);
  const n = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold });
  if (n > maxDiffPixels) return park(`differs from its baseline by ${n} pixel(s)`);
  rmSync(pending, { force: true }); // matches again: an old pending picture is moot
}

afterAll(async () => {
  // oxlint-disable-next-line no-await-in-loop -- one page at a time: saveCoverage drops the page from the set as it goes
  for (const page of open_) await saveCoverage(page);
  if (browser) await (await browser).close();
});

Object.assign(globalThis, {
  viz: { url, dir: process.env.VIZ_DIR!, open, screenshot } satisfies VizGlobal,
});

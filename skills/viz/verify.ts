#!/usr/bin/env bun
// On-demand render-to-disk check for a viz. Drives headless Chrome once, captures
// the console + uncaught errors + failed requests as TEXT, screenshots the page,
// and writes both to .verify/ — so an agent reads two files instead of running a
// live Chrome MCP session (console-as-text ≈ 0 vision tokens, one command not four
// round-trips). This is the verify gate, not a per-save hook: run it when you want
// to know "did it render, and did anything throw?".
//
//   bun verify.ts <url|id> [--wait=<sel|ms>] [--full] [--size=WxH] [--og] [--interactions=<file>]
//
//   <url|id>        full http URL, or a viz id/path → http://127.0.0.1:5180/<id>/
//   --wait          wait for a CSS selector, or a fixed ms, before the shot
//   --full          full-page screenshot (default: viewport only)
//   --size          viewport, e.g. 1440x900 (default 1280x800; --og defaults to 1200x630)
//   --og            also write the shot to <vizdir>/og.auto.png — the AUTO Open Graph
//                   preview image. If a <vizdir>/hero.html exists it renders THAT and clips
//                   to its .og-card/.card element (a hand-authored 1200×630 card — the
//                   preferred source); otherwise it shoots the live page at 1200×630 after
//                   running verify.interactions.ts. Localhost targets only (an external URL
//                   has no viz dir). Drop a hand-made og.png to override. See reference/publishing.md.
//   --interactions  override the interactions file path (see below)
//
// Per-viz interactions, by convention: if `<vizdir>/verify.interactions.ts` (or
// .js) exists, it's imported and its `export default async (page, { shot }) => {...}`
// runs after load+wait, before the final shot — to click/step/open things. It lives
// WITH the viz; this shared script is never edited. (<vizdir> is derived from the URL,
// since a viz's URL path IS its path under $HOME.) --interactions overrides the path
// for the odd case (e.g. a file:// target that has no viz dir).
//
// Want intermediate screenshots? The fn's 2nd arg gives you `shot(name)` — call it any
// number of times to write .verify/<name>.png (path resolved for you), then read those
// files after the run. `dir` is the .verify path if you'd rather screenshot by hand off
// the raw `page`. All PNGs in .verify/ are wiped at the start of each run, so shots are
// always from THIS run — name them and read them, no manual cleanup.
//
// Outputs (overwritten each run, all under .verify/):
//   latest.png   screenshot          console.txt  console + uncaught errors + failed reqs
//   network.txt  full req+resp (hdrs+bodies)       dom.html  final DOM after interactions

import puppeteer from "puppeteer-core";
import { mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const PORT = 5180;

function chromePath(): string {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", // macOS
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    "No Chrome found. Set PUPPETEER_EXECUTABLE_PATH to your Chrome/Chromium binary.",
  );
}

// ---- args ----
const args = process.argv.slice(2);
const flag = (name: string) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const target = args.find((a) => !a.startsWith("--"));
if (!target) {
  console.error("usage: bun verify.ts <url|id> [--wait=<selector|ms>] [--full] [--size=WxH] [--og]");
  process.exit(2);
}
const url = target.includes("://")
  ? target
  : `http://127.0.0.1:${PORT}/${target.replace(/^\/+|\/+$/g, "")}/`;
const wait = flag("wait");
const interactions = flag("interactions");
const full = args.includes("--full");
const og = args.includes("--og");
// --og shoots at the 1200×630 card aspect by default so the auto image needs no cropping
// (a viewport screenshot at WxH is exactly WxH px — no image lib, stays cross-platform).
const [vw, vh] = (flag("size") ?? (og ? "1200x630" : "1280x800")).split("x").map(Number);

const outDir = path.join(import.meta.dir, ".verify");
mkdirSync(outDir, { recursive: true });
// Fresh slate for shots. latest.png + the canonical text files are overwritten by name,
// but ad-hoc shots from interactions (step1.png, …) have unique names — nothing would ever
// remove them, so they'd pile up and a stale one could masquerade as current. Sweep all PNGs.
for (const f of readdirSync(outDir)) if (f.endsWith(".png")) rmSync(path.join(outDir, f));

// Resolve the interactions file: explicit --interactions wins; otherwise look for
// the conventional <vizdir>/verify.interactions.{ts,js}. The viz dir is homedir +
// the URL pathname, because a viz's URL path is exactly its path under $HOME. Only
// works for a localhost target; an external/file:// URL has no viz dir → none.
function resolveInteractions(): string | null {
  if (interactions) return path.resolve(interactions);
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return null;
  const vizDir = path.join(os.homedir(), decodeURIComponent(u.pathname));
  for (const f of ["verify.interactions.ts", "verify.interactions.js"]) {
    const p = path.join(vizDir, f);
    if (existsSync(p)) return p;
  }
  return null;
}
const interactionsFile = resolveInteractions();

// ---- capture buffers ----
const lines: string[] = [];
const errors: string[] = []; // uncaught exceptions + failed requests — the signal that matters
const network: string[] = []; // full request+response block per response
const bodyTasks: Promise<void>[] = []; // response.text() reads, awaited before close
let dom = "";
const stamp = () => new Date().toISOString().slice(11, 23);
const isNoise = (s: string) => s.includes("favicon.ico"); // every page 404s it; not a viz bug

const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: vw || 1280, height: vh || 800 });

  page.on("console", (msg) => {
    const loc = msg.location();
    const where = loc.url ? ` (${loc.url.split("/").pop()}:${loc.lineNumber ?? "?"})` : "";
    const entry = `[${stamp()}] ${msg.type()}: ${msg.text()}${where}`;
    lines.push(entry);
    if (msg.type() === "error" && !isNoise(entry)) errors.push(entry);
  });
  page.on("pageerror", (err) => {
    const entry = `[${stamp()}] UNCAUGHT: ${err.message}`;
    lines.push(entry);
    errors.push(entry);
  });
  page.on("requestfailed", (req) => {
    const entry = `[${stamp()}] REQUEST FAILED: ${req.url()} (${req.failure()?.errorText ?? "?"})`;
    lines.push(entry);
    if (!isNoise(req.url())) errors.push(entry);
  });
  page.on("response", (res) => {
    if (res.status() >= 400 && !isNoise(res.url())) {
      const entry = `[${stamp()}] HTTP ${res.status()}: ${res.url()}`;
      lines.push(entry);
      errors.push(entry);
    }
    // Full request+response block. Body only for text-ish content (dumping binary as
    // text is noise); awaited via bodyTasks so the page stays open until reads finish.
    bodyTasks.push(
      (async () => {
        const req = res.request();
        const ct = res.headers()["content-type"] ?? "";
        let respBody: string;
        if (/event-stream/i.test(ct)) {
          respBody = "[event-stream — not read (would never end)]"; // SSE: _reload, streaming api
        } else if (/json|text|javascript|xml|html|csv|svg|x-www-form-urlencoded/i.test(ct)) {
          try {
            // Hard timeout: a stalled/streaming body must never hang the whole run.
            const t = await Promise.race([
              res.text(),
              new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 3000)),
            ]);
            respBody = t.length > 20000 ? t.slice(0, 20000) + `\n…[truncated, ${t.length} bytes total]` : t;
          } catch {
            respBody = "[body unavailable (redirect/cache/stream/timeout)]";
          }
        } else {
          respBody = `[non-text body: ${ct || "unknown type"}]`;
        }
        const hdrs = (h: Record<string, string>) =>
          Object.entries(h).map(([k, v]) => `    ${k}: ${v}`).join("\n") || "    (none)";
        network.push(
          `### ${res.status()} ${req.method()} ${res.url()}\n` +
            `  > request headers:\n${hdrs(req.headers())}\n` +
            `  > request body: ${req.postData() ?? "(none)"}\n` +
            `  < response headers:\n${hdrs(res.headers())}\n` +
            `  < response body:\n${respBody}`,
        );
      })().catch(() => {}),
    );
  });

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
  } catch (e) {
    errors.push(`[${stamp()}] NAVIGATION FAILED: ${(e as Error).message}`);
  }

  if (wait) {
    if (/^\d+$/.test(wait)) await new Promise((r) => setTimeout(r, Number(wait)));
    else await page.waitForSelector(wait, { timeout: 10000 }).catch(() => errors.push(`[${stamp()}] WAIT SELECTOR NOT FOUND: ${wait}`));
  }
  await new Promise((r) => setTimeout(r, 400)); // settle: late console / animations

  // The live server injects a review overlay (#viz-comments: the corner comment toggle + pins).
  // It's live-interaction chrome, never wanted in a screenshot — and being position:fixed it lands
  // inside the og clip. Hide it before any shot. It's re-injected on each page load, so the
  // hero.html branch below re-hides after its own navigation.
  await page.addStyleTag({ content: "#viz-comments{display:none!important}" }).catch(() => {});

  if (interactionsFile) {
    // shot(name) → an ad-hoc screenshot into .verify/<name>.png, path resolved here so the
    // interactions file never has to know where .verify is (cwd-independent). Returns the path.
    const shot = async (name: string, opts?: { full?: boolean }) => {
      const p = path.join(outDir, `${name.replace(/[^a-z0-9_-]/gi, "_") || "shot"}.png`);
      await page.screenshot({ path: p, fullPage: opts?.full ?? false });
      return p;
    };
    try {
      const mod = await import(interactionsFile);
      const fn = mod.default ?? mod;
      if (typeof fn !== "function") throw new Error("must export a default function (page, { shot }) => {...}");
      await fn(page, { shot, dir: outDir });
    } catch (e) {
      errors.push(`[${stamp()}] INTERACTIONS FAILED (${interactionsFile}): ${(e as Error).message}`);
    }
  }

  dom = await page.content();
  await page.screenshot({ path: path.join(outDir, "latest.png"), fullPage: full });

  // --og: also write the shot to <vizdir>/og.auto.png (the AUTO preview image). The viz
  // dir is homedir + URL pathname (a viz's URL path IS its path under $HOME), so this only
  // works for a localhost target — an external/file:// URL has no viz dir.
  if (og) {
    const u = new URL(url);
    if (u.hostname === "127.0.0.1" || u.hostname === "localhost") {
      const vizDir = path.join(os.homedir(), decodeURIComponent(u.pathname));
      const ogPath = path.join(vizDir, "og.auto.png");
      // A hero.html beside the viz is a hand-authored 1200×630 OG card. Render THAT (not the
      // live page's post-interaction state) and clip to its card element (.og-card | .card).
      // A self-hero viz (viz:card=self) has no hero.html — the LIVE page IS the card, so clip
      // its own .og-card. The viewport is already 1200×630 (the --og default), where the
      // poster template's scale-to-fit renders at scale 1, so the clip is pixel-native.
      // The blind live-page shot is only the last-resort fallback.
      const heroExists = existsSync(path.join(vizDir, "hero.html"));
      const selfHero = !heroExists && !!(await page.$('meta[name="viz:card"][content="self"]'));
      if (heroExists) {
        await page.setViewport({ width: 1272, height: 720 }); // a touch larger than the card so it fits fully, then clip
        await page.goto(new URL("hero.html", url).href, { waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
        await new Promise((r) => setTimeout(r, 300)); // settle fonts/layout
        await page.addStyleTag({ content: "#viz-comments{display:none!important}" }).catch(() => {}); // re-hide: goto reset the page
        const box = await page
          .$eval(".og-card, .card", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; })
          .catch(() => null);
        if (!box) errors.push(`[${stamp()}] hero.html has no .og-card/.card element — shooting top-left 1200×630 instead`);
        await page.screenshot({ path: ogPath, clip: { x: box?.x ?? 0, y: box?.y ?? 0, width: 1200, height: 630 } });
        console.log(`  ↳ og.auto.png → ${ogPath}  (rendered from hero.html — edit that card + re-run --og to update)`);
      } else if (selfHero) {
        const box = await page
          .$eval(".og-card, .card", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; })
          .catch(() => null);
        if (!box) errors.push(`[${stamp()}] viz:card=self but no .og-card/.card element — shooting top-left 1200×630 instead`);
        await page.screenshot({ path: ogPath, clip: { x: box?.x ?? 0, y: box?.y ?? 0, width: 1200, height: 630 } });
        console.log(`  ↳ og.auto.png → ${ogPath}  (this poster IS its own card — edit index.html + re-run --og to update)`);
      } else {
        await page.screenshot({ path: ogPath, fullPage: false });
        console.log(`  ↳ og.auto.png → ${ogPath}  (auto preview from the live page; add a hero.html card or hand-made og.png to upgrade)`);
      }
    } else {
      errors.push(`[${stamp()}] --og needs a localhost viz target — no viz dir for ${u.hostname}`);
    }
  }
  await Promise.allSettled(bodyTasks); // let response bodies finish reading before close
} finally {
  await browser.close();
}

const header = `verify ${url}  @ ${new Date().toISOString()}\n${errors.length} error(s), ${lines.length} console line(s)\n${"=".repeat(60)}\n`;
const body = errors.length
  ? `ERRORS:\n${errors.join("\n")}\n\n${"-".repeat(60)}\nFULL CONSOLE:\n${lines.join("\n") || "(none)"}\n`
  : `FULL CONSOLE:\n${lines.join("\n") || "(none)"}\n`;
await Bun.write(path.join(outDir, "console.txt"), header + body);
await Bun.write(
  path.join(outDir, "network.txt"),
  `network for ${url}\n${network.length} request(s)\n${"=".repeat(60)}\n\n${network.join("\n\n") || "(none)"}\n`,
);
await Bun.write(path.join(outDir, "dom.html"), dom || "<!-- no DOM captured (page failed to load) -->\n");

console.log(`${errors.length ? "✗" : "✓"} ${errors.length} error(s)${interactionsFile ? " (ran " + path.basename(interactionsFile) + ")" : ""} — ${outDir}/{console.txt, latest.png, network.txt, dom.html}`);
if (errors.length) for (const e of errors.slice(0, 10)) console.log("  " + e);
process.exit(0);

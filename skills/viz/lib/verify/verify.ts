// lib/verify/verify.ts — driving the page and judging what came back.
//
// Unlike manage.ts this file really is one linear flow: launch Chrome, load the page,
// collect console and network, run the layout probe, write artifacts, judge. Splitting
// it further would invent seams the work does not have. What it needed was to stop
// being a SCRIPT — as a function it is callable without a subprocess.

import path from "node:path";
import os from "node:os";
import { CENTRAL } from "../../discovery.ts";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { die, bool } from "../../cli.ts";
import { PORT } from "../../server-control.ts";
import { chromePath } from "./chrome.ts";

const SKILL_DIR = path.resolve(import.meta.dir, "../..");

export type VerifyOptions = {
  target: string;
  wait?: string;
  full?: boolean;
  og?: boolean;
  size?: string;
  interactions?: string;
  commit?: string;
  json?: boolean;
};

export async function verifyViz(o: VerifyOptions): Promise<void> {
  const { target, wait, interactions } = o;
  const full = o.full === true;
  const og = o.og === true;
  const flags: Record<string, string | boolean> = o.json ? { json: true } : {};
  // The script read these through a flag() helper; keep the name so the body is verbatim.
  const flag = (n: string): string | undefined =>
    n === "size" ? o.size : n === "commit" ? o.commit : n === "wait" ? o.wait : n === "interactions" ? o.interactions : undefined;
  const url = target.includes("://")
    ? target
    : `http://127.0.0.1:${PORT}/${target.replace(/^\/+|\/+$/g, "")}/`;
  // --og shoots at the 1200x630 card aspect so the auto image needs no cropping.
  const [vw, vh] = (o.size ?? (og ? "1200x630" : "1280x800")).split("x").map(Number);


  const outDir = path.join(SKILL_DIR, ".verify");
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
  // Mechanical layout findings (overflow, clipping, blank render) + a mark census.
  // Populated by the in-page audit below; surfaced on stdout so the agent can fix
  // layout without paying vision tokens to read the screenshot.
  let layout: { findings: string[]; census: string; words: number; graphical: number } = { findings: [], census: "?", words: 0, graphical: 0 };
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
            respBody = "[event-stream — not read (would never end)]"; // a streaming api route
            // (_reload is no longer here — it's a websocket now; see kit/reload.ts)
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

    // ---------------------------------------------------------------------------
    // Layout audit. Runs on EVERY verify, against whatever is on screen — no opt-in,
    // no import required by the viz.
    //
    // Why it's here and not left to kit/viz.js's vizAudit(): layout is the single
    // largest rework class in the viz git history (overflowing labels, crammed nodes,
    // content past the edge), and the only signal for it used to be "read latest.png
    // and squint" — which costs ~1-2k vision tokens per iteration AND still missed
    // things. These checks are mechanical, so they belong in the tool, reported as
    // text naming the exact selector. Eyes are still needed for AESTHETIC judgment
    // (spacing, hierarchy, does-it-read) — this only covers what's measurable.
    const auditPage = () => page.evaluate(() => {
      const out: string[] = [];
      // Readable, clickable-ish identifier for an element.
      const sel = (el: Element): string => {
        if (el.id) return `#${el.id}`;
        const vid = el.getAttribute("data-viz-id");
        if (vid) return `[data-viz-id="${vid}"]`;
        const label = el.getAttribute("data-label") || el.getAttribute("aria-label");
        const cls = [...el.classList].slice(0, 2).map((c) => `.${c}`).join("");
        return `${el.tagName.toLowerCase()}${cls}${label ? ` "${label.slice(0, 30)}"` : ""}`;
      };
      const txt = (el: Element) => (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      const cap = (arr: string[], n: number, what: string) =>
        arr.length > n ? [...arr.slice(0, n), `…and ${arr.length - n} more ${what}`] : arr;

      // 1. SVG <text> spilling past ITS OWN box.
      //    Attribution matters more than the overflow math here: a <g> often groups
      //    several box+label pairs, so "first <rect> in the closest <g>" (the old
      //    vizAudit heuristic) measures a label against a sibling's box and reports a
      //    huge phantom spill. Instead, pick the rect whose bounds contain the text's
      //    CENTRE. If no rect owns the label, we can't attribute it — skip rather than
      //    guess, because a false positive here costs more than a missed one.
      const spills: string[] = [];
      for (const t of document.querySelectorAll("svg text")) {
        let tb: DOMRect;
        try { tb = (t as SVGGraphicsElement).getBBox(); } catch { continue; }
        if (!tb.width) continue;
        // Attribute by the text's ANCHOR point (its x/y attributes — where the author
        // placed it), not its rendered centre. A badly overflowing label has its centre
        // outside its own box, so centre-matching would silently skip the very case we
        // most want to catch; the anchor stays put no matter how far the glyphs spill.
        const num = (v: string | null, fb: number) => {
          const n = parseFloat((v ?? "").trim().split(/[\s,]+/)[0]);
          return Number.isFinite(n) ? n : fb;
        };
        const cx = num(t.getAttribute("x"), tb.x + tb.width / 2);
        const cy = num(t.getAttribute("y"), tb.y + tb.height / 2);
        let own: DOMRect | null = null;
        for (const r of t.closest("g")?.querySelectorAll("rect") ?? []) {
          let rb: DOMRect;
          try { rb = (r as SVGGraphicsElement).getBBox(); } catch { continue; }
          if (cx >= rb.x && cx <= rb.x + rb.width && cy >= rb.y && cy <= rb.y + rb.height) {
            // Innermost wins if boxes nest (e.g. a card inside a panel).
            if (!own || rb.width * rb.height < own.width * own.height) own = rb;
          }
        }
        if (!own) continue;
        const over = Math.max(own.x - tb.x, tb.x + tb.width - (own.x + own.width),
                              own.y - tb.y, tb.y + tb.height - (own.y + own.height));
        // 5px tolerance: <text> doesn't clip, it just draws outside, so a 2-4px
        // overhang is invisible in practice. Verified against the real corpus —
        // at 1px this reported cosmetic noise; at 5px the survivors were all
        // genuinely visible overflows.
        if (over > 5) spills.push(`${sel(t)} "${txt(t)}" spills ${Math.round(over)}px past its box`);
      }
      out.push(...cap(spills, 8, "text overflows").map((s) => `text-overflow: ${s}`));

      // 2. Content clipped by an overflow:hidden/clip ancestor — the SILENT failure.
      //    labelBox() deliberately clips rather than spills, so a too-long label looks
      //    fine in a screenshot while missing words. Nothing else catches this.
      const clipped: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const cs = getComputedStyle(el);
        if (!/hidden|clip/.test(cs.overflow) && !/hidden|clip/.test(cs.overflowY)
            && !/hidden|clip/.test(cs.overflowX)) continue;
        if (!el.clientHeight && !el.clientWidth) continue;
        const dy = el.scrollHeight - el.clientHeight;
        const dx = el.scrollWidth - el.clientWidth;
        if (dy > 2 || dx > 2) {
          const dir = dy > 2 ? `${dy}px vertically` : `${dx}px horizontally`;
          clipped.push(`${sel(el)}${txt(el) ? ` "${txt(el)}"` : ""} is cut off by ${dir}`);
        }
      }
      out.push(...cap(clipped, 8, "clipped elements").map((s) => `clipped: ${s}`));

      // 3. Anything wider than the viewport — "the Nth element blew past the edge".
      const de = document.documentElement;
      if (de.scrollWidth > de.clientWidth + 2) {
        const wide = [...document.querySelectorAll<HTMLElement>("body *")]
          .filter((el) => el.getBoundingClientRect().right > de.clientWidth + 2)
          .slice(0, 4).map(sel);
        out.push(`viewport-overflow: page scrolls horizontally (${de.scrollWidth}px > ${de.clientWidth}px viewport)`
          + (wide.length ? ` — widest: ${wide.join(", ")}` : ""));
      }

      // 4. Content escaping a fixed OG/poster frame. A 1200×630 card that overflows is
      //    silently cropped at publish, so this must fail loudly before it ships.
      for (const card of document.querySelectorAll<HTMLElement>(".og-card, .card.og-card")) {
        const cb = card.getBoundingClientRect();
        const out2 = [...card.querySelectorAll<HTMLElement>("*")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width && r.height && (r.right > cb.right + 1 || r.bottom > cb.bottom + 1
            || r.left < cb.left - 1 || r.top < cb.top - 1);
        });
        if (out2.length) out.push(`og-card-overflow: ${out2.length} element(s) escape the card frame — ${out2.slice(0, 3).map(sel).join(", ")}`);
      }

      // 5. Did anything actually render? A 404'd CDN import yields a blank page that
      //    otherwise passes clean (no failed request, no exception).
      const marks = { rect: 0, path: 0, circle: 0, line: 0, text: 0, canvas: 0, img: 0 };
      for (const k of Object.keys(marks) as (keyof typeof marks)[]) marks[k] = document.querySelectorAll(k).length;
      const total = Object.values(marks).reduce((a, b) => a + b, 0);
      const words = (document.body.innerText || "").trim().length;
      if (!total && words < 10) out.push("blank-render: page has no SVG/canvas marks and almost no text — did a script or import fail?");
      const census = Object.entries(marks).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(", ");
      // Graphical marks = the ones that can encode a variable in space. <text> and <img>
      // deliberately excluded: a label is not an encoding, and an image is somebody
      // else's. This feeds the visual-density line below — NOT the findings list.
      const graphical = marks.rect + marks.path + marks.circle + marks.line + marks.canvas;
      return { findings: out, census: census || "nothing", words, graphical };
    }).catch((e) => ({ findings: [`layout audit failed: ${(e as Error).message}`], census: "?", words: 0, graphical: 0 }));

    layout = await auditPage();

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
          // Audit the HERO too, not just index.html. This is the surface where layout
          // failure is least recoverable: the card is clipped to a fixed 1200×630, so
          // anything escaping the frame is silently cropped out of the image that gets
          // posted to Slack — and nobody sees it until it's already shared.
          const heroLayout = await auditPage();
          layout.findings.push(...heroLayout.findings.map((f) => `hero.html → ${f}`));
          // Nudge hand-rolled hero cards back onto the kit. The corpus says prose in
          // SKILL.md doesn't land here: of the hero.html files authored AFTER
          // kit/viz-og.css existed, 11 of 13 still hand-rolled `.og-card { ... }`
          // rather than linking the kit — which is how the pre-kit corpus ended up
          // with six variants of the same padding rule. This is the one moment the
          // author is provably looking at the card, so say it here, not in a doc.
          const heroSrc = await Bun.file(path.join(vizDir, "hero.html")).text().catch(() => "");
          if (heroSrc && !heroSrc.includes("viz-og.css")) {
            console.log(
              `  ⚠ hero.html hand-rolls its card CSS — <link rel="stylesheet" href="/_kit/viz-og.css">\n` +
                `    gives you .og-card/.frame/.left/.right/.eyebrow/.title/.essence/.chips/.foot in kit\n` +
                `    tokens, so the card re-themes with the viz. Scaffold: bootstrap.ts <slug> --hero`,
            );
          }
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

  // Visual density — a MEASUREMENT, never a finding. Bars 1 and 5 of the skill's ambition
  // table ask whether meaning lives in space or in sentences; this is the cheapest honest
  // proxy for that (graphical marks per 1k chars of rendered text). It stays out of
  // `layout.findings` on purpose: findings block `--commit`, and a deck and a force graph
  // have legitimately opposite ratios — only the author can see which one this is.
  // The band thresholds are a first calibration guess; the raw inputs are printed next to
  // them so they can be retuned once there are real runs to tune against.
  const perK = layout.words ? layout.graphical / (layout.words / 1000) : layout.graphical ? Infinity : 0;
  const band = !layout.graphical ? "no graphical marks" : perK < 5 ? "prose-shaped" : perK < 20 ? "mixed" : "graphical";
  const density = `visual density: ${layout.graphical} graphical mark(s) · ${layout.words} text chars · ${
    Number.isFinite(perK) ? perK.toFixed(1) : "∞"
  } marks/1k chars → ${band}`;

  const header = `verify ${url}  @ ${new Date().toISOString()}\n${errors.length} error(s), ${lines.length} console line(s), ${layout.findings.length} layout finding(s)\n${"=".repeat(60)}\n`;
  const layoutBlock = `LAYOUT (rendered: ${layout.census}):\n${layout.findings.map((f) => "  " + f).join("\n") || "  (clean)"}\n\n${density}\n\n${"-".repeat(60)}\n`;
  const body = errors.length
    ? `ERRORS:\n${errors.join("\n")}\n\n${"-".repeat(60)}\n${layoutBlock}FULL CONSOLE:\n${lines.join("\n") || "(none)"}\n`
    : `${layoutBlock}FULL CONSOLE:\n${lines.join("\n") || "(none)"}\n`;
  await Bun.write(path.join(outDir, "console.txt"), header + body);
  await Bun.write(
    path.join(outDir, "network.txt"),
    `network for ${url}\n${network.length} request(s)\n${"=".repeat(60)}\n\n${network.join("\n\n") || "(none)"}\n`,
  );
  await Bun.write(path.join(outDir, "dom.html"), dom || "<!-- no DOM captured (page failed to load) -->\n");

  const verdict = {
    url,
    ok: errors.length === 0 && layout.findings.length === 0,
    errors,
    layoutFindings: layout.findings,
    rendered: layout.census,
    artifacts: {
      dir: outDir,
      console: path.join(outDir, "console.txt"),
      screenshot: path.join(outDir, "latest.png"),
      network: path.join(outDir, "network.txt"),
      dom: path.join(outDir, "dom.html"),
    },
    interactions: interactionsFile ? path.basename(interactionsFile) : null,
    density: { graphical: layout.graphical, textChars: layout.words, band },
  };
  if (bool(flags, "json")) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
  console.log(`${errors.length ? "✗" : "✓"} ${errors.length} error(s)${interactionsFile ? " (ran " + path.basename(interactionsFile) + ")" : ""} — ${outDir}/{console.txt, latest.png, network.txt, dom.html}`);
  if (errors.length) for (const e of errors.slice(0, 10)) console.log("  " + e);

  // Layout findings go to stdout deliberately: they name the offending selector, so
  // they're actionable WITHOUT opening latest.png. Read the screenshot to judge how
  // it looks, not to hunt for overflow — that's what this is for.
  console.log(`${layout.findings.length ? "⚠" : "✓"} ${layout.findings.length} layout finding(s) · rendered: ${layout.census}`);
  for (const f of layout.findings) console.log("  " + f);

  console.log(`◐ ${density}   (informational — never blocks a commit)`);
  if (band === "prose-shaped" || band === "no graphical marks") {
    console.log("  a page this text-heavy is usually a document with styling on it — check bar 1 of Ambition:");
    console.log("  can you point at a mark and say what its position, size or colour MEANS? If the words genuinely are");
    console.log("  the deliverable (a deck, a written explainer), this line is noise — ignore it and move on.");
  }
  }

  // ---------------------------------------------------------------------------
  // --commit="<msg>" — commit the viz, but ONLY if this run was clean.
  //
  // SKILL.md used to admit "There's no hook safety net. If you forget to commit, the
  // changes get bundled into the next commit… Don't forget." Fixing "don't forget"
  // with a flag beats fixing it with a sentence. Deliberately NOT a hook: a hook
  // fires on every save and would bury the git log in noise.
  //
  // Refusing on a dirty run is the point — it makes "verified" and "committed" the
  // same event, so a broken render can't quietly reach the history.
  const commitMsg = flag("commit");
  if (commitMsg !== undefined) {
    const u = new URL(url);
    const vizDir = path.join(os.homedir(), decodeURIComponent(u.pathname));
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
      console.log(`✗ --commit needs a localhost viz target — no viz dir for ${u.hostname}`);
      process.exit(1);
    }
    if (errors.length || layout.findings.length) {
      console.log(
        `✗ not committing — ${errors.length} error(s), ${layout.findings.length} layout finding(s). ` +
          `Fix them and re-run, or commit by hand if they're intentional.`,
      );
      process.exit(1);
    }
    const git = async (a: string[], cwd: string) => {
      const p = Bun.spawn(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
      const out = (await new Response(p.stdout).text()).trim();
      return { code: await p.exited, out };
    };
    // Which repo owns this viz? A repo-local viz belongs to its HOST repo (no Session
    // trailer, that project's conventions); a central one to the central library.
    const top = await git(["rev-parse", "--show-toplevel"], vizDir);
    if (top.code !== 0) {
      console.log(`✗ --commit: ${vizDir} isn't inside a git repo`);
      process.exit(1);
    }
    const repo = top.out;
    const central = path.resolve(repo) === path.resolve(CENTRAL);
    const rel = path.relative(repo, vizDir) || ".";
    await git(["add", "--", rel], repo);
    const staged = await git(["diff", "--cached", "--name-only", "--", rel], repo);
    if (!staged.out) {
      console.log(`· nothing to commit in ${rel}`);
      process.exit(0);
    }
    const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
    const body = central && sessionId ? `${commitMsg}\n\nSession: ${sessionId}` : commitMsg;
    const done = await git(["commit", "-q", "-m", body], repo);
    console.log(
      done.code === 0
        ? `✓ committed ${staged.out.split("\n").length} file(s) in ${repo}${central ? "" : "  (host repo — no Session trailer)"}`
        : `✗ commit failed in ${repo}`,
    );
    process.exit(done.code === 0 ? 0 : 1);
  }
  process.exit(0);
}

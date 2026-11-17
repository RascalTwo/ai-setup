// lib/verify/og.ts — `verify --og`: shoot the viz's auto preview image (og.auto.png).
import path from "node:path";
import os from "node:os";
import { existsSync } from "node:fs";
import type { Page } from "puppeteer-core";
import { auditPage } from "./audit-page.ts";
import { stamp, type Capture } from "./capture.ts";

/** The top-left of the page's card element, or null when it has none. */
async function cardBox(page: Page): Promise<{ x: number; y: number } | null> {
  try {
    return await page.$eval(".og-card, .card", (el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
  } catch {
    return null;
  }
}

const clipToCard = (box: { x: number; y: number } | null) => ({
  x: box?.x ?? 0,
  y: box?.y ?? 0,
  width: 1200,
  height: 630,
});

/** A hero.html beside the viz is a hand-authored card: render THAT, audit it, and clip to its card element. */
async function shootHeroCard(
  page: Page,
  cap: Capture,
  url: string,
  heroDir: string,
  ogPath: string,
): Promise<void> {
  const { errors } = cap;
  await page.setViewport({ width: 1272, height: 720 }); // a touch larger than the card so it fits fully, then clip
  await page
    .goto(new URL("hero.html", url).href, { waitUntil: "networkidle2", timeout: 15000 })
    .catch(() => {
      /* a hero that does not load is reported by the missing card below */
    });
  await new Promise((r) => {
    setTimeout(r, 300);
  }); // settle fonts/layout
  await page
    .addStyleTag({ content: "#viz-feedback,#viz-status{display:none!important}" })
    .catch(() => {
      /* best-effort */
    }); // re-hide: goto reset the page
  const box = await cardBox(page);
  if (!box)
    errors.push(
      `[${stamp()}] hero.html has no .og-card/.card element — shooting top-left 1200×630 instead`,
    );
  // Audit the HERO too, not just index.html. This is the surface where layout
  // failure is least recoverable: the card is clipped to a fixed 1200×630, so
  // anything escaping the frame is silently cropped out of the image that gets
  // posted to Slack — and nobody sees it until it's already shared.
  const heroLayout = await auditPage(page);
  cap.layout.findings.push(...heroLayout.findings.map((f) => `hero.html → ${f}`));
  // Nudge hand-rolled hero cards back onto the kit. The corpus says prose in
  // SKILL.md doesn't land here: of the hero.html files authored AFTER
  // kit/viz-og.css existed, 11 of 13 still hand-rolled `.og-card { ... }`
  // rather than linking the kit — which is how the pre-kit corpus ended up
  // with six variants of the same padding rule. This is the one moment the
  // author is provably looking at the card, so say it here, not in a doc.
  const heroSrc = await Bun.file(path.join(heroDir, "hero.html"))
    .text()
    .catch(() => "");
  if (heroSrc && !heroSrc.includes("viz-og.css")) {
    console.log(
      `  ⚠ hero.html hand-rolls its card CSS — <link rel="stylesheet" href="/_kit/viz-og.css">\n` +
        `    gives you .og-card/.frame/.left/.right/.eyebrow/.title/.essence/.chips/.foot in kit\n` +
        `    tokens, so the card re-themes with the viz. Scaffold: viz create <slug> --hero`,
    );
  }
  await page.screenshot({ path: ogPath, clip: clipToCard(box) });
  console.log(
    `  ↳ og.auto.png → ${ogPath}  (rendered from hero.html — edit that card + re-run --og to update)`,
  );
}

/** A self-hero viz (viz:card=self) has no hero.html: the LIVE page is the card, so clip its own .og-card. */
async function shootSelfCard(page: Page, cap: Capture, ogPath: string): Promise<void> {
  const box = await cardBox(page);
  if (!box)
    cap.errors.push(
      `[${stamp()}] viz:card=self but no .og-card/.card element — shooting top-left 1200×630 instead`,
    );
  await page.screenshot({ path: ogPath, clip: clipToCard(box) });
  console.log(
    `  ↳ og.auto.png → ${ogPath}  (this poster IS its own card — edit index.html + re-run --og to update)`,
  );
}

/**
 * --og: also write the shot to <vizdir>/og.auto.png (the AUTO preview image). The viz
 * dir is homedir + URL pathname (a viz's URL path IS its path under $HOME), so this only
 * works for a localhost target — an external/file:// URL has no viz dir.
 */
export async function shootOg(page: Page, cap: Capture, url: string): Promise<void> {
  const u = new URL(url);
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") {
    cap.errors.push(
      `[${stamp()}] --og needs a localhost viz target — no viz dir for ${u.hostname}`,
    );
    return;
  }
  const heroDir = path.join(os.homedir(), decodeURIComponent(u.pathname));
  const ogPath = path.join(heroDir, "og.auto.png");
  // A hero.html beside the viz is a hand-authored 1200×630 OG card. Render THAT (not the
  // live page's post-interaction state) and clip to its card element (.og-card | .card).
  // A self-hero viz (viz:card=self) has no hero.html — the LIVE page IS the card, so clip
  // its own .og-card. The viewport is already 1200×630 (the --og default), where the
  // poster template's scale-to-fit renders at scale 1, so the clip is pixel-native.
  // The blind live-page shot is only the last-resort fallback.
  const heroExists = existsSync(path.join(heroDir, "hero.html"));
  const selfHero = !heroExists && !!(await page.$('meta[name="viz:card"][content="self"]'));
  if (heroExists) await shootHeroCard(page, cap, url, heroDir, ogPath);
  else if (selfHero) await shootSelfCard(page, cap, ogPath);
  else {
    await page.screenshot({ path: ogPath, fullPage: false });
    console.log(
      `  ↳ og.auto.png → ${ogPath}  (auto preview from the live page; add a hero.html card or hand-made og.png to upgrade)`,
    );
  }
}

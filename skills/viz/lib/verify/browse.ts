// lib/verify/browse.ts — drive one page in headless Chrome: load it, settle it, then the audit job's work.
import { launch, type Page } from "puppeteer-core";
import { tagAutomation } from "../automation.ts";
import { watchLiveCalls, listControls } from "./tier.ts";
import { chromePath } from "./chrome.ts";
import { auditLoadedPage, type AuditContext } from "./audit-flow.ts";
import { attachListeners, errMessage, stamp, type Capture } from "./capture.ts";

/** What the browser run needs to know. */
export type BrowseContext = AuditContext & {
  viewport: { width: number; height: number };
  wait: string | undefined;
  audit: boolean;
};

/** What the page showed that decides the testing tier (tier.ts). */
export type Observed = { live: Set<string>; controls: string[] };

/** Open `url`, wait until the film timeline and the `--wait` target are ready, and let late console output and animations settle. */
async function loadAndSettle(page: Page, cap: Capture, url: string, wait?: string): Promise<void> {
  const { errors } = cap;
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 15000 });
  } catch (e) {
    errors.push(`[${stamp()}] NAVIGATION FAILED: ${errMessage(e)}`);
  }

  // A declared film (<meta name="viz:film">) is only on screen once its timeline registers.
  await page
    .waitForFunction(
      `!document.querySelector('meta[name="viz:film"]') || !!(window.__viz && window.__viz.timeline)`,
      { timeout: 20000 },
    )
    .catch(() =>
      errors.push(
        `[${stamp()}] FILM TIMELINE NEVER REGISTERED: <meta name="viz:film"> but no window.__viz.timeline after 20s`,
      ),
    );
  if (wait) {
    if (/^\d+$/u.test(wait))
      await new Promise((r) => {
        setTimeout(r, Number(wait));
      });
    else
      await page
        .waitForSelector(wait, { timeout: 10000 })
        .catch(() => errors.push(`[${stamp()}] WAIT SELECTOR NOT FOUND: ${wait}`));
  }
  await new Promise((r) => {
    setTimeout(r, 400);
  }); // settle: late console / animations

  // The live server injects a feedback widget (#viz-feedback: the corner pill + pins) and a
  // build-status pill (#viz-status, kit/reload.ts: "building…"/"ready").
  // Both are live-interaction chrome, never wanted in a screenshot — and being position:fixed they land
  // inside the og clip. Hide them before any shot. They are re-injected on each page load, so the
  // hero.html branch re-hides after its own navigation.
  await page
    .addStyleTag({ content: "#viz-feedback,#viz-status{display:none!important}" })
    .catch(() => {
      /* the style tag is best-effort */
    });
}

/** Launch Chrome, load the page, collect console and network, and (for the audit job) audit and shoot it. */
export async function browse(cap: Capture, ctx: BrowseContext): Promise<Observed> {
  let live = new Set<string>(),
    controls: string[] = []; // what decides the testing tier (tier.ts)
  const browser = await launch({ executablePath: chromePath(), headless: true });
  try {
    const page = await browser.newPage();
    await tagAutomation(page); // backends refuse to ACT on this load: see lib/automation.ts
    await page.setViewport(ctx.viewport);
    live = watchLiveCalls(page);
    attachListeners(page, cap);
    await loadAndSettle(page, cap, ctx.url, ctx.wait);
    if (!ctx.audit) controls = await listControls(page); // `viz test` alone needs only what decides the tier, not the audit
    else controls = await auditLoadedPage(page, cap, ctx);
    await Promise.allSettled(cap.bodyTasks); // let response bodies finish reading before close
  } finally {
    await browser.close();
  }
  return { live, controls };
}

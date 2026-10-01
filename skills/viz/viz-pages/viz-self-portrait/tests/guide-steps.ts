// Steps shared by the Guide's tests (guide*.test.ts): where the reader is, how they drive a
// scrubbed figure, and the two ways the page can be opened that the shared helpers don't cover.
import type { Page } from "puppeteer-core";
import { reducedMotion, type SPPage } from "./helpers.ts";

/** Both motion settings: the guide scrolls instantly under reduced motion and smoothly otherwise. */
export const MOTIONS = [
  { name: "reduced motion", before: reducedMotion },
  { name: "smooth motion", before: undefined },
] as const;

/** Waits until the rail marks `id` as the stop being read. */
export const onStop = (page: Page, id: string) =>
  page.waitForFunction((s) => document.querySelector(".rail-stop.on")?.getAttribute("data-stop") === s, { timeout: 10_000 }, id)
    .catch(async (e) => { throw new Error(`the rail never marked "${id}": it marks ${await page.evaluate(() => document.querySelector(".rail-stop.on")?.getAttribute("data-stop"))}, at ${await page.evaluate(() => location.hash)}`, { cause: e }); });

/** Waits until an element's top edge sits at the top of the view (a scroll has landed). */
export const atTop = (page: Page, sel: string) =>
  page.waitForFunction((s) => Math.abs(document.querySelector(s)!.getBoundingClientRect().top) < 3, { timeout: 10_000 }, sel)
    .catch(async (e) => { throw new Error(`${sel} never reached the top of the view: its top is at ${await page.$eval(sel, (el) => el.getBoundingClientRect().top)}`, { cause: e }); });

/** A scrubbed stop's position readout, e.g. "2 / 5". */
export const position = (page: Page, stop: string) => page.$eval(`#stop-${stop} .fig-pos`, (e) => e.textContent);

/** Waits for a scrubbed stop's readout to say `want`. */
export const atStep = (page: Page, stop: string, want: string) =>
  page.waitForFunction((s, w) => document.querySelector(`#stop-${s} .fig-pos`)!.textContent === w, { timeout: 10_000 }, stop, want)
    .catch(async (e) => { throw new Error(`${stop} never reached step ${want}: it reads ${await position(page, stop)}`, { cause: e }); });

/** Brings a scrubbed stop to the top of the view through the rail, and puts it on its first step. */
export async function arriveAt(page: Page, stop: string) {
  await page.click(`.rail-stop[data-stop="${stop}"]`);
  await onStop(page, stop);
  await atTop(page, `#stop-${stop}`);
  await page.click(`#stop-${stop} .fig-tick:first-child`);
  await atStep(page, stop, "1 / " + (await page.$eval(`#stop-${stop} .fig-pos`, (e) => e.textContent!.split(" / ")[1])));
}

/** Walks a scrubbed stop forward with its → button, calling `see` at each step (0-based). */
export async function walk(page: Page, stop: string, see: (i: number) => Promise<void>) {
  await arriveAt(page, stop);
  const n = Number((await position(page, stop))!.split(" / ")[1]);
  for (let i = 0; i < n; i++) {
    if (i) { await page.click(`#stop-${stop} .fig-next`); await atStep(page, stop, `${i + 1} / ${n}`); }
    await see(i);
  }
}

/** Is the element shown (not display:none, and has a box)? */
export const shown = (page: Page, sel: string) =>
  page.$eval(sel, (e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0);

/** The page as it is published: no live feedback widget. The server injects it into every live
 *  page and it takes every Alt-click for itself; a published copy has no such script. */
export const asPublished = (p: Page) => p.evaluateOnNewDocument(() => {
  new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes)
      if (n instanceof HTMLScriptElement && n.dataset["vizFeedback"] !== undefined) n.removeAttribute("data-viz-feedback");
  }).observe(document, { childList: true, subtree: true });
});

/** A browser on another machine: what navigator reports about its platform. */
export const onPlatform = ({ ua, platform, uaData = "" }: { ua: string; platform: string; uaData?: string }) => (p: Page) =>
  p.evaluateOnNewDocument((ua: string, platform: string, uaData: string) => {
    Object.defineProperty(Navigator.prototype, "userAgent", { get: () => ua });
    Object.defineProperty(Navigator.prototype, "platform", { get: () => platform });
    Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => ({ platform: uaData }) });
  }, ua, platform, uaData);

export type { SPPage };

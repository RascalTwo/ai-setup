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
export async function onStop(page: Page, id: string): Promise<void> {
  try {
    await page.waitForFunction(
      (s) => document.querySelector<HTMLElement>(".rail-stop.on")?.dataset.stop === s,
      { timeout: 10_000 },
      id,
    );
  } catch (e: unknown) {
    throw new Error(
      `the rail never marked "${id}": it marks ${await page.evaluate(() => document.querySelector<HTMLElement>(".rail-stop.on")?.dataset.stop)}, at ${await page.evaluate(() => location.hash)}`,
      { cause: e },
    );
  }
}

/** Waits until an element's top edge sits at the top of the view (a scroll has landed). */
export async function atTop(page: Page, sel: string): Promise<void> {
  try {
    await page.waitForFunction(
      (s) => Math.abs(document.querySelector(s)!.getBoundingClientRect().top) < 3,
      { timeout: 10_000 },
      sel,
    );
  } catch (e: unknown) {
    throw new Error(
      `${sel} never reached the top of the view: its top is at ${await page.$eval(sel, (el) => el.getBoundingClientRect().top)}`,
      { cause: e },
    );
  }
}

/** A scrubbed stop's position readout, e.g. "2 / 5". */
export async function position(page: Page, stop: string): Promise<string> {
  const pos = await page.$eval(`#stop-${stop} .fig-pos`, (e) => e.textContent);
  return pos;
}

/** Waits for a scrubbed stop's readout to say `want`. */
export async function atStep(page: Page, stop: string, want: string): Promise<void> {
  try {
    await page.waitForFunction(
      (s, w) => document.querySelector(`#stop-${s} .fig-pos`)!.textContent === w,
      { timeout: 10_000 },
      stop,
      want,
    );
  } catch (e: unknown) {
    throw new Error(`${stop} never reached step ${want}: it reads ${await position(page, stop)}`, {
      cause: e,
    });
  }
}

/** Brings a scrubbed stop to the top of the view through the rail, and puts it on its first step. */
export async function arriveAt(page: Page, stop: string): Promise<void> {
  await page.click(`.rail-stop[data-stop="${stop}"]`);
  await onStop(page, stop);
  await atTop(page, `#stop-${stop}`);
  await page.click(`#stop-${stop} .fig-tick:first-child`);
  await atStep(
    page,
    stop,
    "1 / " + (await page.$eval(`#stop-${stop} .fig-pos`, (e) => e.textContent.split(" / ")[1])),
  );
}

/** Walks a scrubbed stop forward with its → button, calling `see` at each step (0-based). */
export async function walk(
  page: Page,
  stop: string,
  see: (i: number) => Promise<void>,
): Promise<void> {
  await arriveAt(page, stop);
  const n = Number((await position(page, stop)).split(" / ")[1]);
  const visit = async (i: number): Promise<void> => {
    if (i) {
      await page.click(`#stop-${stop} .fig-next`);
      await atStep(page, stop, `${i + 1} / ${n}`);
    }
    await see(i);
  };
  for (let i = 0; i < n; i++) {
    // oxlint-disable-next-line no-await-in-loop -- stepper walk: step i is reached and seen before step i+1 is clicked to
    await visit(i);
  }
}

/** Is the element shown (not display:none, and has a box)? */
export async function shown(page: Page, sel: string): Promise<boolean> {
  const isShown = await page.$eval(
    sel,
    (e) => getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0,
  );
  return isShown;
}

/** The page as it is published: no live feedback widget. The server injects it into every live
 *  page and it takes every Alt-click for itself; a published copy has no such script. */
export const asPublished = async (p: Page): Promise<void> => {
  await p.evaluateOnNewDocument(() => {
    new MutationObserver((ms) => {
      for (const m of ms)
        for (const n of m.addedNodes)
          if (n instanceof HTMLScriptElement && n.dataset["vizFeedback"] !== undefined)
            delete n.dataset.vizFeedback;
    }).observe(document, { childList: true, subtree: true });
  });
};

/** A browser on another machine: what navigator reports about its platform. */
export const onPlatform =
  ({
    ua,
    platform,
    uaData = "",
  }: {
    ua: string;
    platform: string;
    uaData?: string;
  }): ((p: Page) => Promise<void>) =>
  async (p) => {
    await p.evaluateOnNewDocument(
      (agent: string, plat: string, data: string) => {
        Object.defineProperty(Navigator.prototype, "userAgent", { get: () => agent });
        Object.defineProperty(Navigator.prototype, "platform", { get: () => plat });
        Object.defineProperty(Navigator.prototype, "userAgentData", {
          get: () => ({ platform: data }),
        });
      },
      ua,
      platform,
      uaData,
    );
  };

export type { SPPage };

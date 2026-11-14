/* Disposable — walks the guide and shoots every stop, plus a couple of
 * mid-scrub states, because a plain verify run only ever sees state 1.
 * Delete once the rebuild is signed off. */
import type { Page } from "puppeteer-core";

const pause = async (ms: number): Promise<void> => {
  await new Promise<void>((r) => {
    setTimeout(r, ms);
  });
};

export default async function walkGuide(
  page: Page,
  { shot }: { shot: (name: string) => Promise<unknown> },
): Promise<void> {
  const stops = [
    "why",
    "install",
    "ask",
    "refine",
    "review",
    "forms",
    "templates",
    "data",
    "library",
    "publish",
    "access",
    "session",
    "runtime",
    "internals",
    "map",
    "bars",
  ];

  const shootStop = async (id: string): Promise<void> => {
    // Scrubbed stops are tall and pinned; land ~40% in so the figure has
    // actually advanced past its opening step.
    await page.evaluate((sid: string) => {
      const el = document.querySelector<HTMLElement>("#stop-" + sid);
      if (!el) return;
      const scrub = el.classList.contains("scrub");
      const run = Math.max(1, el.offsetHeight - window.innerHeight);
      window.scrollTo({ top: el.offsetTop + (scrub ? run * 0.4 : -20), behavior: "instant" });
    }, id);
    await pause(320);
    await shot(id);
  };
  for (const id of stops) {
    // oxlint-disable-next-line no-await-in-loop -- the walk is sequential: each stop is scrolled to and shot on the one page
    await shootStop(id);
  }

  // Every install tab. A plain run only ever sees the first one, and the whole point of
  // the tabs is that the OTHER ways in are documented — an unseen tab is an undocumented
  // install path. Shoot each so a regression in one is visible.
  const shootInstallTab = async (way: string): Promise<void> => {
    await page.evaluate((w: string) => {
      const el = document.querySelector<HTMLElement>("#stop-install");
      if (el) window.scrollTo({ top: el.offsetTop - 20, behavior: "instant" });
      const tab = document.querySelector<HTMLElement>(`.inst-tab[data-way="${w}"]`);
      if (tab) tab.click();
    }, way);
    await pause(260);
    await shot(`install-${way}`);
  };
  for (const way of ["agents", "chat", "none", "dev"]) {
    // oxlint-disable-next-line no-await-in-loop -- the walk is sequential: each tab is clicked and shot on the one page
    await shootInstallTab(way);
  }

  // A late step of the runtime tracer, on a non-default scenario.
  await page.evaluate(() => {
    const btn = document.querySelectorAll<HTMLElement>("#rt-picker button")[3];
    if (btn) btn.click();
    const el = document.querySelector<HTMLElement>("#stop-runtime");
    if (el) {
      const run = Math.max(1, el.offsetHeight - window.innerHeight);
      window.scrollTo({ top: el.offsetTop + run * 0.85, behavior: "instant" });
    }
  });
  await pause(320);
  await shot("runtime-late");

  // The five-bar "show me" highlight.
  await page.evaluate(() => {
    const b = document.querySelector<HTMLElement>('.bar[data-bar="4"] .bar-show');
    if (b) b.click();
  });
  await pause(260);
  await shot("bars-lit");
}

// Driven by `viz verify` after load. Each step is a behaviour check that THROWS on
// failure, so a broken interaction fails verify instead of just photographing it.
import type { Page } from "puppeteer-core";

const pause = async (ms: number): Promise<void> => {
  await new Promise<void>((done) => {
    setTimeout(done, ms);
  });
};
// How long a zoom range written to the link is, in ms (null when it isn't a [from, to] pair).
const zoomSpan = (z: unknown): number | null => {
  if (!Array.isArray(z)) return null;
  const pair: unknown[] = z;
  const from = pair[0],
    to = pair[1];
  return typeof from === "number" && typeof to === "number" ? to - from : null;
};

export default async function interactions(
  page: Page,
  { shot }: { shot: (name: string) => Promise<unknown> },
): Promise<void> {
  const check = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`interaction check failed: ${what}`);
  };
  // The sources drawn on the (merged) timeline, by their weekly lines.
  const panels = async (): Promise<(string | undefined)[]> => {
    const srcs = await page.$$eval("#tl path[data-src]", (els) => [
      ...new Set(els.map((e) => (e as SVGElement).dataset["src"])),
    ]);
    return srcs;
  };
  const hash = async (): Promise<{ zoom?: unknown; sel?: unknown }> => {
    const raw = await page.evaluate(() => decodeURIComponent(location.hash.slice(1)) || "{}");
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  };
  const click = async (sel: string) => {
    await page.click(sel);
    await pause(400);
  };

  // GIVEN the page loaded with every source visible
  const start = await panels();
  check(start.length > 0, "at least one source is drawn");
  await shot("opening");

  // WHEN the reader picks "Last 24h"
  await click('#tlCtl [data-p="24h"]');
  // THEN the zoom is remembered across the 60s reload, as a ~24h range
  const z = (await hash()).zoom;
  const span = zoomSpan(z);
  check(
    span !== null && Math.abs(span - 24 * 3600e3) < 3600e3,
    `24h preset stores a 24h range (got ${JSON.stringify(z)})`,
  );
  await shot("last-24h");

  // WHEN the reader hides the second source (only when there are two)
  if (start.length > 1) {
    const first = await page.$eval("#tlCtl [data-src]", (e) =>
      e instanceof HTMLElement ? e.dataset["src"] : undefined,
    );
    await click("#tlCtl [data-src]:not([data-src='" + (first ?? "") + "'])");
    // THEN its lines leave the chart and the other source stays
    check(
      (await panels()).length === start.length - 1,
      "unchecking a source removes it from the chart",
    );
    await click("#tlCtl [data-src]:not(:checked)");
    check((await panels()).length === start.length, "rechecking restores it");
  }

  // WHEN the reader picks "Last week", then clicks the first 5-hour bar in view
  await click('#tlCtl [data-p="lastweek"]');
  const bar = await page.$("#bars g.b");
  if (bar) {
    await bar.click();
    await pause(400);
    // THEN that window is selected and the timeline zooms around it
    const h = await hash();
    const barSpan = zoomSpan(h.zoom);
    check(
      !!h.sel && barSpan !== null && barSpan < 24 * 3600e3,
      "clicking a bar selects it and zooms to it",
    );
    await shot("bar-selected");
  }

  // WHEN the page is opened with ?demo
  await page.goto(page.url().split("#")[0]!.split("?")[0]! + "?demo", {
    waitUntil: "networkidle0",
  });
  // THEN it says so, and shows the generated sources rather than live data
  check(!!(await page.$("#banner .banner")), "?demo shows the demo banner");
  check((await panels()).length === 2, "demo data carries both sources");
  await shot("demo");
}

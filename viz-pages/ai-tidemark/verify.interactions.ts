// Driven by `viz verify` after load. Each step is a behaviour check that THROWS on
// failure, so a broken interaction fails verify instead of just photographing it.
export default async (page: any, { shot }: any) => {
  const check = (ok: boolean, what: string) => { if (!ok) throw new Error(`interaction check failed: ${what}`); };
  // The sources drawn on the (merged) timeline, by their weekly lines.
  const panels = () => page.$$eval("#tl path[data-src]", (els: any[]) => [...new Set(els.map((e) => e.dataset.src))]);
  const hash = () => page.evaluate(() => JSON.parse(decodeURIComponent(location.hash.slice(1)) || "{}"));
  const click = async (sel: string) => { await page.click(sel); await new Promise((r) => setTimeout(r, 400)); };

  // GIVEN the page loaded with every source visible
  const start = await panels();
  check(start.length >= 1, "at least one source is drawn");
  await shot("opening");

  // WHEN the reader picks "Last 24h"
  await click('#tlCtl [data-p="24h"]');
  // THEN the zoom is remembered across the 60s reload, as a ~24h range
  const z = (await hash()).zoom;
  check(Array.isArray(z) && Math.abs(z[1] - z[0] - 24 * 3600e3) < 3600e3, `24h preset stores a 24h range (got ${JSON.stringify(z)})`);
  await shot("last-24h");

  // WHEN the reader hides the second source (only when there are two)
  if (start.length > 1) {
    await click("#tlCtl [data-src]:not([data-src='" + (await page.$eval("#tlCtl [data-src]", (e: any) => e.dataset.src)) + "'])");
    // THEN its lines leave the chart and the other source stays
    check((await panels()).length === start.length - 1, "unchecking a source removes it from the chart");
    await click("#tlCtl [data-src]:not(:checked)");
    check((await panels()).length === start.length, "rechecking restores it");
  }

  // WHEN the reader picks "Last week", then clicks the first 5-hour bar in view
  await click('#tlCtl [data-p="lastweek"]');
  const bar = await page.$("#bars g.b");
  if (bar) {
    await bar.click(); await new Promise((r) => setTimeout(r, 400));
    // THEN that window is selected and the timeline zooms around it
    const h = await hash();
    check(!!h.sel && Array.isArray(h.zoom) && h.zoom[1] - h.zoom[0] < 24 * 3600e3, "clicking a bar selects it and zooms to it");
    await shot("bar-selected");
  }

  // WHEN the page is opened with ?demo
  await page.goto(page.url().split("#")[0].split("?")[0] + "?demo", { waitUntil: "networkidle0" });
  // THEN it says so, and shows the generated sources rather than live data
  check(!!(await page.$("#banner .banner")), "?demo shows the demo banner");
  check((await panels()).length === 2, "demo data carries both sources");
  await shot("demo");
};

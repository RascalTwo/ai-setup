// The tab shell (dashboard.ts's showTab / routeHash / initTab): which tab you land on, switching
// tabs, and the hash that names the tab.
import { describe, it, expect } from "bun:test";
import { activeTab, guideReady, dashboardReady, reducedMotion } from "./helpers.ts";
import { open, click } from "./steps-library.ts";

describe("the tab shell", () => {
  it.concurrent("should land a first-time visitor on the Guide and a returning one on the Dashboard", async () => {
    // GIVEN someone who has never opened the page
    const page = await open();

    // WHEN the page has loaded

    // THEN they land on the Guide
    expect(await activeTab(page)).toBe("guide");
    expect(await page.evaluate(() => location.hash)).toStartWith("#guide");

    // WHEN they come back later, by the bare address
    await page.goto(process.env.VIZ_URL!.replace(/#.*$/, ""), { waitUntil: "networkidle2" });

    // THEN they land on the Dashboard, and once it has drawn the hash names it
    expect(await activeTab(page)).toBe("dashboard");
    await dashboardReady(page);
    expect(await page.evaluate(() => location.hash)).toBe("#dashboard");
  });

  // guide.ts once rewrote the hash to "#guide&stop=<last stop>" at boot whichever tab was showing
  // (a hidden panel measures every stop at top 0), so a reload on Rank landed on the Guide.
  for (const tab of ["rank", "dashboard"]) {
    it.concurrent(`should keep the ${tab} tab, in the hash and on screen, across a reload`, async () => {
      // GIVEN the tab, opened by its link
      const page = await open({ hash: tab });

      // WHEN the guide has booted behind it and the user reloads
      await guideReady(page);
      expect(await page.evaluate(() => location.hash)).toBe("#" + tab);
      await page.reload({ waitUntil: "networkidle2" });

      // THEN the hash and the tab showing are still that tab
      expect(await activeTab(page)).toBe(tab);
      expect(await page.evaluate(() => location.hash)).toBe("#" + tab);
    });
  }

  it.concurrent("should keep the stop in the hash in step as the reader scrolls the Guide", async () => {
    // GIVEN the Guide, at the top
    const page = await open({ hash: "guide", before: reducedMotion });
    await guideReady(page);

    // WHEN the reader scrolls until "Your whole library" is near the top of the view
    await page.evaluate(() => scrollTo({ top: document.getElementById("stop-library")!.offsetTop - 100, behavior: "instant" }));

    // THEN the hash names that stop
    await page.waitForFunction(() => location.hash === "#guide&stop=library", { timeout: 5000 });

    // WHEN they scroll further, to "Who can see it"
    await page.evaluate(() => scrollTo({ top: document.getElementById("stop-access")!.offsetTop - 100, behavior: "instant" }));

    // THEN the hash follows
    await page.waitForFunction(() => location.hash === "#guide&stop=access", { timeout: 5000 });
  });

  it.concurrent("should switch tabs from the tab bar, with the hash naming the tab", async () => {
    // GIVEN the Guide
    const page = await open({ hash: "guide" });
    await guideReady(page);

    // WHEN the user clicks the Dashboard tab
    await click(page, "#tabbtn-dashboard");

    // THEN the Dashboard shows and the hash says so
    expect(await activeTab(page)).toBe("dashboard");
    expect(await page.evaluate(() => location.hash)).toBe("#dashboard");
    await dashboardReady(page);

    // WHEN they click the Rank tab
    await click(page, "#tabbtn-rank");

    // THEN Rank shows, and it is the only tab showing
    expect(await activeTab(page)).toBe("rank");
    expect(await page.$$eval(".tab-panel.active", (e) => e.length)).toBe(1);
    expect(await page.evaluate(() => location.hash)).toBe("#rank");
  });

  it.concurrent("should follow a hash change to a tab, and send an old #quickstart link to the Guide", async () => {
    // GIVEN the Dashboard
    const page = await open({ hash: "dashboard" });

    // WHEN the address changes to #quickstart, a link from before the Guide existed
    await page.evaluate(() => { location.hash = "#quickstart"; });

    // THEN the Guide shows
    await page.waitForFunction(() => document.getElementById("tab-guide")!.classList.contains("active"));
    expect(await activeTab(page)).toBe("guide");
  });

  it.concurrent("should open an old #quickstart link at the Guide's install stop, and ignore a hash naming no tab", async () => {
    // GIVEN a link from before the Guide existed
    const page = await open({ hash: "quickstart", before: reducedMotion });

    // WHEN the page has loaded
    await guideReady(page);

    // THEN the Guide shows at its install stop, and the hash names that stop
    expect(await activeTab(page)).toBe("guide");
    await page.waitForFunction(() => document.querySelector<HTMLElement>(".rail-stop.on")?.dataset.stop === "install", { timeout: 5000 });
    expect(await page.evaluate(() => location.hash)).toBe("#guide&stop=install");

    // GIVEN an old #readme link, which names no stop
    const readme = await open({ hash: "readme" });

    // WHEN the page has loaded
    await guideReady(readme);

    // THEN the Guide shows, and the hash names it
    expect(await activeTab(readme)).toBe("guide");
    expect(await readme.evaluate(() => location.hash)).toStartWith("#guide");

    // WHEN the user goes to the Dashboard, then the address changes to a hash naming no tab
    await click(page, "#tabbtn-dashboard");
    await page.evaluate(() => new Promise<void>((r) => { addEventListener("hashchange", () => r(), { once: true }); location.hash = "#nonsense"; }));

    // THEN the Dashboard stays
    expect(await activeTab(page)).toBe("dashboard");

    // WHEN it changes to #rank
    await page.evaluate(() => { location.hash = "#rank"; });

    // THEN Rank shows
    await page.waitForFunction(() => document.getElementById("tab-rank")!.classList.contains("active"));
  });

  it.concurrent("should still work where the browser refuses storage, remembering nothing", async () => {
    // GIVEN a browser where every use of localStorage throws (a sandboxed or locked-down page)
    const page = await open({
      before: (p) => p.evaluateOnNewDocument(() => {
        Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
      }),
    });

    // WHEN the page has loaded

    // THEN a visitor lands on the Guide, as a first-timer does
    expect(await activeTab(page)).toBe("guide");

    // WHEN they open the Dashboard and pick the grid view
    await click(page, "#tabbtn-dashboard");
    await dashboardReady(page);
    await click(page, '#slug-view [data-view="cards"]');

    // THEN the grid shows
    expect(await page.$eval("#slugs", (e) => e.classList.contains("cards"))).toBe(true);

    // WHEN they come back by the bare address
    await page.goto(process.env.VIZ_URL!.replace(/#.*$/, ""), { waitUntil: "networkidle2" });

    // THEN nothing was remembered: the Guide again, and a list
    expect(await activeTab(page)).toBe("guide");
    expect(await page.$eval("#slugs", (e) => e.classList.contains("cards"))).toBe(false);
    expect(page.errors).toEqual([]);
  });
});

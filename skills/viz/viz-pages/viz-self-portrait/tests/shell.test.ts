// The tab shell (dashboard.ts's showTab / routeHash / initTab): which tab you land on, switching
// tabs, and the hash that names the tab.
import { describe, it, expect } from "bun:test";
import { activeTab, guideReady, dashboardReady, reducedMotion } from "./helpers.ts";
import { open, click } from "./steps-library.ts";

describe("the tab shell", () => {
  it.concurrent("should land a first-time visitor on the Guide and a returning one on the Dashboard", async () => {
    const page = await viz.given("someone who has never opened the page", async () => open());

    await viz.when("the page has loaded");

    await viz.then("they land on the Guide", async () => {
      expect(await activeTab(page)).toBe("guide");
      expect(await page.evaluate(() => location.hash)).toStartWith("#guide");
    });

    await viz.when("they come back later, by the bare address", async () => {
      await page.goto(process.env.VIZ_URL!.replace(/#.*$/u, ""), { waitUntil: "networkidle2" });
    });

    await viz.then(
      "they land on the Dashboard, and once it has drawn the hash names it",
      async () => {
        expect(await activeTab(page)).toBe("dashboard");
        await dashboardReady(page);
        expect(await page.evaluate(() => location.hash)).toBe("#dashboard");
      },
    );
  });

  // guide.ts once rewrote the hash to "#guide&stop=<last stop>" at boot whichever tab was showing
  // (a hidden panel measures every stop at top 0), so a reload on Rank landed on the Guide.
  for (const tab of ["rank", "dashboard"]) {
    it.concurrent(`should keep the ${tab} tab, in the hash and on screen, across a reload`, async () => {
      const page = await viz.given("the tab, opened by its link", async () => open({ hash: tab }));

      await viz.when("the guide has booted behind it and the user reloads", async () => {
        await guideReady(page);
        expect(await page.evaluate(() => location.hash)).toBe("#" + tab);
        await page.reload({ waitUntil: "networkidle2" });
      });

      await viz.then("the hash and the tab showing are still that tab", async () => {
        expect(await activeTab(page)).toBe(tab);
        expect(await page.evaluate(() => location.hash)).toBe("#" + tab);
      });
    });
  }

  it.concurrent("should keep the stop in the hash in step as the reader scrolls the Guide", async () => {
    const page = await viz.given("the Guide, at the top", async () => {
      const p = await open({ hash: "guide", before: reducedMotion });
      await guideReady(p);
      return p;
    });

    await viz.when(
      'the reader scrolls until "Your whole library" is near the top of the view',
      async () => {
        await page.evaluate(() =>
          scrollTo({
            top: document.querySelector<HTMLElement>("#stop-library")!.offsetTop - 100,
            behavior: "instant",
          }),
        );
      },
    );

    await viz.then("the hash names that stop", async () => {
      await page.waitForFunction(() => location.hash === "#guide&stop=library", {
        timeout: 5000,
      });
    });

    await viz.when('they scroll further, to "Who can see it"', async () => {
      await page.evaluate(() =>
        scrollTo({
          top: document.querySelector<HTMLElement>("#stop-access")!.offsetTop - 100,
          behavior: "instant",
        }),
      );
    });

    await viz.then("the hash follows", async () => {
      await page.waitForFunction(() => location.hash === "#guide&stop=access", {
        timeout: 5000,
      });
    });
  });

  it.concurrent("should switch tabs from the tab bar, with the hash naming the tab", async () => {
    const page = await viz.given("the Guide", async () => {
      const p = await open({ hash: "guide" });
      await guideReady(p);
      return p;
    });

    await viz.when("the user clicks the Dashboard tab", async () =>
      click(page, "#tabbtn-dashboard"),
    );

    await viz.then("the Dashboard shows and the hash says so", async () => {
      expect(await activeTab(page)).toBe("dashboard");
      expect(await page.evaluate(() => location.hash)).toBe("#dashboard");
      await dashboardReady(page);
    });

    await viz.when("they click the Rank tab", async () => click(page, "#tabbtn-rank"));

    await viz.then("Rank shows, and it is the only tab showing", async () => {
      expect(await activeTab(page)).toBe("rank");
      expect(await page.$$eval(".tab-panel.active", (e) => e.length)).toBe(1);
      expect(await page.evaluate(() => location.hash)).toBe("#rank");
    });
  });

  it.concurrent("should follow a hash change to a tab, and send an old #quickstart link to the Guide", async () => {
    const page = await viz.given("the Dashboard", async () => open({ hash: "dashboard" }));

    await viz.when(
      "the address changes to #quickstart, a link from before the Guide existed",
      async () => {
        await page.evaluate(() => {
          location.hash = "#quickstart";
        });
      },
    );

    await viz.then("the Guide shows", async () => {
      await page.waitForFunction(() =>
        document.querySelector("#tab-guide")!.classList.contains("active"),
      );
      expect(await activeTab(page)).toBe("guide");
    });
  });

  it.concurrent("should open an old #quickstart link at the Guide's install stop, and ignore a hash naming no tab", async () => {
    const page = await viz.given("a link from before the Guide existed", async () =>
      open({ hash: "quickstart", before: reducedMotion }),
    );

    await viz.when("the page has loaded", async () => guideReady(page));

    await viz.then(
      "the Guide shows at its install stop, and the hash names that stop",
      async () => {
        expect(await activeTab(page)).toBe("guide");
        await page.waitForFunction(
          () => document.querySelector<HTMLElement>(".rail-stop.on")?.dataset.stop === "install",
          { timeout: 5000 },
        );
        expect(await page.evaluate(() => location.hash)).toBe("#guide&stop=install");
      },
    );

    const readme = await viz.given("an old #readme link, which names no stop", async () =>
      open({ hash: "readme" }),
    );

    await viz.when("the page has loaded", async () => guideReady(readme));

    await viz.then("the Guide shows, and the hash names it", async () => {
      expect(await activeTab(readme)).toBe("guide");
      expect(await readme.evaluate(() => location.hash)).toStartWith("#guide");
    });

    await viz.when(
      "the user goes to the Dashboard, then the address changes to a hash naming no tab",
      async () => {
        await click(page, "#tabbtn-dashboard");
        await page.evaluate(async () => {
          await new Promise<void>((r) => {
            addEventListener(
              "hashchange",
              () => {
                r();
              },
              { once: true },
            );
            location.hash = "#nonsense";
          });
        });
      },
    );

    await viz.then("the Dashboard stays", async () => {
      expect(await activeTab(page)).toBe("dashboard");
    });

    await viz.when("it changes to #rank", async () => {
      await page.evaluate(() => {
        location.hash = "#rank";
      });
    });

    await viz.then("Rank shows", async () => {
      await page.waitForFunction(() =>
        document.querySelector("#tab-rank")!.classList.contains("active"),
      );
    });
  });

  it.concurrent("should still work where the browser refuses storage, remembering nothing", async () => {
    const page = await viz.given(
      "a browser where every use of localStorage throws (a sandboxed or locked-down page)",
      async () =>
        open({
          before: async (p) => {
            await p.evaluateOnNewDocument(() => {
              Object.defineProperty(window, "localStorage", {
                get() {
                  throw new DOMException("denied", "SecurityError");
                },
              });
            });
          },
        }),
    );

    await viz.when("the page has loaded");

    await viz.then("a visitor lands on the Guide, as a first-timer does", async () => {
      expect(await activeTab(page)).toBe("guide");
    });

    await viz.when("they open the Dashboard and pick the grid view", async () => {
      await click(page, "#tabbtn-dashboard");
      await dashboardReady(page);
      await click(page, '#slug-view [data-view="cards"]');
    });

    await viz.then("the grid shows", async () => {
      expect(await page.$eval("#slugs", (e) => e.classList.contains("cards"))).toBe(true);
    });

    await viz.when(
      'they tick "show all" and reset the filters, which would each remember it',
      async () => {
        await click(page, "#f-all");
        await click(page, "#filters-reset");
      },
    );

    await viz.then("it still works, and it is unticked", async () => {
      expect(
        await page.$eval("#f-all", (e) => (e instanceof HTMLInputElement ? e.checked : null)),
      ).toBe(false);
    });

    await viz.when("they come back by the bare address", async () => {
      await page.goto(process.env.VIZ_URL!.replace(/#.*$/u, ""), { waitUntil: "networkidle2" });
    });

    await viz.then("nothing was remembered: the Guide again, and a list", async () => {
      expect(await activeTab(page)).toBe("guide");
      expect(await page.$eval("#slugs", (e) => e.classList.contains("cards"))).toBe(false);
      expect(page.errors).toEqual([]);
    });
  });
});

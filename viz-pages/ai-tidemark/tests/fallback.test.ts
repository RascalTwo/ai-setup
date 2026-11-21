// When /data cannot answer, the tidemark shows its generated demo data and says so. It never shows a blank page.
import { describe, it, expect } from "bun:test";
import { open, ready, texts, twoSources, type Answer } from "./helpers.ts";

/** The page is showing the demo fixture: the banner, and both demo sources. */
async function expectDemo(page: Awaited<ReturnType<typeof open>>) {
  await ready(page);
  expect(await page.$eval("#banner .banner", (e) => e.textContent)).toStartWith("Demo data");
  expect(await page.$eval("#stamp", (e) => e.textContent)).toBe("");
  const sources = await texts(page, ".kpis .src");
  expect(sources).toHaveLength(2);
  expect(sources[0]).toMatch(/^Claude Code/u);
  expect(sources[1]).toMatch(/^Codex/u);
  expect(page.errors).toEqual([]);
}

describe("the demo fallback", () => {
  it.concurrent("should show the demo data when the backend answers with an error", async () => {
    const backend = await viz.given("a backend that fails", (): Answer => ({
      status: 500,
      body: "api error: boom",
    }));

    const page = await viz.when("the page opens", async () => open(backend));

    await viz.then("it shows the demo data, labelled as such", async () => {
      await expectDemo(page);
    });
  });

  it.concurrent("should show the demo data when the connection drops", async () => {
    const backend = await viz.given("a backend that cannot be reached", (): Answer => "abort");

    const page = await viz.when("the page opens", async () => open(backend));

    await viz.then("it shows the demo data, labelled as such", async () => {
      await expectDemo(page);
    });
  });

  it.concurrent("should give up on a backend that never answers after eight seconds, and show the demo data", async () => {
    const backend = await viz.given("a backend that never answers", (): Answer => "hang");

    const page = await viz.when("the page opens", async () => open(backend));

    await viz.then("nothing is drawn yet", async () => {
      await Bun.sleep(1500);
      expect(await page.$eval("#kpis", (e) => e.children.length)).toBe(0);
    });
    await viz.then("after the timeout it shows the demo data, labelled as such", async () => {
      await expectDemo(page);
    });
  }, 20_000);

  it.concurrent("should show the demo data without asking the backend when opened with ?demo", async () => {
    const page = await viz.given(
      "a healthy backend, and a page that has drawn its live data",
      async () => {
        const p = await open(twoSources());
        await ready(p);
        p.api.calls.length = 0;
        return p;
      },
    );

    await viz.when("the page is opened with ?demo", async () =>
      page.goto(page.url().split("#")[0] + "?demo", { waitUntil: "load" }),
    );

    await viz.then("it shows the demo data, and the backend was never asked", async () => {
      await expectDemo(page);
      expect(page.api.calls).toEqual([]);
    });
  });

  it.concurrent("should not show live numbers as demo: the demo banner is absent when the backend answers", async () => {
    const backend = await viz.given("a healthy backend", () => twoSources());

    const page = await viz.when("the page opens", async () => {
      const p = await open(backend);
      await ready(p);
      return p;
    });

    await viz.then("there is no demo banner", async () => {
      expect(await page.$("#banner .banner")).toBeNull();
    });
  });

  it.concurrent("should replace the demo data with live data when the backend comes back and the tab is shown again", async () => {
    const page = await viz.given(
      "a backend that fails on the first ask, so the page shows the demo data",
      async () => {
        const p = await open((call) =>
          call === 1 ? { status: 500, body: "api error: boom" } : twoSources({ claudeNow: 60 }),
        );
        await expectDemo(p);
        return p;
      },
    );

    await viz.when("the backend has recovered and the tab becomes visible again", async () =>
      page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))),
    );

    await viz.then(
      "the page asks again and shows the live readings, without the demo banner",
      async () => {
        await page.waitForFunction(
          () =>
            document.querySelector('[data-viz-id="kpi-claude-This week"] .n')?.textContent ===
            "60%",
          { timeout: 5000 },
        );
        expect(await page.$("#banner .banner")).toBeNull();
        expect(page.api.calls).toHaveLength(2);
      },
    );
  });

  it.concurrent("should not ask the backend again when opened with ?demo, even when the tab is shown again", async () => {
    const page = await viz.given("a page opened with ?demo", async () => {
      const p = await open(twoSources());
      await p.goto(p.url().split("#")[0] + "?demo", { waitUntil: "load" });
      await expectDemo(p);
      p.api.calls.length = 0;
      return p;
    });

    await viz.when("the tab becomes visible again", async () => {
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
      );
      await Bun.sleep(500);
    });

    await viz.then("the backend is still not asked, and the demo data stays", async () => {
      expect(page.api.calls).toEqual([]);
      expect(await page.$eval("#banner .banner", (e) => e.textContent)).toStartWith("Demo data");
    });
  });
});

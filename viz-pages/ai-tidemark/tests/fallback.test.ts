// When /data cannot answer, the tidemark shows its generated demo data and says so. It never shows a blank page.
import { describe, it, expect } from "bun:test";
import { open, ready, texts, twoSources } from "./helpers.ts";

/** The page is showing the demo fixture: the banner, and both demo sources. */
async function expectDemo(page: Awaited<ReturnType<typeof open>>) {
  await ready(page);
  expect(await page.$eval("#banner .banner", (e) => e.textContent)).toStartWith("Demo data");
  expect(await page.$eval("#stamp", (e) => e.textContent)).toBe("");
  expect(await texts(page, ".kpis .src")).toEqual([expect.stringMatching(/^Claude Code/), expect.stringMatching(/^Codex/)]);
  expect(page.errors).toEqual([]);
}

describe("the demo fallback", () => {
  it.concurrent("should show the demo data when the backend answers with an error", async () => {
    // GIVEN a backend that fails
    // WHEN the page opens
    const page = await open({ status: 500, body: "api error: boom" });

    // THEN it shows the demo data, labelled as such
    await expectDemo(page);
  });

  it.concurrent("should show the demo data when the connection drops", async () => {
    // GIVEN a backend that cannot be reached
    // WHEN the page opens
    const page = await open("abort");

    // THEN it shows the demo data, labelled as such
    await expectDemo(page);
  });

  it.concurrent("should give up on a backend that never answers after eight seconds, and show the demo data", async () => {
    // GIVEN a backend that never answers
    const page = await open("hang");

    // WHEN the page opens
    // THEN nothing is drawn yet
    await new Promise((r) => setTimeout(r, 1500));
    expect(await page.$eval("#kpis", (e) => e.children.length)).toBe(0);

    // THEN after the timeout it shows the demo data, labelled as such
    await expectDemo(page);
  }, 20_000);

  it.concurrent("should show the demo data without asking the backend when opened with ?demo", async () => {
    // GIVEN a healthy backend, and a page that has drawn its live data
    const page = await open(twoSources());
    await ready(page);
    page.api.calls.length = 0;

    // WHEN the page is opened with ?demo
    await page.goto(page.url().split("#")[0] + "?demo", { waitUntil: "load" });

    // THEN it shows the demo data, and the backend was never asked
    await expectDemo(page);
    expect(page.api.calls).toEqual([]);
  });

  it.concurrent("should not show live numbers as demo: the demo banner is absent when the backend answers", async () => {
    // GIVEN a healthy backend
    const page = await open(twoSources());

    // WHEN the page opens
    await ready(page);

    // THEN there is no demo banner
    expect(await page.$("#banner .banner")).toBeNull();
  });

  it.concurrent("should replace the demo data with live data when the backend comes back and the tab is shown again", async () => {
    // GIVEN a backend that fails on the first ask, so the page shows the demo data
    const page = await open((call) => (call === 1 ? { status: 500, body: "api error: boom" } : twoSources({ claudeNow: 60 })));
    await expectDemo(page);

    // WHEN the backend has recovered and the tab becomes visible again
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));

    // THEN the page asks again and shows the live readings, without the demo banner
    await page.waitForFunction(() => document.querySelector('[data-viz-id="kpi-claude-This week"] .n')?.textContent === "60%", { timeout: 5000 });
    expect(await page.$("#banner .banner")).toBeNull();
    expect(page.api.calls).toHaveLength(2);
  });

  it.concurrent("should not ask the backend again when opened with ?demo, even when the tab is shown again", async () => {
    // GIVEN a page opened with ?demo
    const page = await open(twoSources());
    await page.goto(page.url().split("#")[0] + "?demo", { waitUntil: "load" });
    await expectDemo(page);
    page.api.calls.length = 0;

    // WHEN the tab becomes visible again
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true })));
    await new Promise((r) => setTimeout(r, 500));

    // THEN the backend is still not asked, and the demo data stays
    expect(page.api.calls).toEqual([]);
    expect(await page.$eval("#banner .banner", (e) => e.textContent)).toStartWith("Demo data");
  });
});

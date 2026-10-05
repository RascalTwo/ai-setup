// The tidemark reading live data from /data: what it works out from the readings (this week's pace, the
// projection, which 5-hour windows would have hit a lower tier, the weekly burn by hour), what the
// reader can switch, and that it refreshes. The fixtures and their hand-worked answers are in helpers.ts.
import { describe, it, expect } from "bun:test";
import { open, ready, tile, texts, hash, twoSources, claude, NOW, H } from "./helpers.ts";

describe("the KPI tiles", () => {
  it.concurrent("should work out this week's pace, projection, last week, busiest window and exchange rate from the readings", async () => {
    // GIVEN a live Claude Code source: this week half gone at 30%, having burnt 30 points in the last 7 days
    const page = await open(twoSources());

    // WHEN the page has drawn
    await ready(page);

    // THEN this week reads 30%, at 0.6× the even pace
    const week = await tile(page, "claude", "This week");
    expect(week.n).toBe("30%");
    expect(week.d).toContain("50% of the week gone");
    expect(week.d).toContain("0.6× even pace");
    // THEN it projects to 45% at reset (last week's earlier climb is not in the 7-day rate)
    expect((await tile(page, "claude", "Projected at reset")).n).toBe("45%");
    // THEN last week is shown as closed at 60%, with the other 40% expired unused
    expect(await tile(page, "claude", "Last week closed at")).toMatchObject({
      n: "60%",
      d: "40% expired unused",
    });
    // THEN the busiest 5-hour window is the 50% one (the lagged statusline reading counts toward a peak)
    expect((await tile(page, "claude", "Busiest 5h window")).n).toBe("50%");
    // THEN a full 5-hour window is worth 20% of the week: five of them empty it
    expect(await tile(page, "claude", "Full 5h window =")).toMatchObject({
      n: "20% wk",
      d: "≈ 5.0 maxed windows empty the week",
    });
    // THEN the page says the data is live, not demo
    expect(await page.$eval("#stamp", (e) => e.textContent)).toStartWith("Updated");
    expect(await page.$("#banner .banner")).toBeNull();
    expect(page.errors).toEqual([]);
  });

  it.concurrent("should compute each source from its own readings", async () => {
    // GIVEN Claude Code and Codex, Codex at 8% this week having burnt 8 points
    const page = await open(twoSources());

    // WHEN the page has drawn
    await ready(page);

    // THEN Codex's numbers are its own: 8%, projecting to 12%, its busiest window 5%
    expect((await tile(page, "codex", "This week")).n).toBe("8%");
    expect((await tile(page, "codex", "Projected at reset")).n).toBe("12%");
    expect((await tile(page, "codex", "Busiest 5h window")).n).toBe("5%");
    // THEN Codex has no closed week, so no "last week" tile
    expect(await page.$('[data-viz-id="kpi-codex-Last week closed at"]')).toBeNull();
    // THEN Codex's plan is shown, and Claude's tier
    expect(await texts(page, ".kpis .src .pill")).toEqual(["Max 20x", "plus"]);
  });

  it.concurrent("should flag a projection past the limit as 100%+ in the danger colour, with when it is hit", async () => {
    // GIVEN this week at 90% having burnt 90 points, so half a week more at that rate is well past 100
    const page = await open(twoSources({ claudeNow: 90 }));

    // WHEN the page has drawn
    await ready(page);

    // THEN the projection reads 100%+, in danger, with a time for hitting the limit
    const proj = await tile(page, "claude", "Projected at reset");
    expect(proj.n).toBe("100%+");
    expect(proj.cls).toContain("danger");
    expect(proj.d).toStartWith("limit hit ≈");
  });
});

describe("the panels that follow the readings", () => {
  it.concurrent("should count the 5-hour windows that would have hit the tier below, and ignore a window that only ever read 0%", async () => {
    // GIVEN Claude Code on Max 20x (its 50% window is over the Max 5x line of 25%, its 20% one is not)
    //   and Codex with one real window and one that only ever read 0%
    const page = await open(twoSources());

    // WHEN the page has drawn
    await ready(page);

    // THEN Claude Code has three windows in view, one of which would have hit the Max 5x limit
    // THEN Codex has one window: the all-zero one never existed
    expect(await texts(page, "#bars .sub-src")).toEqual([
      "Claude Code · 3 windows in view · 1 would have hit the Max 5x limit",
      "Codex · 1 windows in view",
    ]);
    // THEN the line where Max 5x would stop is drawn at 25%
    expect(await texts(page, "#bars svg text.lbl")).toContain("Max 5x would stop here (25%)");
    // THEN the table lists the four real windows, with their peaks, how much of the week each burnt and how many readings
    const rows = await page.$$eval("#tbl tr:not(:first-child)", (trs) =>
      trs.map((tr) => [...tr.children].slice(1).map((c) => c.textContent)),
    );
    expect(rows).toHaveLength(4);
    expect(rows).toContainEqual(["Claude Code", "50%", "10", "2"]);
    expect(rows).toContainEqual(["Claude Code", "20%", "4", "2"]);
    expect(rows).toContainEqual(["Claude Code", "10%", "—", "1"]);
    expect(rows).toContainEqual(["Codex", "5%", "5", "2"]);
  });

  it.concurrent("should fit the exchange rate from all history until three windows are in view", async () => {
    // GIVEN two Claude Code windows in view
    const page = await open(twoSources());

    // WHEN the page has drawn
    await ready(page);

    // THEN the fit says it is from all history, and reads 100% of 5h ≈ 20% of the week
    expect((await texts(page, "#xr .sub-src"))[0]).toBe(
      "Claude Code · 2 windows in view · slope from all history",
    );
    expect(await texts(page, "#xr svg text.lbl")).toContain("100% of 5h ≈ 20% of week");
  });

  it.concurrent("should list every weekly window per source", async () => {
    // GIVEN Claude Code with two weeks of history and Codex with one
    const page = await open(twoSources());

    // WHEN the page has drawn
    await ready(page);

    // THEN each source's weeks are counted
    expect(await texts(page, "#weeks .sub-src")).toEqual([
      "Claude Code · 2 weeks",
      "Codex · 1 weeks",
    ]);
  });

  it.concurrent("should spread the weekly points burnt over the hours they were burnt, all of them and only them", async () => {
    // GIVEN Claude Code that burnt 20 points last week and 30 this week (50 in all of its history) and Codex 8
    const page = await open(twoSources());
    await ready(page);
    const burnt = async () => {
      const total = await page.$$eval('#heat rect[data-viz-id^="h-"]', (els) =>
        els.reduce((sum, e) => sum + Number(e.dataset.label!.match(/— ([\d.]+) weekly/u)![1]), 0),
      );
      return total;
    };

    // THEN the day × hour grid adds up to Claude Code's 50 points (each cell is rounded to a tenth)
    expect(await burnt()).toBeCloseTo(50, 0);
    // WHEN the reader picks Codex
    await page.click('#heatSrc [data-k="codex"]');
    await page.waitForFunction(() =>
      document.querySelector('#heatSrc [data-k="codex"]')!.classList.contains("on"),
    );
    // THEN the grid adds up to Codex's 8 points
    expect(await burnt()).toBeCloseTo(8, 0);
    // THEN the choice is kept in the link
    expect((await hash(page)).heat).toBe("codex");
  });
});

describe("the timeline controls", () => {
  it.concurrent("should draw a weekly line per week, and take a source off the chart and its panels when unticked", async () => {
    // GIVEN both sources on the chart
    const page = await open(twoSources());
    await ready(page);
    const lines = async () => {
      const srcs = await page.$$eval("#tl path[data-src]", (els) =>
        els.map((e) => (e as SVGElement).dataset["src"] ?? "").toSorted(),
      );
      return srcs;
    };
    expect(await lines()).toEqual(["claude", "claude", "codex"]);

    // WHEN the reader unticks Codex
    await page.click('#tlCtl [data-src="codex"]');

    // THEN only Claude Code's weeks are drawn, and the bars follow
    expect(await lines()).toEqual(["claude", "claude"]);
    await page.waitForFunction(() => document.querySelectorAll("#bars .sub-src").length === 1);
    expect((await texts(page, "#bars .sub-src"))[0]).toStartWith("Claude Code");
    expect(
      await page.$eval('#tlCtl [data-src="codex"]', (e) =>
        e instanceof HTMLInputElement ? e.checked : null,
      ),
    ).toBe(false);

    // WHEN they tick it again
    await page.click('#tlCtl [data-src="codex"]');

    // THEN it returns
    expect(await lines()).toEqual(["claude", "claude", "codex"]);
  });

  it.concurrent("should open with the source hidden that the link says is hidden", async () => {
    // GIVEN a link with Codex hidden
    // WHEN the page opens
    const page = await open(twoSources(), { hash: { hide: ["codex"] } });
    await ready(page);

    // THEN Codex's checkbox is unticked and only Claude Code is drawn
    expect(
      await page.$eval('#tlCtl [data-src="codex"]', (e) =>
        e instanceof HTMLInputElement ? e.checked : null,
      ),
    ).toBe(false);
    expect(
      await page.$$eval(
        "#tl path[data-src]",
        (els) => new Set(els.map((e) => (e as SVGElement).dataset["src"])).size,
      ),
    ).toBe(1);
  });

  it.concurrent("should zoom to the last 24 hours, and keep that zoom in the link", async () => {
    // GIVEN the page at its default two-week view
    const page = await open(twoSources());
    await ready(page);

    // WHEN the reader picks "Last 24h"
    await page.click('#tlCtl [data-p="24h"]');

    // THEN the link holds exactly the 24 hours up to the data's "now"
    expect((await hash(page)).zoom).toEqual([NOW - 24 * H, NOW]);
  });

  it.concurrent("should zoom to this week, last week or everything from the presets", async () => {
    // GIVEN the page at its default view, this week running from 84 hours ago to 84 hours ahead
    const page = await open(twoSources());
    await ready(page);

    // WHEN the reader picks each preset
    // THEN the link holds this week's span, then last week's, then "all"
    await page.click('#tlCtl [data-p="thisweek"]');
    expect((await hash(page)).zoom).toEqual([NOW - 84 * H, NOW + 84 * H]);
    await page.click('#tlCtl [data-p="lastweek"]');
    expect((await hash(page)).zoom).toEqual([NOW - 252 * H, NOW - 84 * H]);
    await page.click('#tlCtl [data-p="all"]');
    expect((await hash(page)).zoom).toBe("all");
  });

  it.concurrent("should select a 5-hour window and zoom the timeline and bars to it when its bar is clicked", async () => {
    // GIVEN all three Claude Code windows in view
    const page = await open(twoSources());
    await ready(page);

    // WHEN the reader clicks the first bar (the older window, which ends 60 hours before now)
    await page.click("#bars g.b");

    // THEN it is selected, and the timeline zooms to it with six hours either side
    const h = await hash(page);
    expect(h.sel).toBe(`claude-300-${NOW - 60 * H}`);
    expect(h.zoom).toEqual([NOW - 71 * H, NOW - 54 * H]);
    // THEN the bars now count only the window in view
    await page.waitForFunction(() =>
      document.querySelector("#bars .sub-src")!.textContent.includes("1 windows in view"),
    );
    expect((await texts(page, "#bars .sub-src"))[0]).toBe(
      "Claude Code · 1 windows in view · 1 would have hit the Max 5x limit",
    );

    // WHEN they click the same bar again
    await page.click("#bars g.b");

    // THEN it is deselected
    expect((await hash(page)).sel).toBeNull();
  });

  it.concurrent("should draw the lagged statusline readings only when asked", async () => {
    // GIVEN a source with one lagged reading
    const page = await open(twoSources());
    await ready(page);
    expect(await page.$$eval("#tl circle", (c) => c.length)).toBe(0);

    // WHEN the reader ticks the statusline samples box
    await page.click("#lagT");

    // THEN that reading is drawn as a dot
    expect(await page.$$eval("#tl circle", (c) => c.length)).toBe(1);
  });
});

describe("what else the page shows", () => {
  it.concurrent("should show the poller's error log, or say it is empty", async () => {
    // GIVEN a source with a poller error
    const withErrors = await open(twoSources({ errors: "401 from usage endpoint" }));
    // GIVEN one without
    const clean = await open(twoSources());
    await Promise.all([ready(withErrors), ready(clean)]);

    // THEN each shows what it was given
    expect(await withErrors.$eval("#errs", (e) => e.textContent)).toBe("401 from usage endpoint");
    expect(await clean.$eval("#errs", (e) => e.textContent)).toBe("(empty)");
  });

  it.concurrent("should show one source without the multi-source controls", async () => {
    // GIVEN only Claude Code has history (a Claude-only machine)
    const page = await open({ now: NOW, demo: false, sources: [claude()], errors: "" });

    // WHEN the page has drawn
    await ready(page);

    // THEN there are no per-source checkboxes or heatmap buttons, and only Claude Code's tiles
    expect(await page.$$("#tlCtl [data-src]")).toHaveLength(0);
    expect(await page.$$("#heatSrc button")).toHaveLength(0);
    expect(await page.$('[data-viz-id^="kpi-codex-"]')).toBeNull();
    expect((await tile(page, "claude", "This week")).n).toBe("30%");
  });

  it.concurrent("should say what is missing when a source has weekly readings but no 5-hour windows", async () => {
    // GIVEN a source with only weekly readings
    const weeklyOnly = { ...claude(), samples: claude().samples.filter((x) => x.w === 10080) };
    const page = await open({ now: NOW, demo: false, sources: [weeklyOnly], errors: "" });

    // WHEN the page has drawn
    await ready(page);

    // THEN the bars and the exchange rate each say why they are empty
    expect(await page.$eval("#bars", (e) => e.textContent)).toBe(
      "No 5-hour windows in the visible sources.",
    );
    expect(await page.$eval("#xr", (e) => e.textContent)).toBe(
      "Needs windows with both 5-hour and weekly readings.",
    );
    // THEN this week still reads 30%
    expect((await tile(page, "claude", "This week")).n).toBe("30%");
  });

  it.concurrent("should say so, and hide the timeline, when nothing has been recorded", async () => {
    // GIVEN a machine with no history
    const page = await open({ now: NOW, demo: false, sources: [], errors: "" });

    // WHEN the page has drawn
    await ready(page);

    // THEN it says nothing is recorded, and the timeline panel is gone
    expect(await page.$eval("#kpis", (e) => e.textContent)).toContain("No history recorded yet");
    expect(
      await page.$eval("#tlPanel", (e) => (e instanceof HTMLElement ? e.style.display : null)),
    ).toBe("none");
    expect(page.errors).toEqual([]);
  });

  it.concurrent("should ask again when the tab comes back, and show the newer readings", async () => {
    // GIVEN a page whose second answer has this week at 60%
    const page = await open((call) => twoSources({ claudeNow: call === 1 ? 30 : 60 }));
    await ready(page);
    expect((await tile(page, "claude", "This week")).n).toBe("30%");

    // WHEN the tab becomes visible again
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true })),
    );

    // THEN the page asks a second time and shows 60%
    await page.waitForFunction(
      () =>
        document.querySelector('[data-viz-id="kpi-claude-This week"] .n')!.textContent === "60%",
    );
    expect(page.api.calls).toHaveLength(2);
  });
});

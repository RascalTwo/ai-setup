// The tidemark reading live data from /data: what it works out from the readings (this week's pace, the
// projection, which 5-hour windows would have hit a lower tier, the weekly burn by hour), what the
// reader can switch, and that it refreshes. The fixtures and their hand-worked answers are in helpers.ts.
import { describe, it, expect } from "bun:test";
import { open, ready, tile, texts, hash, twoSources, claude, NOW, H } from "./helpers.ts";

describe("the KPI tiles", () => {
  it.concurrent("should work out this week's pace, projection, last week, busiest window and exchange rate from the readings", async () => {
    const data = await viz.given(
      "a live Claude Code source: this week half gone at 30%, having burnt 30 points in the last 7 days",
      () => twoSources(),
    );

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then("this week reads 30%, at 0.6× the even pace", async () => {
      const week = await tile(page, "claude", "This week");
      expect(week.n).toBe("30%");
      expect(week.d).toContain("50% of the week gone");
      expect(week.d).toContain("0.6× even pace");
    });
    await viz.then(
      "it projects to 45% at reset (last week's earlier climb is not in the 7-day rate)",
      async () => {
        expect((await tile(page, "claude", "Projected at reset")).n).toBe("45%");
      },
    );
    await viz.then(
      "last week is shown as closed at 60%, with the other 40% expired unused",
      async () => {
        expect(await tile(page, "claude", "Last week closed at")).toMatchObject({
          n: "60%",
          d: "40% expired unused",
        });
      },
    );
    await viz.then(
      "the busiest 5-hour window is the 50% one (the lagged statusline reading counts toward a peak)",
      async () => {
        expect((await tile(page, "claude", "Busiest 5h window")).n).toBe("50%");
      },
    );
    await viz.then(
      "a full 5-hour window is worth 20% of the week: five of them empty it",
      async () => {
        expect(await tile(page, "claude", "Full 5h window =")).toMatchObject({
          n: "20% wk",
          d: "≈ 5.0 maxed windows empty the week",
        });
      },
    );
    await viz.then("the page says the data is live, not demo", async () => {
      expect(await page.$eval("#stamp", (e) => e.textContent)).toStartWith("Updated");
      expect(await page.$("#banner .banner")).toBeNull();
      expect(page.errors).toEqual([]);
    });
  });

  it.concurrent("should compute each source from its own readings", async () => {
    const data = await viz.given(
      "Claude Code and Codex, Codex at 8% this week having burnt 8 points",
      () => twoSources(),
    );

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then(
      "Codex's numbers are its own: 8%, projecting to 12%, its busiest window 5%",
      async () => {
        expect((await tile(page, "codex", "This week")).n).toBe("8%");
        expect((await tile(page, "codex", "Projected at reset")).n).toBe("12%");
        expect((await tile(page, "codex", "Busiest 5h window")).n).toBe("5%");
      },
    );
    await viz.then('Codex has no closed week, so no "last week" tile', async () => {
      expect(await page.$('[data-viz-id="kpi-codex-Last week closed at"]')).toBeNull();
    });
    await viz.then("Codex's plan is shown, and Claude's tier", async () => {
      expect(await texts(page, ".kpis .src .pill")).toEqual(["Max 20x", "plus"]);
    });
  });

  it.concurrent("should flag a projection past the limit as 100%+ in the danger colour, with when it is hit", async () => {
    const data = await viz.given(
      "this week at 90% having burnt 90 points, so half a week more at that rate is well past 100",
      () => twoSources({ claudeNow: 90 }),
    );

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then(
      "the projection reads 100%+, in danger, with a time for hitting the limit",
      async () => {
        const proj = await tile(page, "claude", "Projected at reset");
        expect(proj.n).toBe("100%+");
        expect(proj.cls).toContain("danger");
        expect(proj.d).toStartWith("limit hit ≈");
      },
    );
  });
});

describe("the panels that follow the readings", () => {
  it.concurrent("should count the 5-hour windows that would have hit the tier below, and ignore a window that only ever read 0%", async () => {
    const data = await viz.given(
      "Claude Code on Max 20x (its 50% window is over the Max 5x line of 25%, its 20% one is not) and Codex with one real window and one that only ever read 0%",
      () => twoSources(),
    );

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then(
      "Claude Code has three windows in view, one of which would have hit the Max 5x limit",
      async () => {
        expect(await texts(page, "#bars .sub-src")).toEqual([
          "Claude Code · 3 windows in view · 1 would have hit the Max 5x limit",
          "Codex · 1 windows in view",
        ]);
      },
    );
    await viz.then("Codex has one window: the all-zero one never existed");
    await viz.then("the line where Max 5x would stop is drawn at 25%", async () => {
      expect(await texts(page, "#bars svg text.lbl")).toContain("Max 5x would stop here (25%)");
    });
    await viz.then(
      "the table lists the four real windows, with their peaks, how much of the week each burnt and how many readings",
      async () => {
        const rows = await page.$$eval("#tbl tr:not(:first-child)", (trs) =>
          trs.map((tr) => [...tr.children].slice(1).map((c) => c.textContent)),
        );
        expect(rows).toHaveLength(4);
        expect(rows).toContainEqual(["Claude Code", "50%", "10", "2"]);
        expect(rows).toContainEqual(["Claude Code", "20%", "4", "2"]);
        expect(rows).toContainEqual(["Claude Code", "10%", "—", "1"]);
        expect(rows).toContainEqual(["Codex", "5%", "5", "2"]);
      },
    );
  });

  it.concurrent("should fit the exchange rate from all history until three windows are in view", async () => {
    const data = await viz.given("two Claude Code windows in view", () => twoSources());

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then(
      "the fit says it is from all history, and reads 100% of 5h ≈ 20% of the week",
      async () => {
        expect((await texts(page, "#xr .sub-src"))[0]).toBe(
          "Claude Code · 2 windows in view · slope from all history",
        );
        expect(await texts(page, "#xr svg text.lbl")).toContain("100% of 5h ≈ 20% of week");
      },
    );
  });

  it.concurrent("should list every weekly window per source", async () => {
    const data = await viz.given("Claude Code with two weeks of history and Codex with one", () =>
      twoSources(),
    );

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then("each source's weeks are counted", async () => {
      expect(await texts(page, "#weeks .sub-src")).toEqual([
        "Claude Code · 2 weeks",
        "Codex · 1 weeks",
      ]);
    });
  });

  it.concurrent("should spread the weekly points burnt over the hours they were burnt, all of them and only them", async () => {
    const { page, burnt } = await viz.given(
      "Claude Code that burnt 20 points last week and 30 this week (50 in all of its history) and Codex 8",
      async () => {
        const p = await open(twoSources());
        await ready(p);
        const sum = async () => {
          const total = await p.$$eval('#heat rect[data-viz-id^="h-"]', (els) =>
            els.reduce(
              (acc, e) => acc + Number(e.dataset.label!.match(/— ([\d.]+) weekly/u)![1]),
              0,
            ),
          );
          return total;
        };
        return { page: p, burnt: sum };
      },
    );

    await viz.when("the page shows the day × hour grid for Claude Code");

    await viz.then(
      "the day × hour grid adds up to Claude Code's 50 points (each cell is rounded to a tenth)",
      async () => {
        expect(await burnt()).toBeCloseTo(50, 0);
      },
    );

    await viz.when("the reader picks Codex", async () => {
      await page.click('#heatSrc [data-k="codex"]');
      await page.waitForFunction(() =>
        document.querySelector('#heatSrc [data-k="codex"]')!.classList.contains("on"),
      );
    });

    await viz.then("the grid adds up to Codex's 8 points", async () => {
      expect(await burnt()).toBeCloseTo(8, 0);
    });
    await viz.then("the choice is kept in the link", async () => {
      expect((await hash(page)).heat).toBe("codex");
    });
  });
});

describe("the timeline controls", () => {
  it.concurrent("should draw a weekly line per week, and take a source off the chart and its panels when unticked", async () => {
    const { page, lines } = await viz.given("both sources on the chart", async () => {
      const p = await open(twoSources());
      await ready(p);
      const drawn = async () => {
        const srcs = await p.$$eval("#tl path[data-src]", (els) =>
          els.map((e) => (e as SVGElement).dataset["src"] ?? "").toSorted(),
        );
        return srcs;
      };
      expect(await drawn()).toEqual(["claude", "claude", "codex"]);
      return { page: p, lines: drawn };
    });

    await viz.when("the reader unticks Codex", async () => page.click('#tlCtl [data-src="codex"]'));

    await viz.then("only Claude Code's weeks are drawn, and the bars follow", async () => {
      expect(await lines()).toEqual(["claude", "claude"]);
      await page.waitForFunction(() => document.querySelectorAll("#bars .sub-src").length === 1);
      expect((await texts(page, "#bars .sub-src"))[0]).toStartWith("Claude Code");
      expect(
        await page.$eval('#tlCtl [data-src="codex"]', (e) =>
          e instanceof HTMLInputElement ? e.checked : null,
        ),
      ).toBe(false);
    });

    await viz.when("they tick it again", async () => page.click('#tlCtl [data-src="codex"]'));

    await viz.then("it returns", async () => {
      expect(await lines()).toEqual(["claude", "claude", "codex"]);
    });
  });

  it.concurrent("should open with the source hidden that the link says is hidden", async () => {
    const link = await viz.given("a link with Codex hidden", () => ({ hash: { hide: ["codex"] } }));

    const page = await viz.when("the page opens", async () => {
      const p = await open(twoSources(), link);
      await ready(p);
      return p;
    });

    await viz.then("Codex's checkbox is unticked and only Claude Code is drawn", async () => {
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
  });

  it.concurrent("should zoom to the last 24 hours, and keep that zoom in the link", async () => {
    const page = await viz.given("the page at its default two-week view", async () => {
      const p = await open(twoSources());
      await ready(p);
      return p;
    });

    await viz.when('the reader picks "Last 24h"', async () => page.click('#tlCtl [data-p="24h"]'));

    await viz.then('the link holds exactly the 24 hours up to the data\'s "now"', async () => {
      expect((await hash(page)).zoom).toEqual([NOW - 24 * H, NOW]);
    });
  });

  it.concurrent("should zoom to this week, last week or everything from the presets", async () => {
    const page = await viz.given(
      "the page at its default view, this week running from 84 hours ago to 84 hours ahead",
      async () => {
        const p = await open(twoSources());
        await ready(p);
        return p;
      },
    );

    const zooms = await viz.when("the reader picks each preset", async () => {
      await page.click('#tlCtl [data-p="thisweek"]');
      const thisWeek = (await hash(page)).zoom;
      await page.click('#tlCtl [data-p="lastweek"]');
      const lastWeek = (await hash(page)).zoom;
      await page.click('#tlCtl [data-p="all"]');
      const all = (await hash(page)).zoom;
      return { thisWeek, lastWeek, all };
    });

    await viz.then("the link holds this week's span, then last week's, then \"all\"", () => {
      expect(zooms.thisWeek).toEqual([NOW - 84 * H, NOW + 84 * H]);
      expect(zooms.lastWeek).toEqual([NOW - 252 * H, NOW - 84 * H]);
      expect(zooms.all).toBe("all");
    });
  });

  it.concurrent("should select a 5-hour window and zoom the timeline and bars to it when its bar is clicked", async () => {
    const page = await viz.given("all three Claude Code windows in view", async () => {
      const p = await open(twoSources());
      await ready(p);
      return p;
    });

    await viz.when(
      "the reader clicks the first bar (the older window, which ends 60 hours before now)",
      async () => page.click("#bars g.b"),
    );

    await viz.then(
      "it is selected, and the timeline zooms to it with six hours either side",
      async () => {
        const h = await hash(page);
        expect(h.sel).toBe(`claude-300-${NOW - 60 * H}`);
        expect(h.zoom).toEqual([NOW - 71 * H, NOW - 54 * H]);
      },
    );
    await viz.then("the bars now count only the window in view", async () => {
      await page.waitForFunction(() =>
        document.querySelector("#bars .sub-src")!.textContent.includes("1 windows in view"),
      );
      expect((await texts(page, "#bars .sub-src"))[0]).toBe(
        "Claude Code · 1 windows in view · 1 would have hit the Max 5x limit",
      );
    });

    await viz.when("they click the same bar again", async () => page.click("#bars g.b"));

    await viz.then("it is deselected", async () => {
      expect((await hash(page)).sel).toBeNull();
    });
  });

  it.concurrent("should draw the lagged statusline readings only when asked", async () => {
    const page = await viz.given("a source with one lagged reading", async () => {
      const p = await open(twoSources());
      await ready(p);
      expect(await p.$$eval("#tl circle", (c) => c.length)).toBe(0);
      return p;
    });

    await viz.when("the reader ticks the statusline samples box", async () => page.click("#lagT"));

    await viz.then("that reading is drawn as a dot", async () => {
      expect(await page.$$eval("#tl circle", (c) => c.length)).toBe(1);
    });
  });
});

describe("what else the page shows", () => {
  it.concurrent("should show the poller's error log, or say it is empty", async () => {
    const withErrors = await viz.given("a source with a poller error", async () =>
      open(twoSources({ errors: "401 from usage endpoint" })),
    );
    const clean = await viz.given("one without", async () => open(twoSources()));

    await viz.when("both pages have drawn", async () => {
      await Promise.all([ready(withErrors), ready(clean)]);
    });

    await viz.then("each shows what it was given", async () => {
      expect(await withErrors.$eval("#errs", (e) => e.textContent)).toBe("401 from usage endpoint");
      expect(await clean.$eval("#errs", (e) => e.textContent)).toBe("(empty)");
    });
  });

  it.concurrent("should show one source without the multi-source controls", async () => {
    const data = await viz.given("only Claude Code has history (a Claude-only machine)", () => ({
      now: NOW,
      demo: false,
      sources: [claude()],
      errors: "",
    }));

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then(
      "there are no per-source checkboxes or heatmap buttons, and only Claude Code's tiles",
      async () => {
        expect(await page.$$("#tlCtl [data-src]")).toHaveLength(0);
        expect(await page.$$("#heatSrc button")).toHaveLength(0);
        expect(await page.$('[data-viz-id^="kpi-codex-"]')).toBeNull();
        expect((await tile(page, "claude", "This week")).n).toBe("30%");
      },
    );
  });

  it.concurrent("should say what is missing when a source has weekly readings but no 5-hour windows", async () => {
    const data = await viz.given("a source with only weekly readings", () => {
      const weeklyOnly = { ...claude(), samples: claude().samples.filter((x) => x.w === 10080) };
      return { now: NOW, demo: false, sources: [weeklyOnly], errors: "" };
    });

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then("the bars and the exchange rate each say why they are empty", async () => {
      expect(await page.$eval("#bars", (e) => e.textContent)).toBe(
        "No 5-hour windows in the visible sources.",
      );
      expect(await page.$eval("#xr", (e) => e.textContent)).toBe(
        "Needs windows with both 5-hour and weekly readings.",
      );
    });
    await viz.then("this week still reads 30%", async () => {
      expect((await tile(page, "claude", "This week")).n).toBe("30%");
    });
  });

  it.concurrent("should say so, and hide the timeline, when nothing has been recorded", async () => {
    const data = await viz.given("a machine with no history", () => ({
      now: NOW,
      demo: false,
      sources: [],
      errors: "",
    }));

    const page = await viz.when("the page has drawn", async () => {
      const p = await open(data);
      await ready(p);
      return p;
    });

    await viz.then("it says nothing is recorded, and the timeline panel is gone", async () => {
      expect(await page.$eval("#kpis", (e) => e.textContent)).toContain("No history recorded yet");
      expect(
        await page.$eval("#tlPanel", (e) => (e instanceof HTMLElement ? e.style.display : null)),
      ).toBe("none");
      expect(page.errors).toEqual([]);
    });
  });

  it.concurrent("should ask again when the tab comes back, and show the newer readings", async () => {
    const page = await viz.given("a page whose second answer has this week at 60%", async () => {
      const p = await open((call) => twoSources({ claudeNow: call === 1 ? 30 : 60 }));
      await ready(p);
      expect((await tile(p, "claude", "This week")).n).toBe("30%");
      return p;
    });

    await viz.when("the tab becomes visible again", async () =>
      page.evaluate(() => document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))),
    );

    await viz.then("the page asks a second time and shows 60%", async () => {
      await page.waitForFunction(
        () =>
          document.querySelector('[data-viz-id="kpi-claude-This week"] .n')!.textContent === "60%",
      );
      expect(page.api.calls).toHaveLength(2);
    });
  });
});

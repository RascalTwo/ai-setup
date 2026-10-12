// The Library dashboard (dashboard.ts): the rows, the stat band, the filters, sort and search, the
// URL that carries them, the git feed, the server panel and the offline state. The drawer that
// writes through api/ is manage-library.test.ts; preview and the lobby key are publish-library.test.ts.
import { describe, it, expect } from "bun:test";
import {
  dashboardReady,
  rowTitles,
  nthCall,
  calls,
  text as textReply,
  viz as makeViz,
  CENTRAL,
  ATLAS,
  HARBOR,
} from "./helpers.ts";
import { open, click, ID, row, rowIds, text, textIs, typeInto } from "./steps-library.ts";

const MIN = 60_000,
  HOUR = 60 * MIN,
  DAY = 24 * HOUR;
const BASE = process.env.VIZ_URL!.replace(/#.*$/u, "");

type SP = Awaited<ReturnType<typeof open>>;

/** The row's text in one field, e.g. its age badge. */
const rowField = async (page: SP, id: string, sel: string): Promise<string> => {
  const t = await text(page, `${row(id)} ${sel}`);
  return t;
};
const hash = async (page: SP): Promise<string> => {
  const h = await page.evaluate(() => location.hash);
  return h;
};
const selectValues = async (page: SP, ids: string[]): Promise<string[]> => {
  const values = await page.evaluate(
    (names) => names.map((i) => document.querySelector<HTMLSelectElement>(`#${i}`)!.value),
    ids,
  );
  return values;
};

describe("the Library list", () => {
  it.concurrent("should list every visible viz, newest first, and count the library by posture", async () => {
    const page = await viz.given(
      "the default synthetic library: 14 vizzes, one of them hidden, plus one mirror row",
      async () => open({ hash: "dashboard" }),
    );

    await viz.when("the dashboard has loaded", async () => dashboardReady(page));

    await viz.then(
      "every row but the hidden one shows, newest first (the mirror row carries its origin's title)",
      async () => {
        expect(await rowTitles(page)).toEqual([
          "Tide clock",
          "Tide clock",
          "Orbit deck",
          "Garden planner",
          "Big globe",
          "Harbor map",
          "Atlas weekly metrics",
          "River poster",
          "Harbor timeline",
          "Atlas exchange",
          "Garden planner",
          "Atlas deep dive",
          "Poster starter",
          "loose-sketch",
        ]);
      },
    );
    await viz.then(
      "the posture bar counts vizzes, not rows: 13 (the mirror row and the hidden viz left out)",
      async () => {
        const segs = await page.$$eval(".posture-bar button.pb-seg", (els) =>
          els.map((e) => [e.dataset.posture, e.textContent.trim()]),
        );
        expect(segs).toEqual([
          ["public", "7"],
          ["private", "3"],
          ["local", "2"],
          ["untagged", "1"],
        ]);
        expect(await page.$eval(".counts-block .tnum b", (e) => e.textContent)).toBe("13");
      },
    );
    await viz.then(
      "the kind bar splits the same 13 in its fixed order, and the size histogram bins them by size on disk",
      async () => {
        expect(
          await page.$$eval(".kind-bar button.sb-seg", (els) =>
            els.map((e) => [e.dataset.kind, e.textContent.trim()]),
          ),
        ).toEqual([
          ["page", "8"],
          ["poster-dive", "1"],
          ["poster", "2"],
          ["exchange", "1"],
          ["deck", "1"],
        ]);
        expect(
          await page.$$eval(".size-hist .sh-col", (els) => els.map((e) => e.getAttribute("title"))),
        ).toEqual([
          "3 vizzes between 32K",
          "5 vizzes between 128K",
          "2 vizzes between 512K",
          "2 vizzes between 2M",
          "1 viz between 2M+",
        ]);
      },
    );
    await viz.then(
      "the counts: 13 vizzes, their files, every commit in the git feed, their size, and the server's uptime",
      async () => {
        expect(
          await page.$$eval(".counts-block .tnum", (els) =>
            els.map((e) => [...e.children].map((c) => c.textContent.trim()).join(" ")),
          ),
        ).toEqual([
          "13 vizzes",
          "79 files",
          "164 commits",
          "5.68 MB on disk",
          "1h 2m uptime",
          "3 containers",
        ]);
      },
    );
    await viz.then("the server panel shows the server's own numbers", async () => {
      expect(
        await page.$$eval("#server-info .row", (els) =>
          els.map((e) => [...e.children].map((c) => c.textContent)),
        ),
      ).toEqual([
        ["bun", "1.3.11"],
        ["pid", "4242"],
        ["uptime", "1h 2m"],
        ["port", "5180"],
        ["containers", "3"],
      ]);
    });
    await viz.then("recent commits are listed with their count", async () => {
      expect(await page.$eval("#commit-total", (e) => e.textContent)).toBe("(4)");
      expect(
        await page.$$eval("#commits .commit-hash", (els) => els.map((e) => e.textContent)),
      ).toEqual(["a1b2c3d", "b2c3d4e", "c3d4e5f", "d4e5f6a"]);
      expect(page.errors).toEqual([]);
    });
  });

  it.concurrent("should say on each row what the viz is: where it lives, its axes, its card, its tags and its copies", async () => {
    const page = await viz.given(
      "the default library, with the mirror row of Tide clock (in atlas) made from a template",
      async () =>
        open({
          hash: "dashboard",
          lib: (l) => {
            l.slugs.find((s) => s.isMirror)!.template = "deck";
          },
        }),
    );

    await viz.when("the page has loaded", async () => dashboardReady(page));
    const badges = async (id: string): Promise<string[]> => {
      const axes = await page.$$eval(`${row(id)} .slug-axes .axis`, (els) =>
        els.map((e) => e.textContent.trim()),
      );
      return axes;
    };
    const titleOf = async (id: string, sel: string): Promise<string | null> => {
      const title = await page.$eval(`${row(id)} ${sel}`, (e) => e.getAttribute("title"));
      return title;
    };
    const mirror = `${ID.tide}↦${ATLAS}`;

    await viz.then(
      "a central viz is badged central, its posture, its public card, its tags, its OG thumbnail and its hero",
      async () => {
        expect(await rowField(page, ID.tide, ".slug-name")).toBe("centralTide clock");
        expect(await badges(ID.tide)).toEqual(["public", "🪪 card public"]);
        expect(
          await page.$$eval(`${row(ID.tide)} .tag-chip`, (els) => els.map((e) => e.textContent)),
        ).toEqual(["ocean", "time"]);
        expect(
          await page.$eval(`${row(ID.tide)} .slug-thumb`, (e) => {
            if (!(e instanceof HTMLElement))
              throw new Error("the thumbnail is not an HTML element");
            return e.style.backgroundImage;
          }),
        ).toContain(`/${ID.tide}/og.png`);
        expect(await page.$eval(`${row(ID.tide)} .hero-on`, (e) => e.getAttribute("href"))).toBe(
          `/${ID.tide}/hero.html`,
        );
        expect(await titleOf(ID.tide, ".mirror-src")).toBe(
          "origin viz — publish-mirrored to: code/atlas",
        );
      },
    );
    await viz.then(
      "a repo viz names its host repo, and a linked one with a stale card and 4 tags says so, the 4th tag folded into +1",
      async () => {
        expect(await rowField(page, ID.metrics, ".slug-host")).toBe("↳ code/atlas");
        expect(await badges(ID.metrics)).toEqual([
          "public",
          "🔗 linked",
          "🪪 card stale (was not public)",
        ]);
        expect(
          await page.$$eval(`${row(ID.metrics)} .tag-chip`, (els) => els.map((e) => e.textContent)),
        ).toEqual(["metrics", "ops", "weekly", "+1"]);
        expect(await titleOf(ID.metrics, ".tag-chip.more")).toBe("metrics, ops, weekly, team");
      },
    );
    await viz.then(
      'an unlisted private poster, a deck template (a shortcut to "new from this"), and a viz with no posture',
      async () => {
        expect(await badges(ID.river)).toEqual([
          "private",
          "🪪 card not public",
          "unlisted",
          "poster",
        ]);
        expect(await badges(ID.orbit)).toEqual(["public", "deck template"]);
        expect(await page.$eval(`${row(ID.orbit)} span.axis.kind`, (e) => e.dataset.act)).toBe(
          "from-open",
        );
        expect(await badges(ID.loose)).toEqual(["untagged"]);
        expect(await rowField(page, ID.loose, ".slug-name")).toBe("centralloose-sketch");
      },
    );
    await viz.then(
      "the vendored copy and the mirror row say where they come from; the mirror row's template is not a shortcut",
      async () => {
        expect(await rowField(page, ID.gardenCopy, ".slug-host")).toBe(
          "↳ vendored ← .agents/state/viz",
        );
        expect(await titleOf(ID.gardenCopy, ".mirror-on")).toBe(
          "vendored full copy of .agents/state/viz — runs standalone; edit the origin and re-sync",
        );
        expect(await titleOf(ID.garden, ".mirror-src")).toBe(
          "origin viz — vendored (full copy) into: code/harbor",
        );
        expect(await rowField(page, mirror, ".slug-host")).toBe("↳ mirror ← .agents/state/viz");
        expect(await titleOf(mirror, ".mirror-on")).toBe(
          "mirrored-in copy from .agents/state/viz — edit the origin viz, not this sink",
        );
        expect(
          await page.$eval(`${row(mirror)} span.axis.kind`, (e) => Object.hasOwn(e.dataset, "act")),
        ).toBe(false);
      },
    );
    await viz.then(
      "only a mirrored-in sink has no manage button: the origins and the vendored copy have one",
      async () => {
        expect(await page.$(`${row(mirror)} button.manage-btn`)).toBeNull();
        expect(await page.$(`${row(ID.gardenCopy)} button.manage-btn`)).not.toBeNull();
      },
    );
    await viz.then("the mirror row's link and commit count are its origin's", async () => {
      expect(await page.$eval(`${row(mirror)} .slug-name`, (e) => e.getAttribute("href"))).toBe(
        `/${ID.tide}/`,
      );
      expect(await rowField(page, mirror, ".commits .count")).toBe("1");
      expect(await titleOf(ID.tide, ".commits")).toBe("1 commit");
      expect(await titleOf(ID.garden, ".commits")).toBe("22 commits");
    });
    await viz.then("an api viz shows its api, a plain one shows none", async () => {
      expect(await titleOf(ID.garden, ".icon-only.api-on")).toBe("has api.ts");
      expect(await titleOf(ID.river, ".icon-only.api-off")).toBe("no api.ts");
      expect(await titleOf(ID.river, ".mirror-off")).toBe("not mirrored");
      expect(page.errors).toEqual([]);
    });
    await viz.then("a viz with a living spec links to it, one without shows no link", async () => {
      expect(
        await page.$eval(`${row(ID.garden)} a[href$="spec.html"]`, (e) => e.getAttribute("href")),
      ).toBe(`/${ID.garden}/.verify/tests/spec.html`);
      expect(await page.$(`${row(ID.river)} a[href$="spec.html"]`)).toBeNull();
    });
  });

  it.concurrent("should show ages, sizes and uptime in compact units", async () => {
    const page = await viz.given(
      "a library whose vizzes span every unit of age and size, on a server up for 65 seconds",
      async () =>
        open({
          hash: "dashboard",
          lib: (l) => {
            l.slugs = [
              makeViz("just-now", { ageMs: 20_000, sizeBytes: 500, fileCount: 1 }),
              makeViz("minutes", { ageMs: 12 * MIN, sizeBytes: 20_000 }),
              makeViz("hours", { ageMs: 5 * HOUR }),
              makeViz("hours-min", { ageMs: 5 * HOUR + 12 * MIN }),
              makeViz("days", { ageMs: 2 * DAY }),
              makeViz("days-hours", { ageMs: DAY + 5 * HOUR }),
              makeViz("months", { ageMs: 95 * DAY, sizeBytes: 3_500_000, created: 0 }),
            ];
            l.git = {};
            l.server.uptimeSec = 65;
          },
        }),
    );

    await viz.when("the page has loaded", async () => dashboardReady(page));
    const ages = async (): Promise<string[]> => {
      const texts = await page.$$eval("#slugs .slug-age", (els) =>
        els.map((e) => e.textContent.trim()),
      );
      return texts;
    };

    await viz.then("each row's age is in its largest two units", async () => {
      expect(await ages()).toEqual(["now", "12m", "5h", "5h 12m", "1d 5h", "2d", "3mo"]);
    });
    await viz.then("sizes are in B, KB or MB", async () => {
      expect(await rowField(page, ID.tide.replace("tide-clock", "just-now"), ".slug-size")).toBe(
        "500 B",
      );
      expect(await rowField(page, ID.tide.replace("tide-clock", "minutes"), ".slug-size")).toBe(
        "19.5 KB",
      );
      expect(await rowField(page, ID.tide.replace("tide-clock", "months"), ".slug-size")).toBe(
        "3.34 MB",
      );
    });
    await viz.then(
      "the uptime reads in minutes and seconds, in the band and in the server panel",
      async () => {
        expect(await text(page, "#server-uptime b")).toBe("1m 5s");
      },
    );
    await viz.then(
      "a row whose viz has no commits in the git feed says so rather than 0",
      async () => {
        expect(
          await rowField(page, ID.tide.replace("tide-clock", "hours"), ".commits .count"),
        ).toBe("—");
      },
    );

    await viz.when("the user sorts by created", async () => page.select("#sort-key", "created"));

    await viz.then(`the age badge follows: a viz with no creation time reads "—"`, async () => {
      expect((await ages()).at(-1)).toBe("—");
    });
  });

  it.concurrent("should count a library of one in the singular, and say so when the library is empty", async () => {
    const one = await viz.given(
      "a library holding one viz of one file, on a server up 42 seconds",
      async () =>
        open({
          hash: "dashboard",
          lib: (l) => {
            l.slugs = [makeViz("only", { fileCount: 1, sizeBytes: 900 })];
            l.git = { [l.slugs[0]!.id]: { commitCount: 1 } };
            l.server.uptimeSec = 42;
          },
        }),
    );

    await viz.when("the page has loaded", async () => dashboardReady(one));

    await viz.then("the band counts one viz, one file, in the singular", async () => {
      expect(await one.$eval(".sh-col", (e) => e.getAttribute("title"))).toBe("1 viz between 32K");
      expect(
        await one.$$eval(".counts-block .tnum", (els) => els.map((e) => e.getAttribute("title"))),
      ).toContain("1 file on disk across every viz");
      expect(await rowField(one, ID.tide.replace("tide-clock", "only"), ".files")).toBe("1");
      expect(
        await one.$eval(`${row(ID.tide.replace("tide-clock", "only"))} .files`, (e) =>
          e.getAttribute("title"),
        ),
      ).toBe("1 file");
      expect(await text(one, "#server-uptime b")).toBe("42s");
    });

    const none = await viz.given("a library with nothing in it, and no commits", async () => {
      const p = await open({
        hash: "dashboard",
        lib: (l) => {
          l.slugs = [];
          l.git = {};
          l.log = [];
        },
      });
      await dashboardReady(p);
      return p;
    });

    await viz.then("the list says there is nothing yet, and so do the commits", async () => {
      expect(await text(none, "#slugs")).toBe("none yet");
      expect(await text(none, "#commits")).toBe("no commits yet");
      expect(await none.$eval("#commit-total", (e) => e.textContent)).toBe("");
      expect(await none.$$eval(".posture-bar .pb-seg", (e) => e.length)).toBe(0);
    });
  });

  it.concurrent("should leave out the vizzes and commits a ?hide link names", async () => {
    const page = await viz.given(
      "the dashboard opened by a link that hides harbor's vizzes and orbit's commits",
      async () => {
        const p = await open({ hash: "dashboard" });
        await p.goto(`${BASE}?hideSlug=harbor&hideCommits=orbit#dashboard`, {
          waitUntil: "networkidle2",
        });
        return p;
      },
    );

    await viz.when("the page has loaded", async () => dashboardReady(page));

    await viz.then("no harbor viz is listed or counted", async () => {
      expect((await rowIds(page)).filter((id) => id.includes("harbor"))).toEqual([]);
      expect(await page.$eval(".counts-block .tnum b", (e) => e.textContent)).toBe("10");
    });
    await viz.then("orbit-deck's commit is gone, a commit naming no viz stays", async () => {
      expect(
        await page.$$eval("#commits .commit-hash", (els) => els.map((e) => e.textContent)),
      ).toEqual(["a1b2c3d", "c3d4e5f", "d4e5f6a"]);
    });

    await viz.when("the link says ?hide=atlas instead, which hides both", async () => {
      await page.goto(`${BASE}?hide=atlas,tide#dashboard`, { waitUntil: "networkidle2" });
      await dashboardReady(page);
    });

    await viz.then(
      "the atlas vizzes (and the mirror row living in atlas) are gone, and tide-clock's commit",
      async () => {
        expect((await rowIds(page)).filter((id) => /atlas|tide/u.test(id))).toEqual([]);
        expect(
          await page.$$eval("#commits .commit-hash", (els) => els.map((e) => e.textContent)),
        ).toEqual(["b2c3d4e", "c3d4e5f", "d4e5f6a"]);
      },
    );
  });
});

describe("filtering the Library", () => {
  it.concurrent("should narrow the rows by a posture click and by search, and keep the filter in the URL", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    await viz.when(`the user clicks the "private" segment of the posture bar`, async () =>
      click(page, '.pb-seg[data-posture="private"]'),
    );

    await viz.then(
      "only the private vizzes show, and the link would reopen this view",
      async () => {
        expect(await rowTitles(page)).toEqual(["Harbor map", "River poster", "Atlas exchange"]);
        expect(await hash(page)).toBe("#dashboard&posture=private");
        expect(
          await page.$eval('.pb-seg[data-posture="private"]', (e) => e.classList.contains("on")),
        ).toBe(true);
      },
    );

    await viz.when(`they clear it and search for "atlas" instead`, async () => {
      await click(page, '.pb-seg[data-posture="private"]');
      await page.type("#slug-search", "atlas");
    });

    await viz.then(
      "rows matching by title or by path show — the mirror of Tide clock INTO atlas included",
      async () => {
        expect(await rowTitles(page)).toEqual([
          "Tide clock",
          "Atlas weekly metrics",
          "Atlas exchange",
          "Atlas deep dive",
        ]);
        expect(await page.$eval("#search-count", (e) => e.textContent)).toBe("4 / 14");
      },
    );
  });

  it.concurrent("should filter by every facet, one at a time, and by kind from the kind bar", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });
    const only = async (sel: string, value: string) => {
      await page.select(sel, value);
      const titles = await rowTitles(page);
      await page.select(sel, "");
      return titles;
    };
    const onlyIds = async (sel: string, value: string) => {
      await page.select(sel, value);
      const ids = await rowIds(page);
      await page.select(sel, "");
      return ids;
    };

    const shown = await viz.when("the user picks each facet in turn", async () => ({
      unlisted: await only("#f-listed", "unlisted"),
      listed: await onlyIds("#f-listed", "listed"),
      approvedStale: await only("#f-approved", "stale"),
      cardNotPublic: await only("#f-card", "not-public"),
      cardStale: await only("#f-card", "stale"),
      apiYes: await only("#f-api", "yes"),
      noApi: await onlyIds("#f-api", "no"),
      untagged: await only("#f-posture", "untagged"),
      kindPoster: await only("#f-kind", "poster"),
      kindPage: await only("#f-kind", "page"),
      scopeAtlas: await only("#f-scope", ATLAS),
    }));

    await viz.then("only the matching vizzes show", () => {
      expect(shown.unlisted).toEqual(["River poster", "Atlas deep dive"]);
      expect(shown.listed.length).toBe(12);
      expect(shown.listed).not.toContain(ID.river);
      expect(shown.listed).not.toContain(ID.dive);
      expect(shown.approvedStale).toEqual(["Orbit deck", "Atlas deep dive"]);
      expect(shown.cardNotPublic).toEqual(["River poster"]);
      expect(shown.cardStale).toEqual(["Atlas weekly metrics"]);
      expect(shown.apiYes).toEqual(["Garden planner", "Atlas weekly metrics"]);
      expect(shown.noApi.length).toBe(12);
      expect(shown.noApi).not.toContain(ID.garden);
      expect(shown.noApi).not.toContain(ID.metrics);
      expect(shown.untagged).toEqual(["loose-sketch"]);
      expect(shown.kindPoster).toEqual(["River poster", "Poster starter"]);
      expect(shown.kindPage).toEqual([
        "Tide clock",
        "Tide clock",
        "Garden planner",
        "Big globe",
        "Harbor map",
        "Atlas weekly metrics",
        "Harbor timeline",
        "Garden planner",
        "loose-sketch",
      ]);
      expect(shown.scopeAtlas).toEqual([
        "Tide clock",
        "Atlas weekly metrics",
        "Atlas exchange",
        "Atlas deep dive",
      ]);
    });
    await viz.then(
      "the scope menu names each place: the central library first, then each repo",
      async () => {
        expect(await page.$$eval("#f-scope option", (os) => os.map((o) => o.textContent))).toEqual([
          "all",
          ".agents/state/viz",
          "code/atlas/viz-pages",
          "code/harbor/viz-pages",
        ]);
      },
    );

    await viz.when("they click the deck segment of the kind bar", async () =>
      click(page, '.sb-seg[data-kind="deck"]'),
    );

    await viz.then(
      "only the deck shows, the kind menu says so, and the segment is lit",
      async () => {
        expect(await rowTitles(page)).toEqual(["Orbit deck"]);
        expect(await selectValues(page, ["f-kind"])).toEqual(["deck"]);
        expect(
          await page.$eval('.sb-seg[data-kind="deck"]', (e) => e.classList.contains("on")),
        ).toBe(true);
        expect(await page.$eval("#f-kind", (e) => e.classList.contains("active"))).toBe(true);
      },
    );

    await viz.when("they click it again", async () => click(page, '.sb-seg[data-kind="deck"]'));

    await viz.then("the kind filter is off", async () => {
      expect((await rowTitles(page)).length).toBe(14);
      expect(await page.$eval("#search-count", (e) => e.textContent)).toBe("");
    });
  });

  it.concurrent("should hide mirrored-in copies for originals only, and add hidden vizzes for show all", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    await viz.when(`the user ticks "originals only"`, async () => click(page, "#f-originals"));

    await viz.then("the mirror row and the vendored copy are gone", async () => {
      expect(await rowIds(page)).not.toContain(`${ID.tide}↦${ATLAS}`);
      expect(await rowIds(page)).not.toContain(ID.gardenCopy);
      expect((await rowIds(page)).length).toBe(12);
      expect(await page.$eval(".ctl-check", (e) => e.classList.contains("active"))).toBe(true);
    });

    await viz.when(`they untick it and tick "show all"`, async () => {
      await click(page, "#f-originals");
      await click(page, "#f-all");
    });

    await viz.then(
      "the hidden-tagged viz shows, first (it is the newest), and it is counted",
      async () => {
        expect((await rowTitles(page))[0]).toBe("Secret notes");
        expect(await page.$eval(".counts-block .tnum b", (e) => e.textContent)).toBe("14");
        expect(await page.$eval("#f-all-label", (e) => e.classList.contains("active"))).toBe(true);
      },
    );
    await viz.then("its tag is offered in the tag menu", async () => {
      expect(await page.$$eval("#f-tag option", (os) => os.map((o) => o.value))).toContain("wip");
    });
  });

  it.concurrent("should remember the show-all tick across visits, and forget it when the filters reset", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });
    const remembered = async (): Promise<string | null> => {
      const value = await page.evaluate(() => localStorage.getItem("sp-show-all"));
      return value;
    };
    const ticked = async (): Promise<boolean> => {
      const checked = await page.$eval("input#f-all", (e) => e.checked);
      return checked;
    };

    await viz.when(`they tick "show all"`, async () => click(page, "#f-all"));

    await viz.then("it is remembered as on", async () => {
      expect(await remembered()).toBe("1");
    });

    await viz.when("they untick it", async () => click(page, "#f-all"));

    await viz.then("that is remembered too", async () => {
      expect(await remembered()).toBe("0");
    });

    await viz.when("they tick it again and come back by the bare address", async () => {
      await click(page, "#f-all");
      await page.goto(BASE, { waitUntil: "networkidle2" });
      await dashboardReady(page);
    });

    await viz.then("it is still ticked", async () => {
      expect(await ticked()).toBe(true);
    });

    await viz.when("they reset the filters", async () => click(page, "#filters-reset"));

    await viz.then("it is unticked and the memory is cleared", async () => {
      expect(await ticked()).toBe(false);
      expect(await remembered()).toBe("0");
    });
  });

  it.concurrent("should filter by any of several tags, each a removable pill", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      expect(await p.$$eval("#f-tag option", (os) => os.map((o) => o.value))).toEqual([
        "",
        "3d",
        "home",
        "maps",
        "metrics",
        "ocean",
        "ops",
        "slides",
        "space",
        "team",
        "time",
        "weekly",
      ]);
      return p;
    });

    await viz.when(`the user adds the tag "maps", then "home"`, async () => {
      await page.select("#f-tag", "maps");
      await page.select("#f-tag", "home");
    });

    await viz.then(
      "vizzes carrying either show, each chosen tag is a pill, and it leaves the menu",
      async () => {
        expect(await rowTitles(page)).toEqual(["Garden planner", "Big globe", "Harbor map"]);
        expect(
          await page.$$eval("#tag-pills .tag-pill", (els) =>
            els.map((e) => e.firstChild!.textContent),
          ),
        ).toEqual(["home", "maps"]);
        expect(await page.$$eval("#f-tag option", (os) => os.map((o) => o.value))).not.toContain(
          "maps",
        );
        expect(await hash(page)).toBe("#dashboard&tags=maps%2Chome");
      },
    );

    await viz.when(`they remove the "maps" pill`, async () =>
      click(page, '#tag-pills [data-tag-rm="maps"]'),
    );

    await viz.then(`only the "home" viz is left`, async () => {
      expect(await rowTitles(page)).toEqual(["Garden planner"]);
    });

    await viz.when("they click beside the pills", async () => click(page, "#tag-pills .tag-pill"));

    await viz.then("nothing changes", async () => {
      expect(await rowTitles(page)).toEqual(["Garden planner"]);
      expect(page.errors).toEqual([]);
    });
  });

  it.concurrent("should say which filter matched nothing, and reset every filter and the sort at once", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    await viz.when(
      "the user sorts by name and filters to local decks tagged maps, originals only, hidden ones shown",
      async () => {
        await page.select("#sort-key", "name");
        await page.select("#f-posture", "local");
        await page.select("#f-kind", "deck");
        await click(page, "#f-originals");
        await click(page, "#f-all");
        await page.select("#f-tag", "maps");
      },
    );

    await viz.then("no viz matches, and the page says it is the filters", async () => {
      expect(await text(page, "#slugs")).toBe("no viz matches the current filters");
      expect(
        await page.$eval("#search-count", (e) => [e.textContent, e.classList.contains("zero")]),
      ).toEqual(["0 / 15", true]);
    });

    await viz.when("the user presses reset", async () => click(page, "#filters-reset"));

    await viz.then(
      "every filter is off, the sort is back to newest first, and the URL is bare",
      async () => {
        expect(await selectValues(page, ["f-posture", "f-kind", "sort-key"])).toEqual([
          "",
          "",
          "modified",
        ]);
        expect(await page.$eval("#sort-dir", (e) => e.textContent)).toBe("↓");
        expect(await page.$$eval("#tag-pills .tag-pill", (e) => e.length)).toBe(0);
        expect((await rowTitles(page)).length).toBe(14);
        expect(await hash(page)).toBe("#dashboard");
      },
    );
  });
});

describe("sorting the Library", () => {
  it.concurrent("should sort by each key in its natural direction, and flip it", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    await viz.when("the user sorts by name", async () => page.select("#sort-key", "name"));

    await viz.then("A→Z (the arrow reads up)", async () => {
      expect(await rowTitles(page)).toEqual([
        "Atlas deep dive",
        "Atlas exchange",
        "Atlas weekly metrics",
        "Big globe",
        "Garden planner",
        "Garden planner",
        "Harbor map",
        "Harbor timeline",
        "loose-sketch",
        "Orbit deck",
        "Poster starter",
        "River poster",
        "Tide clock",
        "Tide clock",
      ]);
      expect(await page.$eval("#sort-dir", (e) => e.textContent)).toBe("↑");
    });

    await viz.when("they sort by size", async () => page.select("#sort-key", "size"));

    await viz.then("biggest first; a tie goes by name", async () => {
      expect(await rowTitles(page)).toEqual([
        "Big globe",
        "Orbit deck",
        "Atlas deep dive",
        "Garden planner",
        "River poster",
        "Atlas weekly metrics",
        "Harbor timeline",
        "Tide clock",
        "Tide clock",
        "Poster starter",
        "Atlas exchange",
        "Garden planner",
        "Harbor map",
        "loose-sketch",
      ]);
      expect(await page.$eval("#sort-dir", (e) => e.textContent)).toBe("↓");
    });

    await viz.when("they flip the direction", async () => click(page, "#sort-dir"));

    await viz.then("smallest first, and the URL says so", async () => {
      expect(await rowTitles(page)).toEqual([
        "loose-sketch",
        "Garden planner",
        "Harbor map",
        "Atlas exchange",
        "Poster starter",
        "Tide clock",
        "Tide clock",
        "Harbor timeline",
        "Atlas weekly metrics",
        "River poster",
        "Garden planner",
        "Atlas deep dive",
        "Orbit deck",
        "Big globe",
      ]);
      expect(await hash(page)).toBe("#dashboard&sort=size&dir=asc");
    });

    await viz.when("they flip it back and sort by files", async () => {
      await click(page, "#sort-dir");
      await page.select("#sort-key", "files");
    });

    await viz.then("most files first", async () => {
      expect(await rowTitles(page)).toEqual([
        "Big globe",
        "Orbit deck",
        "Garden planner",
        "Atlas weekly metrics",
        "Tide clock",
        "Tide clock",
        "Atlas deep dive",
        "Atlas exchange",
        "Garden planner",
        "Harbor map",
        "Harbor timeline",
        "Poster starter",
        "River poster",
        "loose-sketch",
      ]);
    });

    await viz.when("they sort by commits", async () => page.select("#sort-key", "commits"));

    await viz.then("most commits first; the mirror row, with none of its own, last", async () => {
      expect(await rowIds(page)).toEqual([
        ID.gardenCopy,
        ID.garden,
        ID.globe,
        ID.exchange,
        ID.timeline,
        ID.river,
        ID.starter,
        ID.metrics,
        ID.harborMap,
        ID.orbit,
        ID.loose,
        ID.dive,
        ID.tide,
        `${ID.tide}↦${ATLAS}`,
      ]);
    });

    await viz.when("they sort by created", async () => page.select("#sort-key", "created"));

    await viz.then(
      "newest first (each viz here was created 30 days before its last change)",
      async () => {
        expect(await rowTitles(page)).toEqual([
          "Tide clock",
          "Tide clock",
          "Orbit deck",
          "Garden planner",
          "Big globe",
          "Harbor map",
          "Atlas weekly metrics",
          "River poster",
          "Harbor timeline",
          "Atlas exchange",
          "Garden planner",
          "Atlas deep dive",
          "Poster starter",
          "loose-sketch",
        ]);
      },
    );
  });
});

describe("searching the Library", () => {
  it.concurrent("should highlight what matched, show the path while searching, and clear on Escape", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    await viz.when("the user searches two overlapping terms", async () =>
      page.type("#slug-search", "tide ide"),
    );

    await viz.then(
      "the titles match, one highlight spans both terms, and the row shows its highlighted path",
      async () => {
        expect(await rowTitles(page)).toEqual(["Tide clock", "Tide clock"]);
        expect(await page.$eval(`${row(ID.tide)} .slug-name`, (e) => e.innerHTML)).toContain(
          "<mark>Tide</mark> clock",
        );
        expect(await page.$eval(`${row(ID.tide)} .slug-path`, (e) => e.innerHTML)).toBe(
          ".agents/state/viz/<mark>tide</mark>-clock",
        );
      },
    );

    await viz.when("they search a tag instead, which is in no title", async () =>
      typeInto(page, "#slug-search", "ocean"),
    );

    await viz.then(
      "the vizzes with that tag match, with nothing in their title highlighted",
      async () => {
        expect(await rowTitles(page)).toEqual(["Tide clock", "Tide clock"]);
        expect(await page.$eval(`${row(ID.tide)} .slug-name`, (e) => e.innerHTML)).not.toContain(
          "<mark>",
        );
      },
    );

    await viz.when("they search for something no viz has", async () =>
      typeInto(page, "#slug-search", "zebra <b>"),
    );

    await viz.then(
      "the page says nothing matches that, escaped, and the count reads zero",
      async () => {
        expect(await text(page, "#slugs")).toBe("no viz matches “zebra <b>”");
        expect(await page.$eval("#search-count", (e) => e.classList.contains("zero"))).toBe(true);
      },
    );

    await viz.when("they press Escape", async () => page.keyboard.press("Escape"));

    await viz.then(
      "the search is empty, every row is back, and the box has let go of the keyboard",
      async () => {
        expect(await page.$eval("input#slug-search", (e) => e.value)).toBe("");
        expect((await rowTitles(page)).length).toBe(14);
        expect(await page.evaluate(() => document.activeElement?.id)).not.toBe("slug-search");
      },
    );
  });

  it.concurrent("should focus the search on / or Ctrl+F, and let / be typed once in it", async () => {
    const page = await viz.given("the dashboard, nothing focused", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    await viz.when("the user presses /", async () => page.keyboard.press("/"));

    await viz.then("the search box has focus, and the / was not typed", async () => {
      expect(await page.evaluate(() => document.activeElement?.id)).toBe("slug-search");
      expect(await page.$eval("input#slug-search", (e) => e.value)).toBe("");
    });

    await viz.when(`they type "a/b" in it`, async () => page.keyboard.type("a/b"));

    await viz.then("the / is part of the search", async () => {
      expect(await page.$eval("input#slug-search", (e) => e.value)).toBe("a/b");
    });

    await viz.when("they click away, then press Ctrl+F", async () => {
      await click(page, "#server-info");
      await page.keyboard.down("Control");
      await page.keyboard.press("f");
      await page.keyboard.up("Control");
    });

    await viz.then(
      "the search box has focus with its text selected, ready to be typed over",
      async () => {
        expect(
          await page.evaluate(() => {
            const s = document.querySelector<HTMLInputElement>("#slug-search")!;
            return [document.activeElement === s, s.selectionStart, s.selectionEnd];
          }),
        ).toEqual([true, 0, 3]);
      },
    );
  });
});

describe("the Library's URL", () => {
  it.concurrent("should carry every filter, the sort and the search in the hash, and restore them all on reload", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    const view = await viz.when("the user sets every filter, the sort and a search", async () => {
      await page.select("#f-posture", "public");
      await page.select("#f-listed", "listed");
      await page.select("#f-approved", "approved");
      await page.select("#f-card", "public");
      await page.select("#f-api", "no");
      await page.select("#f-scope", CENTRAL);
      await page.select("#f-kind", "page");
      await page.select("#sort-key", "name");
      await click(page, "#sort-dir");
      await click(page, "#f-originals");
      await click(page, "#f-all");
      await page.select("#f-tag", "ocean");
      await page.type("#slug-search", "tide");
      return rowIds(page);
    });

    await viz.then("the hash names all of it", async () => {
      expect(view).toEqual([ID.tide]);
      expect(await hash(page)).toBe(
        "#dashboard&posture=public&listed=listed&approved=approved&card=public&api=no" +
          "&scope=%2FUsers%2Fada%2F.agents%2Fstate%2Fviz&kind=page&sort=name&originals=1&all=1&tags=ocean&q=tide",
      );
    });

    await viz.when("they reload", async () => {
      await page.reload({ waitUntil: "networkidle2" });
      await dashboardReady(page);
    });

    await viz.then("every control is as they left it, and so is the list", async () => {
      expect(
        await selectValues(page, [
          "f-posture",
          "f-listed",
          "f-approved",
          "f-card",
          "f-api",
          "f-scope",
          "f-kind",
          "sort-key",
        ]),
      ).toEqual(["public", "listed", "approved", "public", "no", CENTRAL, "page", "name"]);
      expect(await page.$eval("#sort-dir", (e) => e.textContent)).toBe("↓");
      expect(
        await page.$$eval("input#f-originals, input#f-all", (els) => els.map((e) => e.checked)),
      ).toEqual([true, true]);
      expect(await page.$eval("input#slug-search", (e) => e.value)).toBe("tide");
      expect(await rowIds(page)).toEqual(view);
    });
  });

  it.concurrent("should open a link's ascending sort, and ignore a sort key the page no longer offers", async () => {
    const page = await viz.given("a link sorting by name, ascending", async () =>
      open({ hash: "dashboard&sort=name&dir=asc" }),
    );

    await viz.when("the page has loaded", async () => dashboardReady(page));

    await viz.then("the list opens that way", async () => {
      expect((await rowTitles(page))[0]).toBe("Atlas deep dive");
      expect(await page.$eval("#sort-dir", (e) => e.textContent)).toBe("↑");
    });

    const old = await viz.given("an old link sorting by a key that is gone", async () => {
      const p = await open({ hash: "dashboard&sort=recent" });
      await dashboardReady(p);
      return p;
    });

    await viz.then("the list opens newest first rather than blank", async () => {
      expect(await selectValues(old, ["sort-key"])).toEqual(["modified"]);
      expect((await rowTitles(old)).length).toBe(14);
    });
  });

  it.concurrent("should apply a filtered link pasted into an open Library", async () => {
    const page = await viz.given("the dashboard, unfiltered", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    await viz.when("the address changes to a link filtered to decks", async () => {
      await page.evaluate(() => {
        location.hash = "#dashboard&kind=deck";
      });
    });

    await viz.then("only the deck shows", async () => {
      await page.waitForFunction(() => document.querySelectorAll("#slugs .slug").length === 1);
      expect(await rowTitles(page)).toEqual(["Orbit deck"]);
    });
  });

  it.concurrent("should leave the URL alone while another tab is showing, though the Library keeps refreshing", async () => {
    const page = await viz.given("the Rank tab", async () => open({ hash: "rank" }));

    await viz.when("the Library's 5s refresh has run in the background", async () => {
      await nthCall(page, "GET slugs", 2, 10_000);
      await page.waitForNetworkIdle({ idleTime: 100 });
    });

    await viz.then("the hash still names Rank", async () => {
      expect(await hash(page)).toBe("#rank");
    });
  });
});

describe("the Library's views and feeds", () => {
  it.concurrent("should switch to a grid and keep that choice across a reload", async () => {
    const page = await viz.given("the dashboard, as a list", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      expect(await p.$eval("#slugs", (e) => e.classList.contains("cards"))).toBe(false);
      return p;
    });

    await viz.when("the user picks grid", async () =>
      click(page, '#slug-view [data-view="cards"]'),
    );

    await viz.then("the rows lay out as cards, and grid is lit", async () => {
      expect(await page.$eval("#slugs", (e) => e.classList.contains("cards"))).toBe(true);
      expect(
        await page.$eval('#slug-view [data-view="cards"]', (e) => e.classList.contains("on")),
      ).toBe(true);
    });

    await viz.when("they reload", async () => {
      await page.reload({ waitUntil: "networkidle2" });
      await dashboardReady(page);
    });

    await viz.then("it is still a grid", async () => {
      expect(await page.$eval("#slugs", (e) => e.classList.contains("cards"))).toBe(true);
    });

    await viz.when("they click between the two buttons", async () =>
      click(page, "#slug-view", { offset: { x: 1, y: 1 } }),
    );

    await viz.then("nothing changes", async () => {
      expect(await page.$eval("#slugs", (e) => e.classList.contains("cards"))).toBe(true);
      expect(page.errors).toEqual([]);
    });
  });

  it.concurrent("should show commits as pending until the slow git feed lands", async () => {
    let land!: () => void;
    const page = await viz.given("a git feed that takes a second and a half", async () => {
      const landed = new Promise<void>((r) => {
        land = r;
      });
      return open({
        hash: "dashboard",
        stubs: {
          "GET slugs-git": async (_, l) => {
            await landed;
            return l.git;
          },
        },
      });
    });

    await viz.when("the page has loaded", async () =>
      page.waitForFunction(() => document.querySelectorAll("#slugs .slug").length > 0),
    );

    await viz.then("rows and the band say the commit counts are still coming", async () => {
      expect(await text(page, "#git-status")).toBe("· git feed loading…");
      expect(await rowField(page, ID.river, ".commits .count")).toBe("—");
      expect(await page.$eval(`${row(ID.river)} .commits`, (e) => e.getAttribute("title"))).toBe(
        "commits — git feed loading",
      );
      expect(await page.$$eval(".counts-block .tnum", (els) => els[2]!.getAttribute("title"))).toBe(
        "git feed still loading…",
      );
    });

    await viz.when("the feed lands", async () => {
      land();
      await dashboardReady(page);
    });

    await viz.then("the counts show", async () => {
      expect(await rowField(page, ID.river, ".commits .count")).toBe("15");
      expect(await page.$$eval(".counts-block .tnum", (els) => els[2]!.getAttribute("title"))).toBe(
        "164 commits across all host repos",
      );
    });
  });

  it.concurrent("should show the server's numbers as pending until the server has answered", async () => {
    let answer!: () => void;
    const page = await viz.given(
      "a server slow to say how it is, while the git feed is quick",
      async () => {
        const answered = new Promise<void>((r) => {
          answer = r;
        });
        return open({
          hash: "dashboard",
          stubs: {
            "GET server-info": async (_, l) => {
              await answered;
              return l.server;
            },
          },
        });
      },
    );

    await viz.when("the page has loaded", async () =>
      page.waitForSelector("#slug-totals .stat-band"),
    );

    await viz.then("the band's uptime and containers read as pending", async () => {
      expect(await text(page, "#server-uptime b")).toBe("…");
      expect(await text(page, "#server-containers b")).toBe("…");
    });

    await viz.when("the server answers", () => {
      answer();
    });

    await viz.then("they show", async () => {
      await textIs(page, "#server-uptime b", "1h 2m");
      expect(await text(page, "#server-containers b")).toBe("3");
    });
  });

  it.concurrent("should rescan $HOME on request, and list what the rescan found", async () => {
    let finish!: () => void;
    const page = await viz.given(
      "the dashboard, and a rescan that takes a moment and finds a new viz",
      async () => {
        const done = new Promise<void>((r) => {
          finish = r;
        });
        const p = await open({
          hash: "dashboard",
          stubs: {
            "GET /_rescan": async (_, l) => {
              await done;
              l.slugs.push(
                makeViz("found-later", { container: HARBOR, title: "Found later", ageMs: 1000 }),
              );
              return { containers: 3, slugs: l.slugs.length };
            },
          },
        });
        await dashboardReady(p);
        return p;
      },
    );

    await viz.when("the user presses Rescan", async () => click(page, "#rescan-btn"));

    await viz.then(
      "the button says it is scanning and can't be pressed again, and commits go back to pending",
      async () => {
        expect(
          await page.$eval("button#rescan-btn", (e) => [e.disabled, e.textContent.trim()]),
        ).toEqual([true, "scanning…"]);
        expect(await text(page, "#git-status")).toBe("· git feed refreshing…");
      },
    );

    await viz.when("the scan finishes", async () => {
      finish();
      await page.waitForFunction(
        () => !document.querySelector<HTMLButtonElement>("#rescan-btn")!.disabled,
      );
    });

    await viz.then(
      "the new viz is listed first, the git feed was fetched again, and the button is back",
      async () => {
        expect((await rowTitles(page))[0]).toBe("Found later");
        expect(calls(page, "GET slugs-git").length).toBe(2);
        expect(await text(page, "#rescan-btn")).toBe("Rescan $HOME");
        expect(await text(page, "#git-status")).toBe("");
      },
    );
  });

  it.concurrent("should put the commit counts back when a rescan fails", async () => {
    const page = await viz.given(
      "the server's rescan answers its plain-text error page",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: { "GET /_rescan": () => textReply(500, "rescan error: EACCES ~/private") },
        });
        await dashboardReady(p);
        return p;
      },
    );

    await viz.when("the user presses Rescan", async () => {
      await click(page, "#rescan-btn");
      await page.waitForFunction(
        () => !document.querySelector<HTMLButtonElement>("#rescan-btn")!.disabled,
      );
    });

    await viz.then(
      "the button is back, the git feed reloaded, and the rows show their commit counts again",
      async () => {
        expect(await text(page, "#rescan-btn")).toBe("Rescan $HOME");
        await nthCall(page, "GET slugs-git", 2);
        await page.waitForFunction(() => document.querySelector("#git-status")!.textContent === "");
        expect(await rowField(page, ID.river, ".commits .count")).toBe("15");
      },
    );
  });

  it.concurrent("should pick up changes to the library on its 5s refresh", async () => {
    const page = await viz.given("the dashboard", async () => {
      const p = await open({ hash: "dashboard" });
      await dashboardReady(p);
      return p;
    });

    await viz.when("a viz is made elsewhere and the server has been up a little longer", () => {
      page.api.lib.slugs.push(makeViz("made-elsewhere", { title: "Made elsewhere", ageMs: 1000 }));
      page.api.lib.server.uptimeSec = 3725 + 3600;
    });

    await viz.then("within one refresh it is listed first, and the uptime moved on", async () => {
      await page.waitForFunction(
        () =>
          document
            .querySelector("#slugs .slug .slug-name")
            ?.textContent?.includes("Made elsewhere"),
        { timeout: 10_000 },
      );
      expect(await text(page, "#server-uptime b")).toBe("2h 2m");
    });
  });
});

describe("the Library without a server", () => {
  it.concurrent("should say it is live only, and offer nothing to search, filter or rescan, when the server is down", async () => {
    const page = await viz.given("the viz server is not answering its health check", async () =>
      open({ hash: "dashboard", live: false }),
    );

    await viz.when("the page has loaded", async () =>
      page.waitForFunction(() =>
        document.querySelector("#slugs")!.textContent.includes("Live only."),
      ),
    );

    await viz.then(
      "every live panel says it needs the server, and nothing was asked of the api",
      async () => {
        expect(await text(page, "#slugs")).toContain("The viz server isn't reachable right now.");
        await Promise.all(
          ["#server-info", "#commits"].map(async (sel) => {
            expect(await text(page, sel)).toContain("Live only.");
          }),
        );
        expect(
          page.api.calls.filter((c) => c.route.startsWith("slugs") || c.route === "log"),
        ).toEqual([]);
      },
    );
    await viz.then("rescan is gone, and search and the filters are disabled", async () => {
      expect(await page.$eval("button#rescan-btn", (e) => e.style.display)).toBe("none");
      expect(
        await page.$$eval(
          "input#slug-search, select#f-posture, input#f-originals, button#filters-reset",
          (els) => els.map((e) => e.disabled),
        ),
      ).toEqual([true, true, true, true]);
    });

    await viz.when("a filtered Library link is pasted in", async () => {
      await page.evaluate(() => {
        location.hash = "#dashboard&posture=local";
      });
    });

    await viz.then("the placeholder stays", async () => {
      await page.waitForNetworkIdle({ idleTime: 100 });
      expect(await text(page, "#slugs")).toContain("Live only.");
      expect(page.errors).toEqual([]);
    });
  });

  it.concurrent("should say it is a static copy when it was published", async () => {
    const page = await viz.given("the page as viz publish stamps it", async () =>
      open({
        hash: "dashboard",
        before: async (p) => {
          await p.evaluateOnNewDocument(() => {
            Object.assign(window, { __VIZ_STATIC__: true });
          });
        },
      }),
    );

    await viz.when("the page has loaded", async () =>
      page.waitForFunction(() =>
        document.querySelector("#slugs")!.textContent.includes("Live only."),
      ),
    );

    await viz.then("the Library says there is no server behind a static copy", async () => {
      expect(await text(page, "#slugs")).toContain(
        "This is a static copy — there's no live server behind it.",
      );
      expect(calls(page, "GET slugs")).toEqual([]);
    });
  });

  it.concurrent("should treat a server that can't be reached at all as offline", async () => {
    const page = await viz.given(
      "a health check that fails at the network, not with a status",
      async () =>
        open({
          hash: "dashboard",
          before: async (p) => {
            await p.evaluateOnNewDocument(() => {
              const real = window.fetch;
              const urlOf = (u: RequestInfo | URL): string =>
                typeof u === "string" ? u : u instanceof URL ? u.href : u.url;
              // Object.assign, not `window.fetch =`: with bun-types loaded, `typeof fetch` also demands Bun's `preconnect`, which no browser has.
              Object.assign(window, {
                fetch: async (u: RequestInfo | URL, o?: RequestInit): Promise<Response> => {
                  if (urlOf(u) === "/_health") throw new TypeError("Failed to fetch");
                  const res = await real(u, o);
                  return res;
                },
              });
            });
          },
        }),
    );

    await viz.when("the page has loaded", async () =>
      page.waitForFunction(() =>
        document.querySelector("#slugs")!.textContent.includes("Live only."),
      ),
    );

    await viz.then("the Library says the server isn't reachable", async () => {
      expect(await text(page, "#slugs")).toContain("The viz server isn't reachable right now.");
    });
  });

  it.concurrent("should keep the list it has when a refresh fails, and show the git feed as pending if it never lands", async () => {
    let slugs = 0;
    const page = await viz.given(
      "a server whose git feed and commit log answer its plain-text error page, and whose slugs do the same from the second refresh on",
      async () => {
        const p = await open({
          hash: "dashboard",
          stubs: {
            "GET slugs-git": () => textReply(500, "api error: git"),
            "GET log": () => textReply(500, "api error: git"),
            "GET slugs": (_, l) => (++slugs > 1 ? textReply(500, "api error: EMFILE") : l.slugs),
          },
        });
        await p.waitForFunction(() => document.querySelectorAll("#slugs .slug").length > 0);
        return p;
      },
    );

    await viz.when("the 5s refresh has failed once", async () => {
      await nthCall(page, "GET server-info", 2, 10_000);
      await page.waitForNetworkIdle({ idleTime: 100 });
    });

    await viz.then(
      "the rows from before still show, their commit counts pending, and the commits panel still loading",
      async () => {
        expect((await rowTitles(page)).length).toBe(14);
        expect(await rowField(page, ID.river, ".commits .count")).toBe("—");
        expect(await text(page, "#git-status")).toBe("· git feed loading…");
        expect(await text(page, "#commits")).toBe("loading…");
        expect(page.errors).toEqual([]);
      },
    );
  });
});

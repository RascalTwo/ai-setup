// The Library dashboard (dashboard.ts): search, the URL that carries the filters, the git feed, the
// server panel and the offline state. The rows, filters and sort are library.test.ts; the drawer that
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
  HARBOR,
} from "./helpers.ts";
import {
  open,
  click,
  ID,
  row,
  rowIds,
  text,
  textIs,
  typeInto,
  rowField,
  hash,
  selectValues,
} from "./steps-library.ts";

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

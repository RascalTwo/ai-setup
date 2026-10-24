// The tour's two moving parts: the stop-by-stop route, and the filterable index of everything the repo owns.
import { describe, it, expect } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { entries, posterHref } from "../catalog.ts";

const repo = path.join(import.meta.dir, "..", "..", "..");
const dirsIn = (sub: string): string[] =>
  readdirSync(path.join(repo, sub)).filter((n) => statSync(path.join(repo, sub, n)).isDirectory());

const cardNames = async (page: Awaited<ReturnType<typeof viz.open>>) => {
  const names = await page.$$eval(".idx-card .idx-name", (els) => els.map((e) => e.textContent));
  return names;
};
const byText = (a: string, b: string) => a.localeCompare(b);

describe("the catalog behind the index", () => {
  it("should name exactly the skills and tools the repo owns", async () => {
    const dirs = await viz.given("the skills/ and tools/ directories of this repo", () => ({
      skills: dirsIn("skills"),
      tools: dirsIn("tools"),
    }));

    const catalog = await viz.when("the catalog's entries are split by kind", () => ({
      skills: entries.filter((e) => e.kind === "skill").map((e) => e.name),
      tools: entries.filter((e) => e.kind === "tool").map((e) => e.name),
    }));

    await viz.then("the catalog lists each one once, and nothing else", () => {
      expect(catalog.skills.toSorted(byText)).toEqual(dirs.skills.toSorted(byText));
      expect(catalog.tools.toSorted(byText)).toEqual(dirs.tools.toSorted(byText));
    });
  });

  it("should link every entry to a poster that exists", async () => {
    await viz.given("the catalog's entries and the viz-pages/ directory");

    const missing = await viz.when("each entry's poster path is resolved against viz-pages/", () =>
      entries
        .map((e) => posterHref(e))
        .filter(
          (href) =>
            !existsSync(path.join(repo, "viz-pages", href.replaceAll("../", ""), "index.html")),
        ),
    );

    await viz.then("none is missing", () => {
      expect(missing).toEqual([]);
    });
  });
});

describe("the index", () => {
  it.concurrent("should show every entry, each linking to its poster", async () => {
    const page = await viz.given("the page with no filter", async () => viz.open());

    const hrefs = await viz.when("the visitor reads the cards", async () =>
      page.$$eval(".idx-card", (els) => els.map((e) => e.getAttribute("href") ?? "")),
    );

    await viz.then("one card per catalog entry, each pointing at its poster", async () => {
      expect(hrefs.toSorted(byText)).toEqual(entries.map((e) => posterHref(e)).toSorted(byText));
      expect(await page.$eval("#indexCount", (e) => e.textContent)).toContain(
        `All ${entries.length}`,
      );
    });
  });

  it.concurrent("should narrow to what the visitor types, matching name or description", async () => {
    const page = await viz.given("the page", async () => viz.open());

    await viz.when("the visitor types a word that appears in names and in descriptions", async () =>
      page.type("#indexSearch", "handoff"),
    );

    await viz.then(
      "only matching entries remain, and the count says how many of the whole",
      async () => {
        const names = await cardNames(page);
        expect(names).toContain("r2-handoff");
        expect(names).toContain("auto-handoff");
        expect(names).not.toContain("viz");
        expect(await page.$eval("#indexCount", (e) => e.textContent)).toBe(
          `${names.length} of ${entries.length}`,
        );
      },
    );
  });

  it.concurrent("should show only tools when the visitor picks Tools, and say so when nothing matches", async () => {
    const page = await viz.given("the page", async () => viz.open());

    await viz.when("the visitor picks Tools", async () => page.click('[data-kind-filter="tool"]'));

    await viz.then("every card is a tool and the button reads as pressed", async () => {
      const kinds = await page.$$eval(".idx-card .idx-kind", (els) =>
        els.map((e) => e.textContent),
      );
      expect(kinds).toHaveLength(entries.filter((e) => e.kind === "tool").length);
      expect(new Set(kinds)).toEqual(new Set(["tool"]));
      expect(
        await page.$eval('[data-kind-filter="tool"]', (e) => e.getAttribute("aria-pressed")),
      ).toBe("true");
    });

    await viz.when("the visitor then types something no tool matches", async () =>
      page.type("#indexSearch", "zzzz-no-such-thing"),
    );

    await viz.then("the page says nothing matches rather than showing an empty box", async () => {
      expect(await cardNames(page)).toEqual([]);
      expect(await page.$eval("#indexCount", (e) => e.textContent)).toContain("Nothing matches");
    });
  });

  it.concurrent("should quote counts in prose that agree with the index", async () => {
    const page = await viz.given("the page", async () => viz.open());

    const counts = await viz.when("the visitor reads every inline count", async () =>
      page.$$eval("[data-count]", (els) =>
        els.map((e) => [
          e instanceof HTMLElement ? (e.dataset["count"] ?? "") : "",
          e.textContent ?? "",
        ]),
      ),
    );

    await viz.then("every inline count equals the catalog's", () => {
      const want = new Map([
        ["skill", entries.filter((e) => e.kind === "skill").length],
        ["tool", entries.filter((e) => e.kind === "tool").length],
        ["all", entries.length],
      ]);
      expect(counts.length).toBeGreaterThan(3);
      for (const [kind, shown] of counts) expect(shown).toBe(String(want.get(kind!)));
    });
  });
});

describe("the route", () => {
  it.concurrent("should step through the stops and show each stop's own page links", async () => {
    const { page, title, first } = await viz.given("the tour on its first stop", async () => {
      const p = await viz.open();
      const read = async () => {
        const t = await p.$eval("#detailTitle", (e) => e.textContent);
        return t;
      };
      const firstTitle = await read();
      expect(await p.$eval("#tourProgress", (e) => e.textContent)).toContain("Stop 1 of 16");
      return { page: p, title: read, first: firstTitle };
    });

    await viz.when("the visitor presses Next", async () => page.click("[data-next-stop]"));

    await viz.then("the second stop shows", async () => {
      expect(await title()).not.toBe(first);
      expect(await page.$eval("#tourProgress", (e) => e.textContent)).toContain("Stop 2 of 16");
    });

    await viz.when("the visitor opens the handoffs stop from the map", async () =>
      page.click('[data-node-id="handoff"]'),
    );

    await viz.then("its detail links to the posters it is about", async () => {
      const links = await page.$$eval("#detailLinks a", (els) =>
        els.map((e) => e.getAttribute("href")),
      );
      expect(links).toContain("../tool-auto-handoff/");
      expect(links).toContain("../skill-r2-handoff/");
      expect(links).toContain("../skill-spawn-herdr-tab/");
      expect(links).toContain("../skill-end-session/");
    });
  });

  it.concurrent("should end on the last stop with Next disabled", async () => {
    const page = await viz.given("the tour", async () => viz.open());

    await viz.when("the visitor opens the last stop", async () =>
      page.click('[data-node-id="publish"]'),
    );

    await viz.then("Next is disabled and the progress line says the tour is over", async () => {
      expect(await page.$eval("[data-next-stop]", (e) => e.hasAttribute("disabled"))).toBe(true);
      expect(await page.$eval("#tourProgress", (e) => e.textContent)).toContain("End of the tour");
    });
  });
});

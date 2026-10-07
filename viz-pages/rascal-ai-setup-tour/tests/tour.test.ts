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
  it("should name exactly the skills and tools the repo owns", () => {
    // GIVEN the skills/ and tools/ directories of this repo
    const skills = dirsIn("skills");
    const tools = dirsIn("tools");

    // THEN the catalog lists each one once, and nothing else
    const catalogSkills = entries.filter((e) => e.kind === "skill").map((e) => e.name);
    const catalogTools = entries.filter((e) => e.kind === "tool").map((e) => e.name);
    expect(catalogSkills.toSorted(byText)).toEqual(skills.toSorted(byText));
    expect(catalogTools.toSorted(byText)).toEqual(tools.toSorted(byText));
  });

  it("should link every entry to a poster that exists", () => {
    // WHEN each entry's poster path is resolved against viz-pages/
    const missing = entries
      .map((e) => posterHref(e))
      .filter(
        (href) =>
          !existsSync(path.join(repo, "viz-pages", href.replaceAll("../", ""), "index.html")),
      );

    // THEN none is missing
    expect(missing).toEqual([]);
  });
});

describe("the index", () => {
  it.concurrent("should show every entry, each linking to its poster", async () => {
    // GIVEN the page with no filter
    const page = await viz.open();

    // THEN one card per catalog entry, each pointing at its poster
    const hrefs = await page.$$eval(".idx-card", (els) =>
      els.map((e) => e.getAttribute("href") ?? ""),
    );
    expect(hrefs.toSorted(byText)).toEqual(entries.map((e) => posterHref(e)).toSorted(byText));
    expect(await page.$eval("#indexCount", (e) => e.textContent)).toContain(
      `All ${entries.length}`,
    );
  });

  it.concurrent("should narrow to what the visitor types, matching name or description", async () => {
    // GIVEN the page
    const page = await viz.open();

    // WHEN the visitor types a word that appears in names and in descriptions
    await page.type("#indexSearch", "handoff");

    // THEN only matching entries remain, and the count says how many of the whole
    const names = await cardNames(page);
    expect(names).toContain("r2-handoff");
    expect(names).toContain("auto-handoff");
    expect(names).not.toContain("viz");
    expect(await page.$eval("#indexCount", (e) => e.textContent)).toBe(
      `${names.length} of ${entries.length}`,
    );
  });

  it.concurrent("should show only tools when the visitor picks Tools, and say so when nothing matches", async () => {
    // GIVEN the page
    const page = await viz.open();

    // WHEN the visitor picks Tools
    await page.click('[data-kind-filter="tool"]');

    // THEN every card is a tool and the button reads as pressed
    const kinds = await page.$$eval(".idx-card .idx-kind", (els) => els.map((e) => e.textContent));
    expect(kinds).toHaveLength(entries.filter((e) => e.kind === "tool").length);
    expect(new Set(kinds)).toEqual(new Set(["tool"]));
    expect(
      await page.$eval('[data-kind-filter="tool"]', (e) => e.getAttribute("aria-pressed")),
    ).toBe("true");

    // WHEN the visitor then types something no tool matches
    await page.type("#indexSearch", "zzzz-no-such-thing");

    // THEN the page says nothing matches rather than showing an empty box
    expect(await cardNames(page)).toEqual([]);
    expect(await page.$eval("#indexCount", (e) => e.textContent)).toContain("Nothing matches");
  });

  it.concurrent("should quote counts in prose that agree with the index", async () => {
    // GIVEN the page
    const page = await viz.open();

    // THEN every inline count equals the catalog's
    const counts = await page.$$eval("[data-count]", (els) =>
      els.map((e) => [
        e instanceof HTMLElement ? (e.dataset["count"] ?? "") : "",
        e.textContent ?? "",
      ]),
    );
    const want = new Map([
      ["skill", entries.filter((e) => e.kind === "skill").length],
      ["tool", entries.filter((e) => e.kind === "tool").length],
      ["all", entries.length],
    ]);
    expect(counts.length).toBeGreaterThan(3);
    for (const [kind, shown] of counts) expect(shown).toBe(String(want.get(kind!)));
  });
});

describe("the route", () => {
  it.concurrent("should step through the stops and show each stop's own page links", async () => {
    // GIVEN the tour on its first stop
    const page = await viz.open();
    const title = async () => {
      const t = await page.$eval("#detailTitle", (e) => e.textContent);
      return t;
    };
    const first = await title();
    expect(await page.$eval("#tourProgress", (e) => e.textContent)).toContain("Stop 1 of 16");

    // WHEN the visitor presses Next
    await page.click("[data-next-stop]");

    // THEN the second stop shows
    expect(await title()).not.toBe(first);
    expect(await page.$eval("#tourProgress", (e) => e.textContent)).toContain("Stop 2 of 16");

    // WHEN the visitor opens the handoffs stop from the map
    await page.click('[data-node-id="handoff"]');

    // THEN its detail links to the posters it is about
    const links = await page.$$eval("#detailLinks a", (els) =>
      els.map((e) => e.getAttribute("href")),
    );
    expect(links).toContain("../tool-auto-handoff/");
    expect(links).toContain("../skill-r2-handoff/");
    expect(links).toContain("../skill-spawn-herdr-tab/");
    expect(links).toContain("../skill-end-session/");
  });

  it.concurrent("should end on the last stop with Next disabled", async () => {
    // GIVEN the tour
    const page = await viz.open();

    // WHEN the visitor opens the last stop
    await page.click('[data-node-id="publish"]');

    // THEN Next is disabled and the progress line says the tour is over
    expect(await page.$eval("[data-next-stop]", (e) => e.hasAttribute("disabled"))).toBe(true);
    expect(await page.$eval("#tourProgress", (e) => e.textContent)).toContain("End of the tour");
  });
});

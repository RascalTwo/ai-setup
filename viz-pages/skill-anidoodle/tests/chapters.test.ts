// The rest of the tour: moving between chapters, and the three places a visitor picks something and the
// page answers with what it picked (a score to hear, a live piece to try, a pipeline step to read).
import { describe, it, expect } from "bun:test";
import { open, goTo, text } from "./helpers.ts";

describe("the chapter strip", () => {
  it.concurrent("should step forward and back with the arrows and show only the current chapter", async () => {
    const { page, on, first } = await viz.given("the tour on its first chapter", async () => {
      const p = await open();
      const current = async () => {
        const titles = await p.$$eval("section.ch.on", (s) => s.map((e) => e.dataset["title"]));
        return titles;
      };
      expect(await text(p, "#pos")).toBe("1 / 9");
      const firstOn = await current();
      expect(firstOn).toHaveLength(1);
      return { page: p, on: current, first: firstOn };
    });

    await viz.when("the visitor presses next", async () => {
      await page.click("#next");
      await page.waitForFunction(() => document.querySelector("#pos")!.textContent === "2 / 9");
    });

    await viz.then(
      "the second chapter shows alone and the strip marks it, and the first as seen",
      async () => {
        const second = await on();
        expect(second).toHaveLength(1);
        expect(second).not.toEqual(first);
        expect(await page.$$eval("button.chap.on", (b) => b.map((e) => e.dataset["i"]))).toEqual([
          "1",
        ]);
        expect(await page.$$eval(".chap.seen", (b) => b.length)).toBe(2);
      },
    );

    await viz.when("the visitor presses back", async () => {
      await page.click("#prev");
      await page.waitForFunction(() => document.querySelector("#pos")!.textContent === "1 / 9");
    });

    await viz.then("the first chapter is back", async () => {
      expect(await on()).toEqual(first);
    });
  });

  it.concurrent("should read the pipeline step the visitor picks, and mark the approval steps", async () => {
    const { page, nodes, firstName } = await viz.given(
      "the pipeline chapter, showing its first step",
      async () => {
        const p = await open();
        const count = await p.$$eval("#pipe .pnode", (g) => g.length);
        expect(count).toBeGreaterThan(3);
        const name = await text(p, "#pipeDetail b");
        return { page: p, nodes: count, firstName: name };
      },
    );

    const seen = await viz.when("the visitor picks each step in turn", async () => {
      const picked: { name: string; gate: boolean }[] = [];
      for (let i = 0; i < nodes; i++) {
        // oxlint-disable-next-line no-await-in-loop -- the steps are clicked in order on one page
        await page.click(`#pipe .pnode[data-i="${i}"] rect`);
        picked.push(
          // oxlint-disable-next-line no-await-in-loop -- each read must follow its own click
          await page.evaluate(() => ({
            name: document.querySelector("#pipeDetail b")!.textContent,
            gate: !!document.querySelector("#pipeDetail .gate"),
          })),
        );
      }
      return picked;
    });

    await viz.then(
      "each shows its own name, one at a time is marked selected, and some (not all) are approval steps",
      async () => {
        expect(seen[0]!.name).toBe(firstName);
        expect(new Set(seen.map((s) => s.name)).size).toBe(nodes);
        expect(await page.$$eval("#pipe .pnode.sel", (g) => g.length)).toBe(1);
        expect(seen.some((s) => s.gate)).toBe(true);
        expect(seen.some((s) => !s.gate)).toBe(true);
      },
    );
  });
});

describe("the music chapter", () => {
  it.concurrent("should show the measured numbers of the piece the visitor plays, and stop it on a second click", async () => {
    const page = await viz.given("the music chapter", async () => open(6));

    await viz.when("the visitor clicks the bells piece", async () =>
      page.click('.pt[data-id="bellsHopeful"] circle'),
    );

    await viz.then("it is marked playing, with what was measured of it", async () => {
      expect(await text(page, "#nowPlaying")).toBe(
        "▶ bellsHopeful (cinematic, hopeful) · measured -16 LUFS · true peak -5.8 dBTP · 1 onsets/s · centroid 1645 Hz · click again to stop",
      );
      expect(await page.$$eval("g.pt.playing", (p) => p.map((e) => e.dataset["id"]))).toEqual([
        "bellsHopeful",
      ]);
    });

    await viz.when("the visitor picks the guitar piece instead", async () =>
      page.click('.pt[data-id="guitarWistful"] circle'),
    );
    await viz.then("only the guitar is playing, and the line names it", async () => {
      expect(await page.$$eval("g.pt.playing", (p) => p.map((e) => e.dataset["id"]))).toEqual([
        "guitarWistful",
      ]);
      expect(await text(page, "#nowPlaying")).toContain("▶ guitarWistful");
    });

    await viz.when("the visitor clicks it again", async () =>
      page.click('.pt[data-id="guitarWistful"] circle'),
    );
    await viz.then("nothing is playing", async () => {
      expect(await page.$$eval(".pt.playing", (p) => p.length)).toBe(0);
    });
  });

  it.concurrent("should stop the music when the visitor leaves the chapter", async () => {
    const page = await viz.given("a piece playing in the music chapter", async () => {
      const p = await open(6);
      await p.click('.pt[data-id="bellsHopeful"] circle');
      expect(await p.$$eval(".pt.playing", (g) => g.length)).toBe(1);
      return p;
    });

    await viz.when("the visitor moves to the next chapter and back", async () => {
      await goTo(page, 7);
      await goTo(page, 6);
    });

    await viz.then("nothing is playing", async () => {
      expect(await page.$$eval(".pt.playing", (p) => p.length)).toBe(0);
    });
  });
});

describe("the interactive chapter", () => {
  it.concurrent("should load the first live piece on arrival and swap to the one the visitor picks", async () => {
    const page = await viz.given("the visitor arrives at the interactive chapter", async () =>
      open(7),
    );

    await viz.when("the chapter loads its first piece");

    await viz.then("the first piece is loaded and described", async () => {
      expect(await page.$eval("#intFrame", (f) => f.getAttribute("src"))).toBe(
        "media/int/mascot-hero.html",
      );
      expect(await text(page, "#intInfo h3")).toBe("Mascot hero");
      expect(await page.$$eval("#intPick .chipbtn.on", (b) => b.map((e) => e.textContent))).toEqual(
        ["Mascot hero"],
      );
    });

    await viz.when("the visitor picks the scroll hero", async () =>
      page.click('#intPick .chipbtn[data-i="1"]'),
    );

    await viz.then("the frame and the description swap, and only that button is on", async () => {
      expect(await page.$eval("#intFrame", (f) => f.getAttribute("src"))).toBe(
        "media/int/scroll-hero.html",
      );
      expect(await text(page, "#intInfo h3")).toBe("Scroll hero");
      expect(await page.$$eval("#intPick .chipbtn.on", (b) => b.map((e) => e.textContent))).toEqual(
        ["Scroll hero"],
      );
    });
  });
});

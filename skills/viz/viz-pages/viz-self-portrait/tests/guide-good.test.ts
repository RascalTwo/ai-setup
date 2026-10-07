// Band 2 of the Guide, "Get Good" (fig-good.ts): the pin-a-comment demo, the forms menu, and the
// posture × listing grid.
import { describe, it, expect } from "bun:test";
import { open, guideReady, reducedMotion } from "./helpers.ts";
import { asPublished, shown } from "./guide-steps.ts";

describe("Point at it", () => {
  it.concurrent("should pin a comment where the reader Alt-clicks the demo bar, and coach a plain click", async () => {
    // GIVEN the published guide (no live feedback widget to take the Alt-click), at "Point at it"
    const page = await open({
      hash: "guide&stop=review",
      before: async (p) => {
        await reducedMotion(p);
        await asPublished(p);
      },
    });
    await guideReady(page);
    expect(await shown(page, "#rev-pin")).toBe(false);

    // WHEN the reader clicks the bar without Alt
    await page.click("#rev-target");
    // THEN the demo says to hold Alt, and pins nothing
    expect(await page.$eval("#rev-hint", (e) => e.textContent)).toBe(
      "hold Alt (Option) and click →",
    );
    expect(await shown(page, "#rev-pin")).toBe(false);

    // WHEN the reader Alt-clicks 30px into the bar
    const bar = (await (await page.$("#rev-target"))!.boundingBox())!;
    const demo = (await (await page.$("#rev-demo"))!.boundingBox())!;
    await page.keyboard.down("Alt");
    await page.mouse.click(bar.x + 30, bar.y + bar.height / 2);
    await page.keyboard.up("Alt");

    // THEN a pin shows exactly where they clicked, and the demo says what happens next
    expect(await shown(page, "#rev-pin")).toBe(true);
    const pin = await page.$eval("#rev-pin", (e) =>
      e instanceof HTMLElement
        ? [Number(e.style.left.replace("px", "")), Number(e.style.top.replace("px", ""))]
        : [Number.NaN, Number.NaN],
    );
    // (within a pixel: the mouse lands on whole pixels, the boxes don't)
    expect(Math.abs(pin[0]! - (bar.x + 30 - demo.x))).toBeLessThan(1);
    expect(Math.abs(pin[1]! - (bar.y + bar.height / 2 - demo.y))).toBeLessThan(1);
    expect(await page.$eval("#rev-hint", (e) => e.textContent)).toBe(
      "pinned — the agent reads it, fixes it, resolves it",
    );
  });
});

describe("Ask for a shape", () => {
  it.concurrent("should light only the forms that suit the content kind the reader picks", async () => {
    // GIVEN the forms menu, showing everything
    const page = await open({ hash: "guide&stop=forms", before: reducedMotion });
    await guideReady(page);
    const lit = async (): Promise<string[]> => {
      const names = await page.$$eval("#forms-grid .fm:not(.off) span", (els) =>
        els.map((e) => e.textContent),
      );
      return names;
    };
    expect(await lit()).toHaveLength(22);

    // WHEN the reader picks "part-to-whole"
    await page.click('#forms-fams .ff[data-f="part"]');
    // THEN only the part-to-whole forms stay lit, and only that kind is picked
    expect(await lit()).toEqual(["treemap", "sunburst", "stacked bar"]);
    expect(await page.$$eval("#forms-fams .ff.on", (bs) => bs.map((b) => b.textContent))).toEqual([
      "part-to-whole",
    ]);
    // (faded, once its transition has run)
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('.fm[data-viz-id="form-bar"]')!).opacity === "0.16",
      { timeout: 5_000 },
    );

    // WHEN the reader picks "explanatory"
    await page.click('#forms-fams .ff[data-f="explain"]');
    // THEN the lit set moves to it
    expect(await lit()).toEqual(["stepped explainer", "timed film"]);

    // WHEN the reader clicks the gap beside the kinds, then picks "everything"
    const fams = (await (await page.$("#forms-fams"))!.boundingBox())!;
    await page.mouse.click(fams.x + fams.width - 1, fams.y + fams.height - 1);
    expect(await lit()).toEqual(["stepped explainer", "timed film"]);
    await page.click('#forms-fams .ff[data-f="all"]');
    // THEN all 22 are lit again
    expect(await lit()).toHaveLength(22);
  });
});

describe("Who can see it", () => {
  const picked = async (page: Awaited<ReturnType<typeof open>>) => {
    const state = await page.evaluate(() => ({
      cell: document.querySelector<HTMLElement>(".pg-cell.on")!.dataset.k,
      meta: document.querySelector("#pg-meta")!.textContent.replaceAll(/\s+/gu, " ").trim(),
      fate: document.querySelector("#pg-fate .pg-ships")!.textContent,
    }));
    return state;
  };
  const centre = async (page: Awaited<ReturnType<typeof open>>, sel: string) => {
    const b = (await (await page.$(sel))!.boundingBox())!;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };

  it.concurrent("should tell the fate of the posture and listing the reader clicks", async () => {
    // GIVEN the grid, on its default: local and unlisted
    const page = await open({ hash: "guide&stop=access", before: reducedMotion });
    await guideReady(page);
    expect(await picked(page)).toEqual({
      cell: "local|unlisted",
      meta: '<meta name="viz:posture" content="local"> <meta name="viz:listed" content="unlisted">',
      fate: "never leaves your machine",
    });
    // THEN the three local-or-shipped marks say which cells ship
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>(".pg-cell")].map(
          (c) => c.dataset.k + " " + c.textContent,
        ),
      ),
    ).toEqual([
      "local|listed ○",
      "private|listed ●",
      "public|listed ●",
      "local|unlisted ○",
      "private|unlisted ●",
      "public|unlisted ●",
    ]);

    // WHEN the reader clicks "private + listed"
    await page.click('.pg-cell[data-k="private|listed"]');
    // THEN that is the picked cell, its two metas are shown, and it ships
    expect(await picked(page)).toMatchObject({ cell: "private|listed", fate: "ships" });
    expect((await picked(page)).meta).toBe(
      '<meta name="viz:posture" content="private"> <meta name="viz:listed" content="listed">',
    );
    expect(await page.$eval("#pg-fate p", (e) => e.textContent)).toStartWith(
      "Encrypted, but it gets a lobby card.",
    );

    // WHEN the reader clicks the "listed →" axis label, which is no cell
    await page.click("#pg-grid .pg-ylab");
    // THEN nothing changes
    expect((await picked(page)).cell).toBe("private|listed");

    // WHEN the reader presses outside the grid and lets go over a cell
    const from = await centre(page, "#pg-meta"),
      to = await centre(page, '.pg-cell[data-k="public|unlisted"]');
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    // THEN that was no click on the grid: nothing changes
    expect((await picked(page)).cell).toBe("private|listed");
  });

  it.concurrent("should follow a drag, not the cell the pointer is let go over", async () => {
    // GIVEN the grid, on local and unlisted (the left edge)
    const page = await open({ hash: "guide&stop=access", before: reducedMotion });
    await guideReady(page);
    const start = await centre(page, '.pg-cell[data-k="local|unlisted"]');
    const grid = (await (await page.$("#pg-grid"))!.boundingBox())!;

    // WHEN the reader drags left, past the edge, then back right to just beside where they started
    const back = { x: start.x + 20, y: start.y };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - grid.width * 0.5, start.y, { steps: 5 });
    await page.mouse.move(back.x, back.y, { steps: 5 });
    await page.mouse.up();

    // THEN the drag carried the pick all the way right — the left edge held it on the way out —
    // though the pointer let go over local
    expect(
      await page.evaluate(
        (p) => document.elementFromPoint(p.x, p.y)!.closest<HTMLElement>(".pg-cell")!.dataset.k,
        back,
      ),
    ).toBe("local|unlisted");
    expect((await picked(page)).cell).toBe("public|unlisted");
  });

  it.concurrent("should move the pick the way the reader drags the grid", async () => {
    // GIVEN the grid, on local and unlisted (bottom left)
    const page = await open({ hash: "guide&stop=access", before: reducedMotion });
    await guideReady(page);
    const start = await centre(page, '.pg-cell[data-k="local|unlisted"]');
    const grid = (await (await page.$("#pg-grid"))!.boundingBox())!;

    // WHEN the reader drags right, across the grid
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + grid.width * 0.7, start.y, { steps: 6 });
    await page.mouse.up();
    // THEN the pick moves right to public, still unlisted
    expect((await picked(page)).cell).toBe("public|unlisted");

    // WHEN the reader drags up, toward the listed row
    const now = await centre(page, '.pg-cell[data-k="public|unlisted"]');
    await page.mouse.move(now.x, now.y);
    await page.mouse.down();
    await page.mouse.move(now.x, now.y - grid.height * 0.7, { steps: 6 });
    await page.mouse.up();
    // THEN the pick moves up to public and listed
    expect(await picked(page)).toMatchObject({ cell: "public|listed", fate: "ships" });
  });
});

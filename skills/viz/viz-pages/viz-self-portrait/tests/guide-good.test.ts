// Band 2 of the Guide, "Get Good" (fig-good.ts): the pointer to the feedback widget, the forms menu, and the
// posture × listing grid.
import { describe, it, expect } from "bun:test";
import { open, guideReady, reducedMotion } from "./helpers.ts";

describe("Point at it", () => {
  it.concurrent("should open the page's own feedback widget where the reader Alt-clicks the card", async () => {
    const page = await viz.given('the guide at "Point at it"', async () => {
      const p = await open({ hash: "guide&stop=review", before: reducedMotion });
      await guideReady(p);
      expect(await p.$('textarea[placeholder="Provide feedback here"]')).toBeNull();
      return p;
    });

    await viz.when("the reader Alt-clicks the line that invites them to", async () => {
      const box = (await (await page.$("::-p-text(Alt/Option-click this card)"))!.boundingBox())!;
      await page.keyboard.down("Alt");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.keyboard.up("Alt");
    });
    await viz.then("the real widget offers a line pinned there", async () => {
      expect(await page.$('textarea[placeholder="Provide feedback here"]')).not.toBeNull();
    });
  });
});

describe("Ask for a shape", () => {
  it.concurrent("should light only the forms that suit the content kind the reader picks", async () => {
    const { page, lit } = await viz.given("the forms menu, showing everything", async () => {
      const p = await open({ hash: "guide&stop=forms", before: reducedMotion });
      await guideReady(p);
      const litForms = async (): Promise<string[]> => {
        const names = await p.$$eval("#forms-grid .fm:not(.off) span", (els) =>
          els.map((e) => e.textContent),
        );
        return names;
      };
      expect(await litForms()).toHaveLength(22);
      return { page: p, lit: litForms };
    });

    await viz.when('the reader picks "part-to-whole"', async () =>
      page.click('#forms-fams .ff[data-f="part"]'),
    );
    await viz.then(
      "only the part-to-whole forms stay lit, and only that kind is picked",
      async () => {
        expect(await lit()).toEqual(["treemap", "sunburst", "stacked bar"]);
        expect(
          await page.$$eval("#forms-fams .ff.on", (bs) => bs.map((b) => b.textContent)),
        ).toEqual(["part-to-whole"]);
        // (faded, once its transition has run)
        await page.waitForFunction(
          () =>
            getComputedStyle(document.querySelector('.fm[data-viz-id="form-bar"]')!).opacity ===
            "0.16",
          { timeout: 5_000 },
        );
      },
    );

    await viz.when('the reader picks "explanatory"', async () =>
      page.click('#forms-fams .ff[data-f="explain"]'),
    );
    await viz.then("the lit set moves to it", async () => {
      expect(await lit()).toEqual(["stepped explainer", "timed film"]);
    });

    await viz.when(
      'the reader clicks the gap beside the kinds, then picks "everything"',
      async () => {
        const fams = (await (await page.$("#forms-fams"))!.boundingBox())!;
        await page.mouse.click(fams.x + fams.width - 1, fams.y + fams.height - 1);
        expect(await lit()).toEqual(["stepped explainer", "timed film"]);
        await page.click('#forms-fams .ff[data-f="all"]');
      },
    );
    await viz.then("all 22 are lit again", async () => {
      expect(await lit()).toHaveLength(22);
    });
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
    const link = await viz.given("the grid, on its default: local and unlisted", () => ({
      hash: "guide&stop=access",
      before: reducedMotion,
    }));

    const page = await viz.when("someone opens it", async () => {
      const p = await open(link);
      await guideReady(p);
      expect(await picked(p)).toEqual({
        cell: "local|unlisted",
        meta: '<meta name="viz:posture" content="local"> <meta name="viz:listed" content="unlisted">',
        fate: "never leaves your machine",
      });
      return p;
    });
    await viz.then("the three local-or-shipped marks say which cells ship", async () => {
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
    });

    await viz.when('the reader clicks "private + listed"', async () =>
      page.click('.pg-cell[data-k="private|listed"]'),
    );
    await viz.then("that is the picked cell, its two metas are shown, and it ships", async () => {
      expect(await picked(page)).toMatchObject({ cell: "private|listed", fate: "ships" });
      expect((await picked(page)).meta).toBe(
        '<meta name="viz:posture" content="private"> <meta name="viz:listed" content="listed">',
      );
      expect(await page.$eval("#pg-fate p", (e) => e.textContent)).toStartWith(
        "Encrypted, but it gets a lobby card.",
      );
    });

    await viz.when('the reader clicks the "listed →" axis label, which is no cell', async () =>
      page.click("#pg-grid .pg-ylab"),
    );
    await viz.then("nothing changes", async () => {
      expect((await picked(page)).cell).toBe("private|listed");
    });

    await viz.when("the reader presses outside the grid and lets go over a cell", async () => {
      const from = await centre(page, "#pg-meta"),
        to = await centre(page, '.pg-cell[data-k="public|unlisted"]');
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 4 });
      await page.mouse.up();
    });
    await viz.then("that was no click on the grid: nothing changes", async () => {
      expect((await picked(page)).cell).toBe("private|listed");
    });
  });

  it.concurrent("should follow a drag, not the cell the pointer is let go over", async () => {
    const { page, start, grid } = await viz.given(
      "the grid, on local and unlisted (the left edge)",
      async () => {
        const p = await open({ hash: "guide&stop=access", before: reducedMotion });
        await guideReady(p);
        const from = await centre(p, '.pg-cell[data-k="local|unlisted"]');
        const box = (await (await p.$("#pg-grid"))!.boundingBox())!;
        return { page: p, start: from, grid: box };
      },
    );

    const back = await viz.when(
      "the reader drags left, past the edge, then back right to just beside where they started",
      async () => {
        const to = { x: start.x + 20, y: start.y };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(start.x - grid.width * 0.5, start.y, { steps: 5 });
        await page.mouse.move(to.x, to.y, { steps: 5 });
        await page.mouse.up();
        return to;
      },
    );

    await viz.then(
      "the drag carried the pick all the way right — the left edge held it on the way out — though the pointer let go over local",
      async () => {
        expect(
          await page.evaluate(
            (p) => document.elementFromPoint(p.x, p.y)!.closest<HTMLElement>(".pg-cell")!.dataset.k,
            back,
          ),
        ).toBe("local|unlisted");
        expect((await picked(page)).cell).toBe("public|unlisted");
      },
    );
  });

  it.concurrent("should move the pick the way the reader drags the grid", async () => {
    const { page, start, grid } = await viz.given(
      "the grid, on local and unlisted (bottom left)",
      async () => {
        const p = await open({ hash: "guide&stop=access", before: reducedMotion });
        await guideReady(p);
        const from = await centre(p, '.pg-cell[data-k="local|unlisted"]');
        const box = (await (await p.$("#pg-grid"))!.boundingBox())!;
        return { page: p, start: from, grid: box };
      },
    );

    await viz.when("the reader drags right, across the grid", async () => {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + grid.width * 0.7, start.y, { steps: 6 });
      await page.mouse.up();
    });
    await viz.then("the pick moves right to public, still unlisted", async () => {
      expect((await picked(page)).cell).toBe("public|unlisted");
    });

    await viz.when("the reader drags up, toward the listed row", async () => {
      const now = await centre(page, '.pg-cell[data-k="public|unlisted"]');
      await page.mouse.move(now.x, now.y);
      await page.mouse.down();
      await page.mouse.move(now.x, now.y - grid.height * 0.7, { steps: 6 });
      await page.mouse.up();
    });
    await viz.then("the pick moves up to public and listed", async () => {
      expect(await picked(page)).toMatchObject({ cell: "public|listed", fate: "ships" });
    });
  });
});

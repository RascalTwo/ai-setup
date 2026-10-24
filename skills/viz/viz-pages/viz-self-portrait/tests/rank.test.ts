// The Rank tab (rank.ts): pairwise answers become an order, every answer is saved against the
// dimension being answered, approval rides along on the cards, and dimensions are made, renamed,
// switched and deleted from the picker.
import { describe, it, expect } from "bun:test";
import {
  open,
  rankReady,
  rankPair,
  nthCall,
  calls,
  fakes,
  ok,
  fail,
  netError,
  rankingView,
} from "./helpers.ts";
import {
  three,
  twoDims,
  dialogs,
  nthDialog,
  heldRead,
  pairShown,
  rankView,
  rankOrder,
  rankDone,
  savedReads,
} from "./steps-rank.ts";

const settle = async (): Promise<void> => {
  await new Promise<void>((r) => {
    setTimeout(r, 300);
  });
};
/** Waits until `done()` holds, polling. */
const waitUntil = async (done: () => boolean): Promise<void> => {
  while (!done()) {
    // oxlint-disable-next-line no-await-in-loop -- polling: each check must wait for the page and stand-in server to move on
    await new Promise<void>((r) => {
      setTimeout(r, 25);
    });
  }
};
// The pair Rank asks about first, over the three-viz corpus.
const FIRST = ["Orbit deck", "Tide clock"];

describe("the Rank tab: answering", () => {
  it.concurrent("should turn the user's answers into a finished order, saving after every answer", async () => {
    const page = await viz.given(
      "Rank over three vizzes, with a working stand-in for the rankings file",
      async () => {
        const p = await open({
          hash: "rank",
          lib: three,
          stubs: { "POST ranking": fakes.ranking },
        });
        await rankReady(p);
        expect(await rankView(p)).toMatchObject({
          question: "Which of these two wins on “Best”?",
          saved: "ready",
          answered: "0",
        });
        expect(await p.$eval("#rk-budget", (e) => e.textContent)).toBe("3");
        return p;
      },
    );

    await viz.when("the user prefers the left card, then the right one", async () => {
      expect(await rankPair(page)).toEqual(FIRST);
      await page.keyboard.press("ArrowLeft");
      await nthCall(page, "POST ranking", 1);
      await pairShown(page, ["River poster", "Tide clock"]);
      await page.click("#rk-b");
    });

    await viz.then("the sort is done, in the order those answers imply", async () => {
      await rankDone(page);
      expect(await page.$eval("#rank-done", (e) => e.textContent)).toContain("Done — 3 ranked.");
      expect(await rankOrder(page)).toEqual(["Orbit deck", "Tide clock", "River poster"]);
    });
    await viz.then(
      "the counters agree: two answered, all three placed, nothing left to answer",
      async () => {
        expect(
          await page.$$eval("#rk-answered, #rk-placed, #rk-total, #rk-budget", (els) =>
            els.map((e) => e.textContent),
          ),
        ).toEqual(["2", "3", "3", "0"]);
      },
    );
    await viz.then(
      "both answers reached the rankings file, against the dimension being answered",
      async () => {
        const last = await nthCall(page, "POST ranking", 2);
        expect(last.body.list).toBe("best");
        expect(page.api.lib.ranking.lists["best"]!.log).toHaveLength(2);
        await savedReads(page, "saved");
      },
    );
  });

  it.concurrent("should answer from the keyboard: → prefers the right card, = calls it even, other keys cast nothing", async () => {
    const page = await viz.given("Rank over three vizzes", async () => {
      const p = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
      await rankReady(p);
      return p;
    });

    await viz.when("the user presses a key that means nothing to Rank", async () => {
      await page.keyboard.press("x");
      await settle();
    });

    await viz.then("nothing is answered: the same pair, no save", async () => {
      expect(await rankPair(page)).toEqual(FIRST);
      expect(calls(page, "POST ranking")).toHaveLength(0);
    });

    await viz.when(
      "the user prefers the right card (Tide clock), then calls the next pair even",
      async () => {
        await page.keyboard.press("ArrowRight");
        await nthCall(page, "POST ranking", 1);
        await pairShown(page, ["River poster", "Orbit deck"]);
        await page.keyboard.press("=");
      },
    );

    await viz.then("the order has Tide clock first and the tied pair after it", async () => {
      await rankDone(page);
      expect(await rankOrder(page)).toEqual(["Tide clock", "Orbit deck", "River poster"]);
    });
    await viz.then("both answers were saved", async () => {
      expect((await nthCall(page, "POST ranking", 2)).body.log).toHaveLength(2);
    });

    await viz.when("the user presses an answer key after the sort is done", async () => {
      await page.keyboard.press("ArrowLeft");
      await settle();
    });

    await viz.then("it casts nothing", async () => {
      expect(calls(page, "POST ranking")).toHaveLength(2);
      expect(await rankView(page)).toMatchObject({ answered: "2" });
    });
  });

  it.concurrent("should answer by clicking the left card, and treat = and skip as an even call", async () => {
    const page = await viz.given("Rank over three vizzes", async () => {
      const p = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
      await rankReady(p);
      return p;
    });

    await viz.when("the user clicks the left card (Orbit deck), then the = button", async () => {
      await page.click("#rk-a");
      await nthCall(page, "POST ranking", 1);
      await pairShown(page, ["River poster", "Tide clock"]);
      await page.click("#rk-eq");
    });

    await viz.then("Orbit deck leads, with the even pair after it", async () => {
      await rankDone(page);
      expect(await rankOrder(page)).toEqual(["Orbit deck", "Tide clock", "River poster"]);
      expect((await nthCall(page, "POST ranking", 2)).body.log).toHaveLength(2);
    });

    const again = await viz.given("a fresh start on the same corpus", async () => {
      const p = await open({
        hash: "rank",
        lib: three,
        stubs: { "POST ranking": fakes.ranking },
      });
      await rankReady(p);
      return p;
    });

    await viz.when("the user clicks the left card, then skip", async () => {
      await again.click("#rk-a");
      await nthCall(again, "POST ranking", 1);
      await again.click("#rk-skip");
    });

    await viz.then("skip was saved as an even call, exactly as = was", async () => {
      await rankDone(again);
      expect((await nthCall(again, "POST ranking", 2)).body.log).toEqual(
        page.api.lib.ranking.lists["best"]!.log,
      );
    });
  });

  it.concurrent("should resume where the user left off after a reload", async () => {
    const page = await viz.given("one answer given and saved", async () => {
      const p = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
      await rankReady(p);
      await p.keyboard.press("ArrowLeft");
      await nthCall(p, "POST ranking", 1);
      await savedReads(p, "saved");
      return p;
    });

    await viz.when("the user reloads the page", async () => {
      await page.reload();
      await rankReady(page);
    });

    await viz.then(
      "Rank says it resumed, counts the answer, and asks the second question, not the first",
      async () => {
        expect(await rankView(page)).toMatchObject({
          saved: "resumed · 1 answered",
          answered: "1",
          dimension: "Best (1)",
        });
        await pairShown(page, ["River poster", "Tide clock"]);
      },
    );
  });

  it.concurrent("should not count a key pressed while Rank is not the tab showing", async () => {
    const page = await viz.given(
      "Rank booted, then the user switches to the Library tab",
      async () => {
        const p = await open({
          hash: "rank",
          lib: three,
          stubs: { "POST ranking": fakes.ranking },
        });
        await rankReady(p);
        await p.click("#tabbtn-dashboard");
        return p;
      },
    );

    await viz.when("the user presses ← there", async () => {
      await page.keyboard.press("ArrowLeft");
      await settle();
    });

    await viz.then(
      "no answer was cast, and Rank asks the same pair when the user comes back",
      async () => {
        expect(calls(page, "POST ranking")).toHaveLength(0);
        await page.click("#tabbtn-rank");
        expect(await rankPair(page)).toEqual(FIRST);
        expect(await rankView(page)).toMatchObject({ answered: "0" });
      },
    );
    await viz.then("coming back did not read the corpus again", () => {
      expect(calls(page, "GET ranking")).toHaveLength(1);
    });
  });

  it.concurrent("should start Rank when the address changes to #rank, and not before", async () => {
    const page = await viz.given("the self-portrait on its guide", async () =>
      open({ lib: three }),
    );

    await viz.when("the user goes to another tab by address", async () => {
      await page.evaluate(() => {
        location.hash = "dashboard";
      });
      await settle();
    });

    await viz.then("it does not read the corpus", () => {
      expect(calls(page, "GET ranking")).toHaveLength(0);
    });

    await viz.when("the user changes the address to #rank", async () => {
      await page.evaluate(() => {
        location.hash = "rank";
      });
    });

    await viz.then("Rank loads and asks its first pair", async () => {
      await rankReady(page);
      expect(await rankPair(page)).toEqual(FIRST);
    });
  });
});

describe("the Rank tab: when the server fails", () => {
  it.concurrent("should say SAVE FAILED when the server refuses an answer", async () => {
    const page = await viz.given("a rankings file that refuses every write", async () => {
      const p = await open({
        hash: "rank",
        lib: three,
        stubs: { "POST ranking": fail('no dimension "best"', 404) },
      });
      await rankReady(p);
      return p;
    });

    await viz.when("the user answers", async () => page.keyboard.press("ArrowLeft"));

    await viz.then("the saved line says the write failed, in the danger colour", async () => {
      await savedReads(page, "SAVE FAILED");
      expect(
        await page.$eval("#rk-saved", (e) => (e instanceof HTMLElement ? e.style.color : null)),
      ).toBe("var(--danger)");
    });
  });

  it.concurrent("should tell the user to stop when the server cannot be reached to save", async () => {
    const page = await viz.given(
      "Rank loaded, and a server that is gone by the time the user answers",
      async () => {
        const p = await open({
          hash: "rank",
          lib: three,
          stubs: { "POST ranking": () => netError() },
        });
        await rankReady(p);
        return p;
      },
    );

    await viz.when("the user answers", async () => page.keyboard.press("ArrowLeft"));

    await viz.then("the saved line tells them to stop", async () => {
      await savedReads(page, "SAVE FAILED — stop and check the server");
      expect(
        await page.$eval("#rk-saved", (e) => (e instanceof HTMLElement ? e.style.color : null)),
      ).toBe("var(--danger)");
    });
  });

  it.concurrent("should say the server is unreachable, and load once it is back and the tab is opened again", async () => {
    let down = true;
    const page = await viz.given("the self-portrait on its guide, and the server gone", async () =>
      open({
        lib: three,
        stubs: { "GET ranking": (_, l) => (down ? netError() : rankingView(l)) },
      }),
    );

    await viz.when("the user opens the Rank tab", async () => page.click("#tabbtn-rank"));

    await viz.then("Rank says it needs the server", async () => {
      await page.waitForFunction(
        () =>
          document.querySelector("#rank-boot")!.textContent ===
          "The local server is not reachable — Rank needs it.",
      );
      expect(
        await page.$eval("#rank-main", (e) => (e instanceof HTMLElement ? e.hidden : null)),
      ).toBe(true);
    });

    await viz.when("the server is back and the user opens the tab again", async () => {
      down = false;
      await page.click("#tabbtn-dashboard");
      await page.click("#tabbtn-rank");
    });

    await viz.then("Rank loads and asks its first pair", async () => {
      await rankReady(page);
      expect(await rankPair(page)).toEqual(FIRST);
    });
  });
});

describe("the Rank tab: approving", () => {
  it.concurrent("should approve a viz from its card without casting a vote", async () => {
    const page = await viz.given(
      "Rank, with api/update standing in for the CLI's approve",
      async () => {
        const p = await open({
          hash: "rank",
          lib: three,
          stubs: { "POST update": ok("approved") },
        });
        await rankReady(p);
        expect(await rankPair(p)).toEqual(FIRST);
        return p;
      },
    );

    await viz.when(
      `the user clicks the left card's approval button ("changed since approval" for Orbit deck)`,
      async () => {
        expect(await page.$eval("#rk-a .rk-tri", (e) => e.textContent)).toBe(
          "⚠ changed since approval",
        );
        await page.click("#rk-a .rk-tri");
      },
    );

    await viz.then("that viz is approved through api/update", async () => {
      expect((await nthCall(page, "POST update")).body).toEqual({
        id: ".agents/state/viz/orbit-deck",
        approved: "true",
      });
      await page.waitForFunction(
        () => document.querySelector("#rk-a .rk-tri")!.textContent === "✓ approved",
      );
    });
    await viz.then(
      "no answer was recorded: the same pair is still being asked, nothing saved",
      async () => {
        expect(await rankPair(page)).toEqual(FIRST);
        expect(await page.$eval("#rk-answered", (e) => e.textContent)).toBe("0");
        expect(calls(page, "POST ranking")).toHaveLength(0);
      },
    );
  });

  it.concurrent("should approve every unapproved viz in the pair with t", async () => {
    const page = await viz.given(
      "a pair of one changed-since-approval viz (Orbit deck) and one approved (Tide clock)",
      async () => {
        const p = await open({
          hash: "rank",
          lib: three,
          stubs: { "POST update": ok("approved"), "POST ranking": fakes.ranking },
        });
        await rankReady(p);
        expect(await p.$eval("#rk-b .rk-tri", (e) => e.textContent)).toBe("✓ approved");
        return p;
      },
    );

    await viz.when("the user presses t", async () => page.keyboard.press("t"));

    await viz.then("only Orbit deck is approved, and its card says so", async () => {
      expect((await nthCall(page, "POST update")).body).toEqual({
        id: ".agents/state/viz/orbit-deck",
        approved: "true",
      });
      await page.waitForFunction(
        () => document.querySelector("#rk-a .rk-tri")!.textContent === "✓ approved",
      );
    });

    await viz.when("the user presses t again", async () => {
      await page.keyboard.press("t");
      await settle();
    });

    await viz.then("there is nothing left to approve: no second call", () => {
      expect(calls(page, "POST update")).toHaveLength(1);
    });
    await viz.then("the approval carries to the next pair Orbit deck is in", async () => {
      await page.keyboard.press("ArrowRight");
      await pairShown(page, ["River poster", "Orbit deck"]);
      expect(await page.$eval("#rk-b .rk-tri", (e) => e.textContent)).toBe("✓ approved");
    });
  });

  it.concurrent("should say failed on the button when the approval is refused, and let the user retry", async () => {
    const page = await viz.given("an approve that the CLI refuses", async () => {
      const p = await open({
        hash: "rank",
        lib: three,
        stubs: { "POST update": fail("viz check failed") },
      });
      await rankReady(p);
      return p;
    });

    await viz.when("the user clicks approve on the left card", async () =>
      page.click("#rk-a .rk-tri"),
    );

    await viz.then(
      "the button says failed, stays unapproved, and can be clicked again",
      async () => {
        await page.waitForFunction(
          () => document.querySelector("#rk-a .rk-tri")!.textContent === "failed",
        );
        expect(
          await page.$eval("#rk-a .rk-tri", (e) =>
            e instanceof HTMLButtonElement ? [e.disabled, e.classList.contains("on")] : [],
          ),
        ).toEqual([false, false]);
        await page.click("#rk-a .rk-tri");
        await nthCall(page, "POST update", 2);
      },
    );
  });
});

describe("the Rank tab: dimensions", () => {
  it.concurrent("should switch dimensions, restarting the sort and saving answers against the new one", async () => {
    const page = await viz.given('two dimensions, one answer given on "Best"', async () => {
      const p = await open({
        hash: "rank",
        lib: twoDims,
        stubs: { "POST ranking": fakes.ranking },
      });
      await rankReady(p);
      expect(await rankView(p)).toMatchObject({
        dimensions: ["Best (0)", "Best for a client demo (0)"],
        dimension: "Best (0)",
        hint: "2 dimensions — each keeps its own answers",
      });
      await p.keyboard.press("ArrowLeft");
      await nthCall(p, "POST ranking", 1);
      return p;
    });

    await viz.when("the user picks the other dimension", async () =>
      page.select("#rk-list", "demo"),
    );

    await viz.then(
      "the server is told, and Rank asks the first pair again, on the new dimension",
      async () => {
        expect((await nthCall(page, "POST ranking", 2)).body).toEqual({
          action: "select",
          list: "demo",
        });
        await page.waitForFunction(() =>
          document.querySelector("#rk-question")!.textContent.includes("client demo"),
        );
        expect(await rankView(page)).toMatchObject({
          question: "Which of these two wins on “Best for a client demo”?",
          answered: "0",
          saved: "ready",
          dimensions: ["Best (1)", "Best for a client demo (0)"],
          dimension: "Best for a client demo (0)",
        });
        await pairShown(page, FIRST);
      },
    );

    await viz.when("the user answers there", async () => page.keyboard.press("ArrowRight"));

    await viz.then(
      'that answer is saved to the new dimension, and "Best" keeps its one answer',
      async () => {
        expect((await nthCall(page, "POST ranking", 3)).body.list).toBe("demo");
        expect(page.api.lib.ranking.lists["demo"]!.log).toHaveLength(1);
        expect(page.api.lib.ranking.lists["best"]!.log).toHaveLength(1);
      },
    );
  });

  it.concurrent("should add a dimension the user names, and do nothing when they cancel or leave it blank", async () => {
    const { page, seen } = await viz.given(
      "one dimension, and a user who cancels, then types spaces, then a name",
      async () => {
        const p = await open({
          hash: "rank",
          lib: three,
          stubs: { "POST ranking": fakes.ranking },
        });
        const shown = dialogs(p, [null, "   ", "  Most reusable  "]);
        await rankReady(p);
        expect(await rankView(p)).toMatchObject({
          hint: "add a dimension to rank the same vizzes on something else",
        });
        return { page: p, seen: shown };
      },
    );

    await viz.when(
      'the user clicks "+ new dimension" and cancels, then again and types only spaces',
      async () => {
        await page.click("#rk-newdim");
        await nthDialog(seen, 1);
        await page.click("#rk-newdim");
        await nthDialog(seen, 2);
        await settle();
      },
    );

    await viz.then("nothing is created", () => {
      expect(calls(page, "POST ranking")).toHaveLength(0);
      expect(seen[0]!.message).toBe(
        "Rank these vizzes on what?\n\ne.g. Best · Most reusable · Best for a client demo",
      );
    });

    await viz.when("the user clicks it again and names the dimension", async () =>
      page.click("#rk-newdim"),
    );

    await viz.then(
      "the trimmed name is created and becomes the dimension being answered",
      async () => {
        expect((await nthCall(page, "POST ranking", 1)).body).toEqual({
          action: "new",
          name: "Most reusable",
        });
        await page.waitForFunction(() =>
          document.querySelector("#rk-question")!.textContent.includes("Most reusable"),
        );
        expect(await rankView(page)).toMatchObject({
          dimensions: ["Best (0)", "Most reusable (0)"],
          dimension: "Most reusable (0)",
          hint: "2 dimensions — each keeps its own answers",
        });
      },
    );
  });

  it.concurrent("should show the server's reason when a new dimension's name is taken", async () => {
    const { page, seen } = await viz.given(
      "two dimensions, and a user who names a new one like an existing one",
      async () => {
        const p = await open({
          hash: "rank",
          lib: twoDims,
          stubs: { "POST ranking": fakes.ranking },
        });
        const shown = dialogs(p, ["Best"]);
        await rankReady(p);
        return { page: p, seen: shown };
      },
    );

    await viz.when("the user adds it", async () => page.click("#rk-newdim"));

    await viz.then(
      "an alert gives the server's reason, and the dimensions are unchanged",
      async () => {
        await nthDialog(seen, 2);
        expect(seen[1]).toMatchObject({ type: "alert", message: '"Best" already exists' });
        expect(await rankView(page)).toMatchObject({
          dimensions: ["Best (0)", "Best for a client demo (0)"],
          dimension: "Best (0)",
        });
      },
    );
  });

  it.concurrent("should rename the dimension shown, offering its current name, and keep its answers", async () => {
    const { page, seen } = await viz.given(
      '"Best" with one answer, and a user who cancels, types spaces, keeps the name, then renames',
      async () => {
        const p = await open({
          hash: "rank",
          lib: three,
          stubs: { "POST ranking": fakes.ranking },
        });
        const shown = dialogs(p, [null, "  ", "Best", " Most striking "]);
        await rankReady(p);
        await p.keyboard.press("ArrowLeft");
        await nthCall(p, "POST ranking", 1);
        return { page: p, seen: shown };
      },
    );

    await viz.when(
      "the user clicks rename and cancels, clears it, then leaves the name as it was",
      async () => {
        for (let n = 1; n <= 3; n++) {
          // oxlint-disable-next-line no-await-in-loop -- sequential: each rename click must raise its dialog before the next click
          await page.click("#rk-renamedim");
          // oxlint-disable-next-line no-await-in-loop -- sequential: each rename click must raise its dialog before the next click
          await nthDialog(seen, n);
        }
        await settle();
      },
    );

    await viz.then("the prompt offered the current name, and nothing was renamed", () => {
      expect(seen[0]).toMatchObject({
        type: "prompt",
        message: "Rename this dimension to what?",
        value: "Best",
      });
      expect(calls(page, "POST ranking")).toHaveLength(1);
    });

    await viz.when("the user renames it", async () => page.click("#rk-renamedim"));

    await viz.then(
      "the trimmed name is saved against the same dimension, and its answer survives",
      async () => {
        expect((await nthCall(page, "POST ranking", 2)).body).toEqual({
          action: "rename",
          list: "best",
          name: "Most striking",
        });
        await page.waitForFunction(() =>
          document.querySelector("#rk-question")!.textContent.includes("Most striking"),
        );
        expect(await rankView(page)).toMatchObject({
          dimension: "Most striking (1)",
          saved: "resumed · 1 answered",
          answered: "1",
        });
      },
    );
  });

  it.concurrent("should show the server's reason when a rename clashes with another dimension", async () => {
    const { page, seen } = await viz.given(
      'two dimensions, and a user who renames "Best" to the other\'s name',
      async () => {
        const p = await open({
          hash: "rank",
          lib: twoDims,
          stubs: { "POST ranking": fakes.ranking },
        });
        const shown = dialogs(p, ["best for a CLIENT demo"]);
        await rankReady(p);
        return { page: p, seen: shown };
      },
    );

    await viz.when("the user renames it", async () => page.click("#rk-renamedim"));

    await viz.then("an alert gives the server's reason, and nothing changes", async () => {
      await nthDialog(seen, 2);
      expect(seen[1]).toMatchObject({
        type: "alert",
        message: '"best for a CLIENT demo" is already taken',
      });
      expect(page.api.lib.ranking.lists["best"]!.name).toBe("Best");
    });
  });

  it.concurrent("should name what a delete throws away before deleting, and not delete when cancelled", async () => {
    const { page, seen } = await viz.given(
      '"Best" with two answers, beside an empty second dimension',
      async () => {
        const p = await open({
          hash: "rank",
          lib: twoDims,
          stubs: { "POST ranking": fakes.ranking },
        });
        const shown = dialogs(p, [false, true]);
        await rankReady(p);
        await p.keyboard.press("ArrowLeft");
        await nthCall(p, "POST ranking", 1);
        await p.keyboard.press("ArrowLeft");
        await nthCall(p, "POST ranking", 2);
        return { page: p, seen: shown };
      },
    );

    await viz.when("the user clicks delete and cancels", async () => {
      await page.click("#rk-deldim");
      await nthDialog(seen, 1);
      await settle();
    });

    await viz.then(
      "the confirm named the dimension and its answer count, and nothing was deleted",
      () => {
        expect(seen[0]!.message).toBe(
          'Delete "Best" and its 2 answers?\n\nThat judgment is not recoverable from the UI. ' +
            "rankings.json is git-tracked in the central library, so `git checkout` there can still bring it back.",
        );
        expect(calls(page, "POST ranking")).toHaveLength(2);
      },
    );

    await viz.when("the user deletes it", async () => page.click("#rk-deldim"));

    await viz.then("it is deleted, and Rank moves to the dimension that is left", async () => {
      expect((await nthCall(page, "POST ranking", 3)).body).toEqual({
        action: "delete",
        list: "best",
      });
      await page.waitForFunction(() =>
        document.querySelector("#rk-question")!.textContent.includes("client demo"),
      );
      expect(await rankView(page)).toMatchObject({
        dimensions: ["Best for a client demo (0)"],
        hint: "add a dimension to rank the same vizzes on something else",
      });
    });
  });

  it.concurrent("should say one answer, not one answers, and say when there are none", async () => {
    const { page, seen } = await viz.given(
      '"Best" with one answer, beside an empty second dimension',
      async () => {
        const p = await open({
          hash: "rank",
          lib: twoDims,
          stubs: { "POST ranking": fakes.ranking },
        });
        const shown = dialogs(p, [null, true]);
        await rankReady(p);
        await p.keyboard.press("ArrowLeft");
        await nthCall(p, "POST ranking", 1);
        return { page: p, seen: shown };
      },
    );

    await viz.when('the user clicks delete on "Best"', async () => {
      await page.click("#rk-deldim");
      await nthDialog(seen, 1);
    });

    await viz.then("the confirm counts one answer", () => {
      expect(seen[0]!.message).toStartWith('Delete "Best" and its 1 answer?\n\n');
    });

    await viz.when("the user switches to the empty dimension and deletes it", async () => {
      await page.select("#rk-list", "demo");
      await page.waitForFunction(() =>
        document.querySelector("#rk-question")!.textContent.includes("client demo"),
      );
      await page.click("#rk-deldim");
    });

    await viz.then("the confirm says it has no answers, and it goes", async () => {
      await nthDialog(seen, 2);
      expect(seen[1]!.message).toBe('Delete "Best for a client demo"? It has no answers yet.');
      expect((await nthCall(page, "POST ranking", 3)).body).toEqual({
        action: "delete",
        list: "demo",
      });
      await page.waitForFunction(() =>
        document.querySelector("#rk-question")!.textContent.includes("“Best”"),
      );
    });
  });

  it.concurrent("should refuse to delete the only dimension, with the server's reason", async () => {
    const { page, seen } = await viz.given(
      "a single dimension, and a user who confirms its delete",
      async () => {
        const p = await open({
          hash: "rank",
          lib: three,
          stubs: { "POST ranking": fakes.ranking },
        });
        const shown = dialogs(p, [true]);
        await rankReady(p);
        return { page: p, seen: shown };
      },
    );

    await viz.when("the user deletes it", async () => page.click("#rk-deldim"));

    await viz.then("an alert gives the server's reason, and it is still there", async () => {
      await nthDialog(seen, 2);
      expect(seen[1]).toMatchObject({
        type: "alert",
        message: "that is the only dimension — rename it or add another first",
      });
      expect(page.api.lib.ranking.lists["best"]).toBeDefined();
    });
  });

  for (const button of ["rename", "delete"])
    it.concurrent(`should say so on ${button}, and redraw, when the dimension was deleted in another window`, async () => {
      const { page, seen } = await viz.given(
        'Rank on "Best for a client demo", which another window then deletes',
        async () => {
          const p = await open({
            hash: "rank",
            lib: (l) => {
              twoDims(l);
              l.ranking.current = "demo";
            },
            stubs: { "POST ranking": fakes.ranking },
          });
          const shown = dialogs(p, ["Renamed", true]);
          await rankReady(p);
          delete p.api.lib.ranking.lists["demo"];
          p.api.lib.ranking.current = "best";
          return { page: p, seen: shown };
        },
      );

      await viz.when("the user clicks rename or delete", async () =>
        page.click(button === "rename" ? "#rk-renamedim" : "#rk-deldim"),
      );

      await viz.then(
        "an alert says the dimension is gone, rather than a prompt or confirm about it",
        async () => {
          await nthDialog(seen, 1);
          expect(seen).toEqual([
            {
              type: "alert",
              message:
                "That dimension no longer exists — it was deleted in another window. Showing what is left.",
              value: "",
            },
          ]);
        },
      );
      await viz.then("Rank shows what is left, and nothing was written", async () => {
        await page.waitForFunction(() =>
          document.querySelector("#rk-question")!.textContent.includes("“Best”"),
        );
        expect(await rankView(page)).toMatchObject({
          dimensions: ["Best (0)"],
          dimension: "Best (0)",
        });
        expect(calls(page, "POST ranking")).toHaveLength(0);
      });
    });
});

describe("the Rank tab: a switch while the server is slow", () => {
  it.concurrent("should show the dimension switched to last when an earlier switch's read comes back late", async () => {
    const { page, slow } = await viz.given(
      "two dimensions, and a server slow to answer the read after the first switch",
      async () => {
        const held = heldRead(2);
        const p = await open({
          hash: "rank",
          lib: twoDims,
          stubs: { "POST ranking": fakes.ranking, "GET ranking": held.stub },
        });
        await rankReady(p);
        return { page: p, slow: held };
      },
    );

    await viz.when(
      'the user switches to the other dimension and, while that loads, back to "Best"',
      async () => {
        await page.select("#rk-list", "demo");
        await waitUntil(() => slow.reads() >= 2);
        await page.select("#rk-list", "best");
        await nthCall(page, "GET ranking", 3);
        await settle();
      },
    );
    await viz.when('the slow read (of "demo") finally answers', async () => {
      slow.release();
      await settle();
    });

    await viz.then('Rank still shows "Best", the one the user switched to last', async () => {
      expect(await rankView(page)).toMatchObject({
        question: "Which of these two wins on “Best”?",
        dimension: "Best (0)",
      });
    });

    await viz.then('an answer is saved against "Best"', async () => {
      await page.keyboard.press("ArrowLeft");
      const saved = (await nthCall(page, "POST ranking", 3)).body;
      expect(saved.list).toBe("best");
    });
  });

  it.concurrent("should not let answers to the old dimension's cards land anywhere once the user switched", async () => {
    const { page, slow, progress, before } = await viz.given(
      'Rank on "Best", and a switch to the other dimension that is slow to load',
      async () => {
        const held = heldRead(2);
        const p = await open({
          hash: "rank",
          lib: twoDims,
          stubs: { "POST ranking": fakes.ranking, "GET ranking": held.stub },
        });
        await rankReady(p);
        await p.select("#rk-list", "demo");
        await nthCall(p, "POST ranking", 1);
        await waitUntil(() => held.reads() >= 2);

        const placedCount = async () => {
          const placed = await p.$eval("#rk-placed", (e) => e.textContent);
          return placed;
        };
        const start = { placed: await placedCount(), order: await rankOrder(p) };
        return { page: p, slow: held, progress: placedCount, before: start };
      },
    );

    await viz.when(
      "the user answers the old cards, still on screen, until that sort would finish",
      async () => {
        await page.keyboard.press("ArrowLeft");
        await pairShown(page, ["River poster", "Tide clock"]);
        await page.keyboard.press("ArrowRight");
        await settle();
      },
    );

    await viz.then(
      'no answer is saved, none is counted, nothing more is placed, and "Best" is not declared done',
      async () => {
        expect(calls(page, "POST ranking")).toHaveLength(1);
        expect(await rankView(page)).toMatchObject({ answered: "0" });
        expect({ placed: await progress(), order: await rankOrder(page) }).toEqual(before);
        expect(
          await page.$eval("#rank-done", (e) => (e instanceof HTMLElement ? e.hidden : null)),
        ).toBe(true);
      },
    );

    await viz.when("the new dimension loads", async () => {
      slow.release();
      await page.waitForFunction(() =>
        document.querySelector("#rk-question")!.textContent.includes("client demo"),
      );
    });

    await viz.then(
      "it starts clean, and neither dimension's file took the stray answers",
      async () => {
        expect(await rankView(page)).toMatchObject({
          answered: "0",
          dimension: "Best for a client demo (0)",
        });
        await pairShown(page, FIRST);
        expect(page.api.lib.ranking.lists["best"]!.log).toHaveLength(0);
        expect(page.api.lib.ranking.lists["demo"]!.log).toHaveLength(0);
      },
    );
  });
});

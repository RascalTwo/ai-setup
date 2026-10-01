// The Rank tab (rank.ts): pairwise answers become an order, every answer is saved against the
// dimension being answered, approval rides along on the cards, and dimensions are made, renamed,
// switched and deleted from the picker.
import { describe, it, expect } from "bun:test";
import { open, rankReady, rankPair, nthCall, calls, fakes, ok, fail, netError, rankingView } from "./helpers.ts";
import { three, twoDims, dialogs, nthDialog, heldRead, pairShown, rankView, rankOrder, rankDone, savedReads } from "./steps-rank.ts";

const settle = () => new Promise((r) => setTimeout(r, 300));
// The pair Rank asks about first, over the three-viz corpus.
const FIRST = ["Orbit deck", "Tide clock"];

describe("the Rank tab: answering", () => {
  it.concurrent("should turn the user's answers into a finished order, saving after every answer", async () => {
    // GIVEN Rank over three vizzes, with a working stand-in for the rankings file
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    await rankReady(page);
    expect(await rankView(page)).toMatchObject({ question: "Which of these two wins on “Best”?", saved: "ready", answered: "0" });
    expect(await page.$eval("#rk-budget", (e) => e.textContent)).toBe("3");

    // WHEN the user prefers the left card, then the right one
    expect(await rankPair(page)).toEqual(FIRST);
    await page.keyboard.press("ArrowLeft");
    await nthCall(page, "POST ranking", 1);
    await pairShown(page, ["River poster", "Tide clock"]);
    await page.click("#rk-b");

    // THEN the sort is done, in the order those answers imply
    await rankDone(page);
    expect(await page.$eval("#rank-done", (e) => e.textContent)).toContain("Done — 3 ranked.");
    expect(await rankOrder(page)).toEqual(["Orbit deck", "Tide clock", "River poster"]);
    // THEN the counters agree: two answered, all three placed, nothing left to answer
    expect(await page.$$eval("#rk-answered, #rk-placed, #rk-total, #rk-budget", (els) => els.map((e) => e.textContent)))
      .toEqual(["2", "3", "3", "0"]);
    // THEN both answers reached the rankings file, against the dimension being answered
    const last = await nthCall(page, "POST ranking", 2);
    expect(last.body.list).toBe("best");
    expect(page.api.lib.ranking.lists["best"]!.log).toHaveLength(2);
    await savedReads(page, "saved");
  });

  it.concurrent("should answer from the keyboard: → prefers the right card, = calls it even, other keys cast nothing", async () => {
    // GIVEN Rank over three vizzes
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    await rankReady(page);

    // WHEN the user presses a key that means nothing to Rank
    await page.keyboard.press("x");
    await settle();
    // THEN nothing is answered: the same pair, no save
    expect(await rankPair(page)).toEqual(FIRST);
    expect(calls(page, "POST ranking")).toHaveLength(0);

    // WHEN the user prefers the right card (Tide clock), then calls the next pair even
    await page.keyboard.press("ArrowRight");
    await nthCall(page, "POST ranking", 1);
    await pairShown(page, ["River poster", "Orbit deck"]);
    await page.keyboard.press("=");

    // THEN the order has Tide clock first and the tied pair after it
    await rankDone(page);
    expect(await rankOrder(page)).toEqual(["Tide clock", "Orbit deck", "River poster"]);
    // THEN both answers were saved
    expect((await nthCall(page, "POST ranking", 2)).body.log).toHaveLength(2);

    // WHEN the user presses an answer key after the sort is done
    await page.keyboard.press("ArrowLeft");
    await settle();
    // THEN it casts nothing
    expect(calls(page, "POST ranking")).toHaveLength(2);
    expect(await rankView(page)).toMatchObject({ answered: "2" });
  });

  it.concurrent("should answer by clicking the left card, and treat = and skip as an even call", async () => {
    // GIVEN Rank over three vizzes
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    await rankReady(page);

    // WHEN the user clicks the left card (Orbit deck), then the = button
    await page.click("#rk-a");
    await nthCall(page, "POST ranking", 1);
    await pairShown(page, ["River poster", "Tide clock"]);
    await page.click("#rk-eq");

    // THEN Orbit deck leads, with the even pair after it
    await rankDone(page);
    expect(await rankOrder(page)).toEqual(["Orbit deck", "Tide clock", "River poster"]);
    expect((await nthCall(page, "POST ranking", 2)).body.log).toHaveLength(2);

    // GIVEN a fresh start on the same corpus
    const again = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    await rankReady(again);
    // WHEN the user clicks the left card, then skip
    await again.click("#rk-a");
    await nthCall(again, "POST ranking", 1);
    await again.click("#rk-skip");
    // THEN skip was saved as an even call, exactly as = was
    await rankDone(again);
    expect((await nthCall(again, "POST ranking", 2)).body.log).toEqual(page.api.lib.ranking.lists["best"]!.log);
  });

  it.concurrent("should resume where the user left off after a reload", async () => {
    // GIVEN one answer given and saved
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    await rankReady(page);
    await page.keyboard.press("ArrowLeft");
    await nthCall(page, "POST ranking", 1);
    await savedReads(page, "saved");

    // WHEN the user reloads the page
    await page.reload();
    await rankReady(page);

    // THEN Rank says it resumed, counts the answer, and asks the second question, not the first
    expect(await rankView(page)).toMatchObject({ saved: "resumed · 1 answered", answered: "1", dimension: "Best (1)" });
    await pairShown(page, ["River poster", "Tide clock"]);
  });

  it.concurrent("should not count a key pressed while Rank is not the tab showing", async () => {
    // GIVEN Rank booted, then the user switches to the Library tab
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    await rankReady(page);
    await page.click("#tabbtn-dashboard");

    // WHEN the user presses ← there
    await page.keyboard.press("ArrowLeft");
    await settle();

    // THEN no answer was cast, and Rank asks the same pair when the user comes back
    expect(calls(page, "POST ranking")).toHaveLength(0);
    await page.click("#tabbtn-rank");
    expect(await rankPair(page)).toEqual(FIRST);
    expect(await rankView(page)).toMatchObject({ answered: "0" });
    // THEN coming back did not read the corpus again
    expect(calls(page, "GET ranking")).toHaveLength(1);
  });

  it.concurrent("should start Rank when the address changes to #rank, and not before", async () => {
    // GIVEN the self-portrait on its guide
    const page = await open({ lib: three });
    await page.evaluate(() => { location.hash = "dashboard"; });
    await settle();
    // THEN going to another tab by address does not read the corpus
    expect(calls(page, "GET ranking")).toHaveLength(0);

    // WHEN the user changes the address to #rank
    await page.evaluate(() => { location.hash = "rank"; });

    // THEN Rank loads and asks its first pair
    await rankReady(page);
    expect(await rankPair(page)).toEqual(FIRST);
  });
});

describe("the Rank tab: when the server fails", () => {
  it.concurrent("should say SAVE FAILED when the server refuses an answer", async () => {
    // GIVEN a rankings file that refuses every write
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fail("no dimension \"best\"", 404) } });
    await rankReady(page);

    // WHEN the user answers
    await page.keyboard.press("ArrowLeft");

    // THEN the saved line says the write failed, in the danger colour
    await savedReads(page, "SAVE FAILED");
    expect(await page.$eval("#rk-saved", (e) => (e as HTMLElement).style.color)).toBe("var(--danger)");
  });

  it.concurrent("should tell the user to stop when the server cannot be reached to save", async () => {
    // GIVEN Rank loaded, and a server that is gone by the time the user answers
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": () => netError() } });
    await rankReady(page);

    // WHEN the user answers
    await page.keyboard.press("ArrowLeft");

    // THEN the saved line tells them to stop
    await savedReads(page, "SAVE FAILED — stop and check the server");
    expect(await page.$eval("#rk-saved", (e) => (e as HTMLElement).style.color)).toBe("var(--danger)");
  });

  it.concurrent("should say the server is unreachable, and load once it is back and the tab is opened again", async () => {
    // GIVEN the self-portrait on its guide, and the server gone
    let down = true;
    const page = await open({ lib: three, stubs: { "GET ranking": (_, l) => (down ? netError() : rankingView(l)) } });

    // WHEN the user opens the Rank tab
    await page.click("#tabbtn-rank");

    // THEN Rank says it needs the server
    await page.waitForFunction(() => document.getElementById("rank-boot")!.textContent === "The local server is not reachable — Rank needs it.");
    expect(await page.$eval("#rank-main", (e) => (e as HTMLElement).hidden)).toBe(true);

    // WHEN the server is back and the user opens the tab again
    down = false;
    await page.click("#tabbtn-dashboard");
    await page.click("#tabbtn-rank");

    // THEN Rank loads and asks its first pair
    await rankReady(page);
    expect(await rankPair(page)).toEqual(FIRST);
  });
});

describe("the Rank tab: approving", () => {
  it.concurrent("should approve a viz from its card without casting a vote", async () => {
    // GIVEN Rank, with api/update standing in for the CLI's approve
    const page = await open({ hash: "rank", lib: three, stubs: { "POST update": ok("approved") } });
    await rankReady(page);
    expect(await rankPair(page)).toEqual(FIRST);

    // WHEN the user clicks the left card's approval button ("changed since approval" for Orbit deck)
    expect(await page.$eval("#rk-a .rk-tri", (e) => e.textContent)).toBe("⚠ changed since approval");
    await page.click("#rk-a .rk-tri");

    // THEN that viz is approved through api/update
    expect((await nthCall(page, "POST update")).body).toEqual({ id: ".agents/state/viz/orbit-deck", approved: "true" });
    await page.waitForFunction(() => document.querySelector("#rk-a .rk-tri")!.textContent === "✓ approved");
    // THEN no answer was recorded: the same pair is still being asked, nothing saved
    expect(await rankPair(page)).toEqual(FIRST);
    expect(await page.$eval("#rk-answered", (e) => e.textContent)).toBe("0");
    expect(calls(page, "POST ranking")).toHaveLength(0);
  });

  it.concurrent("should approve every unapproved viz in the pair with t", async () => {
    // GIVEN a pair of one changed-since-approval viz (Orbit deck) and one approved (Tide clock)
    const page = await open({ hash: "rank", lib: three, stubs: { "POST update": ok("approved"), "POST ranking": fakes.ranking } });
    await rankReady(page);
    expect(await page.$eval("#rk-b .rk-tri", (e) => e.textContent)).toBe("✓ approved");

    // WHEN the user presses t
    await page.keyboard.press("t");

    // THEN only Orbit deck is approved, and its card says so
    expect((await nthCall(page, "POST update")).body).toEqual({ id: ".agents/state/viz/orbit-deck", approved: "true" });
    await page.waitForFunction(() => document.querySelector("#rk-a .rk-tri")!.textContent === "✓ approved");

    // WHEN the user presses t again
    await page.keyboard.press("t");
    await settle();
    // THEN there is nothing left to approve: no second call
    expect(calls(page, "POST update")).toHaveLength(1);
    // THEN the approval carries to the next pair Orbit deck is in
    await page.keyboard.press("ArrowRight");
    await pairShown(page, ["River poster", "Orbit deck"]);
    expect(await page.$eval("#rk-b .rk-tri", (e) => e.textContent)).toBe("✓ approved");
  });

  it.concurrent("should say failed on the button when the approval is refused, and let the user retry", async () => {
    // GIVEN an approve that the CLI refuses
    const page = await open({ hash: "rank", lib: three, stubs: { "POST update": fail("viz check failed") } });
    await rankReady(page);

    // WHEN the user clicks approve on the left card
    await page.click("#rk-a .rk-tri");

    // THEN the button says failed, stays unapproved, and can be clicked again
    await page.waitForFunction(() => document.querySelector("#rk-a .rk-tri")!.textContent === "failed");
    expect(await page.$eval("#rk-a .rk-tri", (e) => [(e as HTMLButtonElement).disabled, e.classList.contains("on")])).toEqual([false, false]);
    await page.click("#rk-a .rk-tri");
    await nthCall(page, "POST update", 2);
  });
});

describe("the Rank tab: dimensions", () => {
  it.concurrent("should switch dimensions, restarting the sort and saving answers against the new one", async () => {
    // GIVEN two dimensions, one answer given on "Best"
    const page = await open({ hash: "rank", lib: twoDims, stubs: { "POST ranking": fakes.ranking } });
    await rankReady(page);
    expect(await rankView(page)).toMatchObject({
      dimensions: ["Best (0)", "Best for a client demo (0)"], dimension: "Best (0)",
      hint: "2 dimensions — each keeps its own answers",
    });
    await page.keyboard.press("ArrowLeft");
    await nthCall(page, "POST ranking", 1);

    // WHEN the user picks the other dimension
    await page.select("#rk-list", "demo");

    // THEN the server is told, and Rank asks the first pair again, on the new dimension
    expect((await nthCall(page, "POST ranking", 2)).body).toEqual({ action: "select", list: "demo" });
    await page.waitForFunction(() => document.getElementById("rk-question")!.textContent!.includes("client demo"));
    expect(await rankView(page)).toMatchObject({
      question: "Which of these two wins on “Best for a client demo”?", answered: "0", saved: "ready",
      dimensions: ["Best (1)", "Best for a client demo (0)"], dimension: "Best for a client demo (0)",
    });
    await pairShown(page, FIRST);

    // WHEN the user answers there
    await page.keyboard.press("ArrowRight");

    // THEN that answer is saved to the new dimension, and "Best" keeps its one answer
    expect((await nthCall(page, "POST ranking", 3)).body.list).toBe("demo");
    expect(page.api.lib.ranking.lists["demo"]!.log).toHaveLength(1);
    expect(page.api.lib.ranking.lists["best"]!.log).toHaveLength(1);
  });

  it.concurrent("should add a dimension the user names, and do nothing when they cancel or leave it blank", async () => {
    // GIVEN one dimension, and a user who cancels, then types spaces, then a name
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    const seen = dialogs(page, [null, "   ", "  Most reusable  "]);
    await rankReady(page);
    expect(await rankView(page)).toMatchObject({ hint: "add a dimension to rank the same vizzes on something else" });

    // WHEN the user clicks "+ new dimension" and cancels, then again and types only spaces
    await page.click("#rk-newdim");
    await nthDialog(seen, 1);
    await page.click("#rk-newdim");
    await nthDialog(seen, 2);
    await settle();
    // THEN nothing is created
    expect(calls(page, "POST ranking")).toHaveLength(0);
    expect(seen[0]!.message).toBe("Rank these vizzes on what?\n\ne.g. Best · Most reusable · Best for a client demo");

    // WHEN the user clicks it again and names the dimension
    await page.click("#rk-newdim");

    // THEN the trimmed name is created and becomes the dimension being answered
    expect((await nthCall(page, "POST ranking", 1)).body).toEqual({ action: "new", name: "Most reusable" });
    await page.waitForFunction(() => document.getElementById("rk-question")!.textContent!.includes("Most reusable"));
    expect(await rankView(page)).toMatchObject({
      dimensions: ["Best (0)", "Most reusable (0)"], dimension: "Most reusable (0)",
      hint: "2 dimensions — each keeps its own answers",
    });
  });

  it.concurrent("should show the server's reason when a new dimension's name is taken", async () => {
    // GIVEN two dimensions, and a user who names a new one like an existing one
    const page = await open({ hash: "rank", lib: twoDims, stubs: { "POST ranking": fakes.ranking } });
    const seen = dialogs(page, ["Best"]);
    await rankReady(page);

    // WHEN the user adds it
    await page.click("#rk-newdim");

    // THEN an alert gives the server's reason, and the dimensions are unchanged
    await nthDialog(seen, 2);
    expect(seen[1]).toMatchObject({ type: "alert", message: "\"Best\" already exists" });
    expect(await rankView(page)).toMatchObject({ dimensions: ["Best (0)", "Best for a client demo (0)"], dimension: "Best (0)" });
  });

  it.concurrent("should rename the dimension shown, offering its current name, and keep its answers", async () => {
    // GIVEN "Best" with one answer, and a user who cancels, types spaces, keeps the name, then renames
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    const seen = dialogs(page, [null, "  ", "Best", " Most striking "]);
    await rankReady(page);
    await page.keyboard.press("ArrowLeft");
    await nthCall(page, "POST ranking", 1);

    // WHEN the user clicks rename and cancels, clears it, then leaves the name as it was
    for (let n = 1; n <= 3; n++) { await page.click("#rk-renamedim"); await nthDialog(seen, n); }
    await settle();
    // THEN the prompt offered the current name, and nothing was renamed
    expect(seen[0]).toMatchObject({ type: "prompt", message: "Rename this dimension to what?", value: "Best" });
    expect(calls(page, "POST ranking")).toHaveLength(1);

    // WHEN the user renames it
    await page.click("#rk-renamedim");

    // THEN the trimmed name is saved against the same dimension, and its answer survives
    expect((await nthCall(page, "POST ranking", 2)).body).toEqual({ action: "rename", list: "best", name: "Most striking" });
    await page.waitForFunction(() => document.getElementById("rk-question")!.textContent!.includes("Most striking"));
    expect(await rankView(page)).toMatchObject({ dimension: "Most striking (1)", saved: "resumed · 1 answered", answered: "1" });
  });

  it.concurrent("should show the server's reason when a rename clashes with another dimension", async () => {
    // GIVEN two dimensions, and a user who renames "Best" to the other's name
    const page = await open({ hash: "rank", lib: twoDims, stubs: { "POST ranking": fakes.ranking } });
    const seen = dialogs(page, ["best for a CLIENT demo"]);
    await rankReady(page);

    // WHEN the user renames it
    await page.click("#rk-renamedim");

    // THEN an alert gives the server's reason, and nothing changes
    await nthDialog(seen, 2);
    expect(seen[1]).toMatchObject({ type: "alert", message: "\"best for a CLIENT demo\" is already taken" });
    expect(page.api.lib.ranking.lists["best"]!.name).toBe("Best");
  });

  it.concurrent("should name what a delete throws away before deleting, and not delete when cancelled", async () => {
    // GIVEN "Best" with two answers, beside an empty second dimension
    const page = await open({ hash: "rank", lib: twoDims, stubs: { "POST ranking": fakes.ranking } });
    const seen = dialogs(page, [false, true]);
    await rankReady(page);
    await page.keyboard.press("ArrowLeft");
    await nthCall(page, "POST ranking", 1);
    await page.keyboard.press("ArrowLeft");
    await nthCall(page, "POST ranking", 2);

    // WHEN the user clicks delete and cancels
    await page.click("#rk-deldim");
    await nthDialog(seen, 1);
    await settle();
    // THEN the confirm named the dimension and its answer count, and nothing was deleted
    expect(seen[0]!.message).toBe("Delete \"Best\" and its 2 answers?\n\nThat judgment is not recoverable from the UI. " +
      "rankings.json is git-tracked in the central library, so `git checkout` there can still bring it back.");
    expect(calls(page, "POST ranking")).toHaveLength(2);

    // WHEN the user deletes it
    await page.click("#rk-deldim");

    // THEN it is deleted, and Rank moves to the dimension that is left
    expect((await nthCall(page, "POST ranking", 3)).body).toEqual({ action: "delete", list: "best" });
    await page.waitForFunction(() => document.getElementById("rk-question")!.textContent!.includes("client demo"));
    expect(await rankView(page)).toMatchObject({
      dimensions: ["Best for a client demo (0)"], hint: "add a dimension to rank the same vizzes on something else",
    });
  });

  it.concurrent("should say one answer, not one answers, and say when there are none", async () => {
    // GIVEN "Best" with one answer, beside an empty second dimension
    const page = await open({ hash: "rank", lib: twoDims, stubs: { "POST ranking": fakes.ranking } });
    const seen = dialogs(page, [null, true]);
    await rankReady(page);
    await page.keyboard.press("ArrowLeft");
    await nthCall(page, "POST ranking", 1);

    // WHEN the user clicks delete on "Best"
    await page.click("#rk-deldim");
    await nthDialog(seen, 1);
    // THEN the confirm counts one answer
    expect(seen[0]!.message).toStartWith("Delete \"Best\" and its 1 answer?\n\n");

    // WHEN the user switches to the empty dimension and deletes it
    await page.select("#rk-list", "demo");
    await page.waitForFunction(() => document.getElementById("rk-question")!.textContent!.includes("client demo"));
    await page.click("#rk-deldim");

    // THEN the confirm says it has no answers, and it goes
    await nthDialog(seen, 2);
    expect(seen[1]!.message).toBe("Delete \"Best for a client demo\"? It has no answers yet.");
    expect((await nthCall(page, "POST ranking", 3)).body).toEqual({ action: "delete", list: "demo" });
    await page.waitForFunction(() => document.getElementById("rk-question")!.textContent!.includes("“Best”"));
  });

  it.concurrent("should refuse to delete the only dimension, with the server's reason", async () => {
    // GIVEN a single dimension, and a user who confirms its delete
    const page = await open({ hash: "rank", lib: three, stubs: { "POST ranking": fakes.ranking } });
    const seen = dialogs(page, [true]);
    await rankReady(page);

    // WHEN the user deletes it
    await page.click("#rk-deldim");

    // THEN an alert gives the server's reason, and it is still there
    await nthDialog(seen, 2);
    expect(seen[1]).toMatchObject({ type: "alert", message: "that is the only dimension — rename it or add another first" });
    expect(page.api.lib.ranking.lists["best"]).toBeDefined();
  });

  for (const button of ["rename", "delete"]) it.concurrent(`should say so on ${button}, and redraw, when the dimension was deleted in another window`, async () => {
    // GIVEN Rank on "Best for a client demo", which another window then deletes
    const page = await open({ hash: "rank", lib: (l) => { twoDims(l); l.ranking.current = "demo"; }, stubs: { "POST ranking": fakes.ranking } });
    const seen = dialogs(page, ["Renamed", true]);
    await rankReady(page);
    delete page.api.lib.ranking.lists["demo"];
    page.api.lib.ranking.current = "best";

    // WHEN the user clicks rename or delete
    await page.click(button === "rename" ? "#rk-renamedim" : "#rk-deldim");

    // THEN an alert says the dimension is gone, rather than a prompt or confirm about it
    await nthDialog(seen, 1);
    expect(seen).toEqual([{ type: "alert", message: "That dimension no longer exists — it was deleted in another window. Showing what is left.", value: "" }]);
    // THEN Rank shows what is left, and nothing was written
    await page.waitForFunction(() => document.getElementById("rk-question")!.textContent!.includes("“Best”"));
    expect(await rankView(page)).toMatchObject({ dimensions: ["Best (0)"], dimension: "Best (0)" });
    expect(calls(page, "POST ranking")).toHaveLength(0);
  });
});

describe("the Rank tab: a switch while the server is slow", () => {
  it.concurrent("should show the dimension switched to last when an earlier switch's read comes back late", async () => {
    // GIVEN two dimensions, and a server slow to answer the read after the first switch
    const slow = heldRead(2);
    const page = await open({ hash: "rank", lib: twoDims, stubs: { "POST ranking": fakes.ranking, "GET ranking": slow.stub } });
    await rankReady(page);

    // WHEN the user switches to the other dimension and, while that loads, back to "Best"
    await page.select("#rk-list", "demo");
    while (slow.reads() < 2) await new Promise((r) => setTimeout(r, 25));
    await page.select("#rk-list", "best");
    await nthCall(page, "GET ranking", 3);
    await settle();
    // WHEN the slow read (of "demo") finally answers
    slow.release();
    await settle();

    // THEN Rank still shows "Best", the one the user switched to last
    expect(await rankView(page)).toMatchObject({ question: "Which of these two wins on “Best”?", dimension: "Best (0)" });

    // THEN an answer is saved against "Best"
    await page.keyboard.press("ArrowLeft");
    const saved = (await nthCall(page, "POST ranking", 3)).body;
    expect(saved.list).toBe("best");
  });

  it.concurrent("should not let answers to the old dimension's cards land anywhere once the user switched", async () => {
    // GIVEN Rank on "Best", and a switch to the other dimension that is slow to load
    const slow = heldRead(2);
    const page = await open({ hash: "rank", lib: twoDims, stubs: { "POST ranking": fakes.ranking, "GET ranking": slow.stub } });
    await rankReady(page);
    await page.select("#rk-list", "demo");
    await nthCall(page, "POST ranking", 1);
    while (slow.reads() < 2) await new Promise((r) => setTimeout(r, 25));

    const progress = () => page.$eval("#rk-placed", (e) => e.textContent);
    const before = { placed: await progress(), order: await rankOrder(page) };

    // WHEN the user answers the old cards, still on screen, until that sort would finish
    await page.keyboard.press("ArrowLeft");
    await pairShown(page, ["River poster", "Tide clock"]);
    await page.keyboard.press("ArrowRight");
    await settle();

    // THEN no answer is saved, none is counted, nothing more is placed, and "Best" is not declared done
    expect(calls(page, "POST ranking")).toHaveLength(1);
    expect(await rankView(page)).toMatchObject({ answered: "0" });
    expect({ placed: await progress(), order: await rankOrder(page) }).toEqual(before);
    expect(await page.$eval("#rank-done", (e) => (e as HTMLElement).hidden)).toBe(true);

    // WHEN the new dimension loads
    slow.release();
    await page.waitForFunction(() => document.getElementById("rk-question")!.textContent!.includes("client demo"));

    // THEN it starts clean, and neither dimension's file took the stray answers
    expect(await rankView(page)).toMatchObject({ answered: "0", dimension: "Best for a client demo (0)" });
    await pairShown(page, FIRST);
    expect(page.api.lib.ranking.lists["best"]!.log).toHaveLength(0);
    expect(page.api.lib.ranking.lists["demo"]!.log).toHaveLength(0);
  });
});

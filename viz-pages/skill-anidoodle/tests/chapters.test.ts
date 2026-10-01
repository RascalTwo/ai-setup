// The rest of the tour: moving between chapters, and the three places a visitor picks something and the
// page answers with what it picked (a score to hear, a live piece to try, a pipeline step to read).
import { describe, it, expect } from "bun:test";
import { open, goTo, text } from "./helpers.ts";

describe("the chapter strip", () => {
  it.concurrent("should step forward and back with the arrows and show only the current chapter", async () => {
    // GIVEN the tour on its first chapter
    const page = await open();
    const on = () => page.$$eval("section.ch.on", (s) => s.map((e) => (e as HTMLElement).dataset["title"]));
    expect(await text(page, "#pos")).toBe("1 / 9");
    const first = await on();
    expect(first).toHaveLength(1);

    // WHEN the visitor presses next
    await page.click("#next");
    await page.waitForFunction(() => document.querySelector("#pos")!.textContent === "2 / 9");

    // THEN the second chapter shows alone and the strip marks it, and the first as seen
    const second = await on();
    expect(second).toHaveLength(1);
    expect(second).not.toEqual(first);
    expect(await page.$$eval(".chap.on", (b) => b.map((e) => (e as HTMLElement).dataset["i"]))).toEqual(["1"]);
    expect(await page.$$eval(".chap.seen", (b) => b.length)).toBe(2);

    // WHEN the visitor presses back
    await page.click("#prev");
    await page.waitForFunction(() => document.querySelector("#pos")!.textContent === "1 / 9");

    // THEN the first chapter is back
    expect(await on()).toEqual(first);
  });

  it.concurrent("should read the pipeline step the visitor picks, and mark the approval steps", async () => {
    // GIVEN the pipeline chapter, showing its first step
    const page = await open();
    const nodes = await page.$$eval("#pipe .pnode", (g) => g.length);
    expect(nodes).toBeGreaterThan(3);
    const firstName = await text(page, "#pipeDetail b");

    // WHEN the visitor picks each step in turn
    const seen: { name: string; gate: boolean }[] = [];
    for (let i = 0; i < nodes; i++) {
      await page.click(`#pipe .pnode[data-i="${i}"] rect`);
      seen.push(await page.evaluate(() => ({ name: document.querySelector("#pipeDetail b")!.textContent!, gate: !!document.querySelector("#pipeDetail .gate") })));
    }

    // THEN each shows its own name, one at a time is marked selected, and some (not all) are approval steps
    expect(seen[0]!.name).toBe(firstName);
    expect(new Set(seen.map((s) => s.name)).size).toBe(nodes);
    expect(await page.$$eval("#pipe .pnode.sel", (g) => g.length)).toBe(1);
    expect(seen.some((s) => s.gate)).toBe(true);
    expect(seen.some((s) => !s.gate)).toBe(true);
  });
});

describe("the music chapter", () => {
  it.concurrent("should show the measured numbers of the piece the visitor plays, and stop it on a second click", async () => {
    // GIVEN the music chapter
    const page = await open(6);

    // WHEN the visitor clicks the bells piece
    await page.click('.pt[data-id="bellsHopeful"] circle');

    // THEN it is marked playing, with what was measured of it
    expect(await text(page, "#nowPlaying")).toBe("▶ bellsHopeful (cinematic, hopeful) · measured -16 LUFS · true peak -5.8 dBTP · 1 onsets/s · centroid 1645 Hz · click again to stop");
    expect(await page.$$eval(".pt.playing", (p) => p.map((e) => (e as HTMLElement).dataset["id"]))).toEqual(["bellsHopeful"]);

    // WHEN the visitor picks the guitar piece instead
    await page.click('.pt[data-id="guitarWistful"] circle');
    // THEN only the guitar is playing, and the line names it
    expect(await page.$$eval(".pt.playing", (p) => p.map((e) => (e as HTMLElement).dataset["id"]))).toEqual(["guitarWistful"]);
    expect(await text(page, "#nowPlaying")).toContain("▶ guitarWistful");

    // WHEN the visitor clicks it again
    await page.click('.pt[data-id="guitarWistful"] circle');
    // THEN nothing is playing
    expect(await page.$$eval(".pt.playing", (p) => p.length)).toBe(0);
  });

  it.concurrent("should stop the music when the visitor leaves the chapter", async () => {
    // GIVEN a piece playing in the music chapter
    const page = await open(6);
    await page.click('.pt[data-id="bellsHopeful"] circle');
    expect(await page.$$eval(".pt.playing", (p) => p.length)).toBe(1);

    // WHEN the visitor moves to the next chapter and back
    await goTo(page, 7);
    await goTo(page, 6);

    // THEN nothing is playing
    expect(await page.$$eval(".pt.playing", (p) => p.length)).toBe(0);
  });
});

describe("the interactive chapter", () => {
  it.concurrent("should load the first live piece on arrival and swap to the one the visitor picks", async () => {
    // GIVEN the visitor arrives at the interactive chapter
    const page = await open(7);

    // THEN the first piece is loaded and described
    expect(await page.$eval("#intFrame", (f) => (f as HTMLIFrameElement).getAttribute("src"))).toBe("media/int/mascot-hero.html");
    expect(await text(page, "#intInfo h3")).toBe("Mascot hero");
    expect(await page.$$eval("#intPick .chipbtn.on", (b) => b.map((e) => e.textContent))).toEqual(["Mascot hero"]);

    // WHEN the visitor picks the scroll hero
    await page.click('#intPick .chipbtn[data-i="1"]');

    // THEN the frame and the description swap, and only that button is on
    expect(await page.$eval("#intFrame", (f) => (f as HTMLIFrameElement).getAttribute("src"))).toBe("media/int/scroll-hero.html");
    expect(await text(page, "#intInfo h3")).toBe("Scroll hero");
    expect(await page.$$eval("#intPick .chipbtn.on", (b) => b.map((e) => e.textContent))).toEqual(["Scroll hero"]);
  });
});

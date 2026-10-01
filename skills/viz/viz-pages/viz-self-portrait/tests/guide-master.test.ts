// Band 3 of the Guide, "Master" (fig-understand.ts, fig-master.ts): the runtime's packet paths,
// the internals cards, and the five bars the page grades itself against.
import { describe, it, expect } from "bun:test";
import { open, guideReady, reducedMotion } from "./helpers.ts";
import { MOTIONS, walk, arriveAt, shown } from "./guide-steps.ts";

type P = Awaited<ReturnType<typeof open>>;

describe("Under the hood", () => {
  // What the reader sees at a step: the boxes lit, the hop being narrated, and how the lit wire is drawn.
  const seen = (page: P) => page.evaluate(() => ({
    lit: [...document.querySelectorAll("#rt-svg .rt-n.on .rt-t")].map((t) => t.textContent).sort(),
    now: document.querySelector("#rt-narr .rt-hop.now .rt-hw")!.textContent,
    past: document.querySelectorAll("#rt-narr .rt-hop.past").length,
    wire: document.querySelector('#rt-svg path[stroke-width="2.5"]')!.getAttribute("d")!,
  }));

  it.concurrent("should walk a packet along each scenario's real path", async () => {
    // GIVEN the runtime figure
    const page = await open({ hash: "guide", before: reducedMotion });
    await guideReady(page);
    await arriveAt(page, "runtime");

    // WHEN the reader picks "The browser asks for a page"
    await page.click('#rt-picker button[data-s="1"]');
    // THEN the first hop is Browser → Router, drawn as a wire curving back left (the router sits left of the browser)
    let s = await seen(page);
    expect(s).toMatchObject({ lit: ["Browser", "Router"], now: "Browser → Router", past: 0 });
    expect(s.wire).toMatch(/^M 590 95 C 550 95, 400 41, 360 41$/);
    expect(await page.$$eval("#rt-picker button.on", (bs) => bs.map((b) => b.textContent))).toEqual(["The browser asks for a page"]);

    // WHEN the reader steps to the last step, past this scenario's four hops
    for (let i = 0; i < 4; i++) await page.click("#stop-runtime .fig-next");
    // THEN the last hop stays the one narrated, and the three before it are past
    s = await seen(page);
    expect(s).toMatchObject({ lit: ["Browser", "Static"], now: "Static → Browser", past: 3 });

    // WHEN the reader picks "A viz asks its own backend" and steps back to its third hop
    await page.click('#rt-picker button[data-s="2"]');
    await page.click("#stop-runtime .fig-tick:nth-child(3)");
    // THEN the API loader talks to itself: one box lit, and a loop drawn off its right edge
    s = await seen(page);
    expect(s).toMatchObject({ lit: ["API loader"], now: "API loader → API loader", past: 2 });
    expect(s.wire).toStartWith("M 545 104 C 579 91");

    // WHEN the reader picks "You save a file" and steps to its second hop
    await page.click('#rt-picker button[data-s="0"]');
    await page.click("#stop-runtime .fig-tick:nth-child(2)");
    // THEN the watcher hands down to the debouncer below it, drawn straight down
    s = await seen(page);
    expect(s).toMatchObject({ lit: ["Debounce", "fs.watch"], now: "fs.watch → Debounce", past: 1 });
    expect(s.wire).toBe("M 475 206 L 475 232");

    // WHEN the reader clicks the picker beside its buttons
    const box = (await (await page.$("#rt-picker"))!.boundingBox())!;
    await page.mouse.click(box.x + box.width - 1, box.y + box.height - 1);
    // THEN the scenario stays the same
    expect(await page.$$eval("#rt-picker button.on", (bs) => bs.map((b) => b.textContent))).toEqual(["You save a file"]);
  });

  it.concurrent("should light, at every step of every scenario, exactly the two ends of the hop it narrates", async () => {
    // GIVEN the runtime figure
    const page = await open({ hash: "guide", before: reducedMotion });
    await guideReady(page);
    for (let sc = 3; sc >= 0; sc--) {
      // WHEN the reader walks each scenario, step by step
      await walk(page, "runtime", async () => {
        if (!(await page.$eval(`#rt-picker button[data-s="${sc}"]`, (b) => b.classList.contains("on")))) await page.click(`#rt-picker button[data-s="${sc}"]`);
        const s = await seen(page);
        // THEN the lit boxes are the narrated hop's ends, and exactly one wire is lit
        expect(s.lit).toEqual([...new Set(s.now.split(" → "))].sort());
        expect(await page.$$eval('#rt-svg path[stroke-width="2.5"]', (ps) => ps.length)).toBe(1);
      });
    }
  });
});

describe("The rest of it", () => {
  it.concurrent("should open a card's contract when clicked, and close it on a second click", async () => {
    // GIVEN the internals cards, all closed
    const page = await open({ hash: "guide&stop=internals", before: reducedMotion });
    await guideReady(page);
    const kit = '.surf[data-id="kit"]';
    expect(await shown(page, `${kit} .drawer`)).toBe(false);

    // WHEN the reader clicks "The shared kit"
    await page.click(`${kit} .surf-one`);
    // THEN its contract shows, and the card offers to close
    expect(await shown(page, `${kit} .drawer`)).toBe(true);
    expect(await page.$eval(`${kit} .surf-art`, (e) => e.textContent)).toContain('from "/_kit/viz.js"');
    expect(await page.$eval(`${kit} .surf-more`, (e) => e.textContent)).toBe("close ↑");
    expect(await page.$$eval(".surf .drawer.open", (ds) => ds.length)).toBe(1);

    // WHEN the reader clicks the gap between cards
    const first = (await (await page.$(".surf"))!.boundingBox())!;
    await page.mouse.click(first.x + first.width + 3, first.y + 5);
    // THEN nothing else opens
    expect(await page.$$eval(".surf .drawer.open", (ds) => ds.length)).toBe(1);

    // WHEN the reader clicks the card again
    await page.click(`${kit} .surf-h`);
    // THEN it closes
    expect(await shown(page, `${kit} .drawer`)).toBe(false);
    expect(await page.$eval(`${kit} .surf-more`, (e) => e.textContent)).toBe("details ↓");
  });
});

describe("The five bars", () => {
  const banner = (page: P) => page.$eval("#bars-lit-note", (e) => e.classList.contains("on") ? e.textContent : null);
  const lit = (page: P) => page.$$eval(".bar-lit", (ns) => ns.length);
  const buttons = (page: P) => page.$$eval("#bars .bar-show", (bs) => bs.map((b) => b.textContent));

  it.concurrent("should count each bar from the page itself, and outline what it counted", async () => {
    // GIVEN the five bars, at the end of the guide
    const page = await open({ hash: "guide&stop=bars", before: reducedMotion });
    await guideReady(page);

    // THEN each passes, and bar 3 counts the guide's three bands and sixteen stops
    expect(await page.$$eval("#bars .bar", (bs) => bs.map((b) => b.className))).toEqual(Array(5).fill("bar pass"));
    expect(await page.$eval('.bar[data-bar="3"] .bar-count', (e) => e.textContent)).toBe("19");

    // WHEN the reader presses "show me" on bar 3
    await page.click('.bar-show[data-sel="3"]');
    // THEN those 19 are outlined, the note says how many and how many are on this screen, and the button can hide them
    expect(await lit(page)).toBe(19);
    expect(await banner(page)).toMatch(/^Bar 3 — outlining 19 bands and stops across the whole guide\d+ of them on this screenjump to one →clear$/);
    expect(await buttons(page)).toEqual(["show me", "show me", "hide", "show me", "show me"]);

    // WHEN the reader presses "show me" on bar 5 instead
    await page.click('.bar-show[data-sel="5"]');
    // THEN only bar 5's marks are outlined
    const five = await page.$eval('.bar[data-bar="5"] .bar-count', (e) => Number(e.textContent));
    expect(await lit(page)).toBe(five);
    expect(await banner(page)).toStartWith(`Bar 5 — outlining ${five} "what am I looking at" lines and legends`);
    expect(await buttons(page)).toEqual(["show me", "show me", "show me", "show me", "hide"]);

    // WHEN the reader presses "hide"
    await page.click('.bar-show[data-sel="5"]');
    // THEN nothing is outlined, and the note is gone
    expect(await lit(page)).toBe(0);
    expect(await banner(page)).toBeNull();

    // WHEN the reader shows bar 4, then presses "clear" in the note
    await page.click('.bar-show[data-sel="4"]');
    expect(await lit(page)).toBeGreaterThan(0);
    await page.click("#bars-clear");
    // THEN nothing is outlined, and every button offers "show me" again
    expect(await lit(page)).toBe(0);
    expect(await banner(page)).toBeNull();
    expect(await buttons(page)).toEqual(Array(5).fill("show me"));

    // WHEN the reader clicks the bar's text rather than its button
    await page.click('.bar[data-bar="2"] .bar-check');
    // THEN nothing is outlined
    expect(await lit(page)).toBe(0);
  });

  for (const motion of MOTIONS) {
    it.concurrent(`should take the reader to one of the outlined controls far from here (${motion.name})`, async () => {
      // GIVEN bar 2's controls outlined, from the end of the guide — the first of them, the rail's
      // buttons, are on screen already
      const page = await open({ hash: "guide&stop=bars", before: motion.before });
      await guideReady(page);
      await page.waitForFunction(() => Math.abs(document.querySelector("#stop-bars")!.getBoundingClientRect().top) < 3);
      await page.click('.bar-show[data-sel="2"]');
      expect(await page.$eval('.rail-stop[data-stop="why"]', (b) => b.classList.contains("bar-lit"))).toBe(true);

      // WHEN the reader presses "jump to one →"
      await page.click("#bars-jump");

      // THEN the guide scrolls away from the bars to an outlined mark, centred on screen
      await page.waitForFunction(() => document.querySelector("#stop-bars")!.getBoundingClientRect().top > innerHeight, { timeout: 10_000 });
      expect(await page.$$eval(".bar-lit", (ns) => ns.some((n) => {
        const r = n.getBoundingClientRect();
        return r.top < innerHeight / 2 && r.bottom > innerHeight / 2;
      }))).toBe(true);
    });
  }

  it.concurrent("should re-count from the page as it is now: down to the one mark here, then to none", async () => {
    // GIVEN the five bars, all passing
    const page = await open({ hash: "guide&stop=bars", before: reducedMotion });
    await guideReady(page);
    const five = () => page.$eval('.bar[data-bar="5"]', (b) => [b.className, b.querySelector(".bar-count")!.textContent]);

    // WHEN every "what am I looking at" line and legend but the bars' own leaves the page, and the reader re-counts
    await page.evaluate(() => document.querySelectorAll("#tab-guide .fig-what, #tab-guide .legend").forEach((e) => { if (!e.closest("#fig-bars")) e.remove(); }));
    await page.click("#bars-recount");
    // THEN bar 5 counts just that one, and still passes
    expect(await five()).toEqual(["bar pass", "1"]);

    // WHEN the reader shows bar 5 and jumps to one
    await page.click('.bar-show[data-sel="5"]');
    expect(await banner(page)).toContain("1 of them on this screen");
    await page.click("#bars-jump");
    // THEN with nowhere far to go, the guide centres the one there is
    await page.waitForFunction(() => {
      const r = document.querySelector("#fig-bars .fig-what")!.getBoundingClientRect();
      return Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 3;
    }, { timeout: 10_000 });

    // WHEN that last line leaves the page too, and the reader re-counts
    await page.evaluate(() => document.querySelector("#fig-bars .fig-what")!.remove());
    await page.click("#bars-recount");
    // THEN what was lit for the old count is cleared
    expect(await lit(page)).toBe(0);
    expect(await banner(page)).toBeNull();
    // THEN bar 5 fails with a count of 0, and the other four still pass
    expect(await five()).toEqual(["bar fail", "0"]);
    expect(await page.$$eval("#bars .bar.pass", (bs) => bs.map((b) => b.getAttribute("data-bar")))).toEqual(["1", "2", "3", "4"]);

    // WHEN the reader asks to be shown bar 5, and to jump to one
    await page.click('.bar-show[data-sel="5"]');
    expect(await banner(page)).toStartWith('Bar 5 — outlining 0 "what am I looking at" lines and legends');
    const y = await page.evaluate(() => scrollY);
    await page.click("#bars-jump");

    // THEN the guide stays where it is, and nothing broke
    expect(await page.evaluate(() => scrollY)).toBe(y);
    expect(page.errors).toEqual([]);
  });
});

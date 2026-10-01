// The Guide (guide.ts, guide-boot.ts): the rail, deep links to a stop, the gates, and the controls
// every scrubbed figure shares. The figures themselves are guide-*.test.ts.
import { describe, it, expect } from "bun:test";
import { open, guideReady, activeTab, reducedMotion } from "./helpers.ts";
import { MOTIONS, onStop, atTop, atStep, arriveAt, position } from "./guide-steps.ts";

describe("the Guide", () => {
  for (const motion of MOTIONS) {
    it.concurrent(`should open a deep link at its stop, and follow a rail click to another (${motion.name})`, async () => {
      // GIVEN a link to the "publish" stop
      const page = await open({ hash: "guide&stop=publish", before: motion.before });
      await guideReady(page);

      // THEN the guide opens there: the rail marks it and the stop is at the top of the view
      await onStop(page, "publish");
      await atTop(page, "#stop-publish");

      // WHEN the user clicks "Who can see it" on the rail
      await page.click('.rail-stop[data-stop="access"]');

      // THEN the guide moves there, and the URL names the new stop
      await onStop(page, "access");
      await atTop(page, "#stop-access");
      expect(await page.evaluate(() => location.hash)).toBe("#guide&stop=access");
    });

    it.concurrent(`should take a reader who keeps going at a gate to the top of the next band (${motion.name})`, async () => {
      // GIVEN the Guide
      const page = await open({ hash: "guide", before: motion.before });
      await guideReady(page);

      // WHEN the reader takes "Keep going ↓" at the end of band 1
      await page.click("#gate-run .gate-go");

      // THEN band 2, "Get Good", is at the top of the view, and the Guide is still the tab on show
      await atTop(page, '.band[data-band="good"]');
      expect(await page.$eval('.band[data-band="good"] h2', (e) => e.textContent)).toBe("Get Good");
      expect(await activeTab(page)).toBe("guide");
    });

    it.concurrent(`should step a scrubbed figure with its arrows, its ticks and the arrow keys (${motion.name})`, async () => {
      // GIVEN the "Your first ask" stop, at its first step
      const page = await open({ hash: "guide", before: motion.before });
      await guideReady(page);
      await arriveAt(page, "ask");
      expect(await page.$eval("#ask-cap", (e) => e.textContent)).toBe("nothing yet");

      // WHEN the reader presses →
      await page.click("#stop-ask .fig-next");
      // THEN it is on step 2, and the machine side shows the form the agent chose
      await atStep(page, "ask", "2 / 5");
      expect(await page.$eval("#ask-cap", (e) => e.textContent)).toBe("form chosen — treemap, area = bytes");
      expect(await page.$eval("#ask-body .form-pick", (e) => e.textContent)).toBe("treemap");

      // WHEN the reader clicks the fourth tick
      await page.click("#stop-ask .fig-tick:nth-child(4)");
      // THEN it is on step 4, the first four ticks are lit, and the page is live at a URL
      await atStep(page, "ask", "4 / 5");
      expect(await page.$$eval("#stop-ask .fig-tick", (ts) => ts.map((t) => t.classList.contains("on")))).toEqual([true, true, true, true, false]);
      expect(await page.$eval("#ask-body .stage-url code", (e) => e.textContent)).toBe("127.0.0.1:5180/…/skill-source/");

      // WHEN the reader presses ←
      await page.click("#stop-ask .fig-prev");
      // THEN it is back on step 3: the folder exists
      await atStep(page, "ask", "3 / 5");
      expect(await page.$eval("#ask-body .stage-files", (e) => e.textContent)).toContain("└─ index.html");

      // WHEN the reader presses the right arrow key, twice
      await page.keyboard.press("ArrowRight");
      await atStep(page, "ask", "4 / 5");
      await page.keyboard.press("ArrowDown");
      // THEN it is on the last step: the finished treemap, one cell per source entry
      await atStep(page, "ask", "5 / 5");
      expect(await page.$eval("#ask-cap", (e) => e.textContent)).toBe("rendered · 24 entries · 474 KB");
      expect(await page.$$eval("#ask-tm .tm-cell", (cs) => cs.length)).toBe(24);

      // WHEN the reader presses the left arrow key, then up
      await page.keyboard.press("ArrowLeft");
      await atStep(page, "ask", "4 / 5");
      await page.keyboard.press("ArrowUp");
      // THEN each steps back one
      await atStep(page, "ask", "3 / 5");
      // THEN the next scrubbed stop, below, never moved
      expect(await position(page, "refine")).toBe("1 / 5");
    });
  }

  it.concurrent("should open a #quickstart link at the install stop", async () => {
    // GIVEN a #quickstart link, the tab router's alias for the install stop
    const page = await open({ hash: "quickstart", before: reducedMotion });
    await guideReady(page);

    // THEN the guide opens at "Install", and the URL names it
    await onStop(page, "install");
    await atTop(page, "#stop-install");
    expect(await page.evaluate(() => location.hash)).toBe("#guide&stop=install");
  });

  it.concurrent("should open a first visit with no link at the top of the guide", async () => {
    // GIVEN a first visit, with nothing after the address
    const page = await open({ before: reducedMotion });
    await guideReady(page);

    // THEN the Guide shows at its first stop, and the URL names it
    expect(await activeTab(page)).toBe("guide");
    await onStop(page, "why");
    expect(await page.evaluate(() => [scrollY, location.hash])).toEqual([0, "#guide&stop=why"]);
  });

  it.concurrent("should lay out the rail when a reader who opened the Dashboard switches to the Guide", async () => {
    // GIVEN the Dashboard, in a short window, scrolled down
    const page = await open({ hash: "dashboard", height: 420, before: reducedMotion });
    await page.waitForFunction(() => document.querySelector("#slugs")!.textContent !== "loading…");
    await page.evaluate(() => scrollTo(0, 300));
    await page.waitForFunction(() => scrollY > 0);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    // THEN the hidden Guide never claims the URL
    expect(await page.evaluate(() => location.hash)).toBe("#dashboard");

    // WHEN the reader opens the Guide tab
    await page.click("#tabbtn-guide");

    // THEN the rail spreads its stops down its full height, in order
    await page.waitForFunction(() => parseFloat((document.querySelector('.rail-stop[data-stop="bars"]') as HTMLElement).style.top) > 80, { timeout: 10_000 })
      .catch(async (e) => { throw new Error(`the rail stayed crammed: ${await page.$eval('.rail-stop[data-stop="bars"]', (n) => (n as HTMLElement).style.top)}`, { cause: e }); });
    const tops = await page.$$eval(".rail-stop", (ns) => ns.map((n) => parseFloat((n as HTMLElement).style.top)));
    expect(tops[0]).toBe(0);
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
    // THEN the gates sit on the rail between their bands
    const gate = await page.$eval('.rail-gate[data-gate="run"]', (n) => parseFloat((n as HTMLElement).style.top));
    expect(gate).toBeGreaterThan(tops[3]!);
    expect(gate).toBeLessThan(tops[4]!);

    // WHEN the reader then follows a #quickstart link
    await page.evaluate(() => { location.hash = "#quickstart"; });

    // THEN the Guide goes to "Install"
    await onStop(page, "install");
    await atTop(page, "#stop-install");
  });

  it.concurrent("should re-read the rail's progress when the window grows at the bottom of the guide", async () => {
    // GIVEN the guide scrolled to its very end, in a short window
    const page = await open({ hash: "guide", height: 600, before: reducedMotion });
    await guideReady(page);
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await onStop(page, "bars");
    await page.waitForFunction(() => parseInt(document.querySelector("#rail-pct")!.textContent!) > 90);
    const before = parseInt((await page.$eval("#rail-pct", (e) => e.textContent))!);

    // WHEN the window grows taller, so the page can no longer scroll as far and the read head
    // (45% down the window) now sits higher up the guide
    await page.setViewport({ width: 1280, height: 1000 });

    // THEN the rail's progress drops to match, and it still marks the last stop
    await page.waitForFunction((b) => parseInt(document.querySelector("#rail-pct")!.textContent!) < b, { timeout: 10_000 }, before);
    expect(await page.$eval(".rail-stop.on", (e) => e.getAttribute("data-stop"))).toBe("bars");
    expect(await page.$eval("#rail-fill", (e) => (e as HTMLElement).style.height)).toMatch(/^\d+(\.\d+)?%$/);
  });

  it.concurrent("should say which viz release it documents, and switch install instructions by tab", async () => {
    // GIVEN the Guide, over a server reporting viz 9.9.9-test
    const page = await open({ hash: "guide" });
    await guideReady(page);

    // THEN the install stop names that release
    await page.waitForFunction(() => document.querySelector(".dl-ver")!.textContent !== "…");
    expect(await page.$eval(".dl-ver", (e) => e.textContent)).toBe("These docs describe viz 9.9.9-test. ");

    // WHEN the user picks the "chat" way in
    await page.click('.inst-tab[data-way="chat"]');

    // THEN only that pane shows
    expect(await page.$$eval(".inst-pane.on", (els) => els.map((e) => (e as HTMLElement).dataset.way))).toEqual(["chat"]);
  });

  it.concurrent("should send a reader who stops at the first gate to the Dashboard", async () => {
    // GIVEN the Guide
    const page = await open({ hash: "guide" });
    await guideReady(page);

    // WHEN the reader takes "Stop here" at the end of band 1
    await page.$eval("#gate-run .gate-stop", (b) => (b as HTMLElement).click());

    // THEN the Dashboard shows
    expect(await activeTab(page)).toBe("dashboard");
  });

  it.concurrent("should keep the rest of the guide when one figure fails to render", async () => {
    // GIVEN a page where the "Who can see it" figure throws while it renders (its grid can't be found)
    const logged: string[] = [];
    const page = await open({
      hash: "guide", before: (p) => (p.on("console", (m) => { if (m.type() === "error") logged.push(m.text()); }), p.evaluateOnNewDocument(() => {
        const qs = Element.prototype.querySelector;
        Element.prototype.querySelector = function (this: Element, sel: string) {
          if (sel === "#pg-grid") throw new Error("stand-in: the grid is gone");
          return qs.call(this, sel);
        } as typeof qs;
      })),
    });
    await guideReady(page);

    // THEN that stop says its figure failed
    expect(await page.$eval("#fig-access", (e) => e.textContent!.trim())).toBe("This figure failed to render — see the console.");
    // THEN every figure after it still rendered
    expect(await page.$$eval("#fig-session, #fig-runtime, #fig-internals, #fig-map, #fig-bars", (els) => els.map((e) => e.children.length > 0))).toEqual([true, true, true, true, true]);
    expect(await page.$$eval("#bars .bar", (bs) => bs.length)).toBe(5);
    // THEN the console names the figure that failed
    expect(logged.some((l) => l.startsWith('[guide] figure "access" failed:'))).toBe(true);
    // THEN no error escaped the page
    expect(page.errors).toEqual([]);
  });
});

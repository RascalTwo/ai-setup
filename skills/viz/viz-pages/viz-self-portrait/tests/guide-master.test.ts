// Band 3 of the Guide, "Master" (fig-understand.ts, fig-master.ts): the runtime's packet paths,
// the internals cards, and the five bars the page grades itself against.
import { describe, it, expect } from "bun:test";
import { open, guideReady, reducedMotion } from "./helpers.ts";
import { MOTIONS, walk, arriveAt, shown } from "./guide-steps.ts";

type P = Awaited<ReturnType<typeof open>>;

describe("Under the hood", () => {
  // What the reader sees at a step: the boxes lit, the hop being narrated, and how the lit wire is drawn.
  const seen = async (page: P) => {
    const view = await page.evaluate(() => ({
      lit: [...document.querySelectorAll("#rt-svg .rt-n.on .rt-t")]
        .map((t) => t.textContent)
        .toSorted(),
      now: document.querySelector("#rt-narr .rt-hop.now .rt-hw")!.textContent,
      past: document.querySelectorAll("#rt-narr .rt-hop.past").length,
      wire: document.querySelector('#rt-svg path[stroke-width="2.5"]')!.getAttribute("d")!,
    }));
    return view;
  };

  it.concurrent("should walk a packet along each scenario's real path", async () => {
    const page = await viz.given("the runtime figure", async () => {
      const p = await open({ hash: "guide", before: reducedMotion });
      await guideReady(p);
      await arriveAt(p, "runtime");
      return p;
    });

    await viz.when('the reader picks "The browser asks for a page"', async () =>
      page.click('#rt-picker button[data-s="1"]'),
    );
    await viz.then(
      "the first hop is Browser → Router, drawn as a wire curving back left (the router sits left of the browser)",
      async () => {
        const s = await seen(page);
        expect(s).toMatchObject({ lit: ["Browser", "Router"], now: "Browser → Router", past: 0 });
        expect(s.wire).toMatch(/^M 590 95 C 550 95, 400 41, 360 41$/u);
        expect(
          await page.$$eval("#rt-picker button.on", (bs) => bs.map((b) => b.textContent)),
        ).toEqual(["The browser asks for a page"]);
      },
    );

    await viz.when(
      "the reader steps to the last step, past this scenario's four hops",
      async () => {
        for (let i = 0; i < 4; i++) {
          // oxlint-disable-next-line no-await-in-loop -- sequential clicks: each press must register before the next
          await page.click("#stop-runtime .fig-next");
        }
      },
    );
    await viz.then(
      "the last hop stays the one narrated, and the three before it are past",
      async () => {
        const s = await seen(page);
        expect(s).toMatchObject({ lit: ["Browser", "Static"], now: "Static → Browser", past: 3 });
      },
    );

    await viz.when(
      'the reader picks "A viz asks its own backend" and steps back to its third hop',
      async () => {
        await page.click('#rt-picker button[data-s="2"]');
        await page.click("#stop-runtime .fig-tick:nth-child(3)");
      },
    );
    await viz.then(
      "the API loader talks to itself: one box lit, and a loop drawn off its right edge",
      async () => {
        const s = await seen(page);
        expect(s).toMatchObject({ lit: ["API loader"], now: "API loader → API loader", past: 2 });
        expect(s.wire).toStartWith("M 545 104 C 579 91");
      },
    );

    await viz.when('the reader picks "You save a file" and steps to its second hop', async () => {
      await page.click('#rt-picker button[data-s="0"]');
      await page.click("#stop-runtime .fig-tick:nth-child(2)");
    });
    await viz.then(
      "the watcher hands down to the debouncer below it, drawn straight down",
      async () => {
        const s = await seen(page);
        expect(s).toMatchObject({
          lit: ["Debounce", "fs.watch"],
          now: "fs.watch → Debounce",
          past: 1,
        });
        expect(s.wire).toBe("M 475 206 L 475 232");
      },
    );

    await viz.when("the reader clicks the picker beside its buttons", async () => {
      const box = (await (await page.$("#rt-picker"))!.boundingBox())!;
      await page.mouse.click(box.x + box.width - 1, box.y + box.height - 1);
    });
    await viz.then("the scenario stays the same", async () => {
      expect(
        await page.$$eval("#rt-picker button.on", (bs) => bs.map((b) => b.textContent)),
      ).toEqual(["You save a file"]);
    });
  });

  it.concurrent("should light, at every step of every scenario, exactly the two ends of the hop it narrates", async () => {
    const page = await viz.given("the runtime figure", async () => {
      const p = await open({ hash: "guide", before: reducedMotion });
      await guideReady(p);
      return p;
    });
    for (let sc = 3; sc >= 0; sc--) {
      // oxlint-disable-next-line no-await-in-loop -- the scenarios share one page, so each walk finishes before the next starts
      const steps = await viz.when("the reader walks each scenario, step by step", async () => {
        const taken: { view: Awaited<ReturnType<typeof seen>>; wires: number }[] = [];
        await walk(page, "runtime", async () => {
          if (
            !(await page.$eval(`#rt-picker button[data-s="${sc}"]`, (b) =>
              b.classList.contains("on"),
            ))
          )
            await page.click(`#rt-picker button[data-s="${sc}"]`);
          taken.push({
            view: await seen(page),
            wires: await page.$$eval('#rt-svg path[stroke-width="2.5"]', (ps) => ps.length),
          });
        });
        return taken;
      });
      // oxlint-disable-next-line no-await-in-loop -- same reason as above
      await viz.then(
        "the lit boxes are the narrated hop's ends, and exactly one wire is lit",
        () => {
          for (const { view, wires } of steps) {
            expect(view.lit).toEqual([...new Set(view.now.split(" → "))].toSorted());
            expect(wires).toBe(1);
          }
        },
      );
    }
  });
});

describe("The rest of it", () => {
  it.concurrent("should open a card's contract when clicked, and close it on a second click", async () => {
    const kit = '.surf[data-id="kit"]';
    const page = await viz.given("the internals cards, all closed", async () => {
      const p = await open({ hash: "guide&stop=internals", before: reducedMotion });
      await guideReady(p);
      expect(await shown(p, `${kit} .drawer`)).toBe(false);
      return p;
    });

    await viz.when('the reader clicks "The shared kit"', async () =>
      page.click(`${kit} .surf-one`),
    );
    await viz.then("its contract shows, and the card offers to close", async () => {
      expect(await shown(page, `${kit} .drawer`)).toBe(true);
      expect(await page.$eval(`${kit} .surf-art`, (e) => e.textContent)).toContain(
        'from "@viz/kit"',
      );
      expect(await page.$eval(`${kit} .surf-more`, (e) => e.textContent)).toBe("close ↑");
      expect(await page.$$eval(".surf .drawer.open", (ds) => ds.length)).toBe(1);
    });

    await viz.when("the reader clicks the gap between cards", async () => {
      const first = (await (await page.$(".surf"))!.boundingBox())!;
      await page.mouse.click(first.x + first.width + 3, first.y + 5);
    });
    await viz.then("nothing else opens", async () => {
      expect(await page.$$eval(".surf .drawer.open", (ds) => ds.length)).toBe(1);
    });

    await viz.when("the reader clicks the card again", async () => page.click(`${kit} .surf-h`));
    await viz.then("it closes", async () => {
      expect(await shown(page, `${kit} .drawer`)).toBe(false);
      expect(await page.$eval(`${kit} .surf-more`, (e) => e.textContent)).toBe("details ↓");
    });
  });
});

describe("The five bars", () => {
  const banner = async (page: P) => {
    const note = await page.$eval("#bars-lit-note", (e) =>
      e.classList.contains("on") ? e.textContent : null,
    );
    return note;
  };
  const lit = async (page: P) => {
    const count = await page.$$eval(".bar-lit", (ns) => ns.length);
    return count;
  };
  const buttons = async (page: P) => {
    const labels = await page.$$eval("#bars .bar-show", (bs) => bs.map((b) => b.textContent));
    return labels;
  };

  it.concurrent("should count each bar from the page itself, and outline what it counted", async () => {
    const link = await viz.given("the five bars, at the end of the guide", () => ({
      hash: "guide&stop=bars",
      before: reducedMotion,
    }));

    const page = await viz.when("someone opens it", async () => {
      const p = await open(link);
      await guideReady(p);
      return p;
    });
    await viz.then(
      "each passes, and bar 3 counts the guide's three bands and sixteen stops",
      async () => {
        expect(await page.$$eval("#bars .bar", (bs) => bs.map((b) => b.className))).toEqual(
          Array.from({ length: 5 }, () => "bar pass"),
        );
        expect(await page.$eval('.bar[data-bar="3"] .bar-count', (e) => e.textContent)).toBe("19");
      },
    );

    await viz.when('the reader presses "show me" on bar 3', async () =>
      page.click('.bar-show[data-sel="3"]'),
    );
    await viz.then(
      "those 19 are outlined, the note says how many and how many are on this screen, and the button can hide them",
      async () => {
        expect(await lit(page)).toBe(19);
        expect(await banner(page)).toMatch(
          /^Bar 3 — outlining 19 bands and stops across the whole guide\d+ of them on this screenjump to one →clear$/u,
        );
        expect(await buttons(page)).toEqual(["show me", "show me", "hide", "show me", "show me"]);
      },
    );

    await viz.when('the reader presses "show me" on bar 5 instead', async () =>
      page.click('.bar-show[data-sel="5"]'),
    );
    await viz.then("only bar 5's marks are outlined", async () => {
      const five = await page.$eval('.bar[data-bar="5"] .bar-count', (e) => Number(e.textContent));
      expect(await lit(page)).toBe(five);
      expect(await banner(page)).toStartWith(
        `Bar 5 — outlining ${five} "what am I looking at" lines and legends`,
      );
      expect(await buttons(page)).toEqual(["show me", "show me", "show me", "show me", "hide"]);
    });

    await viz.when('the reader presses "hide"', async () => page.click('.bar-show[data-sel="5"]'));
    await viz.then("nothing is outlined, and the note is gone", async () => {
      expect(await lit(page)).toBe(0);
      expect(await banner(page)).toBeNull();
    });

    await viz.when('the reader shows bar 4, then presses "clear" in the note', async () => {
      await page.click('.bar-show[data-sel="4"]');
      expect(await lit(page)).toBeGreaterThan(0);
      await page.click("#bars-clear");
    });
    await viz.then('nothing is outlined, and every button offers "show me" again', async () => {
      expect(await lit(page)).toBe(0);
      expect(await banner(page)).toBeNull();
      expect(await buttons(page)).toEqual(Array.from({ length: 5 }, () => "show me"));
    });

    await viz.when("the reader clicks the bar's text rather than its button", async () =>
      page.click('.bar[data-bar="2"] .bar-check'),
    );
    await viz.then("nothing is outlined", async () => {
      expect(await lit(page)).toBe(0);
    });
  });

  for (const motion of MOTIONS) {
    it.concurrent(`should take the reader to one of the outlined controls far from here (${motion.name})`, async () => {
      const page = await viz.given(
        "bar 2's controls outlined, from the end of the guide — the first of them, the rail's buttons, are on screen already",
        async () => {
          const p = await open({ hash: "guide&stop=bars", before: motion.before });
          await guideReady(p);
          await p.waitForFunction(
            () => Math.abs(document.querySelector("#stop-bars")!.getBoundingClientRect().top) < 3,
          );
          await p.click('.bar-show[data-sel="2"]');
          expect(
            await p.$eval('.rail-stop[data-stop="why"]', (b) => b.classList.contains("bar-lit")),
          ).toBe(true);
          return p;
        },
      );

      await viz.when('the reader presses "jump to one →"', async () => page.click("#bars-jump"));

      await viz.then(
        "the guide scrolls away from the bars to an outlined mark, centred on screen",
        async () => {
          await page.waitForFunction(
            () => document.querySelector("#stop-bars")!.getBoundingClientRect().top > innerHeight,
            { timeout: 10_000 },
          );
          expect(
            await page.$$eval(".bar-lit", (ns) =>
              ns.some((n) => {
                const r = n.getBoundingClientRect();
                return r.top < innerHeight / 2 && r.bottom > innerHeight / 2;
              }),
            ),
          ).toBe(true);
        },
      );
    });
  }

  it.concurrent("should re-count from the page as it is now: down to the one mark here, then to none", async () => {
    const { page, five } = await viz.given("the five bars, all passing", async () => {
      const p = await open({ hash: "guide&stop=bars", before: reducedMotion });
      await guideReady(p);
      const fiveBar = async () => {
        const bar = await p.$eval('.bar[data-bar="5"]', (b) => [
          b.className,
          b.querySelector(".bar-count")!.textContent,
        ]);
        return bar;
      };
      return { page: p, five: fiveBar };
    });

    await viz.when(
      `every "what am I looking at" line and legend but the bars' own leaves the page, and the reader re-counts`,
      async () => {
        await page.evaluate(() =>
          document.querySelectorAll("#tab-guide .fig-what, #tab-guide .legend").forEach((e) => {
            if (!e.closest("#fig-bars")) e.remove();
          }),
        );
        await page.click("#bars-recount");
      },
    );
    await viz.then("bar 5 counts just that one, and still passes", async () => {
      expect(await five()).toEqual(["bar pass", "1"]);
    });

    await viz.when("the reader shows bar 5 and jumps to one", async () => {
      await page.click('.bar-show[data-sel="5"]');
      expect(await banner(page)).toContain("1 of them on this screen");
      await page.click("#bars-jump");
    });
    await viz.then("with nowhere far to go, the guide centres the one there is", async () => {
      await page.waitForFunction(
        () => {
          const r = document.querySelector("#fig-bars .fig-what")!.getBoundingClientRect();
          return Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) < 3;
        },
        { timeout: 10_000 },
      );
    });

    await viz.when("that last line leaves the page too, and the reader re-counts", async () => {
      await page.evaluate(() => document.querySelector("#fig-bars .fig-what")!.remove());
      await page.click("#bars-recount");
    });
    await viz.then("what was lit for the old count is cleared", async () => {
      expect(await lit(page)).toBe(0);
      expect(await banner(page)).toBeNull();
    });
    await viz.then("bar 5 fails with a count of 0, and the other four still pass", async () => {
      expect(await five()).toEqual(["bar fail", "0"]);
      expect(
        await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>("#bars .bar.pass")].map((b) => b.dataset.bar),
        ),
      ).toEqual(["1", "2", "3", "4"]);
    });

    const y = await viz.when("the reader asks to be shown bar 5, and to jump to one", async () => {
      await page.click('.bar-show[data-sel="5"]');
      expect(await banner(page)).toStartWith(
        'Bar 5 — outlining 0 "what am I looking at" lines and legends',
      );
      const scrolled = await page.evaluate(() => scrollY);
      await page.click("#bars-jump");
      return scrolled;
    });

    await viz.then("the guide stays where it is, and nothing broke", async () => {
      expect(await page.evaluate(() => scrollY)).toBe(y);
      expect(page.errors).toEqual([]);
    });
  });
});

// The Guide (guide.ts, guide-boot.ts): the rail, deep links to a stop, the gates, and the controls
// every scrubbed figure shares. The figures themselves are guide-*.test.ts.
import { describe, it, expect } from "bun:test";
import { open, guideReady, activeTab, reducedMotion, type OpenOptions } from "./helpers.ts";
import { MOTIONS, onStop, atTop, atStep, arriveAt, position } from "./guide-steps.ts";

describe("the Guide", () => {
  for (const motion of MOTIONS) {
    it.concurrent(`should open a deep link at its stop, and follow a rail click to another (${motion.name})`, async () => {
      const link = await viz.given('a link to the "publish" stop', () => ({
        hash: "guide&stop=publish",
        before: motion.before,
      }));

      const page = await viz.when("someone opens it", async () => {
        const p = await open(link);
        await guideReady(p);
        return p;
      });

      await viz.then(
        "the guide opens there: the rail marks it and the stop is at the top of the view",
        async () => {
          await onStop(page, "publish");
          await atTop(page, "#stop-publish");
        },
      );

      await viz.when('the user clicks "Who can see it" on the rail', async () =>
        page.click('.rail-stop[data-stop="access"]'),
      );

      await viz.then("the guide moves there, and the URL names the new stop", async () => {
        await onStop(page, "access");
        await atTop(page, "#stop-access");
        expect(await page.evaluate(() => location.hash)).toBe("#guide&stop=access");
      });
    });

    it.concurrent(`should take a reader who keeps going at a gate to the top of the next band (${motion.name})`, async () => {
      const page = await viz.given("the Guide", async () => {
        const p = await open({ hash: "guide", before: motion.before });
        await guideReady(p);
        return p;
      });

      await viz.when('the reader takes "Keep going ↓" at the end of band 1', async () =>
        page.click("#gate-run .gate-go"),
      );

      await viz.then(
        'band 2, "Get Good", is at the top of the view, and the Guide is still the tab on show',
        async () => {
          await atTop(page, '.band[data-band="good"]');
          expect(await page.$eval('.band[data-band="good"] h2', (e) => e.textContent)).toBe(
            "Get Good",
          );
          expect(await activeTab(page)).toBe("guide");
        },
      );
    });

    it.concurrent(`should step a scrubbed figure with its arrows, its ticks and the arrow keys (${motion.name})`, async () => {
      const page = await viz.given('the "Your first ask" stop, at its first step', async () => {
        const p = await open({ hash: "guide", before: motion.before });
        await guideReady(p);
        await arriveAt(p, "ask");
        expect(await p.$eval("#ask-cap", (e) => e.textContent)).toBe("nothing yet");
        return p;
      });

      await viz.when("the reader presses →", async () => page.click("#stop-ask .fig-next"));
      await viz.then(
        "it is on step 2, and the machine side shows the form the agent chose",
        async () => {
          await atStep(page, "ask", "2 / 5");
          expect(await page.$eval("#ask-cap", (e) => e.textContent)).toBe(
            "form chosen — treemap, area = bytes",
          );
          expect(await page.$eval("#ask-body .form-pick", (e) => e.textContent)).toBe("treemap");
        },
      );

      await viz.when("the reader clicks the fourth tick", async () =>
        page.click("#stop-ask .fig-tick:nth-child(4)"),
      );
      await viz.then(
        "it is on step 4, the first four ticks are lit, and the page is live at a URL",
        async () => {
          await atStep(page, "ask", "4 / 5");
          expect(
            await page.$$eval("#stop-ask .fig-tick", (ts) =>
              ts.map((t) => t.classList.contains("on")),
            ),
          ).toEqual([true, true, true, true, false]);
          expect(await page.$eval("#ask-body .stage-url code", (e) => e.textContent)).toBe(
            "127.0.0.1:5180/…/skill-source/",
          );
        },
      );

      await viz.when("the reader presses ←", async () => page.click("#stop-ask .fig-prev"));
      await viz.then("it is back on step 3: the folder exists", async () => {
        await atStep(page, "ask", "3 / 5");
        expect(await page.$eval("#ask-body .stage-files", (e) => e.textContent)).toContain(
          "└─ index.html",
        );
      });

      await viz.when("the reader presses the right arrow key, twice", async () => {
        await page.keyboard.press("ArrowRight");
        await atStep(page, "ask", "4 / 5");
        await page.keyboard.press("ArrowDown");
      });
      await viz.then(
        "it is on the last step: the finished treemap, one cell per source entry",
        async () => {
          await atStep(page, "ask", "5 / 5");
          expect(await page.$eval("#ask-cap", (e) => e.textContent)).toBe(
            "rendered · 24 entries · 474 KB",
          );
          expect(await page.$$eval("#ask-tm .tm-cell", (cs) => cs.length)).toBe(24);
        },
      );

      await viz.when("the reader presses the left arrow key, then up", async () => {
        await page.keyboard.press("ArrowLeft");
        await atStep(page, "ask", "4 / 5");
        await page.keyboard.press("ArrowUp");
      });
      await viz.then("each steps back one", async () => {
        await atStep(page, "ask", "3 / 5");
      });
      await viz.then("the next scrubbed stop, below, never moved", async () => {
        expect(await position(page, "refine")).toBe("1 / 5");
      });
    });
  }

  it.concurrent("should open a #quickstart link at the install stop", async () => {
    const link = await viz.given(
      "a #quickstart link, the tab router's alias for the install stop",
      () => ({ hash: "quickstart", before: reducedMotion }),
    );

    const page = await viz.when("someone opens it", async () => {
      const p = await open(link);
      await guideReady(p);
      return p;
    });

    await viz.then('the guide opens at "Install", and the URL names it', async () => {
      await onStop(page, "install");
      await atTop(page, "#stop-install");
      expect(await page.evaluate(() => location.hash)).toBe("#guide&stop=install");
    });
  });

  it.concurrent("should open a first visit with no link at the top of the guide", async () => {
    const link = await viz.given(
      "a first visit, with nothing after the address",
      (): OpenOptions => ({ before: reducedMotion }),
    );

    const page = await viz.when("someone opens it", async () => {
      const p = await open(link);
      await guideReady(p);
      return p;
    });

    await viz.then("the Guide shows at its first stop, and the URL names it", async () => {
      expect(await activeTab(page)).toBe("guide");
      await onStop(page, "why");
      expect(await page.evaluate(() => [scrollY, location.hash])).toEqual([0, "#guide&stop=why"]);
    });
  });

  it.concurrent("should lay out the rail when a reader who opened the Dashboard switches to the Guide", async () => {
    const page = await viz.given("the Dashboard, in a short window, scrolled down", async () => {
      const p = await open({ hash: "dashboard", height: 420, before: reducedMotion });
      await p.waitForFunction(() => document.querySelector("#slugs")!.textContent !== "loading…");
      await p.evaluate(() => scrollTo(0, 300));
      await p.waitForFunction(() => scrollY > 0);
      return p;
    });

    await viz.when("a frame passes", async () => {
      await page.evaluate(async () => {
        await new Promise<void>((r) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              r();
            });
          });
        });
      });
    });
    await viz.then("the hidden Guide never claims the URL", async () => {
      expect(await page.evaluate(() => location.hash)).toBe("#dashboard");
    });

    await viz.when("the reader opens the Guide tab", async () => page.click("#tabbtn-guide"));

    const tops = await viz.then(
      "the rail spreads its stops down its full height, in order",
      async () => {
        try {
          await page.waitForFunction(
            () =>
              Number(
                document
                  .querySelector<HTMLElement>('.rail-stop[data-stop="bars"]')!
                  .style.top.replace("%", ""),
              ) > 80,
            { timeout: 10_000 },
          );
        } catch (e: unknown) {
          throw new Error(
            `the rail stayed crammed: ${await page.$eval('.rail-stop[data-stop="bars"]', (n) => (n instanceof HTMLElement ? n.style.top : ""))}`,
            { cause: e },
          );
        }
        const stopTops = await page.$$eval(".rail-stop", (ns) =>
          ns.map((n) =>
            n instanceof HTMLElement ? Number(n.style.top.replace("%", "")) : Number.NaN,
          ),
        );
        expect(stopTops[0]).toBe(0);
        expect(stopTops).toEqual(stopTops.toSorted((a, b) => a - b));
        return stopTops;
      },
    );
    await viz.then("the gates sit on the rail between their bands", async () => {
      const gate = await page.$eval('.rail-gate[data-gate="run"]', (n) =>
        n instanceof HTMLElement ? Number(n.style.top.replace("%", "")) : Number.NaN,
      );
      expect(gate).toBeGreaterThan(tops[3]!);
      expect(gate).toBeLessThan(tops[4]!);
    });

    await viz.when("the reader then follows a #quickstart link", async () => {
      await page.evaluate(() => {
        location.hash = "#quickstart";
      });
    });

    await viz.then('the Guide goes to "Install"', async () => {
      await onStop(page, "install");
      await atTop(page, "#stop-install");
    });
  });

  it.concurrent("should re-read the rail's progress when the window grows at the bottom of the guide", async () => {
    const { page, before } = await viz.given(
      "the guide scrolled to its very end, in a short window",
      async () => {
        const p = await open({ hash: "guide", height: 600, before: reducedMotion });
        await guideReady(p);
        await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await onStop(p, "bars");
        await p.waitForFunction(
          () => Number(document.querySelector("#rail-pct")!.textContent.replace("%", "")) > 90,
        );
        const pct = Number((await p.$eval("#rail-pct", (e) => e.textContent)).replace("%", ""));
        return { page: p, before: pct };
      },
    );

    await viz.when(
      "the window grows taller, so the page can no longer scroll as far and the read head (45% down the window) now sits higher up the guide",
      async () => page.setViewport({ width: 1280, height: 1000 }),
    );

    await viz.then(
      "the rail's progress drops to match, and it still marks the last stop",
      async () => {
        await page.waitForFunction(
          (b) => Number(document.querySelector("#rail-pct")!.textContent.replace("%", "")) < b,
          { timeout: 10_000 },
          before,
        );
        expect(
          await page.$eval(".rail-stop.on", (e) =>
            e instanceof HTMLElement ? e.dataset.stop : undefined,
          ),
        ).toBe("bars");
        expect(
          await page.$eval("#rail-fill", (e) => (e instanceof HTMLElement ? e.style.height : "")),
        ).toMatch(/^\d+(\.\d+)?%$/u);
      },
    );
  });

  it.concurrent("should say which viz release it documents, and switch install instructions by tab", async () => {
    const link = await viz.given("the Guide, over a server reporting viz 9.9.9-test", () => ({
      hash: "guide",
    }));

    const page = await viz.when("someone opens it", async () => {
      const p = await open(link);
      await guideReady(p);
      return p;
    });

    await viz.then("the install stop names that release", async () => {
      await page.waitForFunction(() => document.querySelector(".dl-ver")!.textContent !== "…");
      expect(await page.$eval(".dl-ver", (e) => e.textContent)).toBe(
        "These docs describe viz 9.9.9-test. ",
      );
    });

    await viz.when('the user picks the "chat" way in', async () =>
      page.click('.inst-tab[data-way="chat"]'),
    );

    await viz.then("only that pane shows", async () => {
      expect(
        await page.$$eval(".inst-pane.on", (els) =>
          els.map((e) => (e instanceof HTMLElement ? e.dataset.way : undefined)),
        ),
      ).toEqual(["chat"]);
    });
  });

  it.concurrent("should send a reader who stops at the first gate to the Dashboard", async () => {
    const page = await viz.given("the Guide", async () => {
      const p = await open({ hash: "guide" });
      await guideReady(p);
      return p;
    });

    await viz.when('the reader takes "Stop here" at the end of band 1', async () =>
      page.$eval("#gate-run .gate-stop", (b) => {
        if (!(b instanceof HTMLElement))
          throw new Error("the gate's Stop button is not an HTML element");
        b.click();
      }),
    );

    await viz.then("the Dashboard shows", async () => {
      expect(await activeTab(page)).toBe("dashboard");
    });
  });

  it.concurrent("should keep the rest of the guide when one figure fails to render", async () => {
    const { logged, options } = await viz.given(
      `a page where the "Who can see it" figure throws while it renders (its grid can't be found)`,
      () => {
        const messages: string[] = [];
        const opts: OpenOptions = {
          hash: "guide",
          before: async (p) => {
            p.on("console", (m) => {
              if (m.type() === "error") messages.push(m.text());
            });
            await p.evaluateOnNewDocument(() => {
              const proto: { querySelector: (this: Element, sel: string) => Element | null } =
                Element.prototype;
              const qs = proto.querySelector;
              proto.querySelector = function (this: Element, sel: string) {
                if (sel === "#pg-grid") throw new Error("stand-in: the grid is gone");
                return qs.call(this, sel);
              };
            });
          },
        };
        return { logged: messages, options: opts };
      },
    );

    const page = await viz.when("someone opens it", async () => {
      const p = await open(options);
      await guideReady(p);
      return p;
    });

    await viz.then("that stop says its figure failed", async () => {
      expect(await page.$eval("#fig-access", (e) => e.textContent.trim())).toBe(
        "This figure failed to render — see the console.",
      );
    });
    await viz.then("every figure after it still rendered", async () => {
      expect(
        await page.$$eval(
          "#fig-session, #fig-runtime, #fig-internals, #fig-map, #fig-bars",
          (els) => els.map((e) => e.children.length > 0),
        ),
      ).toEqual([true, true, true, true, true]);
      expect(await page.$$eval("#bars .bar", (bs) => bs.length)).toBe(5);
    });
    await viz.then("the console names the figure that failed", () => {
      expect(logged.some((l) => l.startsWith('[guide] figure "access" failed:'))).toBe(true);
    });
    await viz.then("no error escaped the page", () => {
      expect(page.errors).toEqual([]);
    });
  });
});

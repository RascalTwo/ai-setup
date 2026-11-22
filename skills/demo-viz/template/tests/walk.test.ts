// The demo as the human does it, driven by this page's own walk.json: every step reached by doing it
// (a web step by its action inside the app, never the guide's Next; a cli, agent or dev step by its
// button), ▶ Play doing the same by itself and "Do it myself" taking it back, then, on a live demo,
// the decision gate and a Send that `viz verify` never lets reach a pane, which shows the
// not-delivered state with the words kept.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { WalkSchema, type Walk } from "../walk.schema.ts";

const walk = WalkSchema.parse(
  JSON.parse(readFileSync(path.join(import.meta.dirname, "../walk.json"), "utf8")),
);
type P = Awaited<ReturnType<typeof viz.open>>;
// viz tags only its own smoke browser as automation, not a test's: tag this one too, so the page's
// Send is refused (api.ts) and no test ever types into a real pane.
const live = walk.mode === "live";
const open = async (o: { width?: number; height?: number } = {}): Promise<P> =>
  viz.open(undefined, {
    ...o,
    before: async (page) => {
      await page.setUserAgent({ userAgent: `${await page.browser().userAgent()} VizAutomation` });
    },
  });
type Frame = ReturnType<P["frames"]>[number];
/** "Try it yourself": the walkthrough folds away under the story until it's asked for. */
const tryIt = async (page: P): Promise<void> => {
  if (await page.$eval("#try", (e) => e instanceof HTMLElement && e.hidden))
    await page.click("#try-open");
};
/** Scrolls the control to the middle first: the page's fixed footer covers the bottom of the window, and a click on a covered control lands on the footer. */
const scrollAndClick = async (page: P, sel: string): Promise<void> => {
  await page.$eval(sel, (e) => {
    e.scrollIntoView({ block: "center" });
  });
  await page.click(sel);
};
const changes = walk.changes ?? [];
const cur = async (page: P): Promise<string | null> =>
  page.$eval("#pips .cur", (e) => e.textContent);
const reachedAll = async (page: P): Promise<void> => {
  await page.waitForFunction(
    (n) => document.querySelectorAll("#pips .pip.seen, #pips .pip.cur").length === n,
    { timeout: 15_000 },
    walk.steps.length,
  );
};

// The app scrolls inside its own frame: bring the element up first, as the human would.
async function press(f: Frame, sel: string) {
  await f.$eval(sel, (e) => {
    e.scrollIntoView({ block: "center" });
  });
  await f.click(sel);
}
/** What the human does on a web step, inside the app. */
async function doStep(app: Frame, s: Walk["steps"][number]) {
  /* oxlint-disable no-await-in-loop -- moves happen in order, as the human makes them */
  for (const a of s.act ?? []) {
    if ("click" in a) await press(app, a.click);
    else await app.select(a.select, a.value);
  }
  /* oxlint-enable no-await-in-loop */
  if (s.act) return;
  if (s.done && "value" in s.done) await app.select(s.done.sel, s.done.value);
  else if (s.done && s.target) await press(app, s.target);
  else
    await app.$eval(".driver-popover-next-btn", (b) => {
      if (b instanceof HTMLElement) b.click(); // a step that only asks them to look: the guide's Next
    });
}
async function appFrame(page: P): Promise<Frame> {
  await page.waitForFunction(() => document.querySelector("#pips .cur") !== null, {
    timeout: 30_000,
  });
  const f = page.frames().find((x) => x.url().includes("tour"));
  if (!f) throw new Error("the app's frame isn't on the page");
  await f.waitForSelector(".driver-popover", { timeout: 30_000 });
  return f;
}

// Runs under `viz verify` on a page made from this template; in the skill's own vitest run it skips.
describe.skipIf(!("viz" in globalThis))(
  `the ${walk.mode} ${walk.kind} demo of ${walk.change.commit}`,
  () => {
    it("should reach every step by doing it, the step marker following", async () => {
      const page = await viz.given("the demo page, with the build on its stage", async () =>
        open({ width: 1440, height: 900 }),
      );
      await tryIt(page);
      const app = walk.kind === "web" ? await appFrame(page) : null;
      if (!app)
        await viz.given("the sandbox back at its start (Start over)", async () => {
          await page.click("#reset");
          await page.waitForFunction(
            () => document.querySelector("#reset")?.textContent === "↺ Start over",
            {
              timeout: 60_000,
            },
          );
        });
      await viz.when("the human does each step the guide asks for", async () => {
        // One step at a time, in order: each waits on the one before it.
        /* oxlint-disable no-await-in-loop -- steps happen in order, each after the last */
        for (const [i, s] of walk.steps.entries()) {
          const last = i === walk.steps.length - 1;
          try {
            await page.waitForFunction(
              (id) => document.querySelector("#pips .cur")?.textContent === id,
              { timeout: 15_000 },
              s.id,
            );
            if (app) {
              await doStep(app, s);
              // Done by its action: the guide moved on (or, after the last step, ended) by itself.
              if (s.done && !last)
                await page.waitForFunction(
                  (id) => document.querySelector("#pips .cur")?.textContent !== id,
                  { timeout: 10_000 },
                  s.id,
                );
              if (s.done && last)
                await app.waitForFunction(
                  () => document.querySelector(".driver-popover") === null,
                  {
                    timeout: 10_000,
                  },
                );
            } else await page.click('#guide [data-g="run"], #guide [data-g="next"]');
          } catch (e) {
            throw new Error(`at ${s.id}: ${e instanceof Error ? e.message : String(e)}`, {
              cause: e,
            });
          }
        }
        /* oxlint-enable no-await-in-loop */
      });
      await viz.then("every step was reached, in order", async () => {
        await reachedAll(page);
        expect(await cur(page)).toBe(walk.steps.at(-1)?.id ?? "");
      });
      if (walk.kind === "cli")
        await viz.then("the rows to read are highlighted", async () => {
          // the last step's command may still be running when the loop ends: wait for its output
          await page.waitForFunction(() => document.querySelectorAll("#term-now mark").length > 0, {
            timeout: 10_000,
          });
        });
    }, 120_000);

    it("should replay every step by itself on Play, and hand the controls back on Do it myself", async () => {
      const page = await viz.given("the demo page, with the build on its stage", async () =>
        open({ width: 1440, height: 900 }),
      );
      const n = walk.steps.length;
      await tryIt(page);
      await viz.when("the human presses Play", async () => {
        await page.waitForFunction(() => document.querySelector("#pips .cur") !== null, {
          timeout: 30_000,
        });
        await page.click("#play-go");
      });
      await viz.then("the position reaches the last step and Play is ready again", async () => {
        await page.waitForFunction(
          (m, id) =>
            document.querySelector("#play-pos")?.textContent === `${m} / ${m}` &&
            document.querySelector("#play-go")?.textContent === "▶ Play" &&
            document.querySelector("#pips .cur")?.textContent === id, // the guide lags the position by its own glide
          { timeout: 90_000 },
          n,
          walk.steps.at(-1)?.id ?? "",
        );
        expect(await cur(page)).toBe(walk.steps.at(-1)?.id ?? "");
      });
      if (n > 1) {
        await viz.when("the human presses Play again, then Do it myself", async () => {
          await page.click("#play-go"); // from the end, the top
          await page.click("#play-mine");
        });
        await viz.then("Play stops where it was and offers Play again", async () => {
          expect(await page.$eval("#play-go", (b) => b.textContent)).toBe("▶ Play");
        });
      }
    }, 120_000);

    it.skipIf(changes.length === 0)(
      "should tell one change at a time, each as problem, before, after and why, with its pictures",
      async () => {
        const page = await viz.given("the demo page, story first", async () =>
          open({ width: 1440, height: 900 }),
        );
        type Seen = { title: string; forWho: boolean; up: number; pics: boolean };
        const seen: Seen[] = [];
        let folded = false;
        await viz.when("the human pages through every card with ›", async () => {
          folded = await page.$eval("#try", (e) => e instanceof HTMLElement && e.hidden === true);
          /* oxlint-disable no-await-in-loop -- one card after another, as the human pages through */
          for (const c of changes) {
            await page.waitForFunction(
              (t) => document.querySelector("#card h2")?.textContent === t,
              { timeout: 5000 },
              c.title,
            );
            // every picture loaded: a broken one has no width
            const pics = await page
              .waitForFunction(
                () =>
                  [...document.querySelectorAll("#card img")].every(
                    (m) => m instanceof HTMLImageElement && m.complete && m.naturalWidth > 0,
                  ),
                { timeout: 10_000 },
              )
              .then(() => true)
              .catch(() => false);
            seen.push({
              title: c.title,
              forWho: (await page.$eval("#card .who", (e) => e.textContent)).includes(
                walk.personas.find((p) => p.id === c.persona)?.who ?? "",
              ),
              up: await page.$$eval("#card .part.up", (x) => x.length),
              pics,
            });
            await page.click("#story-fwd");
          }
          /* oxlint-enable no-await-in-loop */
        });
        await viz.then(
          "the walkthrough was folded away, and each card named its change and who it's for, all four parts and pictures showing",
          async () => {
            expect(folded).toBe(true);
            expect(seen).toEqual(
              changes.map((c) => ({
                title: c.title,
                forWho: true,
                up: 4,
                pics: true,
              })),
            );
            expect(await page.$$eval("#card .recap li", (l) => l.length)).toBe(changes.length);
          },
        );
        if (live) {
          await viz.when("the human presses Approve all on the last card", async () => {
            await page.click('[data-end="Accepted"]');
          });
          await viz.then("Accept is picked in the decision", async () => {
            expect(
              await page.$eval('[data-decide="Accepted"]', (b) => b.classList.contains("on")),
            ).toBe(true);
          });
        }
      },
      60_000,
    );

    it.skipIf(changes.length === 0)(
      "should reveal a card's parts one by one on Play, and show them all on Pause",
      async () => {
        const page = await viz.given("the demo page, voice off", async () => open());
        await viz.when("the human turns the voice off and presses Play", async () => {
          await page.click("#story-voice");
          await page.click("#story-go");
        });
        await viz.then("the parts come up one at a time", async () => {
          await page.waitForFunction(
            () => document.querySelectorAll("#card .part.up").length === 1,
            { timeout: 8000 },
          );
          await page.waitForFunction(
            () => document.querySelectorAll("#card .part.up").length === 2,
            { timeout: 15_000 },
          );
        });
        await viz.when("the human presses Pause", async () => {
          await page.click("#story-go");
        });
        await viz.then("the whole card shows and Play is offered again", async () => {
          expect(await page.$$eval("#card .part.up", (x) => x.length)).toBe(4);
          expect(await page.$eval("#story-go", (b) => b.textContent)).toBe("▶ Play");
        });
      },
      60_000,
    );

    it.skipIf(!live)(
      "should keep Send and the agent's notes locked until a decision",
      async () => {
        const page = await viz.given("the demo page", async () => open());
        await viz.when("the human hasn't picked Accept or Changes yet");
        await viz.then(
          "Send is greyed out, says why, and the notes aren't on the page",
          async () => {
            expect(
              await page.$eval("#send", (b) => b instanceof HTMLButtonElement && b.disabled),
            ).toBe(true);
            expect(await page.$eval("#why", (e) => e.textContent)).toContain(
              "Pick Accept or Changes first",
            );
            expect(await page.$$eval("#notes li", (l) => l.length)).toBe(0);
          },
        );
      },
      60_000,
    );

    it.skipIf(!live)(
      "should say when Send didn't arrive, keep the words and offer Send again",
      async () => {
        const page = await viz.given(
          "the demo page, under viz verify (no pane to reach)",
          async () => open(),
        );
        await viz.when("the human picks Changes and presses Send", async () => {
          await scrollAndClick(page, '[data-decide="Changes"]');
          await scrollAndClick(page, "#send");
        });
        await viz.then("the notes open", async () => {
          expect(await page.$$eval("#notes li", (l) => l.length)).toBe(walk.notes.length);
        });
        await viz.then(
          "the page says it wasn't delivered, keeps the words, and offers Send again",
          async () => {
            await page.waitForSelector("#result.fail", { timeout: 10_000 });
            expect(await page.$eval("#result-line", (e) => e.textContent)).toStartWith(
              "Not delivered:",
            );
            expect(
              await page.$eval("#words", (e) => (e instanceof HTMLTextAreaElement ? e.value : "")),
            ).toContain(": Changes. Steps reached");
            expect(
              await page.$eval("#send", (b) => [
                b instanceof HTMLButtonElement && b.disabled,
                b.textContent,
              ]),
            ).toEqual([false, "Send again"]);
          },
        );
      },
      60_000,
    );

    it.skipIf(!live)(
      "should say what a yes does beside Accept, and never approve from viz verify",
      async () => {
        const page = await viz.given(
          "the demo page, under viz verify (no task to approve)",
          async () => open(),
        );
        await viz.when(
          "the human reads what Accept does, picks Accept and presses Send",
          async () => {
            expect(await page.$eval("#yes-text", (e) => e.textContent)).toBe(walk.yes ?? "");
            await scrollAndClick(page, '[data-decide="Accepted"]');
            await scrollAndClick(page, "#send");
          },
        );
        await viz.then(
          "the page said what a yes does, and Accept wasn't delivered: the words are kept",
          async () => {
            await page.waitForSelector("#result.fail", { timeout: 10_000 });
            expect(await page.$eval("#result-line", (e) => e.textContent)).toStartWith(
              "Not delivered:",
            );
            expect(
              await page.$eval("#words", (e) => (e instanceof HTMLTextAreaElement ? e.value : "")),
            ).toContain(": Accepted. Steps reached");
          },
        );
      },
      60_000,
    );
  },
);

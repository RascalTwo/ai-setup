// The walkthrough as the human does it, driven by this page's own walk.json: every step reached by
// doing it (a web step by its action inside the app, never the guide's Next; a cli step by its Run
// button), then the decision gate, then a Send that `viz verify` never lets reach a pane, which
// shows the not-delivered state with the words kept.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Walk } from "../walk.schema.js";

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- this viz's own walk.json, checked by from-spec.ts
const walk = JSON.parse(readFileSync(path.join(import.meta.dir, "../walk.json"), "utf8")) as Walk;
type P = Awaited<ReturnType<typeof viz.open>>;
// viz tags only its own smoke browser as automation, not a test's: tag this one too, so the page's
// Send is refused (api.ts) and no test ever types into a real pane.
const open = async (o: { width?: number; height?: number } = {}): Promise<P> =>
  viz.open(undefined, {
    ...o,
    before: async (page) => {
      await page.setUserAgent({ userAgent: `${await page.browser().userAgent()} VizAutomation` });
    },
  });
type Frame = ReturnType<P["frames"]>[number];
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

// Runs under `viz verify` on a page made from this template; in the skill's own `bun test` it skips.
describe.skipIf(!("viz" in globalThis))(
  `the ${walk.kind} walkthrough of ${walk.change.commit}`,
  () => {
    it("should reach every step by doing it, the step marker following", async () => {
      const page = await viz.given("the walkthrough page, with the build on its stage", async () =>
        open({ width: 1440, height: 900 }),
      );
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
          expect(await page.$$eval("#term-now mark", (m) => m.length)).toBeGreaterThan(0);
        });
    }, 120_000);

    it("should keep Send and the agent's notes locked until a decision", async () => {
      const page = await viz.given("the walkthrough page", async () => open());
      await viz.when("the human hasn't picked Accept or Changes yet");
      await viz.then("Send is greyed out, says why, and the notes aren't on the page", async () => {
        expect(await page.$eval("#send", (b) => b instanceof HTMLButtonElement && b.disabled)).toBe(
          true,
        );
        expect(await page.$eval("#why", (e) => e.textContent)).toContain(
          "Pick Accept or Changes first",
        );
        expect(await page.$$eval("#notes li", (l) => l.length)).toBe(0);
      });
    }, 60_000);

    it("should say when Send didn't arrive, keep the words and offer Send again", async () => {
      const page = await viz.given(
        "the walkthrough page, under viz verify (no pane to reach)",
        async () => open(),
      );
      await viz.when("the human picks Changes and presses Send", async () => {
        await page.click('[data-decide="Changes"]');
        await page.click("#send");
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
    }, 60_000);

    it("should say what a yes does beside Accept, and never approve from viz verify", async () => {
      const page = await viz.given(
        "the walkthrough page, under viz verify (no task to approve)",
        async () => open(),
      );
      await viz.when(
        "the human reads what Accept does, picks Accept and presses Send",
        async () => {
          expect(await page.$eval("#yes-text", (e) => e.textContent)).toBe(walk.yes);
          await page.click('[data-decide="Accepted"]');
          await page.click("#send");
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
    }, 60_000);
  },
);

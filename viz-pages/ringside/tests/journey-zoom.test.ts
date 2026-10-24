// Journey tests for hovering, outcomes, and zooming and panning the timeline.
import { describe, it, expect } from "bun:test";
import type { Page } from "puppeteer-core";
import {
  ID,
  SEC,
  call,
  result,
  chunk,
  session,
  stage,
  text,
  fire,
  tap,
  pause,
} from "./journey-helpers.js";

describe("hovering", () => {
  it.concurrent("should never move the conversation, however long the hovered action's detail is", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          prompts: [{ at: now - 60 * SEC, text: "go" }],
          calls: [
            call("none", "look", "No detail", now - 50 * SEC, { end: now - 49 * SEC, detail: "" }),
            call("short", "run", "Short detail", now - 40 * SEC, {
              end: now - 39 * SEC,
              detail: "ls",
            }),
            call("long", "change", "Long detail", now - 30 * SEC, {
              end: now - 29 * SEC,
              detail: "a very long command line ".repeat(40),
            }),
            call("err", "run", "Failing step", now - 20 * SEC, {
              end: now - 19 * SEC,
              error: true,
              detail: "x".repeat(700),
            }),
          ],
          results: [result("err", now - 19 * SEC, true, "e".repeat(300))],
        }),
    });
    const page = await viz.given("actions whose details run from none to very long", async () =>
      viz.open({ strips: [String(now - 60 * SEC)] }, { before }),
    );
    const layout = async (): Promise<number[]> =>
      page.evaluate(() => [
        document.querySelector("#convo")?.getBoundingClientRect().top ?? -1,
        document.querySelector("#picked")?.getBoundingClientRect().height ?? -1,
        document.documentElement.scrollHeight,
      ]);
    await viz.when("the page renders", async () => {
      await page.waitForSelector("#convo .act");
    });
    const rest = await viz.when("the layout is measured before any hover", layout);
    await viz.when(
      "the pointer passes over each bar, then over the conversation's rows",
      async () => {
        for (const id of ["none", "short", "long", "err"]) {
          // oxlint-disable-next-line no-await-in-loop -- one hover at a time, measured in between
          await fire(page, `rect[data-id="${id}"]`, "mouseover");
          // oxlint-disable-next-line no-await-in-loop -- measured after each hover
          expect(await layout()).toEqual(rest);
        }
        await fire(page, '#convo .act[data-id="long"]', "mouseover");
      },
    );
    await viz.then(
      "nothing moved, and the box showed the last bar's details clipped to one line each",
      async () => {
        expect(await layout()).toEqual(rest);
        const lines = await page.$$eval("#picked .pl", (ls) =>
          ls.map((l) => l.scrollHeight <= l.clientHeight + 2),
        );
        expect(lines).toEqual([true, true, true]);
        expect(await text(page, "#picked")).toContain("Failing step");
      },
    );
    await viz.then("hovering the conversation did not preview, but a click does", async () => {
      await tap(page, '#convo .act[data-id="long"]');
      expect(await text(page, "#picked")).toContain("Long detail");
      expect(await layout()).toEqual(rest);
    });
  });
});

describe("outcomes from the local model", () => {
  it.concurrent("should show what each finished action achieved, next to what it set out to do", async () => {
    const now = Date.now();
    const step = (id: string, label: string, ago: number): Record<string, unknown> =>
      call(id, "run", label, now - ago * SEC, { end: now - (ago - 5) * SEC, tool: "Bash" });
    const { before: stageBefore, seen } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          prompts: [{ at: now - 60 * SEC, text: "run the tests" }],
          calls: [
            step("o1", "Search the handlers", 50),
            step("o2", "Install the deps", 40),
            step("o3", "Lint the code", 30),
            step("o4", "Run the tests", 20),
            call("r1", "run", "Still building", now - 10 * SEC, { tool: "Bash", pos: 123 }),
          ],
        }),
      outcome: (id) =>
        ({
          o1: { outcome: "Found 3 handlers that never set a timeout" },
          o2: { status: 500, outcome: null },
          o3: { outcome: null },
          o4: { outcome: "1 test failed: test_refund_rounding" },
        })[id] ?? { outcome: null },
    });
    // Records the most "✦ …" pending markers the action list ever showed at once.
    const before = async (p: Page): Promise<void> => {
      await p.evaluateOnNewDocument(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const el = document.querySelector("#convo");
          if (!el) return;
          new MutationObserver(() => {
            const count = el.querySelectorAll(".out.pending").length;
            const max = Math.max(Number(document.body.dataset["pendingMax"] ?? 0), count);
            document.body.dataset["pendingMax"] = String(max);
          }).observe(el, { childList: true, subtree: true });
        });
      });
      await stageBefore(p);
    };
    const page = await viz.given(
      "four finished actions and one still running, with the strip open",
      async () => viz.open({ strips: [String(now - 60 * SEC)] }, { before }),
    );
    await viz.when("the model has answered for the finished ones", async () => {
      await page.waitForFunction(() => document.querySelectorAll("#convo .out").length === 2);
      await pause(1700);
    });
    await viz.then(
      "each answered action reads intent → outcome, marked as the model's",
      async () => {
        expect(await text(page, '.act[data-id="o4"]')).toContain(
          "Run the tests→ 1 test failed: test_refund_rounding ✦",
        );
        expect(await text(page, '.act[data-id="o1"]')).toContain(
          "→ Found 3 handlers that never set a timeout",
        );
        expect(
          await page.$$eval(
            '.act .out .ai[title="outcome written by local model"]',
            (e) => e.length,
          ),
        ).toBe(2);
        expect(
          await page.$$eval('.act[data-id="o2"] .out, .act[data-id="o3"] .out', (e) => e.length),
        ).toBe(0);
      },
    );
    await viz.then(
      "each action showed a pending marker while its outcome was being written, and none is left",
      async () => {
        expect(
          await page.evaluate(() => Number(document.body.dataset["pendingMax"] ?? 0)),
        ).toBeGreaterThanOrEqual(2);
        expect(await page.$$eval(".act .out.pending", (e) => e.length)).toBe(0);
      },
    );
    await viz.then(
      "only finished actions were asked about, once each, newest first, two at a time",
      () => {
        expect(seen.outcomes).toEqual(["o4", "o3", "o2", "o1"]);
        expect(seen.outcomePeak).toBe(2);
      },
    );
    await viz.then(
      "each request names the session, the call, where it is in the transcript and its intent",
      () => {
        const first = seen.outcomeBodies[0] ?? "";
        expect(first).toContain(`"session":"${ID}"`);
        expect(first).toContain('"agent":"main"');
        expect(first).toContain('"intent":"Run the tests"');
        expect(first).toMatch(/"pos":\d+/u);
      },
    );
    await viz.then("the Right now card shows the latest finished action's outcome", async () => {
      expect(await text(page, "#now-last")).toBe(
        "Last: Run the tests → 1 test failed: test_refund_rounding ✦",
      );
    });
    await viz.when("the viewer picks that action", async () => {
      await tap(page, '.act[data-id="o4"]');
    });
    await viz.then("the pick box shows the outcome too", async () => {
      expect(await text(page, "#picked")).toContain("→ 1 test failed: test_refund_rounding");
    });
  });
});

/**
 * Where a page element is, in page pixels. Found and measured in one in-page step: the timeline is
 * redrawn twice a second while something runs, and a handle held across steps can go stale.
 */
const where = async (
  page: Page,
  sel: string,
): Promise<{ x: number; y: number; w: number; h: number }> =>
  page.evaluate((s) => {
    const r = document.querySelector(s)?.getBoundingClientRect();
    return { x: r?.x ?? 0, y: r?.y ?? 0, w: r?.width ?? 0, h: r?.height ?? 0 };
  }, sel);
/** Focuses the timeline (an svg, which Puppeteer's own focus refuses). */
const focusTimeline = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    document.querySelector<SVGElement>("#timeline")?.focus();
  });
};
/** The timeline's drawing area (past the 124px label gutter), and the centre of lane `i`. */
const area = async (
  page: Page,
): Promise<{ left: number; right: number; lane: (i: number) => number }> => {
  const b = await where(page, "#timeline");
  return { left: b.x + 124, right: b.x + b.w - 10, lane: (i) => b.y + 26 + i * 28 + 14 };
};
const mid = (r: { x: number; w: number }): number => r.x + r.w / 2;

/** Ten minutes of a session: a prompt, three finished actions, and one still running. */
const spread = (now: number): object =>
  chunk({
    prompts: [{ at: now - 600 * SEC, text: "go" }],
    calls: [
      call("c1", "look", "First", now - 540 * SEC, { end: now - 530 * SEC }),
      call("c2", "run", "Second", now - 300 * SEC, { end: now - 290 * SEC }),
      call("c3", "change", "Third", now - 60 * SEC, { end: now - 50 * SEC }),
      call("c4", "look", "Running", now - 5 * SEC),
    ],
  });
const spreadStage = (now: number): ReturnType<typeof stage> =>
  stage({ sessions: [session(ID, now)], events: () => spread(now) });
const callCount = async (page: Page): Promise<number> => page.$$eval("rect.call", (r) => r.length);
/** Whether an element is actually on screen (not just without the hidden attribute). */
const shown = async (page: Page, sel: string): Promise<boolean> =>
  page.evaluate((s) => document.querySelector(s)?.checkVisibility() ?? false, sel);
const customShown = async (page: Page): Promise<boolean> => shown(page, "#viewctl");
const jumpShown = async (page: Page): Promise<boolean> => shown(page, "#jump-now");
/** Exactly one of "a preset is pressed" and "Custom shows" must hold. */
const viewState = async (page: Page): Promise<string> => {
  const pressed = await page.$$eval('#window button[aria-pressed="true"]', (b) => b.length);
  const custom = await customShown(page);
  return pressed + (custom ? 1 : 0) === 1
    ? custom
      ? "custom"
      : "preset"
    : `broken:${pressed}:${custom}`;
};

describe("zooming and panning the timeline", () => {
  it.concurrent("should zoom around the pointer, show Custom, keep the range in the link, and reset", async () => {
    const now = Date.now();
    const { before } = spreadStage(now);
    const page = await viz.given("a ten-minute round on the preset view", async () =>
      viz.open(undefined, { before }),
    );
    const c2 = await viz.when("the viewer wheels in over the second action", async () => {
      await page.waitForSelector('rect[data-id="c2"]');
      expect(await viewState(page)).toBe("preset");
      const r = await where(page, 'rect[data-id="c2"]');
      await page.mouse.move(mid(r), r.y + r.h / 2);
      await page.mouse.wheel({ deltaY: -400 });
      return { before: r, cursor: mid(r) };
    });
    await viz.then(
      "it grew under the pointer, the view is Custom, and no preset is lit",
      async () => {
        const after = await where(page, 'rect[data-id="c2"]');
        expect(after.w).toBeGreaterThan(c2.before.w * 1.5);
        expect(after.x).toBeLessThanOrEqual(c2.cursor + 2);
        expect(after.x + after.w).toBeGreaterThanOrEqual(c2.cursor - 2);
        expect(await customShown(page)).toBe(true);
        expect(await text(page, ".cust")).toBe("Custom");
        expect(await viewState(page)).toBe("custom");
      },
    );
    await viz.then(
      "the range is in the link, and Jump to now is offered since the edge left now",
      async () => {
        expect(decodeURIComponent(page.url())).toMatch(/"view":\{"span":\d+,"end":\d{10,}/u);
        expect(await jumpShown(page)).toBe(true);
      },
    );
    await viz.when("they press Reset", async () => {
      await page.click("#reset-view");
    });
    await viz.then("the preset is back and the width is as it was", async () => {
      expect(await customShown(page)).toBe(false);
      expect(await viewState(page)).toBe("preset");
      const back = await where(page, 'rect[data-id="c2"]');
      expect(Math.abs(back.w - c2.before.w)).toBeLessThan(3);
    });
  });

  it.concurrent("should pan by dragging empty space, by horizontal wheel, and not count a drag as a click", async () => {
    const now = Date.now();
    const { before } = spreadStage(now);
    const page = await viz.given("a view zoomed in on the second action", async () => {
      const p = await viz.open(undefined, { before });
      await p.waitForSelector('rect[data-id="c2"]');
      const r = await where(p, 'rect[data-id="c2"]');
      await p.mouse.move(mid(r), r.y + r.h / 2);
      await p.mouse.wheel({ deltaY: -700 });
      await p.mouse.wheel({ deltaY: -700 });
      return p;
    });
    const start = await where(page, 'rect[data-id="c2"]');
    const a = await area(page);
    await viz.when("the viewer drags empty space 120px to the right", async () => {
      await page.mouse.move(a.left + 200, a.lane(0));
      await page.mouse.down();
      await page.mouse.move(a.left + 260, a.lane(0), { steps: 4 });
      await page.mouse.move(a.left + 320, a.lane(0), { steps: 4 });
      await page.mouse.up();
    });
    await viz.then("the picture follows the pointer", async () => {
      const now2 = await where(page, 'rect[data-id="c2"]');
      expect(Math.abs(now2.x - start.x - 120)).toBeLessThan(4);
    });
    await viz.when("they wheel sideways", async () => {
      await page.mouse.move(a.left + 400, a.lane(0));
      await page.mouse.wheel({ deltaX: 150, deltaY: 0 });
    });
    await viz.then("the picture moves with it", async () => {
      const moved = await where(page, 'rect[data-id="c2"]');
      expect(Math.abs(start.x + 120 - moved.x - 150)).toBeLessThan(4);
    });
    await viz.when("a drag starts on empty space and ends over an action", async () => {
      const r = await where(page, 'rect[data-id="c2"]');
      await page.mouse.move(a.left + 40, a.lane(0));
      await page.mouse.down();
      await page.mouse.move(mid(r), r.y + r.h / 2, { steps: 6 });
      await page.mouse.up();
    });
    await viz.then("nothing was clicked", async () => {
      expect(await page.$$eval("rect.call.sel", (r) => r.length)).toBe(0);
    });
    await viz.when("they reset, press on an action and move, then click it", async () => {
      await page.click("#reset-view");
      const c3 = await where(page, 'rect[data-id="c3"]');
      await page.mouse.move(mid(c3), c3.y + c3.h / 2);
      await page.mouse.down();
      await page.mouse.move(mid(c3) - 80, c3.y + c3.h / 2, { steps: 4 });
      await page.mouse.up();
      await page.mouse.click(mid(c3), c3.y + c3.h / 2);
    });
    await viz.then("pressing on an action did not pan, and the click picked it", async () => {
      expect(await customShown(page)).toBe(false);
      expect(await page.$$eval('rect.call.sel[data-id="c3"]', (r) => r.length)).toBe(1);
    });
  });

  it.concurrent("should zoom into a shift-dragged range", async () => {
    const now = Date.now();
    const { before } = spreadStage(now);
    const page = await viz.given("the ten-minute view", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the viewer shift-drags a box around the second action", async () => {
      await page.waitForSelector('rect[data-id="c2"]');
      const r = await where(page, 'rect[data-id="c2"]');
      const a = await area(page);
      await page.keyboard.down("Shift");
      await page.mouse.move(r.x - 20, a.lane(0));
      await page.mouse.down();
      await page.mouse.move(r.x + 40, a.lane(0), { steps: 3 });
      expect(await page.$$eval("#timeline rect.brush", (b) => b.length)).toBe(1);
      await page.mouse.move(r.x + r.w + 20, a.lane(0), { steps: 3 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
    });
    await viz.then("that range fills the view, and the others are out of it", async () => {
      expect(await customShown(page)).toBe(true);
      expect(await page.$$eval("rect.call", (r) => r.map((e) => e.dataset.id))).toEqual(["c2"]);
      expect((await where(page, 'rect[data-id="c2"]')).w).toBeGreaterThan(300);
    });
  });

  it.concurrent("should zoom and pan from the keyboard", async () => {
    const now = Date.now();
    const { before } = spreadStage(now);
    const page = await viz.given("the timeline focused", async () => {
      const p = await viz.open(undefined, { before });
      await p.waitForSelector('rect[data-id="c2"]');
      await focusTimeline(p);
      return p;
    });
    const widthOf = async (): Promise<number> => (await where(page, 'rect[data-id="c2"]')).w;
    const first = await widthOf();
    await viz.when("they press plus, an unrelated key, then arrow left", async () => {
      await page.keyboard.press("+");
      await page.keyboard.press("a");
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowRight");
    });
    await viz.then("the view is zoomed in and Custom", async () => {
      expect(await widthOf()).toBeGreaterThan(first * 1.2);
      expect(await customShown(page)).toBe(true);
    });
    await viz.when("they press minus and then zero", async () => {
      await page.keyboard.press("-");
      await page.keyboard.press("=");
      await page.keyboard.press("0");
    });
    await viz.then("the preset is back", async () => {
      expect(await customShown(page)).toBe(false);
      expect(Math.abs((await widthOf()) - first)).toBeLessThan(3);
    });
  });

  it.concurrent("should stay pinned to now while following, and offer Jump to now once panned away", async () => {
    const now = Date.now();
    const { before } = spreadStage(now);
    const page = await viz.given("the view", async () => viz.open(undefined, { before }));
    await viz.when(
      "the viewer zooms in with the pointer at the right edge (now), holding Control",
      async () => {
        await page.waitForSelector('rect[data-id="c3"]');
        const a = await area(page);
        await page.mouse.move(a.right, a.lane(0));
        await page.keyboard.down("Control");
        await page.mouse.wheel({ deltaY: -150 });
        await page.keyboard.up("Control");
      },
    );
    const c3 = await where(page, 'rect[data-id="c3"]');
    await viz.then(
      "the view is Custom but still pinned to now, so there is no Jump button",
      async () => {
        expect(await customShown(page)).toBe(true);
        expect(await jumpShown(page)).toBe(false);
        expect(decodeURIComponent(page.url())).toContain('"end":null');
      },
    );
    await viz.then(
      "as time advances the picture slides left while the running bar stays at the edge",
      async () => {
        await pause(1300);
        const later = await where(page, 'rect[data-id="c3"]');
        expect(later.x).toBeLessThan(c3.x - 1);
        const run = await where(page, 'rect[data-id="c4"]');
        const a = await area(page);
        expect(Math.abs(run.x + run.w - a.right)).toBeLessThan(3);
      },
    );
    await viz.when("they pan left with the arrow key", async () => {
      await focusTimeline(page);
      await page.keyboard.press("ArrowLeft");
    });
    await viz.then("Jump to now appears and the view stops following", async () => {
      expect(await jumpShown(page)).toBe(true);
      const held = await where(page, 'rect[data-id="c3"]');
      await pause(900);
      expect(Math.abs((await where(page, 'rect[data-id="c3"]')).x - held.x)).toBeLessThan(0.5);
    });
    await viz.when("they press Jump to now", async () => {
      await page.click("#jump-now");
    });
    await viz.then("the view is pinned again", async () => {
      expect(await jumpShown(page)).toBe(false);
      expect(decodeURIComponent(page.url())).toContain('"end":null');
    });
  });

  it.concurrent("should open on the range in the link", async () => {
    const now = Date.now();
    const { before } = spreadStage(now);
    const page = await viz.given(
      "a link to the minute around the second action, ending 280s ago",
      async () => viz.open({ view: { span: 60 * SEC, end: now - 280 * SEC } }, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("rect.call");
    });
    await viz.then("it is Custom, not following, and shows only that minute", async () => {
      expect(await customShown(page)).toBe(true);
      expect(await jumpShown(page)).toBe(true);
      expect(await page.$$eval("rect.call", (r) => r.map((e) => e.dataset.id))).toEqual(["c2"]);
    });
  });

  it.concurrent("should ignore other mouse buttons and plain clicks on empty space", async () => {
    const now = Date.now();
    const { before } = spreadStage(now);
    const page = await viz.given("the view", async () => viz.open(undefined, { before }));
    await viz.when(
      "the viewer right-drags, and clicks empty space on both the timeline and the overview",
      async () => {
        await page.waitForSelector("rect.call");
        const a = await area(page);
        await page.mouse.move(a.left + 100, a.lane(0));
        await page.mouse.down({ button: "right" });
        await page.mouse.move(a.left + 300, a.lane(0), { steps: 3 });
        await page.mouse.up({ button: "right" });
        await page.mouse.click(a.left + 200, a.lane(0));
        await page.$eval("#overview", (e) => {
          e.scrollIntoView({ block: "center" });
        });
        const ov = await where(page, "#overview");
        await page.mouse.move(ov.x + 140, ov.y + 20);
        await page.mouse.down({ button: "right" });
        await page.mouse.up({ button: "right" });
        await page.mouse.click(ov.x + 400, ov.y + 20);
      },
    );
    await viz.then("the view is unchanged", async () => {
      expect(await customShown(page)).toBe(false);
    });
  });
});

describe("the overview", () => {
  it.concurrent("should show the whole session, and set the start, the end and the window by dragging", async () => {
    const now = Date.now();
    const { before } = spreadStage(now);
    const page = await viz.given("the ten-minute view", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("rect.ov-win");
    });
    await viz.then(
      "the overview draws every action in its lane colour, and its window spans the session",
      async () => {
        expect(await page.$$eval("#overview rect.ov-call", (r) => r.length)).toBe(4);
        const win = await where(page, "rect.ov-win");
        const ov = await where(page, "#overview");
        expect(win.w).toBeGreaterThan(ov.w - 124 - 20);
      },
    );
    await viz.when("the viewer drags the window's left edge toward the right", async () => {
      const h = await where(page, 'rect.ov-h[data-ov="l"]');
      await page.mouse.move(h.x + 3, h.y + 10);
      await page.mouse.down();
      await page.mouse.move(h.x + 300, h.y + 10, { steps: 5 });
      await page.mouse.up();
    });
    const narrowed = await callCount(page);
    await viz.then(
      "the start moved later, so fewer actions show, and the view is Custom",
      async () => {
        expect(narrowed).toBeLessThan(4);
        expect(await customShown(page)).toBe(true);
      },
    );
    await viz.when("they drag the right edge left, and then the window itself left", async () => {
      const r = await where(page, 'rect.ov-h[data-ov="r"]');
      await page.mouse.move(r.x + 2, r.y + 10);
      await page.mouse.down();
      await page.mouse.move(r.x - 40, r.y + 10, { steps: 4 });
      await page.mouse.up();
      const w = await where(page, "rect.ov-win");
      await page.mouse.move(w.x + w.w / 2, w.y + 10);
      await page.mouse.down();
      await page.mouse.move(w.x + w.w / 2 - 200, w.y + 10, { steps: 5 });
      await page.mouse.up();
    });
    await viz.then("an earlier part of the session is in view", async () => {
      const ids = await page.$$eval("rect.call", (r) => r.map((e) => e.dataset.id));
      expect(ids).toContain("c1");
    });
    await viz.when("they brush a range on the overview outside the window", async () => {
      await page.$eval("#overview", (e) => {
        e.scrollIntoView({ block: "center" });
      });
      const w = await where(page, "rect.ov-win");
      const ov = await where(page, "#overview");
      await page.mouse.move(w.x + w.w + 60, ov.y + 20);
      await page.mouse.down();
      await page.mouse.move(w.x + w.w + 100, ov.y + 20, { steps: 3 });
      expect(await page.$$eval("#overview rect.brush", (b) => b.length)).toBe(1);
      await page.mouse.move(w.x + w.w + 160, ov.y + 20, { steps: 3 });
      await page.mouse.up();
    });
    await viz.then("the view is that range", async () => {
      expect(await customShown(page)).toBe(true);
      expect(await page.$$eval("#overview rect.brush", (b) => b.length)).toBe(0);
    });
  });
});

describe("zooming with folded gaps", () => {
  it.concurrent("should fold idle gaps inside a zoomed view and zoom around any point of it", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          prompts: [{ at: now - 1500 * SEC, text: "go" }],
          calls: [
            call("e1", "look", "Early", now - 1490 * SEC, { end: now - 1480 * SEC }),
            call("e2", "run", "Late", now - 20 * SEC, { end: now - 10 * SEC }),
          ],
        }),
    });
    const page = await viz.given(
      "a link to a range covering two bursts with a long quiet stretch between",
      async () => viz.open({ view: { span: 1600 * SEC, end: null } }, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("rect.call");
    });
    await viz.then("the timeline and the overview each fold the gap into one break", async () => {
      expect(await page.$$eval("#timeline rect.gap", (r) => r.length)).toBe(1);
      expect(await page.$$eval("#overview rect.ov-gap", (r) => r.length)).toBe(1);
    });
    await viz.when("the viewer zooms in before the break, inside it, and after it", async () => {
      const a = await area(page);
      for (const at of ["before", "inside", "after"]) {
        // oxlint-disable-next-line no-await-in-loop -- each zoom starts from the whole-session view
        await page.click('#window button[data-w="all"]');
        // oxlint-disable-next-line no-await-in-loop -- measured fresh after the switch
        const g = await where(page, "#timeline rect.gap");
        const x = { before: a.left + 20, inside: g.x + g.w / 2, after: a.right - 20 }[at] ?? 0;
        // oxlint-disable-next-line no-await-in-loop -- one pointer move at a time
        await page.mouse.move(x, a.lane(0));
        // oxlint-disable-next-line no-await-in-loop -- one wheel at a time
        await page.mouse.wheel({ deltaY: -100 });
      }
    });
    await viz.then("the view is still Custom and the page is fine", async () => {
      expect(await customShown(page)).toBe(true);
      expect(page.errors).toEqual([]);
    });
  });
});

describe("labelling what the reader can see", () => {
  it.concurrent("should work on the visible range newest first, backfill when it widens, drop what leaves view, and follow open strips", async () => {
    const now = Date.now();
    const ids = ["u1", "u2", "u3", "u4", "u5", "u6"];
    const { before: stageBefore, seen } = stage({
      sessions: [session(ID, now)],
      delay: 600,
      events: () =>
        chunk({
          prompts: [{ at: now - 600 * SEC, text: "look things up" }],
          calls: ids.map((id, i) =>
            call(id, "outside", `mcp ${id}`, now - (550 - i * 100) * SEC, {
              tool: "mcp__x__y",
              end: now - (549 - i * 100) * SEC,
              needsLabel: true,
              summary: `{"q":"${id}"}`,
            }),
          ),
        }),
      label: (id) => ({ label: `Label for ${id}` }),
    });
    // Records every text the progress note shows, from the moment the page starts.
    const before = async (p: Page): Promise<void> => {
      await p.evaluateOnNewDocument(() => {
        document.addEventListener("DOMContentLoaded", () => {
          const el = document.querySelector("#ai-note");
          if (!el) return;
          new MutationObserver(() => {
            document.body.dataset["noteLog"] =
              `${document.body.dataset["noteLog"] ?? ""}${el.textContent ?? ""}|`;
          }).observe(el, { childList: true, characterData: true, subtree: true });
        });
      });
      await stageBefore(p);
    };
    const page = await viz.given(
      "six unlabelled actions over ten minutes, the view on the last 200 seconds",
      async () => viz.open({ view: { span: 200 * SEC, end: null } }, { before }),
    );
    const waitFor = async (what: () => boolean): Promise<void> => {
      for (let i = 0; i < 100 && !what(); i++) {
        // oxlint-disable-next-line no-await-in-loop -- polling the fake backend's log
        await pause(100);
      }
    };
    await viz.when("the model starts", async () => {
      await waitFor(() => seen.labelled.length >= 2);
    });
    await viz.then(
      "only the two actions in view are asked about, the newest first, and the note counts what is in view",
      async () => {
        expect(seen.labelled).toEqual(["u6", "u5"]);
        const notes = await page.evaluate(() => document.body.dataset["noteLog"] ?? "");
        expect(notes).toContain("✦ labelling 0 of 4 in view|");
      },
    );
    await viz.when("the viewer widens to the whole session", async () => {
      await pause(900);
      await page.click('#window button[data-w="all"]');
      await waitFor(() => seen.labelled.length >= 4);
    });
    await viz.then("the older ones are backfilled, newest first", () => {
      expect(seen.labelled.slice(0, 4)).toEqual(["u6", "u5", "u4", "u3"]);
    });
    await viz.when("they narrow the view again with a brush before the rest are sent", async () => {
      const a = await area(page);
      await page.keyboard.down("Shift");
      await page.mouse.move(a.right - 150, a.lane(5));
      await page.mouse.down();
      await page.mouse.move(a.right - 10, a.lane(5), { steps: 4 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      await pause(2200);
    });
    await viz.then("the two that left the view were never sent", () => {
      expect(seen.labelled).toEqual(["u6", "u5", "u4", "u3"]);
    });
    await viz.when("the viewer opens the conversation strip that holds them", async () => {
      await tap(page, ".strip-h");
      await waitFor(() => seen.labelled.length >= 6);
    });
    await viz.then(
      "they are labelled after all, newest first, and the note clears once everything is done",
      async () => {
        expect(seen.labelled).toEqual(["u6", "u5", "u4", "u3", "u2", "u1"]);
        await page.waitForFunction(() => document.querySelector("#ai-note")?.textContent === "");
        expect(await page.$$eval("#convo .act .ai", (e) => e.length)).toBe(6);
      },
    );
  });
});

describe("the whole conversation", () => {
  const many = (now: number): object =>
    chunk({
      prompts: Array.from({ length: 12 }, (_, i) => ({
        at: now - (13 - i) * 100 * SEC,
        text: `Question ${i + 1}. ${"detail ".repeat(40)}`,
      })),
    });

  it.concurrent("should always list every turn, mark those in the timeline's range, and scroll to them when the range changes", async () => {
    const now = Date.now();
    const { before } = stage({ sessions: [session(ID, now)], events: () => many(now) });
    const page = await viz.given(
      "twelve prompts and the view on This round (only the last one)",
      async () => viz.open(undefined, { before }),
    );
    const inRange = async (): Promise<string[]> =>
      page.$$eval("#convo .turn.inrange", (e) => e.map((x) => x.id));
    await viz.when("the page renders", async () => {
      await page.waitForSelector("#turn-12");
    });
    await viz.then("every turn is listed, and only the last is marked as in range", async () => {
      expect(await page.$$eval("#convo .turn.user", (e) => e.length)).toBe(12);
      expect(await inRange()).toEqual(["turn-12"]);
      expect(
        await page.$eval("#convo", (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 24),
      ).toBe(true);
    });
    await viz.when(
      "the viewer picks Whole session without having scrolled the conversation",
      async () => {
        await page.click('#window button[data-w="all"]');
      },
    );
    await viz.then("all twelve are marked and the first is scrolled into view", async () => {
      expect(await inRange()).toHaveLength(12);
      await page.waitForFunction(() => (document.querySelector("#convo")?.scrollTop ?? 1) < 20);
    });
  });

  it.concurrent("should leave the conversation where it is when the reader scrolled it in the last ten seconds", async () => {
    const now = Date.now();
    const { before } = stage({ sessions: [session(ID, now)], events: () => many(now) });
    const page = await viz.given(
      "twelve prompts, with the reader's pointer over the conversation",
      async () => viz.open(undefined, { before }),
    );
    await viz.when("the reader scrolls the conversation, then widens the timeline", async () => {
      await page.waitForSelector("#turn-12");
      await page.evaluate(() => {
        document.querySelector("#convo")?.scrollIntoView();
      });
      const c = await where(page, "#convo");
      await page.mouse.move(c.x + c.w / 2, c.y + 100);
      await page.mouse.wheel({ deltaY: -20 });
      await page.click('#window button[data-w="all"]');
      await pause(400);
    });
    await viz.then("the range is marked but the conversation did not jump", async () => {
      expect(await page.$$eval("#convo .turn.inrange", (e) => e.length)).toBe(12);
      expect(await page.$eval("#convo", (e) => e.scrollTop)).toBeGreaterThan(200);
    });
  });
});

describe("when a helper counts as finished", () => {
  it.concurrent("should not show a helper as running once it has ended or gone quiet", async () => {
    const now = Date.now();
    const sub = (id: string, tag: string, ago: number): object =>
      call(id, "run", `Step ${id}`, now - ago * SEC, { agent: tag, tool: "Bash" });
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          prompts: [{ at: now - 70 * SEC, text: "go" }],
          calls: [
            call("agentP", "delegate", "Sending helpers", now - 60 * SEC, { tool: "Agent" }),
            sub("xa", "ha Quiet helper", 300),
            sub("xb", "hb Finished helper", 20),
            sub("xc", "hc Busy helper", 20),
          ],
          agents: [
            { id: "ha", description: "Quiet helper", toolUseId: "agentP", final: false },
            { id: "hb", description: "Finished helper", toolUseId: "agentP", final: true },
            { id: "hc", description: "Busy helper", toolUseId: "agentP", final: false },
          ],
        }),
    });
    const page = await viz.given(
      "a helper with an unfinished call from five minutes ago, one whose transcript ended, and one active now",
      async () => viz.open(undefined, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("text.helper-status");
    });
    const statusOf = async (name: string): Promise<string> =>
      page.evaluate((n) => {
        const rows = [...document.querySelectorAll("text.helper-row")];
        const i = rows.findIndex((r) => r.textContent?.includes(n));
        return document.querySelectorAll("text.helper-status")[i]?.getAttribute("class") ?? "none";
      }, name);
    await viz.then("only the one still active is running", async () => {
      expect(await statusOf("Quiet")).toContain("done");
      expect(await statusOf("Finished")).toContain("done");
      expect(await statusOf("Busy")).toContain("running");
    });
  });
});

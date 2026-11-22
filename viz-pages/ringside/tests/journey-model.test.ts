// Journey tests for a backend whose local model will not answer the page (as under viz verify).
import { describe, it, expect } from "vitest";
import { ID, SEC, call, chunk, session, stage, pause } from "./journey-helpers.js";

describe("a backend whose model won't answer", () => {
  it("should ask the local model nothing, however much is waiting", async () => {
    const now = Date.now();
    // The same session as the conversation's live round, which asks two summaries when the model answers.
    const { before, seen } = stage({
      sessions: [session(ID, now)],
      model: false,
      events: () =>
        chunk({
          prompts: [{ at: now - 60 * SEC, text: "go" }],
          says: [
            { at: now - 50 * SEC, text: "Looking first" },
            { at: now - 20 * SEC, text: "Now building" },
          ],
          calls: [
            call("p1", "look", "Read the notes", now - 80 * SEC, {
              end: now - 79 * SEC,
              needsLabel: true,
            }),
            call("p2", "look", "Read the plan", now - 75 * SEC, { end: now - 74 * SEC }),
            call("w0", "look", "Read the lock", now - 55 * SEC, {
              end: now - 54 * SEC,
              needsLane: true,
            }),
            call("w1", "run", "Run the build", now - 15 * SEC),
            call("w2", "run", "Run the tests", now - 10 * SEC),
          ],
        }),
    });
    const page = await viz.given(
      "finished calls with no label, between notes and a prompt",
      async () => viz.open(undefined, { before }),
    );
    await viz.when("the page renders and polls a few times", async () => {
      await page.waitForSelector("#convo .strip");
      await pause(3000);
    });
    await viz.then("no label, outcome, summary or story was asked for", async () => {
      expect(await page.$$eval("#convo .strip", (e) => e.length)).toBeGreaterThan(0);
      expect(seen.labelled).toEqual([]);
      expect(seen.outcomes).toEqual([]);
      expect(seen.beats).toEqual([]);
      expect(seen.stories).toEqual([]);
    });
  });
});

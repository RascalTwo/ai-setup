// Journey tests for watching a session, its subagents, and the conversation, driven in a real browser.
import { describe, it, expect } from "bun:test";
import {
  ID,
  ID2,
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
  justify,
  type Spec,
} from "./journey-helpers.js";

describe("the conversation", () => {
  it.concurrent("should show time waiting on me only while Claude sat idle", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          prompts: [300, 200, 100].map((s, i) => ({ at: now - s * SEC, text: `p${i}` })),
          says: [290, 190, 90].map((s, i) => ({ at: now - s * SEC, text: `r${i}` })),
          calls: [call("bg", "run", "Watch the logs", now - 150 * SEC)],
        }),
    });
    const page = await viz.given(
      "three rounds, and a background call left running from the second",
      async () => viz.open({ w: "all" }, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("#timeline rect.call");
    });
    await viz.then("only the first wait, with nothing running, is mine", async () => {
      expect(await page.$$eval("#timeline rect.you", (e) => e.map((r) => r.dataset.label))).toEqual(
        ["Waiting on you, 1m 30s"],
      );
      expect(
        await page.$$eval("#timeline .you-label", (e) =>
          e.map((t) => `${t.textContent} ${t.getAttribute("opacity")}`),
        ),
      ).toEqual(["you · 1m 30s 1"]);
    });
    await viz.when("the window shrinks to the last minute", async () => {
      await page.$eval("#mins", (box) => {
        if (!(box instanceof HTMLInputElement)) return;
        box.value = "1";
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });
    await viz.then("that wait is out of view and not drawn", async () => {
      expect(await page.$$eval("#timeline rect.you", (e) => e.length)).toBe(0);
    });
    await viz.when("they step back one round", async () => {
      await tap(page, "#round-prev");
    });
    await viz.then("the panel and the timeline show round 2 and its running call", async () => {
      expect(await text(page, "#round-h")).toBe("Round 2 of 3 · p1");
      expect(await text(page, "#round-meta")).toContain("actions 1");
      expect(await page.$$eval("rect.call", (r) => r.length)).toBe(1);
      expect(await page.$eval("#round-latest", (b) => b.hasAttribute("disabled"))).toBe(false);
    });
    await viz.when("they step back to the first round", async () => {
      await tap(page, "#round-prev");
    });
    await viz.then(
      "it took as long as its reply, can go no further back, and is in the link",
      async () => {
        expect(await text(page, "#round-h")).toBe("Round 1 of 3 · p0");
        expect(await text(page, "#round-meta")).toContain("took 10s");
        expect(await page.$eval("#round-prev", (b) => b.hasAttribute("disabled"))).toBe(true);
        expect(decodeURIComponent(page.url())).toContain('"r":1');
      },
    );
    await viz.when("they step forward, then jump to the latest", async () => {
      await tap(page, "#round-next");
      await tap(page, "#round-latest");
    });
    await viz.then("the panel follows the latest round again", async () => {
      expect(await text(page, "#round-h")).toBe("Round 3 of 3 · p2");
      expect(decodeURIComponent(page.url())).toContain('"r":null');
    });
  });

  it.concurrent("should keep Claude's newest words at the bottom while it is still working", async () => {
    const now = Date.now();
    const { before, seen } = stage({
      sessions: [session(ID, now)],
      beat: () => ({ status: 500, beat: null }),
      story: () => ({ status: 500, story: null }),
      events: () =>
        chunk({
          prompts: [{ at: now - 60 * SEC, text: "go" }],
          says: [
            { at: now - 50 * SEC, text: "Looking first" },
            { at: now - 20 * SEC, text: "Now building" },
          ],
          calls: [
            call("p1", "look", "Read the notes", now - 80 * SEC, { end: now - 79 * SEC }),
            call("p2", "look", "Read the plan", now - 75 * SEC, { end: now - 74 * SEC }),
            call("w0", "look", "Read the lock", now - 55 * SEC, { end: now - 54 * SEC }),
            call("w1", "run", "Run the build", now - 15 * SEC),
            call("w2", "run", "Run the tests", now - 10 * SEC),
          ],
        }),
    });
    const page = await viz.given("a live round: two notes, then a build still running", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("#convo .strip");
    });
    await viz.then(
      "the newest note sits below the folded one, marked as still working",
      async () => {
        expect(await text(page, ".turn.claude .md")).toBe("Now building");
        expect(await text(page, ".turn.claude .meta")).toContain("still working");
        expect(await page.$$eval(".strip-h", (e) => e.map((h) => h.textContent))).toContain(
          "▸ 1 action · 1 note · 5s",
        );
      },
    );
    await viz.then(
      "only the finished strip is summed up; a failed answer leaves its counts",
      async () => {
        await pause(900);
        expect(await page.$$eval("#timeline .run-stripes", (e) => e.length)).toBe(2);
        expect(await page.$$eval("#timeline rect.you", (e) => e.length)).toBe(0);
        expect(seen.beats).toHaveLength(2);
        expect(seen.beats.join()).toContain("Read the lock");
        expect(seen.beats.join()).toContain("(start of the session)");
        expect(seen.stories.length).toBeGreaterThan(0);
        expect(await text(page, "#story")).toContain("The story is written once");
        expect(await page.$$eval(".beat", (e) => e.length)).toBe(0);
      },
    );
  });

  it.concurrent("should read as what was said, what was said back, and what happened between", async () => {
    const now = Date.now();
    const { before, seen } = stage({
      sessions: [session(ID, now)],
      beat: () => ({
        beat: "Fix the build → pin fixed, build still failing\n- The pin was off.\n- The build still fails.",
      }),
      outcome: (id) => ({ outcome: id === "c1" ? "Read 120 lines" : null }),
      story: () => ({
        story: "The build was fixed.\n### Fixing the build (P1-P2)\n- The pin was off.",
      }),
      events: () =>
        chunk({
          prompts: [
            {
              at: now - 300 * SEC,
              text: `${"Please look at the build. ".repeat(14)}\n<b>not bold</b>`,
            },
            { at: now - 100 * SEC, text: "And one more thing" },
          ],
          says: [
            { at: now - 275 * SEC, text: "Checking the *pin* first" },
            {
              at: now - 250 * SEC,
              text: "**Done** with `code`\n- one\n- two\n\n1. first\nplain after\n```\ncode here\n```\n[docs](https://example.com)\n<script>x</script>\n\n### Plan\n> quoted **q**\n\n| name | n |\n|---|---|\n| `a` | **1** |\n| b \\| c | 2 |\n\n3. three\n- nested\n4. four\n\n**Tables show `| pipes |` raw.** and *italic `x`*",
            },
            { at: now - 90 * SEC, text: "On it" },
            { at: now - 60 * SEC, text: "All **set** with `code`.\n```\nopen" },
          ],
          calls: [
            call("c1", "look", "Read the config", now - 290 * SEC, { end: now - 289 * SEC }),
            call("c2", "run", "Run the build", now - 280 * SEC, {
              end: now - 270 * SEC,
              error: true,
            }),
            call("c3", "change", "Fix the pin", now - 260 * SEC, { end: now - 255 * SEC }),
            call("c4", "look", "Look again", now - 200 * SEC, { end: now - 195 * SEC }),
          ],
        }),
    });
    const page = await viz.given(
      "a conversation with two prompts, two replies and four actions, the whole session in view",
      async () => viz.open({ w: "all" }, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("#convo .strip");
    });
    await viz.then(
      "it runs oldest first: me, what happened (and what it said on the way), its reply, what happened, me, it",
      async () => {
        const order = await page.$$eval("#convo > *", (els) =>
          els.map((e) => e.className.replace(" inrange", "")),
        );
        expect(order).toEqual([
          "turn user",
          "strip",
          "turn claude",
          "strip",
          "turn user",
          "strip",
          "turn claude",
        ]);
      },
    );
    await viz.then("my message is right-aligned and whole, with HTML shown as text", async () => {
      expect(await justify(page, ".turn.user")).toBe("flex-end");
      const mine = await text(page, "#turn-1 .text");
      expect(mine.length).toBeGreaterThan(300);
      expect(mine).toContain("<b>not bold</b>");
    });
    await viz.then("its reply is left-aligned Markdown, with nothing unescaped", async () => {
      expect(await justify(page, ".turn.claude")).toBe("flex-start");
      expect(await page.$$eval(".turn.claude .md strong", (e) => e.length)).toBe(5);
      expect(await page.$$eval(".turn.claude .md strong code", (e) => e.length)).toBe(1);
      expect(await page.$$eval(".turn.claude .md em code", (e) => e.length)).toBe(1);
      expect(
        await page.$$eval(
          '.turn.claude .md ol[start="3"], .turn.claude .md ol[start="4"]',
          (e) => e.length,
        ),
      ).toBe(2);
      expect(await text(page, "#now-said")).toBe("“All set with code. open”");
      expect(await text(page, ".turn.claude .md h3")).toBe("Plan");
      expect(await text(page, ".turn.claude .md blockquote")).toBe("quoted q");
      const cells = await page.$$eval(".turn.claude .md td, .turn.claude .md th", (c) =>
        c.map((e) => e.textContent),
      );
      expect(cells).toEqual(["name", "n", "a", "1", "b | c", "2"]);
      expect(await page.$$eval(".turn.claude .md td strong", (e) => e.length)).toBe(1);
      expect(await page.$$eval(".turn.claude .md li", (e) => e.length)).toBe(6);
      expect(await page.$$eval(".turn.claude .md pre", (e) => e.length)).toBe(2);
      expect(
        await page.$$eval('.turn.claude .md a[href="https://example.com"]', (e) => e.length),
      ).toBe(1);
      expect(await page.$$eval(".turn.claude .md script", (e) => e.length)).toBe(0);
    });
    await viz.then("each strip says what happened, in brief", async () => {
      const strips = await page.$$eval(".strip-h", (els) => els.map((e) => e.textContent));
      expect(strips).toEqual([
        "▸ 3 actions · 1 note · 35s · 1 failed",
        "▸ 1 action · 5s",
        "▸ 1 note · 0s",
      ]);
      expect(await page.$$eval(".strip-h .ticks i", (e) => e.length)).toBe(4);
    });
    await viz.then(
      "the strip with more than one step gets one model-written line, from its steps in order",
      async () => {
        await page.waitForSelector(".beat:not(.pending)");
        expect(await text(page, ".beat p")).toBe("Fix the build → pin fixed, build still failing");
        expect(await page.$$eval(".beat li", (e) => e.map((l) => l.textContent))).toEqual([
          "The pin was off.",
          "The build still fails.",
        ]);
        expect(await page.$$eval(".beat .ai", (e) => e.length)).toBe(1);
        await page.waitForSelector("#story h3");
        expect(await text(page, "#story h3")).toBe("Fixing the build (P1-P2)");
        expect(await text(page, "#story li")).toBe("The pin was off.");
        expect(await page.$$eval("#story .ai", (e) => e.length)).toBe(1);
        const told = seen.stories.at(-1) ?? "";
        expect(told).toContain("P1: Please look at the build.");
        expect(told).toContain("What the agent did:\\nFix the build → pin fixed");
        expect(told).toContain("What the agent did (not summed up yet): Look again");
        expect(seen.beats).toHaveLength(1);
        expect(seen.beats[0]).toContain(
          '"steps":["Read the config → Read 120 lines","Run the build (failed)","Claude said: Checking the pin first","Fix the pin"]',
        );
        expect(seen.beats[0]).toContain('"after":"**Done**');
      },
    );
    await viz.when("the viewer opens the first strip", async () => {
      await tap(page, ".strip-h");
    });
    await viz.then(
      "the finished turn shows as time waiting on me, and nothing is striped",
      async () => {
        expect(await page.$$eval("#timeline rect.you", (e) => e.length)).toBe(1);
        expect(await page.$$eval("#timeline .run-stripes", (e) => e.length)).toBe(0);
      },
    );
    await viz.then("its actions are listed and the choice is kept in the link", async () => {
      expect(await page.$$eval(".strip .acts li.act", (e) => e.length)).toBe(3);
      const rows = await page.$$eval(".strip .acts > li", (els) => els.map((e) => e.className));
      expect(rows).toEqual(["act", "act err", "note", "act"]);
      expect(await page.$$eval(".strip .note .md em", (e) => e.length)).toBe(1);
      expect(await page.$eval(".strip-h", (e) => e.getAttribute("aria-expanded"))).toBe("true");
      expect(decodeURIComponent(page.url())).toContain('"strips":["');
    });
    await viz.when("they pick an action and then close the strip", async () => {
      await tap(page, '.act[data-id="c2"]');
      await tap(page, ".strip-h");
    });
    await viz.then("the action was shown above, and the strip is collapsed again", async () => {
      expect(await text(page, "#picked")).toContain("Run the build");
      expect(await page.$$eval(".strip .acts", (e) => e.length)).toBe(0);
    });
  });

  it.concurrent("should follow new messages only while the reader is at the bottom", async () => {
    const now = Date.now();
    const many = Array.from({ length: 30 }, (_, i) => ({
      at: now - (31 - i) * 60 * SEC,
      text: `Message ${i + 1}. ${"filler ".repeat(30)}`,
    }));
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () => chunk({ prompts: many }),
      later: (poll) =>
        chunk({ prompts: [{ at: now - 5 * SEC + poll, text: `Newer ${poll}` }] }, 10),
    });
    const page = await viz.given("a long conversation, opened on the whole session", async () =>
      viz.open({ w: "all" }, { before }),
    );
    const gap = async (): Promise<number> =>
      page.$eval("#convo", (e) => e.scrollHeight - e.scrollTop - e.clientHeight);
    const nextPoll = async (): Promise<void> => {
      await page.waitForResponse((r) => r.url().includes("/api/events"));
      await pause(400);
    };
    await viz.when("the page renders", async () => {
      await page.waitForSelector("#turn-30");
    });
    await viz.then("it starts at the bottom", async () => {
      expect(await page.$eval("#convo", (e) => e.scrollHeight > e.clientHeight + 200)).toBe(true);
      expect(await gap()).toBeLessThan(24);
    });
    await viz.when("the reader scrolls up and a new message arrives", async () => {
      await page.$eval("#convo", (e) => {
        e.scrollTop = 0;
      });
      await nextPoll();
    });
    await viz.then("the new message is there but the view did not move", async () => {
      expect(await page.$$eval("#convo .turn", (e) => e.length)).toBeGreaterThan(30);
      expect(await page.$eval("#convo", (e) => e.scrollTop)).toBe(0);
    });
    await viz.when("the reader returns to the bottom and another arrives", async () => {
      await page.$eval("#convo", (e) => {
        e.scrollTop = e.scrollHeight;
      });
      await nextPoll();
    });
    await viz.then("the view stays at the bottom", async () => {
      expect(await gap()).toBeLessThan(24);
    });
    await viz.when("they click the second prompt marker on the timeline", async () => {
      await tap(page, 'text.prompt-tag[data-turn="2"]');
    });
    await viz.then("the conversation scrolls to that turn", async () => {
      // Waits for it to settle: under load a redraw can land between the click and one quick read.
      const settled = await page
        .waitForFunction(
          () => {
            const top = document.querySelector("#convo")?.scrollTop ?? -1;
            const turn = document.querySelector("#turn-2");
            return turn instanceof HTMLElement && Math.abs(top - (turn.offsetTop - 8)) < 2;
          },
          { timeout: 3000 },
        )
        .then(() => true)
        .catch(() => false);
      expect(settled).toBe(true);
    });
  });
});

describe("watching a session", () => {
  it.concurrent("should show what Claude is doing right now and draw each action on the timeline", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [
            call("a", "look", "Reading server.ts", now - 40 * SEC),
            call("b", "run", "Build the image", now - 12 * SEC),
          ],
          results: [result("a", now - 38 * SEC, false, "FROM python")],
          prompts: [{ at: now - 60 * SEC, text: "fix the pins" }],
        }),
    });
    const page = await viz.given("a session where a build is running", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page has polled the transcript twice", async () => {
      await page.waitForSelector('rect[data-label="Build the image"]');
      await page.waitForResponse((r) => r.url().includes("/api/events"));
      await pause(600);
    });
    await viz.then("the now card names the running command", async () => {
      expect(await text(page, "#now-verb")).toBe("Build the image");
    });
    await viz.then("both actions are bars, in their lanes' colours", async () => {
      const fills = await page.$$eval("rect.call", (rs) => rs.map((r) => r.getAttribute("fill")));
      expect(fills).toEqual(["var(--c1)", "var(--c5)"]);
    });
  });

  it.concurrent("should say how many actions run in parallel", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [
            call("a", "run", "Run the tests", now - 20 * SEC),
            call("b", "look", "Search the code", now - 10 * SEC),
          ],
        }),
    });
    const page = await viz.given("a session with two actions running and no prompts", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the window is widened to everything", async () => {
      await page.waitForSelector("rect.call");
      await page.click('#window button[data-w="all"]');
    });
    await viz.then("the now card counts the extra action", async () => {
      expect(await text(page, "#now-h")).toContain("+1 more in parallel");
    });
    await viz.then("both actions are still drawn", async () => {
      expect(await page.$$eval("rect.call", (r) => r.length)).toBe(2);
    });
  });

  it.concurrent("should summarise a finished round: files changed, failures, and a handover", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      // The failed call's result arrives in an earlier chunk than the call itself.
      events: (from) =>
        from === 0
          ? chunk(
              {
                more: true,
                results: [result("bad", now - 5 * SEC, true, "exit 1")],
                prompts: [{ at: now - 30 * SEC, text: "change a.ts" }],
              },
              5,
            )
          : chunk({
              calls: [
                call("w1", "change", "Writing a.ts", now - 25 * SEC, { file: "/r/a.ts", plus: 3 }),
                call("w2", "change", "Editing a.ts", now - 20 * SEC, {
                  file: "/r/a.ts",
                  plus: 3,
                  minus: 1,
                }),
                call("bad", "run", "Run the build", now - 10 * SEC),
                call("bad", "run", "Run the build", now - 10 * SEC),
                call("r1", "look", "Reading b.ts", now - 8 * SEC, { file: "/r/b.ts" }),
              ],
              results: [
                result("w1", now - 24 * SEC),
                result("w2", now - 19 * SEC),
                result("r1", now - 7 * SEC),
              ],
              says: [{ at: now - 1 * SEC, text: "All done." }],
            }),
    });
    const page = await viz.given("a session whose round just finished with one failure", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page has caught up", async () => {
      await page.waitForSelector(".strip");
    });
    await viz.then("the now card hands over to the room", async () => {
      expect(await text(page, "#now-h")).toBe("Turn finished");
      expect(await text(page, "#now-said")).toContain("All done.");
    });
    await viz.then(
      "it shows how the round's time split, its slowest action, and a waiting timer",
      async () => {
        expect(await text(page, "#now-summary")).toBe(
          "Round took 29s · Run 63% · Change 25% · Look 13%\nSlowest: Run the build (5s)",
        );
        expect(await text(page, "#status")).toMatch(/^waiting on you · \d+s$/u);
      },
    );
    await viz.then("the round counts the failure and sums the edits per file", async () => {
      expect(await text(page, "#round-h")).toContain("Round 1");
      expect(await text(page, "#round-meta")).toContain("errors 1");
      const chips = await text(page, "#round-files");
      expect(chips).toContain("a.ts");
      expect(chips).toContain("+6");
      expect(chips).not.toContain("b.ts");
    });
  });

  it.concurrent("should say Thinking while the turn is live but nothing is running", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [call("a", "look", "Reading x", now - 12 * SEC, { end: now - 3 * SEC })],
          prompts: [{ at: now - 30 * SEC, text: "look around" }],
          says: [{ at: now - 20 * SEC, text: "Looking." }],
        }),
    });
    const page = await viz.given("a live session between actions", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("rect.call");
    });
    await viz.then("the now card says it is thinking", async () => {
      expect(await text(page, "#now-verb")).toBe("Thinking…");
    });
  });

  it.concurrent("should call a session idle after ten quiet minutes", async () => {
    const now = Date.now();
    const start = now - 20 * 3600 * SEC;
    const { before } = stage({
      sessions: [session(ID, start)],
      events: () =>
        chunk({
          calls: [
            call("a", "run", "Long build", start + 10 * SEC, { end: start + 68710 * SEC }),
            // A helper step that never got a result: idle sessions must not treat it as running.
            call("h", "run", "Helper step", start + 20 * SEC, { agent: "h1 Old helper" }),
          ],
          agents: [{ id: "h1", description: "Old helper", toolUseId: "a" }],
          prompts: [{ at: start, text: "build it" }],
        }),
    });
    const page = await viz.given("a session that went quiet yesterday", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page renders and its clock ticks", async () => {
      await page.waitForSelector("rect.call");
      await pause(700);
    });
    await viz.then("the now card and the status say idle", async () => {
      expect(await text(page, "#now-h")).toBe("Session idle");
      expect(await text(page, "#status")).toContain("idle since");
    });
    await viz.then("the conversation shows how long the build took", async () => {
      expect(await text(page, "#convo")).toContain("19h 05m");
    });
  });

  it.concurrent("should explain itself when there is no session yet", async () => {
    const { before } = stage({ sessions: [] });
    const page = await viz.given("no sessions on disk", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page loads and the window is widened", async () => {
      await page.waitForFunction(() => document.querySelector("#status")?.textContent !== "");
      await page.click('#window button[data-w="all"]');
    });
    await viz.then("every panel shows its empty state", async () => {
      expect(await text(page, "#status")).toBe("no sessions found");
      expect(await text(page, "#now-verb")).toBe("No session yet");
      expect(await text(page, "#round-h")).toBe("This round");
      expect(await text(page, "#convo")).toBe("Nothing yet.");
    });
  });
});

describe("exploring the timeline", () => {
  it.concurrent("should narrow the window and show a call's details when it is picked", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [
            call("old", "run", "Old failing step", now - 14 * 60 * SEC, {
              end: now - 13 * 60 * SEC,
              detail: "",
            }),
            call("new", "look", "Fresh step", now - 20 * SEC),
          ],
          results: [result("old", now - 12.5 * 60 * SEC, true, "boom")],
          prompts: [{ at: now - 15 * 60 * SEC, text: "go" }],
        }),
    });
    const page = await viz.given("a round that began fifteen minutes ago", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the viewer picks the last ten minutes", async () => {
      await page.waitForSelector("rect.call");
      await page.click('#window button[data-w="last"]');
    });
    await viz.then("only the recent action is drawn", async () => {
      expect(await page.$$eval("rect.call", (r) => r.length)).toBe(1);
      expect(await page.$$eval("text.prompt-tag", (r) => r.length)).toBe(0);
    });
    await viz.when("they stretch it to twenty minutes, after a nonsense entry", async () => {
      await page.$eval("#mins", (box) => {
        if (!(box instanceof HTMLInputElement)) return;
        for (const v of ["0", "20"]) {
          box.value = v;
          box.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    });
    await viz.then("the older work and its prompt come back, and the link keeps 20", async () => {
      expect(await page.$$eval("rect.call", (r) => r.length)).toBe(2);
      expect(await page.$$eval("text.prompt-tag", (r) => r.length)).toBe(1);
      expect(decodeURIComponent(page.url())).toContain('"mins":20');
    });
    await viz.when("they widen it, pick the old call, and hover empty space", async () => {
      await page.click('#window button[data-w="all"]');
      await tap(page, 'rect[data-id="old"]');
      await fire(page, "#timeline", "mouseover");
      await fire(page, "#window", "click");
    });
    await viz.then("the picked call is marked and described, error included", async () => {
      expect(await page.$$eval("rect.call.sel.err", (r) => r.length)).toBe(1);
      const picked = await text(page, "#picked");
      expect(picked).toContain("Old failing step");
      expect(picked).toContain("error");
      expect(picked).toContain("boom");
    });
    // Read in the same step as the hover: the page's own refresh re-shows the clicked call a moment later.
    const hovered = await viz.when("they hover a running call on the timeline", async () =>
      page.evaluate(() => {
        document
          .querySelector('rect[data-id="new"]')
          ?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        return document.querySelector("#picked")?.textContent ?? "";
      }),
    );
    await viz.then("its elapsed time is shown", () => {
      expect(hovered).toContain("still running");
    });
    const tagged = async (): Promise<string> => text(page, "#picked .tag");
    await viz.when("the pointer leaves the timeline", async () => {
      await fire(page, "#timeline", "mouseleave");
    });
    await viz.then("the box goes back to the pinned call", async () => {
      expect(await tagged()).toBe("pinned ×");
      expect(await text(page, "#picked")).toContain("Old failing step");
    });
    const after: string[] = [];
    await viz.when("they let go by clicking it again, by Esc, and by the chip", async () => {
      await tap(page, 'rect[data-id="old"]');
      after.push(await tagged());
      await tap(page, 'rect[data-id="old"]');
      await page.keyboard.press("Escape");
      after.push(await tagged());
      await tap(page, 'rect[data-id="old"]');
      await tap(page, "#picked .unpin");
      after.push(await tagged());
      await tap(page, "#picked");
      await page.keyboard.press("Escape");
    });
    await viz.then("each time the box follows the newest action again, unpinned", async () => {
      expect(after).toEqual(["latest", "latest", "latest"]);
      expect(await text(page, "#picked")).toContain("Fresh step");
      expect(await page.$$eval("rect.call.sel", (r) => r.length)).toBe(0);
    });
  });

  it.concurrent("should switch between sessions and follow the newest on request", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now, "newest"), session(ID2, now - 60 * SEC, "older")],
      events: () => chunk({ prompts: [{ at: now - 5 * SEC, text: "hi" }] }),
    });
    const page = await viz.given(
      "two sessions with the newest followed and a link naming a call that does not exist",
      async () => viz.open({ sel: "ghost" }, { before }),
    );
    await viz.when("the viewer picks the older session", async () => {
      await page.waitForSelector("#session option");
      await page.select("#session", ID2);
    });
    await viz.then("following switches off", async () => {
      expect(await page.$eval("#follow", (e) => e instanceof HTMLInputElement && e.checked)).toBe(
        false,
      );
      expect(await page.$eval("#session", (e) => e instanceof HTMLSelectElement && e.value)).toBe(
        ID2,
      );
    });
    await viz.when("they tick follow again", async () => {
      await page.click("#follow");
      await page.waitForFunction(
        (id) => document.querySelector<HTMLSelectElement>("#session")?.value === id,
        {},
        ID,
      );
    });
    await viz.then("the newest session is shown again", async () => {
      expect(await page.$eval("#follow", (e) => e instanceof HTMLInputElement && e.checked)).toBe(
        true,
      );
    });
  });

  it.concurrent("should open on the session, window and call named in the link", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [call("b", "run", "Build the image", now - 12 * SEC, { end: now - 2 * SEC })],
        }),
    });
    const page = await viz.given(
      "a link to a session that is not the newest, with a call picked",
      async () => viz.open({ id: ID2, follow: false, w: "last", sel: "b" }, { before }),
    );
    await viz.when("the page loads", async () => {
      await page.waitForSelector("rect.call.sel");
    });
    await viz.then("that session is kept and the picked call is described", async () => {
      expect(await page.$eval("#session", (e) => e instanceof HTMLSelectElement && e.value)).toBe(
        ID2,
      );
      expect(await text(page, "#picked")).toContain("Build the image");
    });
  });
});

describe("backend errors", () => {
  it.concurrent("should show a failing backend in red until polling recovers", async () => {
    const now = Date.now();
    const spec: Spec = {
      sessions: [session(ID, now)],
      events: () => chunk({ prompts: [{ at: now - 5 * SEC, text: "hi" }] }),
      down: true,
    };
    const { before } = stage(spec);
    const page = await viz.given("a backend whose events route answers 500", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page polls", async () => {
      await page.waitForFunction(() =>
        document.querySelector("#status")?.textContent?.includes("backend error"),
      );
    });
    await viz.then("the status pill says so, in red, and promises a retry", async () => {
      expect(await text(page, "#status")).toMatch(/^backend error: .*, retrying$/u);
      expect(await page.$$eval("#status.bad", (e) => e.length)).toBe(1);
    });
    await viz.when("the backend comes back", async () => {
      spec.down = false;
      await page.waitForFunction(
        () => !document.querySelector("#status")?.textContent?.includes("backend error"),
      );
    });
    await viz.then("the error clears on the next good poll", async () => {
      expect(await text(page, "#status")).toBe("live");
      expect(await page.$$eval("#status.bad", (e) => e.length)).toBe(0);
    });
  });
});

const helperCalls = (now: number): object[] => {
  const sub = (
    id: string,
    tag: string,
    lane: string,
    label: string,
    start: number,
    extra = {},
  ): object => call(id, lane, label, start, { agent: tag, ...extra });
  return [
    call("agentP", "delegate", "Sending a helper: Lint", now - 60 * SEC, { tool: "Agent" }),
    call("agentF", "delegate", "Sending a helper: Flaky", now - 55 * SEC, {
      tool: "Agent",
      end: now - 30 * SEC,
      error: true,
    }),
    sub("s0", "h1 Clear lint", "look", "Reading the config", now - 50 * SEC, {
      end: now - 45 * SEC,
    }),
    sub("s2", "h1 Clear lint", "delegate", "Sending a helper: Nested", now - 40 * SEC, {
      tool: "Agent",
    }),
    sub("s1", "h1 Clear lint", "run", "Running viz verify", now - 30 * SEC),
    sub("n1", "h2 Nested check", "run", "Run the tests", now - 20 * SEC),
    sub("f1", "h3 Flaky helper", "look", "Reading a file", now - 50 * SEC, { end: now - 40 * SEC }),
    // Finished well over 30s ago, so it reads as done even with no launching call to go by.
    sub("g1", "h9 Ghost helper", "look", "Reading a ghost", now - 45 * SEC, {
      end: now - 44 * SEC,
    }),
  ];
};
const helperAgents = [
  { id: "h1", description: "Clear lint", toolUseId: "agentP" },
  { id: "h2", description: "Nested check", toolUseId: "s2" },
  { id: "h3", description: "Flaky helper", toolUseId: "agentF" },
];

describe("subagents", () => {
  it.concurrent("should show each helper as a summary row and open it on a click", async () => {
    const now = Date.now();
    const { before, seen } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: helperCalls(now),
          prompts: [{ at: now - 70 * SEC, text: "lint it" }],
          agents: helperAgents,
          subs: { h1: 77 },
        }),
    });
    const page = await viz.given("a round where a helper launched a helper", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page has polled twice", async () => {
      await page.waitForSelector("rect.helper-row");
      await page.waitForResponse((r) => r.url().includes("/api/events"));
    });
    await viz.then("every helper has one collapsed row with its status", async () => {
      const labels = await page.$$eval("text.lane-label.helper-row", (ts) =>
        ts.map((t) => t.textContent),
      );
      expect(labels.map((l) => l?.replace(/^.*\)/u, ""))).toEqual([
        "▸ Clear lint",
        "▸ Nested che…",
        "▸ Flaky helper",
        "▸ Ghost helper",
      ]);
    });
    await viz.then(
      "running, failed and done are told apart, and nested rows are indented",
      async () => {
        const status = async (cls: string): Promise<number> =>
          page.$$eval(`text.helper-status.${cls}`, (e) => e.length);
        expect([await status("running"), await status("failed"), await status("done")]).toEqual([
          2, 1, 1,
        ]);
        const xs = await page.$$eval("text.lane-label.helper-row", (ts) =>
          ts.map((t) => Number(t.getAttribute("x"))),
        );
        expect(xs).toEqual([8, 18, 8, 8]);
        expect(await page.$$eval("rect.spark", (e) => e.length)).toBeGreaterThan(0);
      },
    );
    await viz.then(
      "connectors run from the launching bars, and the cursor is handed back",
      async () => {
        expect(await page.$$eval("path.link", (e) => e.length)).toBe(3);
        expect(seen.subs).toContain('{"h1":77}');
      },
    );
    await viz.when(
      "the viewer clicks the first helper's row and the failed helper's Agent bar",
      async () => {
        await tap(page, 'rect.helper-row[data-agent="h1"]');
        await tap(page, 'rect.call[data-id="agentF"]');
      },
    );
    await viz.then(
      "both open into seven mini lanes and the choice is kept in the link",
      async () => {
        expect(await page.$$eval("text.mini-label", (e) => e.length)).toBe(14);
        expect(
          await page.$$eval("text.lane-label.helper-row", (ts) =>
            ts.slice(0, 1).map((t) => t.textContent?.replace(/^.*\)/u, "").slice(0, 1)),
          ),
        ).toEqual(["▾"]);
        expect(decodeURIComponent(page.url())).toContain('"open":["h1","h3"]');
        expect(await page.$$eval('rect.call[data-id="s1"]', (e) => e.length)).toBe(1);
      },
    );
    await viz.when("the viewer picks one of the helper's bars and closes its row", async () => {
      await tap(page, 'rect.call[data-id="s1"]');
      await tap(page, 'rect.helper-row[data-agent="h3"]');
    });
    await viz.then("the pick names the helper, and the row is a summary again", async () => {
      expect(await text(page, "#picked")).toContain("helper “Clear lint”");
      expect(await page.$$eval("text.mini-label", (e) => e.length)).toBe(7);
    });
  });

  it.concurrent("should nest a helper's actions under the call that launched it, and show what runs now", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: helperCalls(now),
          prompts: [{ at: now - 70 * SEC, text: "lint it" }],
          agents: helperAgents,
        }),
    });
    const page = await viz.given(
      "a round with nested helpers and one with no known launcher",
      async () => viz.open(undefined, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector(".strip-h");
      await tap(page, ".strip-h");
      await page.waitForSelector(".acts");
    });
    await viz.then("the strip counts the actions, helpers and failures", async () => {
      expect(await text(page, ".strip-h")).toMatch(/^▾ 8 actions · .* · 4 helpers · 1 failed/u);
    });
    await viz.then(
      "each helper's actions are grouped under its name, indented by depth",
      async () => {
        const rows = await page.$$eval("#convo .acts > li", (ls) =>
          ls.map((l) => [
            l.dataset.id ?? `H:${l.textContent}`,
            l instanceof HTMLElement ? l.style.marginLeft : "",
          ]),
        );
        expect(rows).toEqual([
          ["agentP", ""],
          ["agentF", ""],
          ["H:↳ Clear lint", "16px"],
          ["s0", "16px"],
          ["s2", "16px"],
          ["s1", "16px"],
          ["H:↳ Flaky helper", "16px"],
          ["f1", "16px"],
          ["H:↳ Ghost helper", "16px"],
          ["g1", "16px"],
          ["H:↳ Nested check", "32px"],
          ["n1", "32px"],
        ]);
      },
    );
    await viz.then("the now card lists what each helper is doing", async () => {
      expect(await text(page, "#now-helpers")).toBe(
        "+ helper 'Clear lint': Running viz verify\n+ helper 'Nested check': Run the tests",
      );
    });
  });

  it.concurrent("should show a helper's action when only the helper is running", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [
            call("agentP", "delegate", "Sending a helper: Lint", now - 60 * SEC, {
              tool: "Agent",
              end: now - 5 * SEC,
            }),
            call("s1", "run", "Running viz verify", now - 30 * SEC, { agent: "h1 Clear lint" }),
          ],
          prompts: [{ at: now - 70 * SEC, text: "lint it" }],
          agents: [helperAgents[0]],
        }),
    });
    const page = await viz.given(
      "a helper still running after its Agent call came back, opened from the link",
      async () => viz.open({ open: ["h1"] }, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForSelector("text.mini-label");
    });
    await viz.then("the now card shows the helper's action itself", async () => {
      expect(await text(page, "#now-verb")).toBe("Running viz verify");
      expect(await text(page, "#now-helpers")).toBe("");
      expect(await page.$$eval("text.mini-label", (e) => e.length)).toBe(7);
    });
  });
});

describe("labels from the local model", () => {
  it.concurrent("should label calls that have none, two at a time, and mark the labels as the model's", async () => {
    const now = Date.now();
    const ids = ["n1", "n2", "n3", "n4", "n5"];
    const { before, seen } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: ids.map((id, i) =>
            call(id, "outside", `mcp ${id}`, now - (30 - i) * SEC, {
              tool: "mcp__x__y",
              end: now - (29 - i) * SEC,
              needsLabel: true,
              summary: `{"q":"${id}"}`,
            }),
          ),
          prompts: [{ at: now - 40 * SEC, text: "look things up" }],
        }),
      label: (id) =>
        ({
          n1: { label: "Looking up Jira issue" },
          n2: { label: null },
          n3: { status: 500, label: null },
          n4: { label: "Listing Gmail threads" },
          n5: { label: "Opening a browser tab" },
        })[id] ?? { label: null },
    });
    const page = await viz.given("five calls with only fallback labels", async () =>
      viz.open({ strips: [String(now - 40 * SEC)] }, { before }),
    );
    await viz.when("the model has answered for all of them", async () => {
      await page.waitForFunction(() => document.querySelectorAll("#convo .ai").length === 3);
      await pause(1700);
    });
    await viz.then("answers replace the fallback labels and carry the marker", async () => {
      expect(await text(page, '#convo li[data-id="n5"]')).toContain("Opening a browser tab ✦");
      expect(await page.$eval('#convo li[data-id="n2"]', (e) => e.textContent ?? "")).toContain(
        "mcp n2",
      );
      expect(
        await page.$$eval('#convo .ai[title="label written by local model"]', (e) => e.length),
      ).toBe(3);
    });
    await viz.then("never more than two were asked at once, and none twice, newest first", () => {
      expect(seen.peak).toBe(2);
      expect(seen.labelled).toHaveLength(5);
      expect(seen.labelled.slice(0, 2)).toEqual(["n5", "n4"]);
    });
  });
});

describe("the end of a round", () => {
  it.concurrent("should summarise a round that had no actions", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          prompts: [{ at: now - 30 * SEC, text: "say hi" }],
          says: [{ at: now - 1 * SEC, text: "Hi!" }],
        }),
    });
    const page = await viz.given("a round where Claude only replied", async () =>
      viz.open(undefined, { before }),
    );
    await viz.when("the page renders", async () => {
      await page.waitForFunction(
        () => document.querySelector("#now-h")?.textContent === "Turn finished",
      );
    });
    await viz.then("the summary has the round time and no split or slowest action", async () => {
      expect(await text(page, "#now-summary")).toBe("Round took 29s");
    });
  });
});

describe("the whole-session timeline", () => {
  it.concurrent("should fold a long quiet gap into a labelled break and keep both sides in place", async () => {
    const now = Date.now();
    const old = now - 3 * 3600 * SEC;
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [
            call("a", "look", "Early look", old, { end: old + 10 * SEC }),
            call("b", "run", "Late build", now - 20 * SEC),
          ],
          prompts: [
            { at: old - 5 * SEC, text: "first" },
            { at: now - 30 * SEC, text: "second" },
          ],
        }),
    });
    const page = await viz.given(
      "a session with a prompt three hours ago and another just now",
      async () => viz.open(undefined, { before }),
    );
    await viz.when("the viewer opens the whole session", async () => {
      await page.waitForSelector("rect.call");
      expect(await page.$$eval("rect.gap", (e) => e.length)).toBe(0);
      await page.click('#window button[data-w="all"]');
      await page.waitForSelector("rect.gap");
    });
    await viz.then("the idle stretch is one narrow break with its length", async () => {
      expect(await page.$$eval("rect.gap", (e) => e.length)).toBe(1);
      expect(await text(page, "text.gap-label")).toBe("⋯ 2h 59m idle");
      expect(await page.$eval("rect.gap", (e) => Number(e.getAttribute("width")))).toBe(30);
    });
    await viz.then(
      "the early bar sits left of the break, the late one right of it, and no tick is inside it",
      async () => {
        const num = async (sel: string, attr: string): Promise<number> =>
          page.$eval(sel, (e, a) => Number(e.getAttribute(a)), attr);
        const gap = await num("rect.gap", "x");
        expect(await num('rect[data-id="a"]', "x")).toBeLessThan(gap);
        expect(await num('rect[data-id="b"]', "x")).toBeGreaterThan(gap + 30);
        const ticks = await page.$$eval("text.tick", (ts) =>
          ts.map((t) => Number(t.getAttribute("x"))),
        );
        expect(ticks.length).toBeGreaterThan(1);
        expect(ticks.filter((t) => t > gap && t < gap + 30)).toEqual([]);
      },
    );
  });
});

describe("the whole-session timeline, at the end", () => {
  it.concurrent("should fold a quiet stretch before now when the session is still live", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [call("a", "look", "Reading x", now - 9 * 60 * SEC, { end: now - 8 * 60 * SEC })],
          prompts: [{ at: now - 9 * 60 * SEC, text: "look" }],
        }),
    });
    const page = await viz.given(
      "a live session whose last action ended eight minutes ago",
      async () => viz.open({ w: "all" }, { before }),
    );
    await viz.when("the whole session is shown", async () => {
      await page.waitForSelector("rect.gap");
    });
    await viz.then("the quiet minutes up to now are one break", async () => {
      expect(await page.$$eval("rect.gap", (e) => e.length)).toBe(1);
      expect(await text(page, "text.gap-label")).toBe("⋯ 8m idle");
    });
  });
});

describe("work in flight", () => {
  it.concurrent("should pulse running bars, in lanes and helper rows, unless motion is reduced", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      events: () =>
        chunk({
          calls: [
            call("agentP", "delegate", "Sending a helper: Lint", now - 60 * SEC, { tool: "Agent" }),
            call("s1", "run", "Running viz verify", now - 30 * SEC, { agent: "h1 Clear lint" }),
          ],
          prompts: [{ at: now - 70 * SEC, text: "lint it" }],
          agents: [helperAgents[0]],
        }),
    });
    const page = await viz.given("a running action and a helper that is running too", async () =>
      viz.open(undefined, { before }),
    );
    const animation = async (sel: string): Promise<string> =>
      page.evaluate((s) => {
        const e = document.querySelector(s);
        return e ? getComputedStyle(e).animationName : "missing";
      }, sel);
    await viz.when("the page renders", async () => {
      await page.waitForSelector("rect.spark.run");
    });
    await viz.then("both pulse", async () => {
      expect(await animation("rect.call.run")).toBe("pulse");
      expect(await animation("rect.spark.run")).toBe("pulse");
    });
    await viz.when("the viewer prefers reduced motion", async () => {
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    });
    await viz.then("they hold still", async () => {
      // The media change reaches the page a moment after the call returns, so wait for it.
      await page.waitForFunction(
        () => getComputedStyle(document.querySelector("rect.call.run")!).animationName === "none",
      );
      expect(await animation("rect.call.run")).toBe("none");
      expect(await animation("rect.spark.run")).toBe("none");
    });
  });
});

describe("lanes the local model picks", () => {
  it.concurrent("should move a script's bar once the model says what it does", async () => {
    const now = Date.now();
    const { before } = stage({
      sessions: [session(ID, now)],
      lane: (id) => ({ lane: id === "s1" ? "change" : null }),
      events: () =>
        chunk({
          prompts: [{ at: now - 60 * SEC, text: "tidy up" }],
          calls: [
            call("s1", "run", "Run a cleanup script", now - 50 * SEC, {
              end: now - 49 * SEC,
              needsLane: true,
              summary: '{"command":"python3 - <<EOF"}',
            }),
            call("s2", "run", "Run another script", now - 40 * SEC, {
              end: now - 39 * SEC,
              needsLane: true,
            }),
            call("s3", "change", "Tidy and commit", now - 30 * SEC, {
              end: now - 29 * SEC,
              tool: "Bash",
              detail:
                "cd /r && grep -rn x . && echo hi > n.txt && pytest -q && curl -s x && sed -i s/a/b/ f && git commit -m 'a; b' && bash t.sh",
            }),
          ],
        }),
    });
    const page = await viz.given("two script calls the rules could only call Run", async () =>
      viz.open(undefined, { before }),
    );
    const counts = async (): Promise<string> =>
      page.$$eval("#round-bars > *", (els) =>
        els
          .map((e) => e.textContent?.trim() ?? "")
          .filter(Boolean)
          .join(" "),
      );
    await viz.when("the model answers for both", async () => {
      await page.waitForFunction(() =>
        document.querySelector("#round-bars")?.textContent?.includes("Change"),
      );
      await pause(900);
    });
    await viz.then("the one it placed moved to Change, the other stays in Run", async () => {
      expect(await counts()).toContain("Run 1 Verify 0 Change 2");
    });
    await viz.when("the moved call is picked", async () => {
      await tap(page, 'rect[data-id="s1"]');
    });
    await viz.then("its details name the lane and mark it as the model's", async () => {
      expect(await text(page, "#picked")).toContain("Bash · Change ✦");
    });
    await viz.when("a chain is picked", async () => {
      await tap(page, 'rect[data-id="s3"]');
    });
    await viz.then("its steps are listed under the lane each would get alone", async () => {
      expect(await text(page, "#picked .steps")).toBe(
        "Look grep -rn x . · Change echo hi > n.txt; sed -i s/a/b/ f; git commit -m '' · Verify pytest -q · Run curl -s x · Script bash t.sh",
      );
    });
  });
});

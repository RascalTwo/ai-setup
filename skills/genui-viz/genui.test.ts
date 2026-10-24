// genui: cards in, answers out, through the genui page's _log/cards and _log/answers.
import { describe, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as panel from "./lib.ts";

// A scratch page: the log files are all these tests touch, so no viz and no server.
const page = mkdtempSync(path.join(tmpdir(), "genui-"));
panel.usePage(page);
const answers = path.join(page, ".viz-data", "answers.jsonl");

const confirm = { type: "confirm", title: "Ship it?" } as const;

describe("genui", () => {
  test("Given a spec with no known component, when it is parsed, then it is refused before anyone sees it", () => {
    expect(() => panel.parseSpec('{"type":"nope","title":"x"}')).toThrow(
      /spec.type must be one of/u,
    );
    expect(() => panel.parseSpec('{"type":"choice"}')).toThrow(/title is required/u);
    expect(() => panel.parseSpec("not json")).toThrow(/not JSON/u);
    expect(panel.parseSpec(JSON.stringify(confirm)).type).toBe("confirm");
  });

  test("Given a waiting card, when the page appends its answer, then wait resolves with it at once", async () => {
    const card = await panel.addCard(panel.parseSpec(JSON.stringify(confirm)), "wT:p1");
    const started = Date.now();
    const waiting = panel.waitAnswer(card.id, 5000);
    setTimeout(
      () =>
        appendFileSync(
          answers,
          JSON.stringify({ card: card.id, value: { decision: "yes" } }) +
            "\n",
        ),
      50,
    );
    const a = await waiting;
    expect(a?.value?.["decision"]).toBe("yes");
    expect(Date.now() - started).toBeLessThan(1000); // watched, not polled once a second
    expect(panel.summarize(card, a)).toBe("Yes");
    expect(panel.cards().findLast((c) => c.id === card.id)?.pane).toBe("wT:p1");
  });

  test("Given nobody answers, when the timeout passes, then wait resolves undefined", async () => {
    const card = await panel.addCard(panel.parseSpec(JSON.stringify(confirm)));
    expect(await panel.waitAnswer(card.id, 100)).toBeUndefined();
    expect(panel.summarize(card)).toBe("waiting for an answer");
  });

  test("Given a choice card, when a row is picked or the card is cancelled, then the receipt says which", async () => {
    const card = await panel.addCard(
      panel.parseSpec(
        '{"type":"choice","title":"Pick","columns":["Model"],"rows":[["Air"],["X1"]]}',
      ),
    );
    expect(panel.summarize(card, { card: card.id, value: { index: 1 } })).toBe("Picked X1");
    expect(panel.summarize(card, { card: card.id, cancelled: true })).toBe("Cancelled");
    const multi = await panel.addCard(
      panel.parseSpec(
        '{"type":"choice","multi":true,"title":"Pick","columns":["Model"],"rows":[["Air"],["X1"],["Pro"]]}',
      ),
    );
    expect(panel.summarize(multi, { card: multi.id, value: { indexes: [0, 2] } })).toBe(
      "Picked Air, Pro",
    );
  });

  test("Given the newer cards, when answered, then each receipt reads as what the human did", async () => {
    const add = async (spec: object) => panel.addCard(panel.parseSpec(JSON.stringify(spec)));
    const ok = await add({ type: "confirm", title: "Delete build/?", yes: "Delete", danger: true });
    expect(panel.summarize(ok, { card: ok.id, value: { decision: "yes" } })).toBe("Delete");
    expect(panel.summarize(ok, { card: ok.id, value: { decision: "no", note: "later" } })).toBe(
      "No — later",
    );
    const patch = await add({ type: "diff", title: "a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n" });
    expect(panel.summarize(patch, { card: patch.id, value: { decision: "yes" } })).toBe("Approve");
    const form = await add({
      type: "form",
      title: "Deploy",
      schema: {
        properties: {
          env: { type: "string", title: "Environment", enum: ["stg", "prod"] },
          dry: { type: "boolean" },
          tags: { type: "array", items: { enum: ["a", "b"] } },
        },
      },
    });
    expect(
      panel.summarize(form, { card: form.id, value: { env: "stg", dry: true, tags: ["a", "b"] } }),
    ).toBe("Environment: stg · dry: yes · tags: a, b");
  });

  test("Given a display card, when shown, then nobody waits on it unless it sets wait", async () => {
    const shown = await panel.addCard(panel.parseSpec('{"type":"notice","title":"Built"}'));
    expect(panel.displayOnly(shown.spec)).toBe(true);
    expect(panel.summarize(shown)).toBe("shown");
    expect(panel.displayOnly(panel.parseSpec('{"type":"code","title":"x","text":"1","wait":true}'))).toBe(
      false,
    );
    expect(panel.displayOnly(panel.parseSpec('{"type":"confirm","title":"x"}'))).toBe(false);
    expect(() => panel.parseSpec('{"type":"diff","title":"x"}')).toThrow(/spec.patch is required/u);
    expect(() => panel.parseSpec('{"type":"form","title":"x","schema":{}}')).toThrow(/properties/u);
  });

  test("Given several components in one card, when one answers, then the card answers for all of them", async () => {
    const card = await panel.addCard(
      panel.parseSpec(
        JSON.stringify({
          title: "Release",
          components: [
            { type: "notice", body: "3 commits" },
            { type: "form", schema: { properties: { env: { type: "string", title: "Env" } } } },
            { type: "confirm", yes: "Ship" },
          ],
        }),
      ),
    );
    expect(panel.displayOnly(card.spec)).toBe(false);
    expect(panel.partsOf(card.spec).map((p) => p.key)).toEqual(["notice", "form", "confirm"]);
    expect(
      panel.summarize(card, { card: card.id, value: { form: { env: "stg" }, confirm: { decision: "yes" } } }),
    ).toBe("Env: stg · Ship");
    const shown = panel.parseSpec(
      '{"title":"FYI","components":[{"type":"notice"},{"type":"html","html":"<b>hi</b>"},{"type":"notice"}]}',
    );
    expect(panel.displayOnly(shown)).toBe(true);
    expect(panel.partsOf(shown).map((p) => p.key)).toEqual(["notice", "html", "notice2"]);
    expect(() => panel.parseSpec('{"title":"x","components":[{"type":"diff"}]}')).toThrow(
      /spec.components\[0\].patch is required/u,
    );
  });
});

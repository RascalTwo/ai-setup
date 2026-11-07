import { describe, expect, it } from "bun:test";
import path from "node:path";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { check, skeleton } from "./from-spec.ts";
import { approve } from "./template/approve.ts";
import { tourSteps, withGuide } from "./guide/inject.ts";
import type { Walk } from "./template/walk.schema.ts";
import { highlight, sendBlocked, sendWords, stepOf } from "./template/words.ts";

const at = (step: string) => ({ hash: `#${encodeURIComponent(JSON.stringify({ step }))}` });
const walk: Walk = {
  title: "Walkthrough: month span",
  change: { repo: "timeline-studio", commit: "3c303d1", subject: "Calendar view: month span" },
  source: "a throwaway copy",
  kind: "web",
  reset: ["true"],
  stage: { now: "http://localhost:5191/", before: null },
  relay: { folder: "/x" },
  yes: "Accept adds this to your local copy; nothing goes online.",
  steps: ["S1", "S2", "S3", "S4", "S5"].map((id, i) => ({
    id,
    example: `E${i + 1}`,
    say: `Look at <b>thing ${i + 1}</b>.`,
  })),
  notes: [],
};
const all = new Set(["S1", "S2", "S3", "S4", "S5"]);

describe("the Send words", () => {
  it("should carry the decision, the steps reached and each reaction under its step", () => {
    const log = [
      { id: "a", type: "speech", text: "why is the first week cut off?", at: "2026-10-24T10:00:00Z", where: at("S3") },
    ];
    const w = sendWords(walk, "Changes", all, log, "walk-month-span");
    expect(w).toStartWith('Walkthrough of 3c303d1 "Calendar view: month span": Changes. Steps reached 5/5.');
    expect(w).toContain('What they said, by step:\nS3 (E3), "Look at thing 3.":\n  - "why is the first week cut off?"');
    expect(w).toContain("Full detail: viz feedback walk-month-span --detail");
  });

  it("should group by step in walkthrough order and keep what was said off any step", () => {
    const log = [
      { id: "a", type: "comment", text: "later", at: "2026-10-24T10:02:00Z", where: at("S4") },
      { id: "b", type: "comment", text: "first", at: "2026-10-24T10:01:00Z", where: at("S1") },
      { id: "c", type: "comment", text: "before the guide", at: "2026-10-24T10:00:00Z" },
    ];
    const w = sendWords(walk, "Accepted", new Set(["S1"]), log, "v");
    expect(w).toContain("Accepted. Steps reached 1/5.");
    expect(w.indexOf("S1 (E1)")).toBeLessThan(w.indexOf("S4 (E4)"));
    expect(w).toContain('Before the first step:\n  - "before the guide"');
  });

  it("should leave out what an earlier delivered Send carried, and anything retracted", () => {
    const log = [
      { id: "a", type: "comment", text: "old", at: "2026-10-24T10:00:00Z", where: at("S1") },
      { type: "send", at: "2026-10-24T10:01:00Z" },
      { id: "b", type: "comment", text: "gone", at: "2026-10-24T10:02:00Z", where: at("S2") },
      { id: "b", type: "retract", at: "2026-10-24T10:03:00Z" },
    ];
    expect(sendWords(walk, "Accepted", all, log, "v")).toContain("They said nothing along the way.");
  });

  it("should read the step from the hash the page saved", () => {
    expect(stepOf({ where: at("S2") })).toBe("S2");
    expect(stepOf({ where: { hash: "#garbage" } })).toBeNull();
    expect(stepOf({})).toBeNull();
  });
});

describe("Send before a decision", () => {
  it("should say why it can't be pressed until Accept or Changes is picked", () => {
    expect(sendBlocked(null)).toContain("Pick Accept or Changes first");
    expect(sendBlocked("Changes")).toBeNull();
  });
});

describe("walk.json from the signed spec", () => {
  const spec = {
    task: { id: "t", title: "Month span", folder: "/runs/p/t" },
    signedOffAt: "2026-10-24T00:00:00Z",
    examples: [
      { id: "E1", kind: "should", text: "Month shows whole weeks", verdict: "ok" },
      { id: "E2", kind: "shouldnt", text: "Zoom shows", verdict: "ok" },
      { id: "E3", kind: "should", text: "+N more opens the day", verdict: "ok" },
    ],
  };
  const good = (steps: Walk["steps"]) => ({ kind: "web", stage: {}, change: {}, relay: { folder: "/f" }, yes: "a yes merges it locally", steps });

  it("should write one step per ✓ should example, in the spec's order, naming the example", () => {
    const w = skeleton(spec);
    expect(w.steps.map((s) => [s.id, s.example])).toEqual([["S1", "E1"], ["S2", "E3"]]);
    expect(w.relay.folder).toBe("/runs/p/t");
  });

  it("should pass a walkthrough that shows every example in order, with intro and outro steps", () => {
    const steps = [
      { id: "S1", example: "E1", say: "Switch <b>View</b> to Calendar." },
      { id: "S2", example: "E1", say: "Set Show to Month." },
      { id: "S3", example: "E3", say: "Click its +N more." },
      { id: "S4", say: "That's everything. Decide below." },
    ];
    expect(check(spec, good(steps))).toEqual([]);
  });

  it("should catch a missing example, the wrong order and a guide that says what is right", () => {
    const steps = [
      { id: "S1", example: "E3", say: "Click +N more: it correctly opens the day." },
      { id: "S2", example: "E2", say: "Look." },
    ];
    expect(check(spec, good(steps))).toEqual([
      "no step shows E1",
      "a step names E2, which isn't a ✓ should example",
      `S1's say judges ("correctly"): say where to look and what to do, not what is right`,
    ]);
    const swapped = [
      { id: "S1", example: "E3", say: "a" },
      { id: "S2", example: "E1", say: "b" },
    ];
    expect(check(spec, good(swapped))).toContain("steps don't follow the spec's order of examples");
    expect(check({ ...spec, signedOffAt: null }, good(swapped))[0]).toContain("isn't signed off");
  });
});

describe("the injected guide's steps", () => {
  it("should hand product-tour its step shape and point a clip step at the recording", () => {
    const t = tourSteps([
      { id: "S1", say: "Pick it", target: "#view", done: { sel: "#view", value: "calendar" } },
      { id: "S2", say: "Watch", target: null, clip: { src: "c.txt", why: "slow" } },
    ]);
    expect(t[0]).toEqual({ id: "S1", say: "Pick it", target: "#view", done: { sel: "#view", value: "calendar" } });
    expect(t[1]).toEqual({ id: "S2", say: "Watch<br><small>The recording is on the page, below the app.</small>" });
  });

  it("should load the guide from index.html once, however often it's injected", () => {
    const once = withGuide("<html><head><title>a</title></head></html>");
    expect(withGuide(once)).toBe(once);
    expect(once.match(/walk-guide\/start\.js/gu)).toHaveLength(1);
  });
});

describe("the guided terminal", () => {
  it("should mark the rows to read and escape the rest", () => {
    expect(highlight("Build slot: a\n<b>x</b>", ["Build slot"])).toBe("<mark>Build slot: a</mark>\n&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("Accept + Send approves the task", () => {
  // A stubbed Kelpie: records what it was asked and where, and answers like `kelpie approve` does from a page.
  const root = mkdtempSync(path.join(tmpdir(), "walk-approve-"));
  const state = path.join(root, "state");
  const run = path.join(state, "runs", "p", "t");
  mkdirSync(run, { recursive: true });
  writeFileSync(path.join(run, ".task.json"), JSON.stringify({ project: "p", id: "t" }));
  const stub = (exit: number) => {
    const f = path.join(root, `kelpie-${exit}.ts`);
    writeFileSync(f, `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(path.join(root, "called.json"))}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), pane: process.env.HERDR_PANE_ID ?? null }));
if (${exit}) { console.error("task t is no longer handed to agents"); process.exit(${exit}); }
console.log("Approved. Told the agent to ship it.");`);
    chmodSync(f, 0o755);
    return f;
  };
  const post = (ua = "Mozilla/5.0") => new Request("http://x/sent", { method: "POST", headers: { "user-agent": ua } });
  const called = () => JSON.parse(readFileSync(path.join(root, "called.json"), "utf8"));

  it("should run kelpie approve with their words from the run folder, as the human, and say Approved", () => {
    const r = approve(post(), "Walkthrough of abc: Accepted.", run, { KELPIE_STATE: state, KELPIE_CLI: stub(0), HERDR_PANE_ID: "w1-1" });
    expect(r).toEqual({ outcome: "approved", ok: true, message: "Approved. Told the agent to ship it." });
    const c = called();
    expect(c.argv).toEqual(["approve", "Walkthrough of abc: Accepted."]);
    expect(c.cwd).toEndWith(path.join("runs", "p", "t"));
    expect(c.pane).toBeNull(); // Kelpie must see the page, not an agent, so it tells the pane
  });

  it("should say why when Kelpie refuses, so the page can say Not delivered and keep the words", () => {
    const r = approve(post(), "Accepted.", run, { KELPIE_STATE: state, KELPIE_CLI: stub(1) });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("no longer handed to agents");
  });

  it("should never approve from viz verify, or outside a Kelpie run", () => {
    expect(approve(post("VizAutomation"), "x", run, { KELPIE_STATE: state, KELPIE_CLI: stub(0) }).outcome).toBe("refused");
    expect(approve(post(), "x", "/not/a/run", { KELPIE_STATE: state, KELPIE_CLI: stub(0) }).outcome).toBe("no-run");
  });
});

describe("what a yes does", () => {
  it("should be a field the skeleton asks for and the check requires", () => {
    const spec = { task: { id: "t", title: "T", folder: "/f" }, signedOffAt: "x", examples: [] };
    expect(skeleton(spec).yes).toContain("TODO");
    expect(check(spec, { kind: "cli", cmd: {}, change: {}, relay: { folder: "/f" }, steps: [] })).toContain(
      "walk.json has no yes: what Accept does, shown beside it",
    );
  });

  it("should be on the page beside Accept, filled from walk.json", () => {
    const html = readFileSync(path.join(import.meta.dir, "template/index.html"), "utf8");
    expect(html.indexOf('data-decide="Accepted"')).toBeLessThan(html.indexOf('id="yes-text"'));
    expect(html.indexOf('id="yes-text"')).toBeLessThan(html.indexOf('id="send"'));
    expect(readFileSync(path.join(import.meta.dir, "template/app.ts"), "utf8")).toContain('el("#yes-text").textContent = walk.yes;');
  });
});

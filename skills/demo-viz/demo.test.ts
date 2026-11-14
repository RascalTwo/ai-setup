import { describe, expect, it } from "bun:test";
import path from "node:path";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { check, skeleton } from "./from-spec.ts";
import { movesOf, player } from "./template/play.ts";
import { approve } from "./template/approve.ts";
import { tourSteps, withGuide } from "./guide/inject.ts";
import type { Walk } from "./template/walk.schema.ts";
import { barWidths, highlight, sendBlocked, sendWords, stepOf, transcript } from "./template/words.ts";

const at = (step: string) => ({ hash: `#${encodeURIComponent(JSON.stringify({ step }))}` });
const walk: Walk = {
  mode: "live",
  title: "Demo: month span",
  change: { repo: "timeline-studio", commit: "3c303d1", subject: "Calendar view: month span" },
  source: "a throwaway copy",
  kind: "web",
  personas: [{ id: "P1", who: "Planner" }],
  reset: ["true"],
  stage: { now: "http://localhost:5191/", before: null },
  relay: { folder: "/x" },
  yes: "Accept adds this to your local copy; nothing goes online.",
  steps: ["S1", "S2", "S3", "S4", "S5"].map((id, i) => ({
    id,
    persona: "P1",
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
    expect(w).toStartWith('Demo of 3c303d1 "Calendar view: month span": Changes. Steps reached 5/5.');
    expect(w).toContain('What they said, by step:\nS3 (E3) [P1], "Look at thing 3.":\n  - "why is the first week cut off?"');
    expect(w).toContain("Full detail: viz feedback walk-month-span --detail");
  });

  it("should group by step in demo order and keep what was said off any step", () => {
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

describe("walk.json from the spec", () => {
  const spec = {
    task: { id: "t", title: "Month span", folder: "/runs/p/t" },
    signedOffAt: "2026-10-24T00:00:00Z",
    demo: {
      personas: [
        { id: "P1", who: "Planner", before: { capture: "described" } },
        { id: "P2", who: "Facilitator", before: { capture: "real" } },
      ],
    },
    examples: [
      { id: "E1", kind: "should", text: "Month shows <whole> weeks", verdict: "ok", persona: "P2" },
      { id: "E2", kind: "shouldnt", text: "Zoom shows", verdict: "ok" },
      { id: "E3", kind: "should", text: "+N more opens the day", verdict: "ok", persona: "P1" },
      { id: "E4", kind: "should", text: "Arrows step a month", verdict: "ok", persona: "P1" },
    ],
  };
  const personas = [
    { id: "P1", who: "Planner" },
    { id: "P2", who: "Facilitator" },
  ];
  // The journey order: P1's examples (E3, E4), then P2's (E1).
  const steps = (): Record<string, unknown>[] => [
    { id: "S1", persona: "P1", example: "E3", say: "Click its +N more." },
    { id: "S2", persona: "P1", example: "E4", say: "Press the right arrow." },
    { id: "S3", persona: "P2", example: "E1", say: "Switch <b>Show</b> to Month." },
    { id: "S4", persona: "P2", say: "That's everything. Decide below." },
  ];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test walks are partial on purpose
  const good = (over: object = {}, st = steps()) => ({ mode: "live", impact: "Planners stop losing a week to a hand-typed date.", kind: "web", personas, stage: {}, change: {}, relay: { folder: "/f" }, yes: "a yes merges it locally", steps: st, ...over }) as Parameters<typeof check>[1];

  it("should copy the personas and write one step per ✓ should example, persona by persona, naming both", () => {
    const w = skeleton(spec);
    expect(w.mode).toBe("live");
    expect(w.personas).toEqual(personas);
    expect(w.steps.map((s) => [s.id, s.persona, s.example])).toEqual([
      ["S1", "P1", "E3"],
      ["S2", "P1", "E4"],
      ["S3", "P2", "E1"],
    ]);
    expect(w.relay?.folder).toBe("/runs/p/t");
  });

  it("should pre-fill each live step's promise from the example, escaped, and leave it off a promised demo", () => {
    expect(skeleton(spec).steps[2]?.promised).toBe("<p>Month shows &lt;whole&gt; weeks</p>");
    const p = skeleton(spec, "promised");
    expect(p.mode).toBe("promised");
    expect(p.steps.some((s) => "promised" in s)).toBe(false);
    expect("yes" in p || "relay" in p).toBe(false); // nothing to Accept, nothing to Send
  });

  it("should show a promised demo every should example, judged or not", () => {
    const draft = { ...spec, signedOffAt: null, examples: spec.examples.map((e) => ({ ...e, verdict: null })) };
    expect(skeleton(draft, "promised").steps).toHaveLength(3);
    expect(skeleton(draft).steps).toHaveLength(0);
  });

  it("should refuse a spec with no personas", () => {
    expect(() => skeleton({ ...spec, demo: undefined })).toThrow("demo.personas");
  });

  it("should pass a demo that shows every example in order, with an outro step", () => {
    expect(check(spec, good())).toEqual([]);
  });

  it("should catch a missing example, a step under the wrong persona and a guide that says what is right", () => {
    const st = [
      { id: "S1", persona: "P1", example: "E3", say: "Click +N more: it correctly opens the day." },
      { id: "S2", persona: "P1", example: "E2", say: "Look." },
      { id: "S3", persona: "P1", example: "E1", say: "Switch Show to Month." },
    ];
    expect(check(spec, good({}, st))).toEqual([
      "persona P2 has no steps",
      "no step shows E4, and notes don't name it",
      "a step names E2, which isn't a ✓ should example",
      "S3 shows E1, which is P2's, under P1",
      `S1's say judges ("correctly"): say where to look and what to do, not what is right`,
    ]);
  });

  it("should keep a persona's walkthrough to 3 steps, and let a live example without a step be named in notes instead", () => {
    const st = [...steps(), { id: "S5", persona: "P2", say: "More." }, { id: "S6", persona: "P2", say: "More." }];
    expect(check(spec, good({}, st))).toEqual(["persona P2 has 4 steps: keep the 3 that show the impact and move the other examples to notes"]);
    const fewer = steps().filter((s) => s.example !== "E4");
    expect(check(spec, good({}, fewer))).toEqual(["no step shows E4, and notes don't name it"]);
    expect(check(spec, good({ notes: ["Also checked E4, by the tests."] }, fewer))).toEqual([]);
    expect(check(spec, good({ notes: ["E40 is something else."] }, fewer))).toEqual(["no step shows E4, and notes don't name it"]); // falsifier: a longer id is not E4
  });

  it("should need an impact summary on a live demo, and put a TODO for it in the skeleton", () => {
    expect(check(spec, good({ impact: "  " }))).toEqual(["walk.json has no impact: 2-3 plain sentences on who is affected, their life before and after, why it matters"]);
    expect(skeleton(spec).impact).toContain("TODO");
    expect("impact" in skeleton(spec, "promised")).toBe(false); // the spec page's ask carries it
  });

  it("should catch steps out of journey order, and a step with no persona or one that isn't listed", () => {
    const swapped = steps();
    swapped.reverse();
    expect(check(spec, good({}, swapped))).toContain("steps don't follow the journey order: persona by persona, the spec's order of examples within each");
    const st = steps();
    st[0] = { id: "S1", example: "E3", say: "a" };
    st[1] = { id: "S2", persona: "P9", example: "E4", say: "b" };
    const out = check(spec, good({}, st));
    expect(out).toContain("S1 has no persona");
    expect(out).toContain("S2 names persona P9, which isn't in personas");
    expect(check(spec, good({ personas: [personas[0]] }))).toContain("walk.json's personas aren't the spec's demo.personas, in the same order");
  });

  it("should need a signed-off spec for a live demo, but not for a promised one", () => {
    expect(check({ ...spec, signedOffAt: null }, good())[0]).toContain("isn't signed off");
    const draft = { ...spec, signedOffAt: null, examples: spec.examples.map((e) => ({ ...e, verdict: null })) };
    expect(check(draft, good({ mode: "promised", yes: undefined, relay: undefined, stage: { before: "http://x/" } }))).toEqual([]);
  });

  it("should mark a step that differs only when it carries the promise to compare, and only on a live demo", () => {
    const st = steps();
    st[0] = { ...st[0], differs: "Opens a drawer, not the day.", promised: "<p>Opens the day.</p>" };
    expect(check(spec, good({}, st))).toEqual([]);
    st[1] = { ...st[1], differs: "  " };
    st[2] = { ...st[2], differs: "Month starts Monday." };
    expect(check(spec, good({}, st))).toEqual([
      "S2's differs is empty: say in plain words how the build differs, or leave it out",
      "S3 differs from the promise but doesn't carry the promise: fill promised so the toggle shows what was promised",
    ]);
    const draft = { ...spec, signedOffAt: null };
    expect(check(draft, good({ mode: "promised", yes: undefined }, st))).toContain("S1 has promised/differs, but a promised demo is the promise");
  });

  it("should want a clip on both sides of every agent step", () => {
    const st = steps();
    st[0] = { ...st[0], clip: { src: "clip/a.txt", before: "clip/b.txt", why: "slow" } };
    st[1] = { ...st[1], clip: { src: "clip/a.txt", why: "slow" } };
    const out = check(spec, good({ kind: "agent" }, st));
    expect(out).toContain("S2 is an agent step without a clip on both sides (clip.src and clip.before)");
    expect(out).toContain("S3 is an agent step without a clip on both sides (clip.src and clip.before)");
    expect(out.filter((p) => p.includes("agent step"))).toHaveLength(3); // S2, S3 and the outro
  });

  it("should want measure on every dev step that shows an example", () => {
    const st = steps();
    st[0] = { ...st[0], measure: [{ label: "files touched", before: 9, after: 3, unit: "files" }] };
    const out = check(spec, good({ kind: "dev" }, st));
    expect(out.filter((p) => p.includes("dev step without measure")).map((p) => p.split(" ")[0])).toEqual(["S2", "S3"]); // not the outro: it shows no example
  });

  it("should want a real before shown some other way when it can't run, in a promised demo", () => {
    const draft = { ...spec, signedOffAt: null };
    const promised = (st: Record<string, unknown>[], over: object = {}) => good({ mode: "promised", yes: undefined, relay: undefined, stage: { before: null }, ...over }, st);
    expect(check(draft, promised(steps()))).toEqual(["persona P2's before is a real capture, but none of its steps carries one (capture)"]);
    const st = steps();
    st[2] = { ...st[2], capture: "before/P2.png" };
    expect(check(draft, promised(st))).toEqual([]);
    // the previous build runs beside the mock: nothing to capture
    expect(check(draft, promised(steps(), { stage: { before: "http://x/" } }))).toEqual([]);
  });

  it("should check that captures and clips exist in the viz folder", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "demo-dir-"));
    const st = steps();
    st[0] = { ...st[0], capture: "before/P1.png", clip: { src: "a.txt", before: "b.txt", why: "slow" } };
    const out = check(spec, good({}, st), dir);
    expect(out).toEqual([
      "S1's clip a.txt isn't in the viz folder",
      "S1's clip.before b.txt isn't in the viz folder",
      "S1's capture before/P1.png isn't in the viz folder",
    ]);
  });
});

describe("▶ Play", () => {
  const moves = movesOf;
  it("should replay a step's act, else the value of done.sel, else a click on target, else nothing", () => {
    expect(moves({ act: [{ click: "#next" }] })).toEqual([{ click: "#next" }]);
    expect(moves({ done: { sel: "#view", value: "month" }, target: "#view" })).toEqual([{ select: "#view", value: "month" }]);
    expect(moves({ done: { sel: "#title", text: "November" }, target: "#next" })).toEqual([{ click: "#next" }]);
    expect(moves({ done: { sel: "#panel" } })).toEqual([]); // appears by itself, nothing to press
    expect(moves({ target: "#title" })).toEqual([]); // look only
  });

  /** A player over `n` steps whose moves log themselves. */
  function rig(n: number) {
    const log: string[] = [];
    const states: { at: number; playing: boolean }[] = [];
    let aborted = 0;
    const p = player(n, {
      play: async (i, live) => {
        log.push(`play ${i}`);
        await Promise.resolve();
        if (!live()) log.push(`gave up ${i}`);
      },
      hold: async () => {
        await Promise.resolve();
      },
      onChange: (s) => states.push(s),
      abort: () => {
        aborted += 1;
      },
    });
    return { p, log, states, aborted: () => aborted };
  }
  const settle = () => new Promise((r) => setTimeout(r, 5));

  it("should play every step in order from the start and stop at the last", async () => {
    const r = rig(3);
    r.p.start();
    await settle();
    expect(r.log).toEqual(["play 0", "play 1", "play 2"]);
    expect(r.p.state).toEqual({ at: 2, playing: false });
    expect(r.states.map((s) => s.at)).toEqual([0, 1, 2, 2]);
  });

  it("should start over from the top when Play is pressed after the end", async () => {
    const r = rig(2);
    r.p.start();
    await settle();
    r.p.start();
    await settle();
    expect(r.log).toEqual(["play 0", "play 1", "play 0", "play 1"]);
  });

  it("should let a paused step finish and not start the next", async () => {
    const log: string[] = [];
    let release = () => {};
    let held = false;
    const p = player(3, {
      play: async (i) => {
        log.push(`play ${i}`);
        if (i === 1 && !held) {
          held = true;
          await new Promise<void>((res) => (release = res));
        }
      },
      hold: () => Promise.resolve(),
      onChange: () => {},
    });
    p.start();
    await settle();
    expect(log).toEqual(["play 0", "play 1"]);
    p.pause();
    release();
    await settle();
    expect(log).toEqual(["play 0", "play 1"]);
    expect(p.state).toEqual({ at: 1, playing: false });
    p.start(); // resume from the step it paused on
    await settle();
    expect(log).toEqual(["play 0", "play 1", "play 1", "play 2"]);
  });

  it("should hand control back at once on Do it myself: abort the cursor, play nothing more", async () => {
    const log: string[] = [];
    let release = () => {};
    let aborted = 0;
    let stillLive = true;
    const p = player(3, {
      play: async (i, live) => {
        log.push(`play ${i}`);
        await new Promise<void>((res) => (release = res));
        stillLive = live();
      },
      hold: () => Promise.resolve(),
      onChange: () => {},
      abort: () => {
        aborted += 1;
      },
    });
    p.start();
    await settle();
    p.stop();
    release();
    await settle();
    expect(aborted).toBe(1);
    expect(stillLive).toBe(false); // the step in flight was told to give up
    expect(log).toEqual(["play 0"]);
    expect(p.state).toEqual({ at: 0, playing: false });
  });

  it("should step back and forward by hand without playing, clamped, and beat autoplay", async () => {
    const r = rig(3);
    r.p.go(2);
    r.p.go(5);
    expect(r.p.state.at).toBe(2);
    r.p.go(-1);
    expect(r.p.state.at).toBe(0);
    r.p.start();
    r.p.go(2); // a hand move while playing wins
    await settle();
    expect(r.p.state).toEqual({ at: 2, playing: false });
    expect(r.log.filter((l) => l === "play 2")).toHaveLength(0);
  });

  it("should follow the human's own moves, but not while Play is driving", async () => {
    const r = rig(4);
    r.p.follow(2);
    expect(r.p.state.at).toBe(2);
    r.p.go(0);
    r.p.start();
    r.p.follow(3);
    expect(r.p.state.at).toBe(0);
    await settle();
  });
});

describe("measured pairs and agent transcripts", () => {
  it("should draw each bar as its value of the row's larger one", () => {
    expect(barWidths({ before: 12, after: 3 })).toEqual({ before: 100, after: 25 });
    expect(barWidths({ before: 0, after: 0 })).toEqual({ before: 0, after: 0 });
    expect(barWidths({ before: 2.5, after: 5 })).toEqual({ before: 50, after: 100 });
  });

  it("should build each side's transcript from the steps so far, leaving out steps with no recording", () => {
    const steps = [
      { id: "S1", clip: { src: "new1", before: "old1", why: "w" } },
      { id: "S2" },
      { id: "S3", clip: { src: "new3", before: "old3", why: "w" } },
    ];
    const read = (s: string) => `text of ${s}\n`;
    expect(transcript(steps, 1, "now", read)).toBe("── S1 ──\ntext of new1");
    expect(transcript(steps, 2, "before", read)).toBe("── S1 ──\ntext of old1\n\n── S3 ──\ntext of old3");
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
    const r = approve(post(), "Demo of abc: Accepted.", run, { KELPIE_STATE: state, KELPIE_CLI: stub(0), HERDR_PANE_ID: "w1-1" });
    expect(r).toEqual({ outcome: "approved", ok: true, message: "Approved. Told the agent to ship it." });
    const c = called();
    expect(c.argv).toEqual(["approve", "Demo of abc: Accepted."]);
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
    const spec = { task: { id: "t", title: "T", folder: "/f" }, signedOffAt: "x", demo: { personas: [{ id: "P1", who: "w" }] }, examples: [] };
    expect(skeleton(spec).yes).toContain("TODO");
    expect(check(spec, { mode: "live", kind: "cli", cmd: {}, change: {}, relay: { folder: "/f" }, steps: [] })).toContain(
      "walk.json has no yes: what Accept does, shown beside it",
    );
  });

  it("should be on the page beside Accept, filled from walk.json", () => {
    const html = readFileSync(path.join(import.meta.dir, "template/index.html"), "utf8");
    expect(html.indexOf('data-decide="Accepted"')).toBeLessThan(html.indexOf('id="yes-text"'));
    expect(html.indexOf('id="yes-text"')).toBeLessThan(html.indexOf('id="send"'));
    expect(readFileSync(path.join(import.meta.dir, "template/app.ts"), "utf8")).toContain('el("#yes-text").textContent = walk.yes ?? "";');
  });
});

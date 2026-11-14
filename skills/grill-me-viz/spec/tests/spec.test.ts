// Spec mode's rules: what build.ts refuses, what the film says first, and when the page locks Sign off.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NO_ONE_CHANGES, noOneChanges, specProblems } from "../template/rules.ts";
import { script } from "../template/script.ts";
import { SpecSchema, type Spec } from "../template/spec.schema.ts";

const here = import.meta.dir;
const skeleton = (): Spec => SpecSchema.parse(JSON.parse(readFileSync(path.join(here, "../template/spec.json"), "utf8")));

// A realistic spec: two personas, each with a journey, one with a real capture and one described.
const base = (): Spec => ({
  ...skeleton(),
  ask: "Show who is blocked in one filter.",
  demo: {
    scope: "A Blocked filter on the board. Not a new status.",
    page: "http://127.0.0.1:5180/x/demo-ts-blocked/",
    personas: [
      {
        id: "P1",
        who: "Facilitator running the Monday review",
        before: { text: "Opens each task to see who is blocked.", capture: "real", visual: '<img src="before/P1.png">' },
        after: { text: "One Blocked filter shows them all." },
      },
      {
        id: "P2",
        who: "Team member",
        before: { text: "Nothing exists yet for this.", capture: "described" },
        after: { text: "Sees their own blocked tasks on top." },
      },
    ],
  },
  examples: [
    { id: "E1", kind: "should", persona: "P1", text: "Pick Blocked: only blocked tasks stay." },
    { id: "E2", kind: "should", persona: "P2", text: "Open the board: my blocked tasks are first." },
    { id: "E3", kind: "shouldnt", text: "Blocked hides tasks for good." },
  ],
});

describe("the blank skeleton", () => {
  it("should hold together, so a fresh spec builds before it is filled in", () => {
    expect(specProblems(skeleton())).toEqual([]);
  });
});

describe("specProblems", () => {
  it("should accept a two-persona spec where each persona has a journey", () => {
    expect(specProblems(base())).toEqual([]);
  });

  it("should refuse a spec with no persona, and say what to do instead", () => {
    const spec = base();
    spec.demo.personas = [];
    spec.examples = [{ id: "E3", kind: "shouldnt", text: "x" }];
    const [problem] = specProblems(spec);
    expect(problem).toContain("demo.personas is empty");
    expect(problem).toContain("make no spec page");
  });

  it("should refuse a should example with no persona", () => {
    const spec = base();
    spec.examples = spec.examples.map((e) => (e.id === "E2" ? { ...e, persona: undefined } : e));
    expect(specProblems(spec)).toContain('E2: a "should" example needs a "persona" (P1, P2)');
  });

  it("should refuse a should example whose persona does not exist", () => {
    const spec = base();
    spec.examples = spec.examples.map((e) => (e.id === "E2" ? { ...e, persona: "P9" } : e));
    expect(specProblems(spec)).toContain('E2: persona "P9" is not in demo.personas (P1, P2)');
  });

  it("should refuse a persona that no should example walks through", () => {
    const spec = base();
    spec.examples = spec.examples.filter((e) => e.id !== "E2");
    const found = specProblems(spec);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('P2 (Team member): no "should" example');
  });

  it("should refuse a real capture with no picture, and accept a described one without", () => {
    const spec = base();
    spec.demo.personas = spec.demo.personas.map((p) => (p.id === "P1" ? { ...p, before: { text: "x", capture: "real" } } : p));
    const found = specProblems(spec);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('P1 (Facilitator running the Monday review): before.capture is "real" but has no visual');
  });

  it("should refuse an empty demo page and a repeated persona id", () => {
    const spec = base();
    spec.demo.page = " ";
    spec.demo.personas = spec.demo.personas.map((p) => ({ ...p, id: "P1" }));
    const found = specProblems(spec);
    expect(found.some((p) => p.startsWith("demo.page is empty"))).toBe(true);
    expect(found.some((p) => p.startsWith("two personas share an id"))).toBe(true);
  });

  it("should tell an old spec to move from hero to demo instead of crashing", () => {
    const old = { ...base(), hero: { why: "", done: [], scope: "", slot: "" } };
    expect(specProblems(old)[0]).toContain('"hero" was removed');
    const { demo: _gone, ...noDemo } = base();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- an old spec.json has no demo; that is the case under test
    expect(specProblems(noDemo as Spec)[0]).toContain('no "demo" block');
  });
});

describe("the sign-off lock", () => {
  const personas = [{ id: "P1" }, { id: "P2" }];
  const marks = (m: Record<string, string>) => (id: string) => m[id];

  it("should say no one changes when every persona is marked wrong", () => {
    expect(noOneChanges(personas, marks({ P1: "fix", P2: "fix" }))).toBe(true);
    expect(NO_ONE_CHANGES).toContain("no one's experience changes");
    expect(NO_ONE_CHANGES).toContain("Sign off stays locked");
    expect(NO_ONE_CHANGES).toContain("Send corrections");
  });

  it("should not say it while one persona is still right, kinda or unjudged", () => {
    expect(noOneChanges(personas, marks({ P1: "fix", P2: "ok" }))).toBe(false);
    expect(noOneChanges(personas, marks({ P1: "fix", P2: "kinda" }))).toBe(false);
    expect(noOneChanges(personas, marks({ P1: "fix" }))).toBe(false);
  });

  it("should never fire with no persona", () => {
    expect(noOneChanges([], marks({}))).toBe(false);
  });
});

describe("the film", () => {
  it("should open with the ask, then tell each persona's today and after, before any example", () => {
    const scenes = script(base());
    expect(scenes.map((s) => s.kind).slice(0, 3)).toEqual(["ask", "persona", "persona"]);
    expect(scenes[1]).toEqual({
      title: "Facilitator running the Monday review",
      kind: "persona",
      lines: ["Today: Opens each task to see who is blocked.", "After: One Blocked filter shows them all."],
    });
    expect(scenes[0]?.lines.at(-1)).toBe("A Blocked filter on the board. Not a new status.");
  });
});

describe("build.ts", () => {
  const build = (spec: object) => {
    const dir = mkdtempSync(path.join(tmpdir(), "spec-build-"));
    writeFileSync(path.join(dir, "spec.json"), JSON.stringify(spec));
    const run = Bun.spawnSync(["bun", path.join(here, "../build.ts"), dir], { stdout: "pipe", stderr: "pipe" });
    return { dir, code: run.exitCode, out: run.stdout.toString(), err: run.stderr.toString() };
  };

  it("should write the narration, persona lines included, for a good spec", () => {
    const { dir, code } = build(base());
    expect(code).toBe(0);
    const cues: { say: string }[] = JSON.parse(readFileSync(path.join(dir, "narration.json"), "utf8")).cues;
    expect(cues.map((c) => c.say)).toContain("After: One Blocked filter shows them all.");
  });

  it("should fail with plain messages, one per problem, and write nothing", () => {
    const spec = base();
    spec.examples = spec.examples.filter((e) => e.id !== "E2");
    const { dir, code, err } = build(spec);
    expect(code).toBe(1);
    expect(err).toContain("spec.json is not ready:");
    expect(err).toContain('- P2 (Team member): no "should" example');
    expect(() => readFileSync(path.join(dir, "narration.json"))).toThrow();
  });
});

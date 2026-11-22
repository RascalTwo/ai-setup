// lib/testing/spec.ts — the living spec: a viz's tests, read as what the page promises (ADR 0027).
//
// Each describe() is a feature, each it()/test() a scenario, the sentences of its viz.given / viz.when / viz.then
// calls its steps. Nothing is hand-written: the tests are read as text, then joined with the last run's results
// (vitest's results file, one entry per test with its real name) and its coverage.json. It adds no rule of its own:
// viz lint already fails a test without its three steps.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderSpecHtml, renderSpecMd } from "./spec-render.ts";
import { testKey } from "./names.ts";
import type { Timing } from "./timing.ts";
import { START, TITLE, extent } from "../lint/test-shape.ts";

export type Step = {
  kind: "GIVEN" | "WHEN" | "THEN";
  text: string; // the sentence as written (a template keeps its ${…})
  line: number;
  state?: "passed" | "failed" | "not reached";
  ms?: number; // how long it took, wall-clock, from the run's steps file; absent for a step that did not run
};

/** One it()/test() as written in a test file. */
export type ParsedTest = {
  file: string; // relative to the viz
  line: number; // where its title is: what vitest reports as the test's line (an it.each's is past its table)
  start: number; // where the it( call starts
  describes: string[]; // enclosing describe titles, outermost first, as written (a template keeps its ${…})
  title: string; // as written
  steps: Step[];
  skipped: boolean;
};
export type Status = "pass" | "fail" | "skip" | "not run";
export type Scenario = {
  feature: string;
  title: string;
  file: string;
  line: number;
  status: Status;
  error: string | null;
  steps: Step[];
  /** The files it ran with line counts; null for a unit test (coverage is shared), absent with no coverage. */
  covers: { file: string; lines: number }[] | null;
  unitTogether: { files: number; lines: number } | null;
  coverageKey: string;
  /** Null when the run left no step times for it (no steps file, or a title shared with another test). */
  timing: Timing | null;
};
export type Spec = {
  viz: string;
  ranAt: string | null;
  /** From the first test file starting to the last one ending; null with no results. */
  wallMs: number | null;
  scenarios: Scenario[];
};

const DESCRIBE = /^(\s*)describe(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\2).)*)\2/u;
// A step call's sentence; a template literal may run over lines.
const STEP = /\bviz\.(given|when|then)\(\s*(["'`])((?:\\.|(?!\2)[^])*)\2/gu;

/** Every it()/test() in a test file's source, with its describe path and its viz.given/when/then sentences. Finds a
 *  test's extent the way viz lint's test-shape check does (lib/lint/test-shape.ts): by indentation, not a syntax tree. */
export function parseTests(src: string, file: string): ParsedTest[] {
  const lines = src.split("\n");
  const stack: { indent: number; title: string }[] = [];
  const tests: ParsedTest[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) break;
    const d = line.match(DESCRIBE),
      m = d ? null : START.exec(line);
    if (!d && !m) continue;
    const [, lead = ""] = d ?? m ?? []; // group 1 always participates
    const ws = lead.length;
    for (let top = stack.at(-1); top && top.indent >= ws; top = stack.at(-1)) stack.pop();
    if (d) {
      const [, , , title = ""] = d;
      stack.push({ indent: ws, title });
      continue;
    }
    const { head, end } = extent(lines, i, ws);
    const body = lines.slice(i, end).join("\n");
    const steps = [...body.matchAll(STEP)].map((s): Step => {
      const [, kind = "", , text = ""] = s; // groups 1 and 3 always participate
      return {
        kind: kind.toUpperCase() as Step["kind"], // oxlint-disable-line typescript/no-unsafe-type-assertion -- the regex allows only these three
        text: text.replaceAll(/\\(.)/gu, "$1"),
        line: i + 1 + body.slice(0, s.index).split("\n").length - 1,
      };
    });
    tests.push({
      file,
      line: head + 1,
      start: i + 1,
      describes: stack.map((x) => x.title),
      title: TITLE.exec(lines.slice(head, head + 3).join(" "))?.[2] ?? "(untitled)",
      steps,
      skipped: /^\s*(?:it|test)(?:\.\w+)*\.(?:skip|todo)\b/u.test(line),
    });
    i = Math.max(i, end - 1); // nothing inside a test is another test
  }
  return tests;
}

/** The key coverage.json files a browser test under (lib/verify/tier.ts testName): nearest describe › title. */
export const coverageKey = (t: Pick<ParsedTest, "describes" | "title">): string =>
  t.describes.length > 0 ? `${t.describes.at(-1)} › ${t.title}` : t.title;

// ---- the last run: vitest's results file ---------------------------------------------------------------
/** One test as vitest's json reporter writes it. */
export type Assertion = {
  ancestorTitles: string[];
  title: string;
  status: string; // passed | failed | pending | skipped | todo
  failureMessages: string[];
  duration?: number | null; // ms
  location?: { line: number; column: number };
};
export type Results = {
  numTotalTests: number;
  numPendingTests: number;
  testResults: {
    name: string;
    status: string;
    message: string;
    startTime?: number;
    endTime?: number;
    assertionResults: Assertion[];
  }[];
};
export const resultsFile = (out: string): string => path.join(out, "results.json");
export function readResults(out: string): Results | null {
  const file = resultsFile(out);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Results) : null; // oxlint-disable-line typescript/no-unsafe-type-assertion -- the file vitest's json reporter wrote
}

/** The first line of a failure, without its error class: what the failure list and the spec show. */
export const whyOf = (failure: string | undefined): string =>
  (failure ?? "")
    .replace(/\n[^]*$/u, "")
    .replace(/^\w*Error(?: \[\w+\])?:\s*/u, "")
    .trim() || "failed";

type Case = {
  file: string;
  line: number;
  suites: string[];
  name: string;
  status: "pass" | "fail" | "skip";
  why: string;
  key: string; // names.ts testKey: what a step is recorded under
  ms: number | null;
};

/** Every test of a run, with the describe titles it sits under. */
export const casesOf = (results: Results): Case[] =>
  results.testResults.flatMap((f) =>
    f.assertionResults.map((a) => ({
      file: f.name,
      line: a.location?.line ?? 0,
      suites: a.ancestorTitles,
      name: a.title,
      status: a.status === "passed" ? "pass" : a.status === "failed" ? "fail" : "skip",
      why: whyOf(a.failureMessages[0]),
      key: testKey(f.name, a.ancestorTitles, a.title, a.location?.line),
      ms: a.duration ?? null,
    })),
  );

/** A step's sentence as a pattern: a template's ${…} stands for whatever it was at run time. */
const sentence = (text: string) =>
  text
    .split(/\$\{[^}]*\}/u)
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
    .join(".*?");

/** Mark the steps by how far the test got. A step that throws starts the error "THEN <sentence> — " (preload.ts),
 *  so that step failed, those before it passed, the rest were not reached. No such prefix (a timeout, a throw
 *  between steps): only the scenario is marked. */
export function markSteps(steps: Step[], why: string): Step[] {
  const at = steps.findIndex((s) =>
    new RegExp(`^${s.kind} ${sentence(s.text)} — `, "su").test(why),
  );
  if (at < 0) return steps;
  return steps.map((s, i) => ({
    ...s,
    state: i < at ? "passed" : i === at ? "failed" : "not reached",
  }));
}

/** One step as preload.ts records it. `test` is the scope id (names.ts testKey) of the test it ran in. */
type StepRecord = { test: string | null; kind: string; text: string; ms: number; ok: boolean };

/** The step records of the last run by test, in the order they ran. A title two tests share cannot be told apart, so
 *  neither gets any: a wrong time is worse than none. */
function readSteps(out: string, cases: Case[]): Map<string, StepRecord[]> {
  const byTest = new Map<string, StepRecord[]>();
  for (const f of readdirSync(out).filter((n) => /^steps-.*\.json$/u.test(n))) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the file preload.ts wrote
    for (const r of JSON.parse(readFileSync(path.join(out, f), "utf8")) as StepRecord[]) {
      if (r.test !== null) byTest.set(r.test, [...(byTest.get(r.test) ?? []), r]);
    }
  }
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.key)) byTest.delete(c.key);
    seen.add(c.key);
  }
  return byTest;
}

type CoverageData = { tests: Record<string, { lines: Record<string, number[]> }> };
const UNIT = "the unit tests (together, not per test)";

type Run = {
  cases: Case[] | null;
  cov: CoverageData | null;
  steps: Map<string, StepRecord[]>;
  wallMs: number | null;
};
const NO_RUN: Run = { cases: null, cov: null, steps: new Map(), wallMs: null };

/** What the last run left in `out`: its test results and this run's coverage. */
function readRun(out: string): Run {
  const results = readResults(out),
    covFile = path.join(out, "coverage.json");
  if (!results) return NO_RUN;
  // Coverage is measured only off a green run, so after a red one the file is an earlier run's: not this run's to show.
  const fresh =
    existsSync(covFile) && statSync(covFile).mtimeMs >= statSync(resultsFile(out)).mtimeMs;
  const cases = casesOf(results),
    starts = results.testResults.flatMap((f) => (f.startTime === undefined ? [] : [f.startTime])),
    ends = results.testResults.flatMap((f) => (f.endTime === undefined ? [] : [f.endTime]));
  return {
    cases,
    cov: fresh ? (JSON.parse(readFileSync(covFile, "utf8")) as CoverageData) : null, // oxlint-disable-line typescript/no-unsafe-type-assertion -- the file writeAttribution wrote
    steps: readSteps(out, cases),
    wallMs: starts.length > 0 ? Math.round(Math.max(...ends) - Math.min(...starts)) : null,
  };
}

/** The files a scenario ran, or — for a unit test, which has no coverage of its own — the unit tests' shared total. */
function coverOf(cov: CoverageData | null, key: string): Pick<Scenario, "covers" | "unitTogether"> {
  const shared = cov?.tests[key],
    unit = cov?.tests[UNIT];
  return {
    covers: shared
      ? Object.entries(shared.lines).map(([file, ls]) => ({ file, lines: ls.length }))
      : null,
    unitTogether:
      !shared && unit
        ? { files: Object.keys(unit.lines).length, lines: Object.values(unit.lines).flat().length }
        : null,
  };
}

/** Give each written step the time of the run's step that said it (in order; a template's ${…} matches its value), and
 *  total the run's steps by kind. A step that did not run, or ran inside a helper, has no time of its own but still
 *  counts in its kind's total. */
function timeSteps(
  written: Step[],
  recs: StepRecord[] | undefined,
  ms: number | null,
): { steps: Step[]; timing: Timing | null } {
  if (!recs || ms === null) return { steps: written, timing: null };
  let from = 0;
  const steps = written.map((s): Step => {
    const re = new RegExp(`^${sentence(s.text)}$`, "su");
    const at = recs.findIndex((r, i) => i >= from && r.kind === s.kind && re.test(r.text));
    if (at < 0) return s;
    from = at + 1;
    return { ...s, ms: recs[at]?.ms ?? 0 };
  });
  const sum = (kind: string) => recs.filter((r) => r.kind === kind).reduce((n, r) => n + r.ms, 0);
  return {
    steps,
    timing: {
      ms: Math.round(ms),
      givenMs: sum("GIVEN"),
      whenMs: sum("WHEN"),
      thenMs: sum("THEN"),
    },
  };
}

/** One test's scenarios: one, or one per iteration when it is a loop that has run. */
function scenariosFor(t: ParsedTest, { cases, cov, steps }: Run): Scenario[] {
  const key = coverageKey(t);
  const mine =
    cases?.filter((c) => c.line >= t.start && c.line <= t.line && c.file.endsWith(t.file)) ?? [];
  const base = {
    file: t.file,
    line: t.start,
    coverageKey: key,
    ...coverOf(cov, key),
  };
  const out: Scenario[] = [];
  for (const c of mine.length > 0 ? mine : [null]) {
    const written = c?.status === "fail" ? markSteps(t.steps, c.why) : t.steps,
      timed = timeSteps(written, c ? steps.get(c.key) : undefined, c?.ms ?? null);
    out.push({
      ...base,
      feature: (c ? c.suites : t.describes).join(" › ") || "(no describe)",
      title: c?.name ?? t.title,
      status: !c ? (t.skipped ? "skip" : "not run") : c.status,
      error: c?.status === "fail" ? c.why : null,
      steps: timed.steps,
      timing: timed.timing,
    });
  }
  return out;
}

/** Build the spec for the viz in `vizDir`, from its test files and whatever `out` (.verify/tests) holds. */
export function buildSpec(vizDir: string, out: string, withResults = true): Spec {
  const testsDir = path.join(vizDir, "tests");
  const files = existsSync(testsDir)
    ? readdirSync(testsDir)
        .filter((f) => /\.test\.(ts|js|mjs|tsx)$/u.test(f))
        .toSorted()
    : [];
  const tests = files.flatMap((f) =>
    parseTests(readFileSync(path.join(testsDir, f), "utf8"), `tests/${f}`),
  );
  const run = withResults ? readRun(out) : NO_RUN;
  return {
    viz: path.basename(vizDir),
    ranAt: run.cases ? statSync(resultsFile(out)).mtime.toISOString() : null,
    wallMs: run.wallMs,
    scenarios: tests.flatMap((t) => scenariosFor(t, run)),
  };
}

/** Write spec.html and spec.md beside coverage.html; returns the spec. */
export function writeSpec(vizDir: string, out: string, withResults = true): Spec {
  const spec = buildSpec(vizDir, out, withResults);
  writeFileSync(path.join(out, "spec.md"), renderSpecMd(spec));
  writeFileSync(path.join(out, "spec.html"), renderSpecHtml(spec));
  return spec;
}

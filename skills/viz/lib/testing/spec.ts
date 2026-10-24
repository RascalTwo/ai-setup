// lib/testing/spec.ts — the living spec: a viz's tests, read as what the page promises (ADR 0027).
//
// Each describe() is a feature, each it()/test() a scenario, the sentences of its viz.given / viz.when / viz.then
// calls its steps. Nothing is hand-written: the tests are read as text, then joined with the last run's results
// (bun's junit file, one entry per test with its real name) and its coverage.json. It adds no rule of its own:
// viz lint already fails a test without its three steps.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { renderSpecHtml, renderSpecMd } from "./spec-render.ts";
import { START, TITLE, extent } from "../lint/test-shape.ts";

export type Step = {
  kind: "GIVEN" | "WHEN" | "THEN";
  text: string; // the sentence as written (a template keeps its ${…})
  line: number;
  state?: "passed" | "failed" | "not reached";
};
/** One it()/test() as written in a test file. */
export type ParsedTest = {
  file: string; // relative to the viz
  line: number; // where its title is: what bun's junit reports as the test's line (an it.each's is past its table)
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
};
export type Spec = {
  viz: string;
  ranAt: string | null;
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
    const d = lines[i]!.match(DESCRIBE),
      m = d ? null : START.exec(lines[i]!);
    if (!d && !m) continue;
    const ws = (d?.[1] ?? m![1]!).length;
    while (stack.length > 0 && stack.at(-1)!.indent >= ws) stack.pop();
    if (d) {
      stack.push({ indent: ws, title: d[3]! });
      continue;
    }
    const { head, end } = extent(lines, i, ws);
    const body = lines.slice(i, end).join("\n");
    const steps = [...body.matchAll(STEP)].map((s): Step => ({
      kind: s[1]!.toUpperCase() as Step["kind"], // oxlint-disable-line typescript/no-unsafe-type-assertion -- the regex allows only these three
      text: s[3]!.replaceAll(/\\(.)/gu, "$1"),
      line: i + 1 + body.slice(0, s.index).split("\n").length - 1,
    }));
    tests.push({
      file,
      line: head + 1,
      start: i + 1,
      describes: stack.map((x) => x.title),
      title: TITLE.exec(lines.slice(head, head + 3).join(" "))?.[2] ?? "(untitled)",
      steps,
      skipped: /^\s*(?:it|test)(?:\.\w+)*\.(?:skip|todo)\b/u.test(lines[i]!),
    });
    i = Math.max(i, end - 1); // nothing inside a test is another test
  }
  return tests;
}

/** The key coverage.json files a browser test under (lib/verify/tier.ts testName): nearest describe › title. */
export const coverageKey = (t: Pick<ParsedTest, "describes" | "title">): string =>
  t.describes.length > 0 ? `${t.describes.at(-1)} › ${t.title}` : t.title;

// ---- the last run: bun's junit file + the failures runTests recorded ----------------------------------
type Case = {
  file: string;
  line: number;
  suites: string[];
  name: string;
  status: "pass" | "fail" | "skip";
};
const unxml = (s: string) =>
  s
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");

/** Every test case in a junit file, with the describe titles it sits under. Suites with no `line` are files. */
export function parseJunit(xml: string): Case[] {
  const out: Case[] = [];
  const open: (string | null)[] = []; // a describe's title, or null for a file's suite
  let cur: Case | null = null;
  for (const m of xml.matchAll(/<(\/?)(testsuite|testcase|failure|skipped)\b([^>]*?)(\/?)>/gu)) {
    const [, closing, tag, attrs = "", selfClosed] = m;
    const attr = (n: string) => {
      const v = attrs.match(new RegExp(`(?:^|\\s)${n}="([^"]*)"`, "u"))?.[1];
      return v === undefined ? undefined : unxml(v);
    };
    if (tag === "testsuite") {
      if (closing) open.pop();
      else {
        if (attr("line") !== undefined) open.push(attr("name") ?? "");
        else open.push(null);
        if (selfClosed) open.pop();
      }
    } else if (tag === "testcase") {
      if (closing) cur = null;
      else {
        cur = {
          file: attr("file") ?? "",
          line: Number(attr("line") ?? 0),
          suites: open.filter((s): s is string => s !== null),
          name: attr("name") ?? "",
          status: "pass",
        };
        out.push(cur);
        if (selfClosed) cur = null;
      }
    } else if (cur && !closing) cur.status = tag === "failure" ? "fail" : "skip";
  }
  return out;
}

export type Failure = { why: string };
const failuresFile = (out: string) => path.join(out, "failures.json");
export const junitFile = (out: string): string => path.join(out, "junit.xml");
export const saveFailures = (out: string, f: Record<string, Failure>): void =>
  writeFileSync(failuresFile(out), JSON.stringify(f));

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

type CoverageData = { tests: Record<string, { lines: Record<string, number[]> }> };
const UNIT = "the unit tests (bun, not per test)";

type Run = { cases: Case[] | null; failures: Record<string, Failure>; cov: CoverageData | null };

/** What the last run left in `out`: its junit cases, the failures runTests recorded, and this run's coverage. */
function readRun(out: string): Run {
  const junit = junitFile(out),
    covFile = path.join(out, "coverage.json");
  if (!existsSync(junit)) return { cases: null, failures: {}, cov: null };
  const failures: Record<string, Failure> = existsSync(failuresFile(out))
    ? (JSON.parse(readFileSync(failuresFile(out), "utf8")) as Record<string, Failure>) // oxlint-disable-line typescript/no-unsafe-type-assertion -- the file runTests wrote
    : {};
  // Coverage is measured only off a green run, so after a red one the file is an earlier run's: not this run's to show.
  const fresh = existsSync(covFile) && statSync(covFile).mtimeMs >= statSync(junit).mtimeMs;
  return {
    cases: parseJunit(readFileSync(junit, "utf8")),
    failures,
    cov: fresh ? (JSON.parse(readFileSync(covFile, "utf8")) as CoverageData) : null, // oxlint-disable-line typescript/no-unsafe-type-assertion -- the file writeAttribution wrote
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

/** One test's scenarios: one, or one per iteration when it is a loop that has run. */
function scenariosFor(t: ParsedTest, { cases, failures, cov }: Run): Scenario[] {
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
    const fail = c?.status === "fail" ? failures[[...c.suites, c.name].join(" > ")] : undefined;
    out.push({
      ...base,
      feature: (c ? c.suites : t.describes).join(" › ") || "(no describe)",
      title: c?.name ?? t.title,
      status: !c ? (t.skipped ? "skip" : "not run") : c.status,
      error: c?.status === "fail" ? (fail?.why ?? "failed") : null,
      steps: fail ? markSteps(t.steps, fail.why) : t.steps,
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
  const run = withResults ? readRun(out) : { cases: null, failures: {}, cov: null };
  return {
    viz: path.basename(vizDir),
    ranAt: run.cases ? statSync(junitFile(out)).mtime.toISOString() : null,
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

// tests/spec.test.ts — the living spec reads a viz's tests as features, scenarios and steps (ADR 0027).
//
// The fixtures are a test file as a viz would write it (sample.txt, not .test.ts so bun does not run it)
// and the junit bun would write for it (junit.xml); failures.json stands in for the errors runTests records.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSpec, markSteps, parseJunit, parseTests, writeSpec } from "../lib/testing/spec.ts";

const FIX = path.join(import.meta.dir, "fixtures", "spec");
const SRC = readFileSync(path.join(FIX, "sample.txt"), "utf8");
const tests = parseTests(SRC, "tests/sample.test.ts");
const byTitle = (t: string) => tests.find((x) => x.title === t)!;
const said = (t: string) => byTitle(t).steps.map((s) => `${s.kind} ${s.text}`);

describe("parseTests", () => {
  test("Given it/test/describe and a nested describe, then each test knows its describes, its line and its steps", () => {
    expect(tests.map((t) => t.title)).toEqual([
      "should say it scans",
      "should fall back",
      "should scan: ${id}",
      "should fit %s",
      "has nothing written",
      "is parked",
    ]);
    expect(byTitle("should say it scans").describes).toEqual(["The badge"]);
    expect(byTitle("should fall back").describes).toEqual(["The badge", "on a bad link"]);
    expect(said("should say it scans")).toEqual([
      "GIVEN a plain code",
      "WHEN the user types text",
      "THEN the badge says it scans",
    ]);
    expect(byTitle("should say it scans").steps.map((s) => s.line)).toEqual([5, 6, 7]);
  });

  test("Given a step with no function, two of one kind, and a sentence on the next line, then each is a step in order", () => {
    expect(said("should fall back")).toEqual([
      "GIVEN a crafted link",
      "WHEN it opens",
      "THEN it falls back",
      "THEN and it says why",
    ]);
  });

  test("Given a looped test, then it is one test with the template title and sentences as written", () => {
    expect(said("should scan: ${id}")).toEqual([
      "GIVEN style ${id}",
      "WHEN it is drawn",
      "THEN style ${id} scans",
    ]);
  });

  test("Given an it.each with a multi-line table, then its title and line are past the table and its steps are read", () => {
    const t = byTitle("should fit %s");
    expect([t.start, t.line]).toEqual([34, 37]);
    expect(t.steps.map((s) => s.kind)).toEqual(["GIVEN", "WHEN", "THEN"]);
  });

  test("Given a test with no steps or a skipped one, then it is listed with none, nothing invented", () => {
    expect(byTitle("has nothing written").steps).toEqual([]);
    expect(byTitle("is parked").skipped).toBe(true);
  });
});

describe("markSteps", () => {
  const steps = byTitle("should fall back").steps;
  const states = (why: string) => markSteps(steps, why).map((s) => s.state);

  test("Given an error with a step's prefix, then the steps before it passed, it failed, the rest were not reached", () => {
    expect(states("THEN it falls back — expect(received).toBe(expected)")).toEqual([
      "passed",
      "passed",
      "failed",
      "not reached",
    ]);
    expect(states("GIVEN a crafted link — boom")).toEqual([
      "failed",
      "not reached",
      "not reached",
      "not reached",
    ]);
  });

  test("Given an error with no step prefix (a timeout), then no step is marked", () => {
    expect(states("this test timed out after 5000ms")).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  test("Given a template sentence, then the run's value matches its ${…}", () => {
    const loop = byTitle("should scan: ${id}").steps;
    expect(markSteps(loop, "THEN style b scans — nope").map((s) => s.state)).toEqual([
      "passed",
      "passed",
      "failed",
    ]);
  });
});

describe("the spec, joined with a run", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "viz-spec-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, "tests"), { recursive: true });
  writeFileSync(path.join(dir, "tests", "sample.test.ts"), SRC);
  const out = path.join(dir, ".verify", "tests");
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "junit.xml"), readFileSync(path.join(FIX, "junit.xml"), "utf8"));
  writeFileSync(
    path.join(out, "failures.json"),
    JSON.stringify({
      "The badge > should say it scans": {
        why: "THEN the badge says it scans — expect(received).toBe(expected)",
      },
      "Styles > should scan: b": { why: "GIVEN style b — no such style" },
    }),
  );
  const spec = buildSpec(dir, out);
  const sc = (title: string) => spec.scenarios.find((s) => s.title === title)!;

  test("Given the junit, then a loop and an it.each show one scenario per iteration under its real name", () => {
    const loop = spec.scenarios.filter((s) => s.title.startsWith("should scan:"));
    expect(loop.map((s) => s.title)).toEqual(["should scan: a", "should scan: b"]);
    expect(loop.every((s) => s.steps.length === 3 && s.feature === "Styles")).toBe(true);
    expect(
      spec.scenarios.filter((s) => s.title.startsWith("should fit")).map((s) => s.title),
    ).toEqual(["should fit wide", "should fit tall"]);
  });

  test("Given a failure in the THEN, then GIVEN and WHEN passed and THEN failed; in the GIVEN, the rest were not reached", () => {
    const f = sc("should say it scans");
    expect(f.status).toBe("fail");
    expect(f.error).toBe("THEN the badge says it scans — expect(received).toBe(expected)");
    expect(f.steps.map((s) => s.state)).toEqual(["passed", "passed", "failed"]);
    expect(sc("should scan: b").steps.map((s) => s.state)).toEqual([
      "failed",
      "not reached",
      "not reached",
    ]);
    expect(sc("should scan: a").steps.every((s) => s.state === undefined)).toBe(true);
  });

  test("Given a test with no steps that passed, then it is listed as a pass with no steps", () => {
    expect([sc("has nothing written").status, sc("has nothing written").steps]).toEqual([
      "pass",
      [],
    ]);
    expect(sc("is parked").status).toBe("skip");
  });

  test("Given no junit at all, then nothing is green and a loop is one row with its template title", () => {
    const none = buildSpec(dir, path.join(dir, "nowhere"));
    expect(none.ranAt).toBeNull();
    expect(none.scenarios.some((s) => s.status === "pass")).toBe(false);
    expect(
      none.scenarios.filter((s) => s.title.startsWith("should scan")).map((s) => s.title),
    ).toEqual(["should scan: ${id}"]);
  });

  test("Given the spec, then spec.md marks failures ✗, steps by how far they got, and the header counts the passes", () => {
    writeSpec(dir, out);
    const md = readFileSync(path.join(out, "spec.md"), "utf8");
    expect(md).toContain("5 of 8 scenarios pass");
    expect(md).toContain("✗ **should say it scans**");
    expect(md).toContain("✗ GIVEN style ${id}"); // a loop shares the steps as written
    expect(md).toContain("no steps written");
    const html = readFileSync(path.join(out, "spec.html"), "utf8");
    expect(html).toContain("should scan: b");
    expect(html).toContain("not reached");
  });
});

test("Given a junit with describes nested and failures, then parseJunit gives each case its describes and status", () => {
  const cases = parseJunit(readFileSync(path.join(FIX, "junit.xml"), "utf8"));
  expect(cases.map((c) => [c.suites.join(" > "), c.name, c.status])).toEqual([
    ["The badge", "should say it scans", "fail"],
    ["The badge > on a bad link", "should fall back", "pass"],
    ["Styles", "should scan: a", "pass"],
    ["Styles", "should scan: b", "fail"],
    ["Styles", "should fit wide", "pass"],
    ["Styles", "should fit tall", "pass"],
    ["Styles", "has nothing written", "pass"],
    ["Styles", "is parked", "skip"],
  ]);
});

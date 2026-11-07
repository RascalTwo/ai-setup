// tests/lint-test-shape.test.ts — the GIVEN / WHEN / THEN shape check on a viz's tests (lib/lint/test-shape.ts).
//
// WHY: every test of a viz is GIVEN, then WHEN, then THEN, written as viz.given / viz.when / viz.then so that
// each is run and recorded. A comment saying so is not a step and does not count.

import { describe, expect, test } from "bun:test";
import { testShape } from "../lib/lint/test-shape.ts";

const check = (body: string) =>
  testShape(`describe("x", () => {\n  it("should y", () => {\n${body}\n  });\n});\n`, "f.test.ts");

describe("testShape", () => {
  test("accepts steps, and does not accept comments in their place", () => {
    // GIVEN one test written with steps and one with only comments
    const steps = '    await viz.given("a");\n    await viz.when("b");\n    await viz.then("c");';
    const comments = "    // GIVEN a\n    // WHEN b\n    // THEN c";

    // WHEN each is checked
    // THEN the steps are fine and the comments are a finding
    expect(check(steps)).toEqual([]);
    expect(check(comments)[0]).toContain("has no viz.given(…) or viz.when(…) or viz.then(…)");
  });

  test("names the missing verb and the test", () => {
    // GIVEN a test with a GIVEN and a THEN but no WHEN
    // WHEN it is checked
    const found = check('    await viz.given("a");\n    await viz.then("c");');

    // THEN the finding names the file, the line, the title and what is missing
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('f.test.ts:2 test "should y" has no viz.when(…)');
  });

  test("flags a test with no markers at all, and one out of order", () => {
    // GIVEN a bare test and one whose THEN comes before its WHEN
    // WHEN each is checked
    // THEN the first lacks all three and the second is out of order
    expect(check("    expect(1).toBe(1);")[0]).toContain(
      "has no viz.given(…) or viz.when(…) or viz.then(…)",
    );
    expect(
      check('    await viz.given("a");\n    await viz.then("c");\n    await viz.when("b");')[0],
    ).toContain("does not go GIVEN");
  });

  test("leaves it.todo and tests it does not own alone", () => {
    // GIVEN a todo with no body and a describe block
    // WHEN checked
    // THEN nothing is reported
    expect(testShape('it.todo("later");\ndescribe("x", () => {});\n', "f.test.ts")).toEqual([]);
  });

  test("reads a test whose header wraps over lines", () => {
    // GIVEN a concurrent test with its title and function on separate lines, missing its THEN
    const text =
      'it.concurrent(\n  "should wrap",\n  async () => {\n    await viz.given("a");\n    await viz.when("b");\n  },\n);\n';

    // WHEN checked
    // THEN the finding is for the wrapped title
    expect(testShape(text, "f.test.ts")[0]).toContain('"should wrap" has no viz.then(…)');
  });

  test("reads past a multi-line it.each table to the body", () => {
    // GIVEN it.each tables that close at the test's own indent, one with all three steps and one missing its THEN
    const table = (steps: string) =>
      `it.each([\n  ["a", 1],\n  ["b", 2],\n] as const)("should %s", async (s, n) => {\n${steps}\n});\n`;
    const all = '  await viz.given("a");\n  await viz.when("b");\n  await viz.then("c");';

    // WHEN each is checked
    // THEN the full one is fine and the other is flagged, under its own title, for its THEN only
    expect(testShape(table(all), "f.test.ts")).toEqual([]);
    expect(
      testShape(table('  await viz.given("a");\n  await viz.when("b");'), "f.test.ts")[0],
    ).toContain('"should %s" has no viz.then(…)');
  });
});

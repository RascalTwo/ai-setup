// tests/testing-steps.test.ts — viz.given / viz.when / viz.then, the GIVEN / WHEN / THEN steps a viz's tests can write as code.
//
// WHY: a step must return what its function returned (that is how values pass between steps), name itself in a
// failure, and leave a record of what ran. These run the real preload on a fixture test file, as verify does.

import { afterAll, expect, test } from "vitest";
import path from "node:path";
import { parseJson } from "./json.ts";
import { run } from "../lib/proc.ts";
import { buildSpec, casesOf, readResults } from "../lib/testing/spec.ts";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const SKILL = path.dirname(import.meta.dirname);
const DIR = path.join(SKILL, "tests", ".tmp-vizzes", "steps");
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

rmSync(DIR, { recursive: true, force: true });
mkdirSync(path.join(DIR, "tests"), { recursive: true });
writeFileSync(
  path.join(DIR, "tests", "a.test.ts"),
  `import { it, expect } from "vitest";
it("passes a value between steps", async () => {
  const n = await viz.given("the number two", () => 2);
  const double = await viz.when("it is doubled", async () => n * 2);
  await viz.when("nothing else happens");
  await viz.then("it is four", () => expect(double).toBe(4));
});
it("refuses to be awaited instead of hanging", async () => {
  await expect((async () => await (viz as unknown))()).rejects.toThrow("is a step, not a promise");
});
it("names the step that failed", async () => {
  await viz.given("a fine start");
  await viz.then("it is five", () => expect(2 + 2).toBe(5));
});
`,
);

writeFileSync(
  path.join(DIR, "tests", "b.test.ts"),
  `import { setTimeout } from "node:timers/promises";
describe("A loop", () => {
  for (const n of [1, 2, 3])
    it.concurrent(\`waits \${n}\`, async () => {
      await viz.given(\`it waits \${n}00 ms\`, () => setTimeout(n * 100));
      await viz.when(\`it waits again\`, () => setTimeout(n * 100));
      await viz.then(\`it waits a last time\`, () => setTimeout(n * 100));
    });
});
`,
);

async function runSteps(file = "a") {
  await run(
    [
      process.execPath,
      path.join(SKILL, "node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      path.join(SKILL, "lib/testing/vitest.config.ts"),
      "--root",
      DIR,
      `tests/${file}.test.ts`,
    ],
    {
      cwd: DIR,
      env: {
        ...process.env,
        NO_COLOR: "1",
        VIZ_URL: "http://127.0.0.1:1/",
        VIZ_DIR: DIR,
        VIZ_OUT: DIR,
      },
    },
  );
  return casesOf(readResults(DIR) ?? { numTotalTests: 0, numPendingTests: 0, testResults: [] });
}

test("a step returns its function's result, names itself in a failure, and is recorded", async () => {
  // GIVEN a test file with one passing run of steps, one that awaits `viz` by mistake and one whose last step fails
  // WHEN it runs under the viz preload
  const cases = await runSteps();

  // THEN the first two tests passed and the third failed, and its failure names the step
  expect(cases.map((c) => [c.name, c.status])).toEqual([
    ["passes a value between steps", "pass"],
    ["refuses to be awaited instead of hanging", "pass"],
    ["names the step that failed", "fail"],
  ]);
  expect(cases[2]?.why).toContain("THEN it is five");

  // THEN every step that ran is on record, in order, with its kind, sentence and outcome
  const file = readdirSync(DIR).find((f) => f.startsWith("steps-"));
  expect(file).toBeDefined();
  if (file === undefined) throw new Error("no steps- file was written");
  const steps = parseJson<{ kind: string; text: string; ok: boolean; ms: number }[]>(
    readFileSync(path.join(DIR, file), "utf8"),
  ).map(({ kind, text, ok, ms }) => ({ kind, text, ok, timed: typeof ms === "number" }));
  expect(steps).toEqual([
    { kind: "GIVEN", text: "the number two", ok: true, timed: true },
    { kind: "WHEN", text: "it is doubled", ok: true, timed: true },
    { kind: "WHEN", text: "nothing else happens", ok: true, timed: true },
    { kind: "THEN", text: "it is four", ok: true, timed: true },
    { kind: "GIVEN", text: "a fine start", ok: true, timed: true },
    { kind: "THEN", text: "it is five", ok: false, timed: true },
  ]);
});

test("a loop's iterations that run at once each get their own step times", async () => {
  // GIVEN three iterations of one concurrent test, whose three steps each wait 100, 200 and 300 ms and which overlap
  // WHEN they run under the viz preload and the spec is built from what they left
  await runSteps("b");
  const waits = buildSpec(DIR, DIR).scenarios.filter((s) => s.file === "tests/b.test.ts");

  // THEN each iteration's GIVEN, WHEN and THEN are its own wait, and no iteration's steps add up to more than its test
  expect(waits.map((s) => s.title)).toEqual(["waits 1", "waits 2", "waits 3"]);
  waits.forEach((s, i) => {
    const t = s.timing;
    if (!t) throw new Error(`${s.title} has no step times`);
    for (const kind of [t.givenMs, t.whenMs, t.thenMs])
      expect(kind).toBeGreaterThanOrEqual((i + 1) * 100 - 5);
    expect(t.givenMs + t.whenMs + t.thenMs).toBeLessThanOrEqual(t.ms + 5);
  });
}, 60_000);

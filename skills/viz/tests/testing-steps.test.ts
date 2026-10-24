// tests/testing-steps.test.ts — viz.given / viz.when / viz.then, the GIVEN / WHEN / THEN steps a viz's tests can write as code.
//
// WHY: a step must return what its function returned (that is how values pass between steps), name itself in a
// failure, and leave a record of what ran. These run the real preload on a fixture test file, as verify does.

import { afterAll, expect, test } from "bun:test";
import path from "node:path";
import { parseJson } from "./json.ts";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const SKILL = path.dirname(import.meta.dir);
const DIR = path.join(SKILL, "tests", ".tmp-vizzes", "steps");
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

rmSync(DIR, { recursive: true, force: true });
mkdirSync(path.join(DIR, "tests"), { recursive: true });
writeFileSync(
  path.join(DIR, "tests", "a.test.ts"),
  `import { it, expect } from "bun:test";
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

async function run() {
  const proc = Bun.spawn(
    ["bun", "test", "--preload", path.join(SKILL, "lib/testing/preload.ts"), "./tests/a.test.ts"],
    {
      cwd: DIR,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        NO_COLOR: "1",
        VIZ_URL: "http://127.0.0.1:1/",
        VIZ_DIR: DIR,
        VIZ_OUT: DIR,
      },
    },
  );
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  return out + err;
}

test("a step returns its function's result, names itself in a failure, and is recorded", async () => {
  // GIVEN a test file with one passing run of steps, one that awaits `viz` by mistake and one whose last step fails
  // WHEN it runs under the viz preload
  const output = await run();

  // THEN the first test passed and the second failed
  expect(output).toContain(" 2 pass");
  expect(output).toContain("(fail) names the step that failed");
  // THEN the failure names the step
  expect(output).toContain("THEN it is five");

  // THEN every step that ran is on record, in order, with its kind, sentence and outcome
  const file = readdirSync(DIR).find((f) => f.startsWith("steps-"));
  expect(file).toBeDefined();
  const steps = parseJson<{ kind: string; text: string; ok: boolean; ms: number }[]>(
    readFileSync(path.join(DIR, file!), "utf8"),
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

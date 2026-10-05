// tests/verify-parts.test.ts — `viz verify` is an umbrella; `audit`, `types` and `test` each run one of its jobs.
//
// WHY: verify does three jobs in one run (ADR 0024). Each verb must report only its own job, or
// "just tell me the types" would fail on a missing test, and a clean `viz types` could hide a broken page.
// These tests drive the real CLI against one throwaway viz that is wrong in two different ways:
// its page renders fine, it takes input but has no tests, and it has a type error.

import { afterAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { parseJson } from "./json.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const SKILL = path.dirname(import.meta.dir);
const DIR = path.join(SKILL, "tests", ".tmp-vizzes", "verify-parts");
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
writeFileSync(
  path.join(DIR, "index.html"),
  `<!doctype html><html><head><meta charset="utf-8"><title>t</title></head><body><h1>Fixture</h1><svg width="200" height="100"><rect width="80" height="60"/><circle cx="140" cy="50" r="30"/></svg><p>A fixture viz with enough on it to pass the layout audit.</p><input id="name" type="text"></body></html>`,
);
writeFileSync(path.join(DIR, "app.ts"), `export const n: number = "not a number";\n`);

type Verdict = {
  ok: boolean;
  parts: string[];
  errors: string[];
  rendered: string | null;
  artifacts: unknown;
  tests: unknown;
  types: unknown;
};
async function run(
  verb: string,
  env: Record<string, string> = {},
): Promise<{ code: number; v: Verdict }> {
  const proc = Bun.spawn(
    ["bun", path.join(SKILL, "viz.ts"), verb, `file://${DIR}/index.html`, "--json"],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, VIZ_NO_OPEN: "1", ...env },
    },
  );
  const out = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, v: parseJson<Verdict>(out.slice(out.indexOf("{"))) };
}

describe("each verb reports only its own job", () => {
  test.concurrent("Given a viz with a type error and no tests, when audit runs, then it passes and says it checked neither", async () => {
    // GIVEN a viz that renders cleanly but has a type error and an input with no tests (the fixture)

    // WHEN audit runs
    const { code, v } = await run("audit");

    // THEN it passes: the page is fine, and types and tests are not its job
    expect(code).toBe(0);
    expect(v.errors).toEqual([]);
    // THEN the verdict says which job ran, and that it rendered the page
    expect(v.parts).toEqual(["audit"]);
    expect(v.rendered).toContain("rect");
    expect(v.types).toBeNull();
    expect(v.tests).toBeNull();
  });

  test.concurrent("Given a viz with a type error and no tests, when types runs, then it fails on the type error alone", async () => {
    // GIVEN the same viz

    // WHEN types runs
    const { code, v } = await run("types");

    // THEN it fails, and every error it names is a type error, not the missing tests
    expect(code).toBe(1);
    expect(v.errors.length).toBeGreaterThan(0);
    expect(v.errors.every((e) => e.includes("TYPES:"))).toBe(true);
    // THEN it did not render the page
    expect(v.rendered).toBeNull();
    expect(v.artifacts).toBeNull();
  });

  test.concurrent("Given a viz with a type error and no tests, when test runs, then it fails on the missing tests alone", async () => {
    // GIVEN the same viz

    // WHEN test runs
    const { code, v } = await run("test");

    // THEN it fails, and every error it names is about the tests, not the type error
    expect(code).toBe(1);
    expect(v.errors.length).toBeGreaterThan(0);
    expect(v.errors.every((e) => e.includes("TESTS:"))).toBe(true);
    // THEN it did not check the types
    expect(v.types).toBeNull();
  });
});

test.concurrent("Given a viz with a type error and no tests, when verify runs, then it reports all of its jobs", async () => {
  // GIVEN the same viz

  // WHEN verify runs
  const { code, v } = await run("verify");

  // THEN it fails, having run every job
  expect(code).toBe(1);
  expect(v.parts).toEqual(["audit", "types", "test", "lint", "format"]);
  // THEN both problems are reported, from their own jobs
  expect(v.errors.some((e) => e.includes("TYPES:"))).toBe(true);
  expect(v.errors.some((e) => e.includes("TESTS:"))).toBe(true);
  expect(v.rendered).toContain("rect");
});

test.concurrent("Given no Chrome on the machine, when types runs, then it still reports the type error", async () => {
  // GIVEN Chrome is not where the skill looks for it
  const env = { PUPPETEER_EXECUTABLE_PATH: "/nonexistent/chrome" };

  // WHEN types runs
  const { code, v } = await run("types", env);

  // THEN it reports the type error rather than failing to launch a browser
  expect(code).toBe(1);
  expect(v.errors.some((e) => e.includes("TYPES:"))).toBe(true);
});

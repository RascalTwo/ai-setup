// tests/skill-lint.test.ts — the skill's own TypeScript, linted by its own `viz lint` (the pre-commit side of the plan).
//
// The skill is the first thing the lint rollout covers: the type-aware engine must have run on it (so a silent skip
// cannot look like a pass) and it must have no findings.

import path from "node:path";
import { expect, test } from "bun:test";
import { lint } from "../lib/lint/lint.ts";

const SKILL = path.dirname(import.meta.dir);

test("Given the skill's own code, when lint runs, then the type-aware engine ran and nothing is found", () => {
  // GIVEN the skill, without the vizzes and the kit that live inside it (they have their own checks)
  // WHEN lint runs over it
  const r = lint(SKILL, ["viz-pages", "kit", "tests/fixtures", "templates", "node_modules"])!;

  // THEN it linted the skill's files, with the type-aware engine, and found nothing
  expect(r.files).toBeGreaterThan(50);
  expect(r.skipped).toBeNull();
  expect(r.findings).toEqual([]);
});

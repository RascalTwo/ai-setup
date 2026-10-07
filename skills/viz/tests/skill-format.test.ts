// tests/skill-format.test.ts — the skill's own TypeScript, CSS and HTML, formatted by the formatter it ships (`viz format`).
//
// The vizzes cannot pass `viz verify` unformatted; the skill that checks them is held to the same rule.

import { expect, test } from "bun:test";
import { formatSkill } from "../maintainer/format-self.ts";

test("Given the skill's own source, when the formatter checks it, then every file is formatted", () => {
  // GIVEN the skill without its vizzes and fixtures; WHEN the formatter runs without writing
  const r = formatSkill(false)!;

  // THEN it checked the skill's files (a silent skip cannot look like a pass) and none is left unformatted
  expect(r.files).toBeGreaterThan(100);
  expect(r.skipped).toBeNull();
  expect(r.findings).toEqual([]);
}, 60000);

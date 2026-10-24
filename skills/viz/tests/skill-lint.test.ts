// tests/skill-lint.test.ts — everything this repo ships as TypeScript, linted by `viz lint` (the pre-commit side of the plan).
//
// Each call must have run the type-aware engine (so a silent skip cannot look like a pass) and find nothing. The skill's own
// code, the kit, and each viz folder are separate calls because they need different tsconfigs: `lint` writes a temporary viz
// tsconfig into the folder it is given, which is right for kit/src and the vizzes but wrong from the skill root (measured:
// 5,204 bogus findings), so the skill root call leaves them out.

import { existsSync } from "node:fs";
import path from "node:path";
import { expect, test } from "bun:test";
import { lint } from "../lib/lint/lint.ts";

const SKILL = path.dirname(import.meta.dir);

test("Given the skill's own code, when lint runs, then the type-aware engine ran and nothing is found", () => {
  // GIVEN the skill, without the vizzes and the kit that live inside it (each is linted in its own test below)
  // WHEN lint runs over it
  const r = lint(SKILL, ["viz-pages", "kit", "tests/fixtures", "templates", "node_modules"])!;

  // THEN it linted the skill's files, with the type-aware engine, and found nothing
  expect(r.files).toBeGreaterThan(50);
  expect(r.skipped).toBeNull();
  expect(r.findings).toEqual([]);
});

test("Given the kit's TypeScript sources, when lint runs, then the type-aware engine ran and nothing is found", () => {
  // GIVEN kit/src, linted as a viz folder (the .js beside it is generated and ignored)
  // WHEN lint runs over it
  const r = lint(path.join(SKILL, "kit/src"))!;

  // THEN it linted the sources, with the type-aware engine, and found nothing
  expect(r.files).toBeGreaterThan(10);
  expect(r.skipped).toBeNull();
  expect(r.findings).toEqual([]);
});

// The vizzes the skill bundles. templates/ holds only base-url.sh (no TypeScript), so there is nothing there to lint.
// deck, poster and poster-dive are plain HTML/CSS with no TypeScript: lint returns null for them, asserted below so
// that "nothing to lint" is a stated fact and not a skipped test.
const BUNDLED_WITH_TS = ["viz-self-portrait", "exchange"];
const BUNDLED_WITHOUT_TS = ["deck", "poster", "poster-dive"];

for (const name of BUNDLED_WITH_TS) {
  test(`Given the bundled viz ${name}, when lint runs, then the type-aware engine ran and nothing is found`, () => {
    // GIVEN a bundled viz that has TypeScript
    // WHEN lint runs over its folder
    const r = lint(path.join(SKILL, "viz-pages", name))!;

    // THEN it linted its files, with the type-aware engine, and found nothing
    expect(r).not.toBeNull();
    expect(r.files).toBeGreaterThan(0);
    expect(r.skipped).toBeNull();
    expect(r.findings).toEqual([]);
  });
}

for (const name of BUNDLED_WITHOUT_TS) {
  test(`Given the bundled viz ${name}, when lint runs, then it reports there is no TypeScript to lint`, () => {
    // GIVEN a bundled viz with no TypeScript
    // WHEN lint runs over its folder
    // THEN lint returns null: it had nothing to lint (if this viz gains a .ts file, move it to BUNDLED_WITH_TS)
    expect(lint(path.join(SKILL, "viz-pages", name))).toBeNull();
  });
}

test("Given the viz pages on disk, when compared with the lists above, then every bundled viz is covered", () => {
  // GIVEN the folders under viz-pages/
  // WHEN compared with the two lists
  const onDisk = new Bun.Glob("*/").scanSync({
    cwd: path.join(SKILL, "viz-pages"),
    onlyFiles: false,
  });

  // THEN none is missing from them, so a new bundled viz cannot dodge the lint
  expect([...onDisk].map((d) => d.replace(/\/$/u, "")).toSorted()).toEqual(
    [...BUNDLED_WITH_TS, ...BUNDLED_WITHOUT_TS].toSorted(),
  );
});

test("Given the pr-viz template, when lint runs, then the type-aware engine ran and nothing is found", () => {
  // GIVEN the viz template this repo ships in the sibling pr-viz skill
  const template = path.join(SKILL, "../pr-viz/template");
  // it must be there: a missing template is a failure, not a skip
  expect(existsSync(template)).toBe(true);

  // WHEN lint runs over it
  const r = lint(template)!;

  // THEN it linted its files, with the type-aware engine, and found nothing
  expect(r).not.toBeNull();
  expect(r.files).toBeGreaterThan(0);
  expect(r.skipped).toBeNull();
  expect(r.findings).toEqual([]);
});

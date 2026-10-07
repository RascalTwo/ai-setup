// tests/copy.test.ts — a mirror or vendored copy is checked at its origin, and a stale lint disable is a finding.
//
// WHY: a copy has the same source as its origin, so checking both reports every finding twice (and tempts a fix in the
// copy, which the next sync undoes). And a disable whose finding is gone is clutter that hides the next real one.

import { afterAll, describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { isCopy, sourceDirFor } from "../lib/copy.ts";
import { lint } from "../lib/lint/lint.ts";

// Under the home directory: a vendored copy's receipt names its origin relative to it.
const ROOT = mkdtempSync(path.join(os.homedir(), ".viz-copy-test-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function viz(name: string, files: Record<string, string>): string {
  const dir = path.join(ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(path.join(dir, f), body);
  return dir;
}
const BAD = "export const x = (a: number) => a == null;\n";

describe("a copy of another viz", () => {
  test("Given a mirror, when its source is looked up, then there is none to check and lint skips it", () => {
    const mirror = viz("mirror", {
      "index.html": "<title>t</title>",
      ".mirror.json": "{}",
      "a.ts": BAD,
    });
    expect(isCopy(mirror)).toBe(true);
    expect(sourceDirFor(mirror)).toBeNull();
    expect(lint(mirror)).toBeNull();
  });

  test("Given a vendored copy whose origin is here, when its source is looked up, then it is the origin", () => {
    const origin = viz("origin", { "index.html": "<title>t</title>", "a.ts": BAD });
    const receipt = JSON.stringify({ origin: path.relative(os.homedir(), origin) });
    const copy = viz("copy", {
      "index.html": "<title>t</title>",
      ".vendored.json": receipt,
      "a.ts": BAD,
    });
    expect(sourceDirFor(copy)).toBe(origin);
    expect(lint(copy)).toBeNull();
    // THEN the finding is reported once, at the origin
    expect(lint(origin)!.findings.length).toBeGreaterThan(0);
  });

  test("Given a vendored copy whose origin is not on this machine, when its source is looked up, then it is none", () => {
    const copy = viz("lost", {
      "index.html": "<title>t</title>",
      ".vendored.json": '{"origin":"nowhere/at/all"}',
    });
    expect(sourceDirFor(copy)).toBeNull();
  });

  test("Given an ordinary viz, when its source is looked up, then it is itself", () => {
    const own = viz("own", { "index.html": "<title>t</title>" });
    expect(isCopy(own)).toBe(false);
    expect(sourceDirFor(own)).toBe(own);
  });
});

describe("a stale lint disable", () => {
  test("Given a disable above code that has no such finding, when lint runs, then it is reported", () => {
    // the directive is assembled so this file does not itself hold one
    const stale = [
      "// oxlint-",
      "disable-next-line eqeqeq -- nothing on the next line breaks that rule\n",
    ].join("");
    const v = viz("stale", {
      "index.html": "<title>t</title>",
      "a.ts": `${stale}export const x = 1;\n`,
    });
    expect(lint(v)!.findings.join("\n")).toContain("Unused oxlint");
  }, 60000);
});

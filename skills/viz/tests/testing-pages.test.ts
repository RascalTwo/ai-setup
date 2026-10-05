// tests/testing-pages.test.ts — the review and coverage pages' scripts are TypeScript (ADR 0023).
//
// WHY: serveReview and writeAttribution strip their types as they serve or write the page, and
// stripping checks nothing. So the checker runs here, at the strictness a typed viz is held to.
// coverage.html is opened from file://, so its script must also stay a classic script.
import { expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { STRICT, TSC_PATH } from "../lib/verify/types.ts";

const PAGES = path.join(path.dirname(import.meta.dir), "lib", "testing");

test("Given the review and coverage pages' scripts, when checked at verify's strictness, then there are no type errors", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "viz-pages-"));
  try {
    writeFileSync(
      path.join(tmp, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { ...STRICT, noEmit: true },
        files: [path.join(PAGES, "review.ts"), path.join(PAGES, "coverage.ts")],
      }),
    );
    const r = Bun.spawnSync({
      cmd: [process.execPath, TSC_PATH, "-p", path.join(tmp, "tsconfig.json"), "--pretty", "false"],
    });
    expect((r.stdout.toString() + r.stderr.toString()).trim()).toBe("");
    expect(r.exitCode).toBe(0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("Given coverage.ts, when its types are stripped, then it has no import or export, so it runs as a classic script from file://", () => {
  const js = new Bun.Transpiler({ loader: "ts" }).transformSync(
    readFileSync(path.join(PAGES, "coverage.ts"), "utf8"),
  );
  expect(js).not.toMatch(/^\s*(import|export)\b/mu);
});

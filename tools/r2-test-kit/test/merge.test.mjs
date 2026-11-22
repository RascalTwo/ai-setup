import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { defaults } from "../src/config.mjs";
import { buildCoverageMap, KitError, loadInputs, merge } from "../src/merge.mjs";
import { app, tmp } from "./helpers.mjs";

describe("inputs", () => {
  test("a missing input folder fails with its name", () => {
    const cwd = app();
    rmSync(join(cwd, "out/coverage/e2e"), { recursive: true });
    expect(() => loadInputs(defaults.inputs, cwd)).toThrow(new KitError("coverage input missing: out/coverage/e2e"));
  });

  test("an input with only a load record, or nothing, fails as empty", () => {
    const cwd = app();
    rmSync(join(cwd, "out/coverage/unit/"), { recursive: true });
    mkdirSync(join(cwd, "out/coverage/unit"));
    expect(() => loadInputs(defaults.inputs, cwd)).toThrow("coverage input empty: out/coverage/unit has no test record with coverage");
    writeFileSync(join(cwd, "out/coverage/unit/a.json"), JSON.stringify({ name: "(load) x", load: true, files: { "src/lib.js": {} } }));
    expect(() => loadInputs(defaults.inputs, cwd)).toThrow("coverage input empty");
  });
});

describe("coverage map", () => {
  test("merges every runner's records, and counts a file no runner loaded at 0%", () => {
    const cwd = app();
    const map = buildCoverageMap(loadInputs(defaults.inputs, cwd), defaults, cwd);
    expect(map.files()).toEqual(["src/lib.js", "src/never.ts"]);
    const lib = map.fileCoverageFor("src/lib.js");
    const fns = Object.fromEntries(Object.entries(lib.fnMap).map(([id, f]) => [f.name, lib.f[id]]));
    expect(fns).toEqual({ add: 1, pick: 1, unused: 0 });
    expect(Object.values(lib.b)).toEqual([[1, 0]]);
    expect(map.fileCoverageFor("src/never.ts").toSummary().lines.pct).toBe(0);
  });

  test("the include function filters records, stored maps and unloaded files alike", () => {
    const cwd = app();
    const map = buildCoverageMap(loadInputs(defaults.inputs, cwd), { include: () => false }, cwd);
    expect(map.files()).toEqual([]);
  });

  test("a record whose static map is gone is skipped; an app without src/ just has no unloaded files", () => {
    const cwd = app();
    rmSync(join(cwd, "out/coverage/meta"), { recursive: true });
    rmSync(join(cwd, "src"), { recursive: true });
    expect(buildCoverageMap(loadInputs(defaults.inputs, cwd), defaults, cwd).files()).toEqual([]);
    expect(buildCoverageMap([], defaults, tmp()).files()).toEqual([]);
  });
});

describe("merge", () => {
  test("writes lcov, HTML and JSON, and checks the floor on the totals", () => {
    const cwd = app();
    writeFileSync(join(cwd, "coverage-floor.json"), JSON.stringify({ lines: 99 }));
    const r = merge(defaults, cwd);
    expect(r.ok).toBe(false);
    expect(r.messages[0]).toMatch(/^COVERAGE FLOOR: lines [\d.]+% < 99%$/);
    expect(readFileSync(join(cwd, "out/coverage/merged/lcov.info"), "utf8")).toMatch("SF:src/lib.js");
    expect(readFileSync(join(cwd, "out/coverage/merged/lcov-report/index.html"), "utf8")).toMatch("lib.js");
    expect(Object.keys(r.totals)).toEqual(["lines", "statements", "functions", "branches"]);
  });
});

import { describe, expect, test } from "vitest";
import { defaults } from "../src/config.mjs";
import { buildMap, keysOf, queryLine, queryTest } from "../src/cov-map.mjs";
import { loadInputs } from "../src/merge.mjs";
import { readMeta } from "../src/record.mjs";
import { app } from "./helpers.mjs";

const built = () => {
  const cwd = app();
  return buildMap(loadInputs(defaults.inputs, cwd), defaults.include, cwd);
};

describe("cov-map", () => {
  test("a test is credited with what it ran and nothing else", () => {
    const map = built();
    expect(map.byTest["unit > add"]).toEqual({ "src/lib.js": ["2", "2#add"] });
    expect(map.byTest["e2e > pos"]).toEqual({ "src/lib.js": ["3", "3#pick", "3.b0.0"] });
  });

  test("a function no test calls is credited to no test, not even the load record", () => {
    const map = built();
    expect(map.byLine["src/lib.js:4#unused"]).toBeUndefined();
    expect(Object.values(map.byTest).flatMap((f) => f["src/lib.js"] ?? [])).not.toContain("4#unused");
    expect(map.byTest["(load) unit"]).toEqual({ "src/lib.js": ["1"] });
  });

  test("--line lists each key on the line, branch arms included, with its tests", () => {
    const map = built();
    expect(queryLine(map, "src/lib.js:3")).toEqual(["src/lib.js:3 <- e2e > pos", "src/lib.js:3#pick <- e2e > pos", "src/lib.js:3.b0.0 <- e2e > pos", "src/lib.js:3.b0.1 <- (no test ran it)"]);
    expect(queryLine(map, "src/lib.js:4")).toEqual(["src/lib.js:4 <- (no test ran it)", "src/lib.js:4#unused <- (no test ran it)"]);
    expect(queryLine(map, "src/lib.js:99")).toEqual(["src/lib.js:99: nothing counted on that line"]);
    expect(queryLine(map, "src/nope.js:1")).toEqual(["src/nope.js:1: nothing counted on that line"]);
  });

  test("--test matches a substring and lists lines, functions and arms per file", () => {
    const map = built();
    expect(queryTest(map, "pos")).toEqual(["e2e > pos", "  src/lib.js: 3 3#pick 3.b0.0"]);
    expect(queryTest(map, "zzz")).toEqual(['no test matches "zzz"']);
  });

  test("records outside the include filter, with a lost map, or that ran nothing are left out", () => {
    const cwd = app();
    const records = loadInputs(defaults.inputs, cwd);
    expect(buildMap(records, () => false, cwd)).toEqual({ byTest: {}, byLine: {}, keys: {} });
    const lost = records.map((r) => ({ ...r, files: Object.fromEntries(Object.entries(r.files).map(([f, c]) => [f, { ...c, m: "gone" }])) }));
    expect(buildMap(lost, defaults.include, cwd).byTest).toEqual({});
    const idle = records.map((r) => ({ ...r, files: Object.fromEntries(Object.entries(r.files).map(([f, c]) => [f, { m: c.m, s: {}, f: {}, b: {} }])) }));
    expect(buildMap(idle, defaults.include, cwd).byTest).toEqual({});
  });

  test("keys sort by line number, then by kind", () => {
    const cwd = app();
    const [meta] = Object.values(readMeta(cwd));
    expect(keysOf(meta)).toEqual(["1", "2", "2#add", "3", "3#pick", "3.b0.0", "3.b0.1", "4", "4#unused"]);
  });
});

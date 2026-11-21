import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { checkFloor } from "../src/floor.mjs";
import { tmp } from "./helpers.mjs";

const at = (n) => ({ lines: n, statements: n, functions: n, branches: n });
const floorFile = (floor) => {
  const file = join(tmp(), "coverage-floor.json");
  if (floor) writeFileSync(file, JSON.stringify(floor));
  return file;
};

describe("coverage floor", () => {
  test("below fails and names the number", () => {
    const r = checkFloor(floorFile(at(90)), { ...at(95), lines: 80 });
    expect(r).toEqual({ ok: false, messages: ["COVERAGE FLOOR: lines 80% < 90%"] });
  });

  test("at the floor passes and leaves the file untouched", () => {
    const file = floorFile(at(90));
    const before = readFileSync(file, "utf8"), mtime = statSync(file).mtimeMs;
    expect(checkFloor(file, at(90)).ok).toBe(true);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  test("above passes and raises the file to the new numbers", () => {
    const file = floorFile(at(90));
    const r = checkFloor(file, { ...at(90), branches: 92.5 });
    expect(r.ok).toBe(true);
    expect(r.messages[0]).toMatch("raised branches 90% → 92.5%");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ ...at(90), branches: 92.5 });
  });

  test("a floor missing a key counts it from zero", () => {
    const file = floorFile({ lines: 90 });
    expect(checkFloor(file, at(90)).messages[0]).toMatch("statements 0% → 90%");
  });

  test("no floor file yet is created at the current numbers", () => {
    const file = floorFile();
    expect(checkFloor(file, at(70)).ok).toBe(true);
    expect(existsSync(file) && JSON.parse(readFileSync(file, "utf8"))).toEqual(at(70));
  });
});

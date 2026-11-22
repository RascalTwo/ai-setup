import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { add, diff, hydrate, META, readMeta, readRecords, snapshot, writeRecord } from "../src/record.mjs";
import { load, tmp } from "./helpers.mjs";

describe("diff", () => {
  test("credits a test only with the counters it moved, nothing it didn't call", () => {
    const { cov, lib } = load(tmp());
    const before = snapshot(cov);
    lib.pick(1);
    const [d] = Object.values(diff(before, cov));
    const fns = Object.keys(d.f).map((id) => cov[Object.keys(cov)[0]].fnMap[id].name);
    expect(fns).toEqual(["pick"]);
    expect(Object.values(d.b)).toEqual([[1, 0]]);
  });

  test("a file nothing moved in is left out, and a snapshot doesn't follow later increments", () => {
    const { cov, lib } = load(tmp());
    const before = snapshot(cov);
    expect(diff(before, cov)).toEqual({});
    lib.add(1, 2);
    expect(Object.keys(diff(before, cov))).toHaveLength(1);
    expect(diff(snapshot(cov), cov)).toEqual({});
  });

  test("a file first seen after the snapshot counts from zero", () => {
    const { cov } = load(tmp());
    expect(Object.values(diff({}, cov))[0].s).not.toEqual({});
    expect(snapshot()).toEqual({});
    expect(diff({})).toEqual({});
  });
});

describe("add", () => {
  test("sums counters, arms included", () => {
    const into = add({}, { a: { s: { 0: 1 }, f: { 0: 1 }, b: { 0: [1, 0] } } });
    add(into, { a: { s: { 0: 2, 1: 1 }, f: {}, b: { 0: [0, 3] } } });
    expect(into).toEqual({ a: { s: { 0: 3, 1: 1 }, f: { 0: 1 }, b: { 0: [1, 3] } } });
  });
});

describe("records", () => {
  test("a record keeps relative paths and the static map once; a rerun replaces it", () => {
    const cwd = tmp();
    const { cov, lib } = load(cwd);
    const before = snapshot(cov);
    lib.add(1, 1);
    writeRecord("out/coverage/unit", { runner: "vitest", name: "a > b" }, diff(before, cov), cov, cwd);
    writeRecord("out/coverage/unit", { runner: "vitest", name: "a > b" }, diff(before, cov), cov, cwd);
    const [r] = readRecords(join(cwd, "out/coverage/unit"));
    expect(r).toMatchObject({ runner: "vitest", name: "a > b", load: false });
    expect(Object.keys(r.files)).toEqual(["src/lib.js"]);
    expect(readdirSync(join(cwd, META))).toHaveLength(1);
    const meta = readMeta(cwd)[r.files["src/lib.js"].m];
    expect(meta.path).toBe("src/lib.js");
    expect(meta.s).toBeUndefined();
  });

  test("a static map without a hash is keyed by its statements; non-JSON files are ignored", () => {
    const cwd = tmp();
    const { cov } = load(cwd);
    const [path] = Object.keys(cov);
    delete cov[path].hash;
    writeRecord("in", { runner: "x", name: "t" }, diff({}, cov), cov, cwd);
    writeFileSync(join(cwd, META, "notes.txt"), "");
    writeFileSync(join(cwd, "in", "notes.txt"), "");
    expect(Object.keys(readMeta(cwd))).toHaveLength(1);
    expect(readRecords(join(cwd, "in"))).toHaveLength(1);
  });

  test("no meta folder reads as no maps", () => {
    expect(readMeta(tmp())).toEqual({});
    expect(existsSync(join(tmp(), META))).toBe(false);
  });
});

describe("hydrate", () => {
  test("fills every counter, missing ones at zero", () => {
    const { cov } = load(tmp());
    const fc = Object.values(cov)[0];
    const h = hydrate(fc, { s: { 0: 4 }, f: {}, b: { 0: [0, 2] } });
    expect(h.s[0]).toBe(4);
    expect(Object.values(h.f).every((n) => n === 0)).toBe(true);
    expect(h.b[0]).toEqual([0, 2]);
    expect(Object.values(hydrate(fc).s).every((n) => n === 0)).toBe(true);
  });
});

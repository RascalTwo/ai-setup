// vitest setupFiles entry: each test's own Istanbul counters, diffed from globalThis.__coverage__ around
// it. Whatever runs outside a test (imports, hooks around the file) goes to one "(load) <file>" record,
// credited to no test. shortcut: assumes tests in a file run one at a time; test.concurrent would mix them.
import { relative } from "node:path";
import { afterAll, afterEach, beforeEach, expect } from "vitest";
import { add, diff, OUT, snapshot, writeRecord } from "./record.mjs";

const dir = `${OUT}/unit`;
const cov = () => globalThis.__coverage__ ?? {};
let mark = snapshot(cov());
const load = {};
const file = () => relative(process.cwd(), expect.getState().testPath ?? "unknown");

beforeEach(() => {
  add(load, diff(mark, cov()));
  mark = snapshot(cov());
});
afterEach(() => {
  writeRecord(dir, { runner: "vitest", name: `${file()} > ${expect.getState().currentTestName}` }, diff(mark, cov()), cov(), process.cwd());
  mark = snapshot(cov());
});
afterAll(() => {
  add(load, diff(mark, cov()));
  writeRecord(dir, { runner: "vitest", name: `(load) ${file()}`, load: true }, load, cov(), process.cwd());
});

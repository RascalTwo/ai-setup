// Real Istanbul counters for the tests: instrument a small script, run it, read globalThis.__coverage__.
import libInstrument from "istanbul-lib-instrument";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SOURCE = `globalThis.lib = { add, pick, unused };
function add(a, b) { return a + b; }
function pick(x) { return x > 0 ? "pos" : "neg"; }
function unused() { return 1; }
`;

/** Instruments SOURCE as `<cwd>/src/lib.js` into its own coverage global and runs it; returns { cov, lib }. */
export function load(cwd, path = join(cwd, "src/lib.js")) {
  const inst = libInstrument.createInstrumenter({ coverageVariable: "__coverage__", coverageGlobalScope: "globalThis", coverageGlobalScopeFunc: false });
  const code = inst.instrumentSync(SOURCE, path);
  globalThis.__coverage__ = {};
  new Function(code)();
  return { cov: globalThis.__coverage__, lib: globalThis.lib };
}

export const tmp = () => mkdtempSync(join(tmpdir(), "r2-test-kit-"));

import { mkdirSync, writeFileSync } from "node:fs";
import { diff, snapshot, writeRecord } from "../src/record.mjs";

/**
 * A fake app root with records in both default inputs: "(load) unit" (import time), "unit > add" calls
 * add(), "e2e > pos" calls pick(1). unused() is called by nothing. src/never.ts is loaded by no runner.
 */
export function app() {
  const cwd = tmp();
  mkdirSync(join(cwd, "src"), { recursive: true });
  writeFileSync(join(cwd, "src/lib.js"), SOURCE);
  writeFileSync(join(cwd, "src/never.ts"), "export const never = (n: number) => n;\n");
  writeFileSync(join(cwd, "src/lib.test.js"), "");
  const { cov, lib } = load(cwd);
  const rec = (dir, name, run, extra = {}) => {
    const before = snapshot(cov);
    run();
    writeRecord(dir, { runner: "x", name, ...extra }, extra.load ? diff({}, cov) : diff(before, cov), cov, cwd);
  };
  rec("out/coverage/unit", "(load) unit", () => {}, { load: true });
  rec("out/coverage/unit", "unit > add", () => lib.add(1, 2));
  rec("out/coverage/e2e", "e2e > pos", () => lib.pick(1));
  return cwd;
}

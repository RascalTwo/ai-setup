import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { main } from "../src/cli.mjs";
import { loadConfig } from "../src/config.mjs";
import { app, tmp } from "./helpers.mjs";

const run = async (args, cwd) => {
  const out = [];
  const code = await main(args, cwd, (l) => out.push(l));
  return { code, out };
};

describe("r2-test-kit", () => {
  test("merge exits 0 at the floor and 1 below it, one line each", async () => {
    const cwd = app();
    expect((await run(["merge"], cwd)).out.at(-1)).toMatch("COVERAGE FLOOR: created coverage-floor.json");
    expect(await run(["merge"], cwd)).toMatchObject({ code: 0, out: [expect.stringMatching("COVERAGE FLOOR: met")] });
    writeFileSync(join(cwd, "coverage-floor.json"), JSON.stringify({ branches: 100 }));
    expect(await run(["merge"], cwd)).toEqual({ code: 1, out: ["COVERAGE FLOOR: branches 50% < 100%"] });
  });

  test("a missing input exits 1 naming it, for merge and cov-map alike", async () => {
    const cwd = app();
    rmSync(join(cwd, "out/coverage/e2e"), { recursive: true });
    expect(await run(["merge"], cwd)).toEqual({ code: 1, out: ["coverage input missing: out/coverage/e2e"] });
    expect(await run(["cov-map", "--build"], cwd)).toEqual({ code: 1, out: ["coverage input missing: out/coverage/e2e"] });
  });

  test("cov-map builds, then answers --test and --line", async () => {
    const cwd = app();
    expect((await run(["cov-map", "--build"], cwd)).code).toBe(0);
    expect(JSON.parse(readFileSync(join(cwd, "out/pertest/map.json"), "utf8")).byTest["unit > add"]).toBeTruthy();
    expect((await run(["cov-map", "--test", "add"], cwd)).out).toEqual(["unit > add", "  src/lib.js: 2 2#add"]);
    expect((await run(["cov-map", "--line", "src/lib.js:2"], cwd)).out[0]).toBe("src/lib.js:2 <- unit > add");
  });

  test("anything else prints usage and exits 2; other errors are not swallowed", async () => {
    for (const args of [[], ["cov-map"], ["cov-map", "--test"], ["cov-map", "--line", "nofile"]]) expect((await run(args, tmp())).code).toBe(2);
    await expect(run(["cov-map", "--test", "x"], tmp())).rejects.toThrow("ENOENT");
  });

  test("r2-test-kit.config.mjs overrides the defaults", async () => {
    const cwd = tmp();
    writeFileSync(join(cwd, "r2-test-kit.config.mjs"), 'export default { inputs: ["a"], include: () => true };');
    const c = await loadConfig(cwd);
    expect(c.inputs).toEqual(["a"]);
    expect(c.floorFile).toBe("coverage-floor.json");
    expect(c.include("anything")).toBe(true);
    expect((await loadConfig(tmp())).include("src/App.tsx")).toBe(true);
  });
});

describe("default include", async () => {
  const { defaultInclude } = await import("../src/config.mjs");
  test.each([
    ["src/App.tsx", true],
    ["src/deep/x.ts", true],
    ["src/App.test.tsx", false],
    ["src/main.tsx", false],
    ["src/checkout/main.tsx", false],
    ["src/types.d.ts", false],
    ["journeys/a.ts", false],
    ["src/style.css", false],
  ])("%s → %s", (p, want) => expect(defaultInclude(p)).toBe(want));
});

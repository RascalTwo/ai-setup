// tests/verify-state.test.ts — a viz's own .verify/ folder (lib/verify/state.ts).

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { floorFile, verifyDir } from "../lib/verify/state.ts";

/** A throwaway git repo holding one viz folder. */
const repoWithViz = () => {
  const repo = mkdtempSync(path.join(tmpdir(), "verify-state-"));
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo });
  const viz = path.join(repo, "viz-pages", "demo");
  mkdirSync(path.join(viz, "tests"), { recursive: true });
  return { repo, viz };
};
const ignored = (repo: string, file: string) =>
  Bun.spawnSync(["git", "check-ignore", "-q", file], { cwd: repo }).exitCode === 0;

describe("verifyDir", () => {
  test("Given a viz in a git repo, when its .verify/ is made, then git ignores all of it but the floor and the .gitignore", () => {
    const { repo, viz } = repoWithViz();
    const dir = verifyDir(viz);
    for (const f of ["latest.png", "console.txt", "floor.json"])
      writeFileSync(path.join(dir, f), "x");
    const rel = (f: string) => path.relative(repo, path.join(dir, f));
    expect(ignored(repo, rel("latest.png"))).toBe(true);
    expect(ignored(repo, rel("console.txt"))).toBe(true);
    // falsifier: a blanket `*` alone would ignore these too
    expect(ignored(repo, rel("floor.json"))).toBe(false);
    expect(ignored(repo, rel(".gitignore"))).toBe(false);
  });
});

describe("floorFile", () => {
  test("Given a floor at the old tests/coverage-floor.json, when asked, then it is moved to .verify/floor.json with its contents", () => {
    const { viz } = repoWithViz();
    const old = path.join(viz, "tests", "coverage-floor.json");
    writeFileSync(old, '{"lines":97}');
    const fp = floorFile(viz);
    expect(fp).toBe(path.join(viz, ".verify", "floor.json"));
    expect(readFileSync(fp, "utf8")).toBe('{"lines":97}');
    expect(existsSync(old)).toBe(false);
  });

  test("Given both an old and a new floor, when asked, then the new one wins and the old is left alone", () => {
    const { viz } = repoWithViz();
    writeFileSync(path.join(viz, "tests", "coverage-floor.json"), '{"lines":50}');
    mkdirSync(path.join(viz, ".verify"));
    writeFileSync(path.join(viz, ".verify", "floor.json"), '{"lines":99}');
    expect(readFileSync(floorFile(viz), "utf8")).toBe('{"lines":99}');
    expect(existsSync(path.join(viz, "tests", "coverage-floor.json"))).toBe(true);
  });
});

// pr-split's split.ts and the size line it feeds r2-pr (pr-viz's classify.ts), run as CLIs against a throwaway git repo.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SKILLS = path.join(import.meta.dir, "..", "skills");
let repo = "";
const sh = (args: string[], cwd = repo) => {
  const p = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const git = (...a: string[]) => sh(["git", "-c", "commit.gpgsign=false", "-c", "user.name=t", "-c", "user.email=t@t", ...a]).out.trim();
const write = (f: string, s: string) => { mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); writeFileSync(path.join(repo, f), s); };
const cut = (pieces: object[]) => {
  writeFileSync(path.join(repo, "..", "cut.json"), JSON.stringify({ repo, base: "main", head: "feature", pieces }));
  return sh(["bun", path.join(SKILLS, "pr-split/scripts/split.ts"), "cut", path.join(repo, "..", "cut.json")]);
};
const lines = (n: number, tag = "") => Array.from({ length: n }, (_, i) => `line ${i + 1}${tag}`).join("\n") + "\n";

beforeEach(() => {
  // GIVEN main with a 40-line app.py
  repo = path.join(mkdtempSync(path.join(os.tmpdir(), "pr-split-test-")), "repo");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  write("src/app.py", lines(40));
  git("add", "."); git("commit", "-qm", "base");
  // GIVEN a feature branch that edits app.py in two far-apart places, adds a module and its test, and a lockfile
  git("checkout", "-qb", "feature");
  write("src/app.py", lines(40).replace("line 2\n", "line 2 changed\n").replace("line 35\n", "line 35 changed\n"));
  write("src/links.py", "def inline_link_urls():\n    return 1\n");
  write("tests/test_links.py", "def test_it():\n    assert True\n");
  write("uv.lock", "pinned\n");
  git("add", "."); git("commit", "-qm", "feature");
});
afterEach(() => rmSync(path.dirname(repo), { recursive: true, force: true }));

test("pieces cut by file and by hunk become local branches that sum back to the head", () => {
  // WHEN the change is cut into a refactor piece and a stacked feature piece
  const r = cut([
    { branch: "p-refactor", title: "Rename line 2", hunks: ["src/app.py#1"] },
    { branch: "p-links", title: "Add links", after: "p-refactor", files: ["src/links.py", "tests/", "uv.lock"], hunks: ["src/app.py#2"] },
  ]);
  // THEN it reports the sum-back passed
  expect(r.err).toBe("");
  expect(r.out).toContain("✓ the 2 pieces sum back to feature exactly");
  // THEN the first piece holds only its hunk
  expect(git("diff", "--name-only", "main", "p-refactor")).toBe("src/app.py");
  expect(git("diff", "main", "p-refactor")).not.toContain("line 35 changed");
  // THEN the stacked piece's tip is the head's tree
  expect(git("rev-parse", "p-links^{tree}")).toBe(git("rev-parse", "feature^{tree}"));
  // THEN the user's checkout is untouched
  expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("feature");
  expect(git("worktree", "list").split("\n")).toHaveLength(1);
});

test("independent pieces each branch off the base", () => {
  // WHEN two pieces share no dependency
  const r = cut([
    { branch: "p-a", title: "a", hunks: ["src/app.py#1"], files: ["uv.lock"] },
    { branch: "p-b", title: "b", hunks: ["src/app.py#2"], files: ["src/links.py", "tests/"] },
  ]);
  // THEN both sit one commit on main, and together they rebuild the head
  expect(r.code).toBe(0);
  expect(git("rev-parse", "p-a~1")).toBe(git("rev-parse", "main"));
  expect(git("rev-parse", "p-b~1")).toBe(git("rev-parse", "main"));
  expect(git("diff", "main", "p-b")).toContain("line 35 changed");
  expect(git("diff", "main", "p-b")).not.toContain("line 2 changed");
});

test("a hunk in no piece, or in two, stops the cut before any branch exists", () => {
  // WHEN uv.lock is left out and app.py's first hunk is claimed twice
  const r = cut([
    { branch: "p-a", title: "a", hunks: ["src/app.py#1"] },
    { branch: "p-b", title: "b", files: ["src/", "tests/"] },
  ]);
  // THEN it names both problems and creates nothing
  expect(r.code).toBe(1);
  expect(r.err).toContain("src/app.py#1 is in both p-a and p-b");
  expect(r.err).toContain("uv.lock#1 is in no piece");
  expect(git("branch", "--list", "p-*")).toBe("");
});

test("the size line counts code and tests and leaves the lockfile's lines out", () => {
  // WHEN the size line is asked for the feature branch
  const r = sh(["bun", path.join(SKILLS, "pr-viz/scripts/classify.ts"), repo, "main...feature"]);
  // THEN 4 files; app.py 4 lines + links.py 2 = 6 code, 2 tests; uv.lock is a file but no lines
  expect(r.out.trim()).toBe("Size: 4 files, 8 lines to read (6 code, 2 tests)");
});

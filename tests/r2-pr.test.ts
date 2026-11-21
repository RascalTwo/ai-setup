// r2-pr's demo pictures: demo.ts finds a branch's live demo and prints its table; body.ts finalize swaps the pictures for URLs.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPTS = path.join(import.meta.dir, "..", "skills/r2-pr/scripts");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10" width="20" height="10"><rect width="20" height="10" fill="#e34948"/></svg>';
let tmp = "", repo = "", viz = "";
const sh = (args: string[], cwd = repo, env: Record<string, string> = {}) => {
  const p = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
};
const git = (...a: string[]) => sh(["git", "-c", "commit.gpgsign=false", "-c", "user.name=t", "-c", "user.email=t@t", ...a]).out.trim();
const commit = (f: string) => { writeFileSync(path.join(repo, f), f); git("add", "."); git("commit", "-qm", f); return git("rev-parse", "--short", "HEAD"); };
const demo = (name: string, walk: object, mtime = Date.now() / 1000) => {
  const dir = path.join(viz, name);
  mkdirSync(path.join(dir, "story"), { recursive: true });
  writeFileSync(path.join(dir, "story/b.png"), PNG);
  writeFileSync(path.join(dir, "story/a.svg"), SVG);
  writeFileSync(path.join(dir, "walk.json"), JSON.stringify(walk));
  sh(["touch", "-t", new Date(mtime * 1000).toISOString().replace(/\D/g, "").slice(0, 12), path.join(dir, "walk.json")]);
};
const walk = (commit: string, extra: object = {}) => ({
  mode: "live",
  change: { repo: "acme/shop", commit, subject: "Branch agent/fix" },
  personas: [{ id: "P1", who: "A shopper | signed in" }],
  changes: [{ id: "C1", persona: "P1", title: "A failed save says so", problem: "p", before: { line: 'Said "Saved" anyway', pic: "story/b.png" }, after: { line: "Says it failed", pic: "story/a.svg" }, why: "w" }],
  ...extra,
});
const find = (branch = "agent/fix") =>
  sh(["bun", path.join(SCRIPTS, "demo.ts"), "acme/shop", repo, "main", "HEAD", branch, "--out", path.join(tmp, "pics")], tmp, { R2PR_VIZ_ROOT: viz });

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "r2-pr-test-"));
  repo = path.join(tmp, "repo");
  viz = path.join(tmp, "viz");
  mkdirSync(repo); mkdirSync(viz);
  // GIVEN main with one commit and a branch with one more
  git("init", "-q", "-b", "main");
  commit("base.txt");
  git("checkout", "-qb", "agent/fix");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

test("a live demo whose commit is on the branch becomes a before/after table with PNG pictures", () => {
  // GIVEN a demo made at the branch's commit
  demo("demo-a", walk(commit("fix.txt")));
  // WHEN r2-pr looks for the branch's demo
  const r = find();
  // THEN the section carries one row: title and persona, both captions, both pictures as PNG
  expect(r.code).toBe(0);
  expect(r.out).toContain("<!-- r2-pr:demo -->");
  expect(r.out).toContain("| **A failed save says so**<br>for A shopper &#124; signed in |");
  expect(r.out).toContain("Said &quot;Saved&quot; anyway");
  expect(r.out.match(/src="r2-pr:pic:[^"]+\.png"/g)).toHaveLength(2);
  expect(existsSync(path.join(tmp, "pics/C1-after.png"))).toBe(true);
  expect(readFileSync(path.join(tmp, "pics/C1-after.png")).subarray(1, 4).toString()).toBe("PNG"); // the SVG became a real PNG
  expect(r.err).toContain("demo demo-a: commit");
});

test("no demo for the branch gives empty output and exit 0", () => {
  // GIVEN demos for another repo, a promised demo, and one whose commit is not on this branch
  commit("fix.txt");
  demo("other-repo", { ...walk(git("rev-parse", "--short", "HEAD")), change: { repo: "acme/other", commit: git("rev-parse", "--short", "HEAD"), subject: "x" } });
  demo("promised", { ...walk("promised"), mode: "promised" });
  demo("elsewhere", walk("deadbee", { change: { repo: "acme/shop", commit: "deadbee", subject: "Branch somewhere/else" } }));
  // WHEN r2-pr looks
  const r = find();
  // THEN nothing is printed and nothing fails
  expect(r.code).toBe(0);
  expect(r.out).toBe("");
});

test("a rebuilt branch still finds its demo: same tree, new commit ids", () => {
  // GIVEN a demo made at one commit, then the branch squashed into a different commit with the same tree
  demo("demo-a", walk(commit("fix.txt")));
  git("reset", "-q", "--soft", "main"); git("commit", "-qm", "squashed");
  // WHEN r2-pr looks
  const r = find("agent/renamed");
  // THEN the demo is found by its tree
  expect(r.out).toContain("<!-- r2-pr:demo -->");
  expect(r.err).toContain("branch's tree");
});

test("a demo of uncommitted work is found by its subject naming the branch, and the newest demo wins", () => {
  // GIVEN two demos naming the branch, the second newer
  commit("fix.txt");
  demo("old", walk("uncommitted", { changes: walk("x").changes.map((c) => ({ ...c, title: "Old title" })) }), 1_700_000_000);
  demo("new", walk("uncommitted", { changes: walk("x").changes.map((c) => ({ ...c, title: "New title" })) }), 1_800_000_000);
  // WHEN r2-pr looks
  const r = find();
  // THEN the newer one is used
  expect(r.out).toContain("New title");
  expect(r.out).not.toContain("Old title");
});

test("finalize swaps each picture for its uploaded URL, and fails loudly on a missing one", () => {
  // GIVEN a draft holding the demo section
  demo("demo-a", walk(commit("fix.txt")));
  const section = find().out;
  writeFileSync(path.join(tmp, "pr.md"), `# draft\n\n${section}`);
  const paths = [...section.matchAll(/r2-pr:pic:([^"]+)/g)].map((m) => m[1]);
  // WHEN finalized without the URLs
  const bad = sh(["bun", path.join(SCRIPTS, "body.ts"), "finalize", path.join(tmp, "pr.md")]);
  // THEN it names the picture it has no URL for
  expect(bad.code).not.toBe(0);
  expect(bad.err).toContain("no URL for");
  // WHEN finalized with a path-to-URL map
  writeFileSync(path.join(tmp, "pics.json"), JSON.stringify(Object.fromEntries(paths.map((p, i) => [p, `https://github.com/user-attachments/assets/u${i}`]))));
  const ok = sh(["bun", path.join(SCRIPTS, "body.ts"), "finalize", path.join(tmp, "pr.md"), `pics=${path.join(tmp, "pics.json")}`]);
  // THEN both pictures carry their URL and no marker is left
  expect(ok.out).toContain('src="https://github.com/user-attachments/assets/u0"');
  expect(ok.out).toContain('src="https://github.com/user-attachments/assets/u1"');
  expect(ok.out).not.toContain("r2-pr:pic:");
});

test("finalize needs a video URL only when the draft has a video line", () => {
  // GIVEN a draft for a PR only its author reads: an image, no video line
  writeFileSync(path.join(tmp, "pr.md"), "# draft\n\nr2-pr:image ~/pr-1.poster.png\n");
  const finalize = (file: string, ...urls: string[]) => sh(["bun", path.join(SCRIPTS, "body.ts"), "finalize", path.join(tmp, file), ...urls]);
  // WHEN finalized with the image URL alone
  const ok = finalize("pr.md", "image=https://github.com/user-attachments/assets/i");
  // THEN the image is embedded and nothing asks for a video
  expect(ok.code).toBe(0);
  expect(ok.out).toContain('<img width="1400" alt="Image walkthrough" src="https://github.com/user-attachments/assets/i" />');
  // GIVEN a draft that does carry a video line, WHEN finalized without its URL, THEN it fails and says so
  writeFileSync(path.join(tmp, "vid.md"), "r2-pr:video ~/pr-1.mp4\nr2-pr:image ~/pr-1.poster.png\n");
  const bad = finalize("vid.md", "image=https://github.com/user-attachments/assets/i");
  expect(bad.code).not.toBe(0);
  expect(bad.err).toContain("no video=<url> given");
});

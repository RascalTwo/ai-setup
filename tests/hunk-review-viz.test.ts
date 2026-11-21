// review.test.ts — the promises hunk-review-viz makes, checked against a real git repo:
// marks follow unchanged content through a rewrite, changed content comes back for review,
// flags come back "addressed", and IDs stay put.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CommitView, FileView, ReviewConfig } from "../skills/hunk-review-viz/template/contract.ts";
import { buildReview, fileAt, parseDiff, readState, setMark, setReply, similarity } from "../skills/hunk-review-viz/lib/review.ts";
import { normalizeId, words } from "../skills/hunk-review-viz/lib/words.ts";
import { countLines, share, size, sum } from "../skills/hunk-review-viz/template/stats.ts";
import { interdiff, newSide } from "../skills/hunk-review-viz/template/interdiff.ts";

let root = "";
let repo = "";
let dir = "";

const sh = (...args: string[]) => {
  const p = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};
const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag} line ${i + 1}`).join("\n") + "\n";
const write = (path: string, text: string) => writeFileSync(join(repo, path), text);
const commit = (msg: string) => {
  sh("add", "-A");
  sh("commit", "-q", "-m", msg);
};
const file = (commits: CommitView[], path: string): FileView => {
  const f = commits.flatMap((c) => c.files).find((x) => x.path === path);
  if (!f) throw new Error(`no ${path}`);
  return f;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "hunk-review-"));
  repo = join(root, "repo");
  dir = join(root, "page");
  Bun.spawnSync(["mkdir", "-p", repo, dir]);
  sh("init", "-q", "-b", "main");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  write("app.ts", lines(40, "app"));
  write("notes.md", "notes\n");
  commit("base");
  sh("checkout", "-q", "-b", "feature");
  // Two hunks far apart in app.ts, so git keeps them separate.
  const app = lines(40, "app").split("\n");
  app[2] = "app line 3 CHANGED TOP";
  app[35] = "app line 36 CHANGED BOTTOM";
  write("app.ts", app.join("\n"));
  commit("Change app");
  write("notes.md", "notes\nmore notes\n");
  write("dir with space.md", "spaced\n");
  commit("Add notes");
  const cfg: ReviewConfig = { name: "test", skillDir: join(import.meta.dir, "..", "skills", "hunk-review-viz"), repos: [{ name: "repo", path: repo, range: "main...feature" }] };
  writeFileSync(join(dir, "review.json"), JSON.stringify(cfg));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("parseDiff", () => {
  it("reads a path with a space, without the tab git appends", () => {
    const view = buildReview(dir);
    expect(view.commits.flatMap((c) => c.files.map((f) => f.path))).toContain("dir with space.md");
  });
  it("reads a rename and a binary file", () => {
    const files = parseDiff(
      [
        "diff --git a/old.ts b/new.ts",
        "similarity index 90%",
        "rename from old.ts",
        "rename to new.ts",
        "diff --git a/pic.png b/pic.png",
        "Binary files a/pic.png and b/pic.png differ",
      ].join("\n"),
    );
    expect(files[0]).toMatchObject({ path: "new.ts", oldPath: "old.ts" });
    expect(files[1]).toMatchObject({ path: "pic.png", binary: true });
  });
});

describe("a review across a rewrite", () => {
  it("keeps an approval on unchanged content, brings back an edited flag as addressed, and keeps the ID", () => {
    const before = buildReview(dir);
    expect(before.commits.map((c) => c.subject)).toEqual(["Change app", "Add notes"]);
    const app = file(before.commits, "app.ts");
    expect(app.hunks).toHaveLength(2);
    const [top, bottom] = app.hunks;
    if (!top || !bottom) throw new Error("hunks");
    setMark(dir, { fp: top.fp, kind: "hunk", mark: "ok" });
    setMark(dir, { fp: bottom.fp, kind: "hunk", mark: "change", note: "rename it" });
    const notes = file(before.commits, "notes.md");
    setMark(dir, { fp: notes.fp, kind: "file", mark: "question", note: "why?" });

    // Rewrite: swap the commits' order and edit the flagged bottom hunk; the top one stays the same.
    sh("checkout", "-q", "main");
    sh("checkout", "-q", "-B", "feature");
    write("notes.md", "notes\nmore notes\n");
    write("dir with space.md", "spaced\n");
    commit("Add notes");
    const appLines = lines(40, "app").split("\n");
    appLines[2] = "app line 3 CHANGED TOP";
    appLines[35] = "app line 36 RENAMED BOTTOM";
    write("app.ts", appLines.join("\n"));
    commit("Change app");

    const after = buildReview(dir);
    expect(after.commits.map((c) => c.subject)).toEqual(["Add notes", "Change app"]);
    const [top2, bottom2] = file(after.commits, "app.ts").hunks;
    expect(top2).toMatchObject({ fp: top.fp, id: top.id, status: "ok" });
    expect(bottom2?.status).toBe("addressed");
    expect(bottom2?.note).toBe("rename it");
    expect(bottom2?.was?.fp).toBe(bottom.fp);
    expect(bottom2?.was?.lines.join("\n")).toContain("CHANGED BOTTOM");
    expect(file(after.commits, "notes.md").status).toBe("question");
    expect(after.orphans).toEqual([]);
  });

  it("shows a reply on the hunk it answers, and a replied question as answered", () => {
    const view = buildReview(dir);
    const notes = file(view.commits, "notes.md");
    setReply(dir, notes.fp, "because the docs said so");
    const bottom = file(view.commits, "app.ts").hunks[1];
    if (!bottom?.was) throw new Error("bottom not addressed");
    setReply(dir, bottom.was.fp, "renamed", 36);
    const again = buildReview(dir);
    expect(file(again.commits, "notes.md")).toMatchObject({ status: "answered", reply: "because the docs said so" });
    expect(file(again.commits, "app.ts").hunks[1]).toMatchObject({ status: "addressed", reply: "renamed", replyLine: 36 });
  });

  it("retires the old mark when the reviewer acts on an addressed hunk", () => {
    const view = buildReview(dir);
    const bottom = file(view.commits, "app.ts").hunks[1];
    if (!bottom?.was) throw new Error("bottom not addressed");
    setMark(dir, { fp: bottom.fp, kind: "hunk", mark: "ok", replaces: bottom.was.fp });
    expect(readState(dir).marks[bottom.was.fp]).toBeUndefined();
    expect(file(buildReview(dir).commits, "app.ts").hunks[1]?.status).toBe("ok");
  });

  it("follows order.json by subject and puts files the agent lists first", () => {
    writeFileSync(
      join(dir, "order.json"),
      JSON.stringify({ commits: [{ match: "Change app", why: "read the code first" }, { match: "Add notes", files: [{ path: "dir with space.md", why: "the new file" }] }] }),
    );
    const view = buildReview(dir);
    expect(view.commits.map((c) => [c.subject, c.why])).toEqual([
      ["Change app", "read the code first"],
      ["Add notes", undefined],
    ]);
    expect(view.commits[1]?.files.map((f) => f.path)).toEqual(["dir with space.md", "notes.md"]);
    expect(view.commits[1]?.files[0]?.why).toBe("the new file");
    rmSync(join(dir, "order.json"));
  });

  it("reports a bad range as an error on that repo instead of failing the review", () => {
    const cfgPath = join(dir, "review.json");
    const good = Bun.file(cfgPath);
    const saved = require("node:fs").readFileSync(cfgPath, "utf8") as string;
    writeFileSync(cfgPath, JSON.stringify({ ...JSON.parse(saved), repos: [{ name: "repo", path: repo, range: "main...nope" }] }));
    const view = buildReview(dir);
    expect(view.repos[0]?.error).toContain("nope");
    expect(view.commits).toEqual([]);
    writeFileSync(cfgPath, saved);
    expect(good.size).toBeGreaterThan(0);
  });
  it("reports a mark as gone, not carried, when nothing left in its file shares a changed line", () => {
    const view = buildReview(dir);
    const top = file(view.commits, "app.ts").hunks[0];
    if (!top) throw new Error("top");
    setMark(dir, { fp: top.fp, kind: "hunk", mark: "change", note: "drop this" });
    // Rewrite: the top change is removed outright; only the bottom change remains in app.ts.
    sh("checkout", "-q", "main");
    sh("checkout", "-q", "-B", "feature");
    const appLines = lines(40, "app").split("\n");
    appLines[19] = "app line 20 NEW UNRELATED MIDDLE";
    appLines[35] = "app line 36 RENAMED BOTTOM";
    write("app.ts", appLines.join("\n"));
    write("notes.md", "notes\nmore notes\n");
    write("dir with space.md", "spaced\n");
    commit("Change app");
    const after = buildReview(dir);
    // The unrelated middle change shares no line with the flagged one, so it stays unreviewed.
    expect(file(after.commits, "app.ts").hunks.map((h) => h.status)).toEqual(["unreviewed", "ok"]);
    expect(after.orphans).toEqual([{ id: top.id, repo: "repo", path: "app.ts", mark: "change", note: "drop this" }]);
  });
});

describe("fileAt", () => {
  it("returns a file's lines at a commit, and null for a missing path or a non-SHA", () => {
    const head = sh("rev-parse", "HEAD");
    const lines = fileAt(dir, "repo", head, "app.ts");
    expect(lines?.length).toBe(40);
    expect(lines?.[0]).toBe("app line 1");
    expect(fileAt(dir, "repo", head, "nope.ts")).toBeNull();
    expect(fileAt(dir, "repo", "HEAD; rm -rf /", "app.ts")).toBeNull();
    expect(fileAt(dir, "other", head, "app.ts")).toBeNull();
  });
});

describe("words", () => {
  it("is stable for a fingerprint and speakable", () => {
    const fp = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    expect(words(fp)).toBe(words(fp));
    expect(words(fp)).toMatch(/^[a-z]+ [a-z]+$/);
    expect(words(fp, true)).toMatch(/^[a-z]+ [a-z]+ [a-z]+$/);
    expect(normalizeId("Amber-Falcon!")).toBe("amber falcon");
  });
});

describe("line counts", () => {
  it("counts a removed-then-added run as changed lines, and the rest as added or removed", () => {
    // 2 removed then 3 added: 2 changed, 1 added. Then context, 1 removed alone, 1 added alone.
    expect(countLines(["-a", "-b", "+A", "+B", "+C", " ctx", "-gone", " ctx", "+new", "\\ No newline at end of file"])).toEqual({ add: 2, chg: 2, del: 1 });
    // An addition followed by a removal is not a change: the removal starts its own run.
    expect(countLines(["+x", "-y"])).toEqual({ add: 1, chg: 0, del: 1 });
  });
  it("rolls up and shares", () => {
    const t = sum([{ add: 1, chg: 2, del: 3 }, { add: 4, chg: 0, del: 1 }]);
    expect(t).toEqual({ add: 5, chg: 2, del: 4 });
    expect(size(t)).toBe(11);
    expect(share(1, 400)).toBe("<1%");
    expect(share(37, 100)).toBe("37%");
  });
});

describe("since you last saw it", () => {
  it("shows only what changed between the code the reviewer saw and the code now, folding the rest", () => {
    const before = ["+// a comment", "+const a = 1;", ...Array.from({ length: 10 }, (_, i) => `+line ${i}`), "+const server = setup(a);"];
    const after = ["+const a = 1;", ...Array.from({ length: 10 }, (_, i) => `+line ${i}`), "+const auth = [a];", "+const servers = setup(...auth);"];
    expect(interdiff(newSide(before), newSide(after))).toEqual([
      "-// a comment",
      " const a = 1;",
      " line 0",
      " line 1",
      "~⋯ 5 unchanged lines",
      " line 7",
      " line 8",
      " line 9",
      "-const server = setup(a);",
      "+const auth = [a];",
      "+const servers = setup(...auth);",
    ]);
  });
  it("reads a hunk's new side: context and additions, not removals", () => {
    expect(newSide([" keep", "-old", "+new", "\\ No newline at end of file"])).toEqual(["keep", "new"]);
  });
});

describe("similarity", () => {
  it("scores shared changed lines, ignoring context", () => {
    expect(similarity(["+a", "-b", " c"], ["+a", "-b", " z"])).toBe(1);
    expect(similarity(["+a", "-b"], ["+a", "-x"])).toBeCloseTo(1 / 3);
  });
});

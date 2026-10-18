#!/usr/bin/env bun
// shape.ts — the mechanical half of pr-shape. The judgement (which hunks make a piece) is the agent's.
//
//   bun shape.ts hunks   <repo> <base> <head> → every changed file and hunk, with ids, kinds and sizes
//   bun shape.ts cut     <cut.json>           → one local branch per piece, after the sum-back check passes
//   bun shape.ts commits <cut.json>           → one branch, "<head>-shaped", with one commit per piece in the order given
//
// cut.json:
//   { "repo": "/path", "base": "main", "head": "my-branch",
//     "pieces": [ { "branch": "link-urls-confluence", "title": "Keep link URLs in Confluence pages",
//                   "after": "link-urls-helpers",          // optional: stack on that piece's branch
//                   "files": ["modules/confluence/"],       // whole files, by path prefix
//                   "hunks": ["src/app.py#2"] } ] }         // or single hunks, by id (path#n, 1-based)
//
// For `commits`, a piece is a commit: `branch` and `after` are not used, each piece stacks on the one
// before it, and an optional "body" joins the title as the commit message.
//
// Every hunk lands in exactly one piece. Pieces are built as detached commits in throwaway
// worktrees; branches are created only once the pieces, applied in order onto the base, rebuild
// the head's tree exactly. Nothing is pushed, and the user's checkout is never touched.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { kindOf } from "../../pr-viz/scripts/classify.ts";

type Piece = { branch: string; title: string; body?: string; after?: string; files?: string[]; hunks?: string[] };
type FileDiff = { path: string; head: string; hunks: string[] };

function git(repo: string, args: string[], input?: string) {
  const p = Bun.spawnSync(["git", "-C", repo, ...args], { stdin: input ? Buffer.from(input) : undefined, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
}

/** The diff from the merge base, cut into files, each into its header and hunks (raw patch text). */
function parse(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  for (const chunk of text.split(/^(?=diff --git )/m).filter((c) => c.startsWith("diff --git "))) {
    const [head, ...hunks] = chunk.split(/^(?=@@ )/m);
    const name = /^\+\+\+ b\/(.+)$/m.exec(head)?.[1] ?? /^diff --git a\/.+ b\/(.+)$/m.exec(head)?.[1];
    if (!name) throw new Error(`can't read the path in: ${head.split("\n")[0]}`);
    files.push({ path: name, head, hunks });
  }
  return files;
}

// quotePath off: a non-ASCII path stays readable instead of "\303\251"-quoted.
const diffOf = (repo: string, from: string, to: string) => git(repo, ["-c", "core.quotePath=false", "diff", "--binary", "--no-color", "-U3", from, to]);

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "hunks") {
  const [repo, base, head] = args;
  const files = parse(diffOf(repo, git(repo, ["merge-base", base, head]).trim(), head));
  for (const f of files) {
    const lines = (h: string, c: string) => h.split("\n").slice(1).filter((l) => l.startsWith(c)).length; // after the @@ line
    console.log(`${kindOf(f.path, /^(Binary files|GIT binary patch)/m.test(f.head)).padEnd(6)} ${f.path}`);
    f.hunks.forEach((h, i) => console.log(`         ${f.path}#${i + 1}  +${lines(h, "+")} -${lines(h, "-")}  ${h.split("\n")[0].replace(/^@@.*?@@ ?/, "")}`));
  }
} else if (cmd === "cut" || cmd === "commits") {
  const plan = JSON.parse(readFileSync(args[0], "utf8")) as { repo: string; base: string; head: string; pieces: Piece[] };
  const { repo } = plan;
  const linear = cmd === "commits";
  const shaped = `${plan.head}-shaped`;
  // A commit stacks on the one before it; its name only labels it in messages.
  const pieces: Piece[] = linear
    ? plan.pieces.map((p, i) => ({ ...p, branch: `commit ${i + 1}`, after: i ? `commit ${i}` : undefined }))
    : plan.pieces;
  const start = git(repo, ["merge-base", plan.base, plan.head]).trim();
  const files = parse(diffOf(repo, start, plan.head));

  // Every hunk (a hunkless file — binary, rename, mode change — counts as one) in exactly one piece.
  const owner = new Map<string, string>();
  const problems: string[] = [];
  const ids = (f: FileDiff) => (f.hunks.length ? f.hunks.map((_, i) => `${f.path}#${i + 1}`) : [`${f.path}#0`]);
  const names = pieces.map((p) => p.branch);
  for (const b of new Set(names.filter((b, i) => names.indexOf(b) !== i))) problems.push(`two pieces are called ${b}`);
  for (const p of pieces) {
    const claim = (id: string) => {
      if (owner.has(id)) problems.push(`${id} is in both ${owner.get(id)} and ${p.branch}`);
      else owner.set(id, p.branch);
    };
    for (const pre of p.files ?? []) {
      const hit = files.filter((f) => f.path.startsWith(pre));
      if (!hit.length) problems.push(`${p.branch}: no changed file starts with "${pre}"`);
      for (const f of hit) ids(f).forEach(claim);
    }
    for (const id of p.hunks ?? []) {
      const [file, n] = [id.slice(0, id.lastIndexOf("#")), +id.slice(id.lastIndexOf("#") + 1)];
      if (!files.find((f) => f.path === file)?.hunks[n - 1]) problems.push(`${p.branch}: no hunk ${id}`);
      else claim(id);
    }
    if (p.after && !pieces.some((q) => q.branch === p.after)) problems.push(`${p.branch}: after "${p.after}", which is no piece`);
    if (![...owner.values()].includes(p.branch)) problems.push(`${p.branch} has no hunks`);
    if (!linear && git(repo, ["branch", "--list", p.branch]).trim()) problems.push(`branch ${p.branch} already exists`);
  }
  if (linear && git(repo, ["branch", "--list", shaped]).trim()) problems.push(`branch ${shaped} already exists`);
  for (const id of files.flatMap(ids)) if (!owner.has(id)) problems.push(`${id} is in no piece`);
  if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }

  // A piece's patch: each of its files' header plus the hunks it owns.
  const patchOf = (p: Piece) => files.map((f) => {
    if (!f.hunks.length) return owner.get(`${f.path}#0`) === p.branch ? f.head : "";
    const mine = f.hunks.filter((_, i) => owner.get(`${f.path}#${i + 1}`) === p.branch);
    return mine.length ? f.head + mine.join("") : "";
  }).join("");

  // Parents before children: a stacked piece is built on its parent's commit.
  const order: Piece[] = [];
  const visit = (p: Piece, seen: string[] = []) => {
    if (order.includes(p)) return;
    if (seen.includes(p.branch)) throw new Error(`pieces stack in a loop: ${[...seen, p.branch].join(" → ")}`);
    if (p.after) visit(pieces.find((q) => q.branch === p.after)!, [...seen, p.branch]);
    order.push(p);
  };
  pieces.forEach((p) => visit(p));

  const tmp = mkdtempSync(path.join(os.tmpdir(), "pr-shape-"));
  const sha = new Map<string, string>();
  let made = 0, mismatch = "";
  // Apply a patch on a fresh worktree at `from` and commit it; returns the commit.
  const commit = (from: string, patch: string, msg: string) => {
    const wt = path.join(tmp, `wt${++made}`);
    git(repo, ["worktree", "add", "--detach", "--quiet", wt, from]);
    try {
      if (patch) git(wt, ["apply", "--index", "--whitespace=nowarn", "-"], patch);
      git(wt, ["-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", msg]);
      return git(wt, ["rev-parse", "HEAD"]).trim();
    } finally { git(repo, ["worktree", "remove", "--force", wt]); }
  };
  try {
    for (const p of order) sha.set(p.branch, commit(p.after ? sha.get(p.after)! : start, patchOf(p), p.body ? `${p.title}\n\n${p.body}` : p.title));
    // Sum-back: every piece's own change, applied in order onto the base, must rebuild the head's tree.
    let at = start;
    for (const p of order) at = commit(at, diffOf(repo, p.after ? sha.get(p.after)! : start, sha.get(p.branch)!), `sum-back: ${p.branch}`);
    const want = git(repo, ["rev-parse", `${plan.head}^{tree}`]).trim(), got = git(repo, ["rev-parse", `${at}^{tree}`]).trim();
    if (want !== got) mismatch = git(repo, ["diff", "--stat", at, plan.head]);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  if (mismatch) { console.error(`✗ the pieces don't sum back to ${plan.head}; no branch was created. What differs:\n${mismatch}`); process.exit(1); }

  if (linear) {
    const tip = sha.get(order.at(-1)!.branch)!;
    git(repo, ["branch", shaped, tip]);
    console.log(`✓ the ${order.length} commits sum back to ${plan.head} exactly, on ${shaped}`);
    for (const p of order) console.log(`  ${git(repo, ["rev-parse", "--short", sha.get(p.branch)!]).trim()} ${p.title}: ${git(repo, ["diff", "--shortstat", `${sha.get(p.branch)!}^`, sha.get(p.branch)!]).trim()}`);
    process.exit(0);
  }

  for (const p of order) git(repo, ["branch", p.branch, sha.get(p.branch)!]);
  console.log(`✓ the ${order.length} pieces sum back to ${plan.head} exactly`);
  for (const p of order) {
    const size = git(repo, ["diff", "--shortstat", p.after ?? start, p.branch]).trim();
    console.log(`  ${p.branch}${p.after ? ` (on ${p.after})` : ""}: ${size}`);
  }
} else {
  console.error("usage: shape.ts hunks <repo> <base> <head> | cut <cut.json> | commits <cut.json>");
  process.exit(1);
}

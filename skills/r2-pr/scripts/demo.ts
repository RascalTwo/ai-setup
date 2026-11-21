#!/usr/bin/env bun
// demo.ts — the demo-viz pictures for a PR: finds the branch's live demo and prints its `r2-pr:demo` section.
//
//   bun demo.ts <owner/repo> <checkout> <base> <head> <branch> --out <dir>   → the section on stdout
//
// Empty stdout, exit 0: the branch has no demo (the section is then left out). Which demo and why goes to stderr.
// Pictures land in <dir> as PNG (SVGs converted: GitHub does not render SVG attachments); the table names each
// as `r2-pr:pic:<path>`, which body.ts finalize swaps for the uploaded URL. Demos live in the viz library
// (~/.agents/state/viz/<name>/walk.json; R2PR_VIZ_ROOT overrides it).

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

type Pic = { line: string; pic: string };
type Change = { title: string; persona: string; before: Pic; after: Pic };
type Walk = { mode?: string; change?: { repo?: string; commit?: string; subject?: string }; personas?: { id: string; who: string }[]; changes?: Change[] };

function git(checkout: string, ...args: string[]) {
  const p = Bun.spawnSync(["git", "-C", checkout, ...args], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : "";
}

const tokens = (s = "") => s.split("+").map((t) => t.replace(/\(.*?\)/g, "").trim().toLowerCase()).filter(Boolean);

// A demo is this branch's when it was made for this repo and one of its commits is on the branch, or the
// branch's tree equals the commit's tree (pr-shape rebuilds the commits, never the tree), or, for a demo
// of uncommitted work, its subject names the branch.
export function why(walk: Walk, repo: string, checkout: string, base: string, head: string, branch: string): string | null {
  if (walk.mode !== "live" || !walk.changes?.length) return null;
  const [, name] = repo.toLowerCase().split("/");
  if (!tokens(walk.change?.repo).some((t) => t === repo.toLowerCase() || t === name)) return null;
  const onBranch = new Set(git(checkout, "rev-list", `${base}..${head}`).split("\n"));
  const headTree = git(checkout, "rev-parse", `${head}^{tree}`);
  for (const c of tokens(walk.change?.commit)) {
    const sha = /^[0-9a-f]{7,40}$/.test(c) ? git(checkout, "rev-parse", "--verify", `${c}^{commit}`) : "";
    if (!sha) continue;
    if (onBranch.has(sha)) return `commit ${c} is on the branch`;
    if (headTree && git(checkout, "rev-parse", `${sha}^{tree}`) === headTree) return `commit ${c} has the branch's tree`;
  }
  return branch && (walk.change?.subject ?? "").toLowerCase().includes(branch.toLowerCase()) ? "its subject names the branch" : null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\|/g, "&#124;").replace(/\s+/g, " ").trim();

function picture(dir: string, out: string, slug: string, pic: string): string | null {
  const src = path.join(dir, pic);
  const dst = path.join(out, `${slug}.png`);
  if (!existsSync(src)) throw new Error(`${pic} is missing from ${dir}`);
  if (/\.png$/i.test(pic)) copyFileSync(src, dst);
  else if (/\.svg$/i.test(pic)) {
    const p = Bun.spawnSync(["rsvg-convert", "-b", "white", "-w", "960", src, "-o", dst], { stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`rsvg-convert ${pic}: ${p.stderr.toString().trim()}`);
  } else return null; // a clip (.webm) cannot sit in a table cell: its caption stands alone
  return dst;
}

export function section(walk: Walk, dir: string, out: string): string {
  const who = new Map((walk.personas ?? []).map((p) => [p.id, p.who]));
  const cell = (c: Change, side: "before" | "after", i: number) => {
    const png = picture(dir, out, `C${i + 1}-${side}`, c[side].pic);
    const img = png ? `<img width="360" alt="${side === "before" ? "Before" : "After"}" src="r2-pr:pic:${png}"><br>` : "";
    return `${img}${esc(c[side].line)}`;
  };
  const rows = walk.changes!.map((c, i) => `| **${esc(c.title)}**<br>for ${esc(who.get(c.persona) ?? c.persona)} | ${cell(c, "before", i)} | ${cell(c, "after", i)} |`);
  return [
    "<!-- r2-pr:demo -->",
    '<a id="what-changes"></a>',
    "## What changes",
    "",
    "| Change | Before | After |",
    "|---|---|---|",
    ...rows,
    "<!-- /r2-pr:demo -->",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const [repo, checkout, base, head, branch] = process.argv.slice(2);
  const out = process.argv[process.argv.indexOf("--out") + 1];
  if (!repo?.includes("/") || !checkout || !base || !head || !branch || !out || process.argv.indexOf("--out") < 0) {
    console.error("usage: demo.ts <owner/repo> <checkout> <base> <head> <branch> --out <dir>");
    process.exit(1);
  }
  const root = process.env.R2PR_VIZ_ROOT ?? path.join(os.homedir(), ".agents/state/viz");
  const found = readdirSync(root)
    .filter((n) => existsSync(path.join(root, n, "walk.json")))
    .flatMap((n) => {
      try {
        const walk = JSON.parse(readFileSync(path.join(root, n, "walk.json"), "utf8")) as Walk;
        const reason = why(walk, repo, checkout, base, head, branch);
        return reason ? [{ n, walk, reason, at: statSync(path.join(root, n, "walk.json")).mtimeMs }] : [];
      } catch { return []; } // an unreadable walk.json is not this branch's demo
    })
    .sort((a, b) => b.at - a.at); // the newest demo wins
  if (!found.length) { console.error(`no demo for ${branch}`); process.exit(0); }
  const [pick] = found;
  console.error(`demo ${pick.n}: ${pick.reason}${found.length > 1 ? ` (newest of ${found.length}: ${found.map((f) => f.n).join(", ")})` : ""}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  process.stdout.write(section(pick.walk, path.join(root, pick.n), out));
}

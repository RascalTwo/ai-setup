#!/usr/bin/env bun
// build.ts — plan.json + the diff → hunks.json and narration.json, for the pr-viz template.
//
//   bun build.ts <viz-dir>
//
// The diff comes from plan.json `source`: { "repo": "<clone>", "range": "main...branch" }
// (git, fully local) or { "diff": "<file>" } (e.g. saved from `gh pr diff`).
//
// It refuses to write until the diff tour covers EVERY production hunk — the film's claim
// "100% of changed production lines were shown" is only worth anything if it is enforced.
// A refusal lists the uncovered hunk ids; add a `say` line for each and run it again.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Line = ["+" | "-" | " ", number | null, number | null, string];
type Hunk = { id: string; file: string; header: string; newStart: number; lines: Line[]; add: number; del: number };
type FileDiff = { path: string; kind: "prod" | "test" | "lock" | "binary" | "docs"; add: number; del: number; hunks: Hunk[] };

const dir = path.resolve(process.argv[2] ?? ".");
const plan = JSON.parse(readFileSync(path.join(dir, "plan.json"), "utf8"));

function diffText(): string {
  const src = plan.source ?? {};
  if (src.diff) return readFileSync(path.resolve(dir, src.diff), "utf8");
  if (!src.repo || !src.range) throw new Error('plan.json needs source: { "repo", "range" } or { "diff" }');
  const p = Bun.spawnSync(["git", "-C", src.repo, "diff", "--no-color", "-U3", src.range], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git diff ${src.range} failed: ${p.stderr.toString()}`);
  return p.stdout.toString();
}

// What a reviewer reads differently. plan.classify ({ "glob-ish substring": kind }) wins.
function kindOf(file: string, binary: boolean): FileDiff["kind"] {
  for (const [pat, kind] of Object.entries(plan.classify ?? {})) if (file.includes(pat)) return kind as FileDiff["kind"];
  // Fixtures by extension: a hand-written text PDF diffs as text but is still a fixture, not code.
  if (binary || /\.(pdf|png|jpe?g|gif|webp|svg|ico|zip|gz|mp[34]|wav|docx?|xlsx?|pptx?)$/i.test(file)) return "binary";
  if (/(^|\/)(uv|poetry|Cargo|Gemfile|composer)\.lock$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|bun\.lockb?$|go\.sum$/.test(file)) return "lock";
  if (/(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*$|_test\.\w+$|\.(test|spec)\.\w+$/.test(file)) return "test";
  if (/\.(md|mdx|rst|txt)$/i.test(file)) return "docs";
  return "prod";
}

function parse(text: string): FileDiff[] {
  const files: FileDiff[] = [];
  let f: FileDiff | null = null, h: Hunk | null = null, o = 0, n = 0;
  for (const line of text.split("\n")) {
    const head = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (head) { f = { path: head[2], kind: "prod", add: 0, del: 0, hunks: [] }; files.push(f); h = null; continue; }
    if (!f) continue;
    if (line.startsWith("Binary files")) { f.kind = "binary"; continue; }
    const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (at) {
      o = +at[1]; n = +at[2];
      h = { id: `${f.path}#${f.hunks.length + 1}`, file: f.path, header: at[3].trim(), newStart: n, lines: [], add: 0, del: 0 };
      f.hunks.push(h);
      continue;
    }
    if (!h || /^(\+\+\+|---) /.test(line)) continue;
    if (line.startsWith("+")) { h.lines.push(["+", null, n++, line.slice(1)]); h.add++; f.add++; }
    else if (line.startsWith("-")) { h.lines.push(["-", o++, null, line.slice(1)]); h.del++; f.del++; }
    else if (line.startsWith(" ")) h.lines.push([" ", o++, n++, line.slice(1)]);
  }
  for (const file of files) {
    file.kind = kindOf(file.path, file.kind === "binary");
    if (file.kind === "binary") file.hunks = []; // a fixture's bytes are not something to read
  }
  return files;
}

const files = parse(diffText());
const prodHunks = files.filter((f) => f.kind === "prod").flatMap((f) => f.hunks);

// Scenes → beats. Every `say` line is one beat, numbered in order; the diff tour's entries
// are beats too. narration.json is written from this, so there is one copy of the script.
const cues: { at: string; say: string }[] = [];
const toured = new Set<string>();
const problems: string[] = [];
for (const [si, s] of (plan.scenes ?? []).entries()) {
  const lines: string[] = s.kind === "tour" ? (s.entries ?? []).map((e: { hunk: string; say: string }) => e.say) : (s.say ?? []);
  if (!lines.length) problems.push(`scene ${si + 1} "${s.title}" has no say lines`);
  // A tour entry shows one hunk ("hunk") or several on one beat ("hunks": small ones stacked,
  // identical ones — the same helper copied into three modules — shown once).
  if (s.kind === "tour") for (const e of s.entries ?? []) for (const id of e.hunks ?? [e.hunk]) {
    if (!prodHunks.some((h) => h.id === id)) problems.push(`tour entry "${id}" is not a production hunk`);
    toured.add(id);
  }
  // "[words](target)" pointer marks are the page's business; the voice says just the words.
  for (const say of lines) cues.push({ at: `beat:${cues.length + 1}`, say: say.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1") });
}
const missing = prodHunks.filter((h) => !toured.has(h.id));

const summary = files.map((f) => `  ${f.kind.padEnd(6)} +${String(f.add).padStart(3)} -${String(f.del).padStart(3)}  ${f.path}  (${f.hunks.length} hunk${f.hunks.length === 1 ? "" : "s"})`).join("\n");
console.log(`${files.length} files · ${prodHunks.length} production hunks\n${summary}`);

if (missing.length || problems.length) {
  for (const p of problems) console.error(`✗ ${p}`);
  if (missing.length) {
    console.error(`✗ the diff tour misses ${missing.length} production hunk(s) — give each a say line in a "tour" scene:`);
    for (const h of missing) console.error(`  ${h.id}  +${h.add} -${h.del}  ${h.header || ""}\n${h.lines.filter((l) => l[0] !== " ").slice(0, 6).map((l) => `      ${l[0]} ${l[3]}`).join("\n")}`);
  }
  process.exit(1);
}

writeFileSync(path.join(dir, "hunks.json"), JSON.stringify({ files }, null, 1) + "\n");
const narration = { voice: plan.voice ?? "af_heart", speed: plan.speed ?? 1.12, cues };
const prev = existsSync(path.join(dir, "narration.json")) ? readFileSync(path.join(dir, "narration.json"), "utf8") : "";
const next = JSON.stringify(narration, null, 2) + "\n";
if (prev !== next) writeFileSync(path.join(dir, "narration.json"), next);
// Add-ons (addons/): run when the change has what they read, and a checkout to read it from.
// A saved diff has no tree to walk, so they're skipped there. plan.addons.<name> = false opts out.
const ADDONS = path.join(import.meta.dir, "..", "addons");
const src = plan.source ?? {};
const addon = (name: string, when: boolean, cmd: string[]) => {
  if (!when || plan.addons?.[name] === false) return;
  if (!src.repo || !src.range) return console.log(`· ${name}: skipped (needs source.repo + source.range, not a saved diff)`);
  const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  console.log(r.exitCode === 0 ? r.stdout.toString().trim().split("\n").map((l) => `· ${l}`).join("\n") : `⚠ ${name} failed: ${r.stderr.toString().trim().split("\n").pop()}`);
};
addon("callgraph", files.some((f) => f.kind === "prod" && f.path.endsWith(".py")),
  ["python3", path.join(ADDONS, "python_callgraph.py"), src.repo, src.range, dir]);
addon("fixtures", files.some((f) => f.path.toLowerCase().endsWith(".pdf")),
  ["uv", "run", "--no-project", "--quiet", "--with", "pypdf", "--with", "pillow", "python", path.join(ADDONS, "pdf_fixtures.py"), src.repo, src.range, dir]);

const words = cues.reduce((a, c) => a + c.say.split(/\s+/).length, 0);
console.log(`✓ ${cues.length} beats · ${words} words ≈ ${Math.round(words / 2.6 / 60 * 10) / 10} min · diff tour covers ${toured.size}/${prodHunks.length} production hunks`);

#!/usr/bin/env node
// walkthrough.ts — the review's story as a PR-body list: each tour step's sentence (order.json `tour`),
// then its hunks as text GitHub colours. A fence gets ONE language, so per hunk: only added lines →
// the file's own language (syntax colours; all-green would say nothing), anything changed or removed →
// ```diff (red/green is the point). Unlike a permalink snippet (capped at ~10 visible lines) every
// line shows. Each block's label links to those lines in the PR's Files changed.
//
// The list is what needs a human's eyes, so a hunk whose every changed line is an import is left out,
// and named, with links, at the end. It refuses (exit 1, the IDs on stderr) while a production hunk
// that isn't import-only is missing from the tour: the story must cover the code.
//
//   node walkthrough.ts <review name>   → markdown on stdout
//
// Needs order.json `pr.repo`. Links go to the PR's Files changed once `pr.number` exists, and to the
// compare view (same line anchors) before that, so a local draft links correctly before the PR is opened.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { OrderFile } from "../template/contract.ts";
import { buildReview, readConfig, revRange } from "../lib/review.ts";
import { normalizeId } from "../lib/words.ts";

const INDEX = path.join(process.env.HOME ?? "", ".agents/state/hunk-review-viz/reviews.json");
const review = process.argv[2] ?? "";
const dir = (JSON.parse(readFileSync(INDEX, "utf8")) as Record<string, { dir: string }>)[review]?.dir;
if (!dir) throw new Error(`no review named "${review}" in ${INDEX}`);
const orderPath = path.join(dir, "order.json");
const order = (existsSync(orderPath) ? JSON.parse(readFileSync(orderPath, "utf8")) : {}) as OrderFile;
if (!order.pr?.repo) throw new Error("order.json needs pr.repo (owner/name)");
// shortcut: links use the review's first repo; a cross-repo review links only that one, fine until a cross-repo PR body needs it.
const first = readConfig(dir).repos[0];
const [base, head] = revRange(first.range).split("..").map((r) => execFileSync("git", ["-C", first.path, "rev-parse", r || "HEAD"], { encoding: "utf8" }).trim());
const { repo, number } = order.pr;
const diffPage = number ? `https://github.com/${repo}/pull/${number}/files` : `https://github.com/${repo}/compare/${base}...${head}`;

// The review's hunks as [op, old line, new line, text] rows, numbered from each header.
const view = buildReview(dir);
const hunks = new Map<string, any>();
for (const c of view.commits)
  for (const f of c.files)
    for (const h of f.hunks) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(h.header);
      let o = Number(m?.[1] ?? 1), n = Number(m?.[2] ?? 1);
      const lines = h.lines.map((l) => {
        const op = l[0] === "+" || l[0] === "-" ? l[0] : " ";
        const row = [op, op === "+" ? null : o, op === "-" ? null : n, l.slice(1)];
        if (op !== "+") o++;
        if (op !== "-") n++;
        return row;
      });
      hunks.set(h.id, { id: h.id, file: f.path, kind: f.kind, lines });
    }

const sha = (p: string) => createHash("sha256").update(p).digest("hex");
// The changed lines' span, linked to them in Files changed (R = new-file lines, L = old-only).
function lines(h: any) {
  const added = h.lines.filter((l: any) => l[0] === "+").map((l: any) => l[2]);
  const [side, nums] = added.length ? ["R", added] : ["L", h.lines.filter((l: any) => l[0] === "-").map((l: any) => l[1])];
  const a = Math.min(...nums), b = Math.max(...nums);
  return { url: `${diffPage}#diff-${sha(h.file)}${side}${a}${a === b ? "" : `-${side}${b}`}`, span: a === b ? `L${a}` : `L${a}–${b}` };
}
// Fence languages GitHub highlights, by file extension; unknown ones get plain text.
const LANG: Record<string, string> = { py: "python", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript",
  go: "go", rs: "rust", java: "java", kt: "kotlin", rb: "ruby", cs: "csharp", php: "php", sh: "bash", yml: "yaml", yaml: "yaml",
  json: "json", toml: "toml", graphql: "graphql", md: "markdown", css: "css", scss: "scss", html: "html", sql: "sql", tf: "hcl" };
// Only added lines → just those lines in the file's language; otherwise the whole hunk as a diff.
function block(h: any) {
  const addOnly = h.lines.every((l: any) => l[0] !== "-");
  const body = addOnly ? h.lines.filter((l: any) => l[0] === "+").map((l: any) => l[3])
    : h.lines.map((l: any) => (l[0] === " " ? " " : l[0]) + l[3]);
  const lang = addOnly ? LANG[path.extname(h.file).slice(1).toLowerCase()] ?? "" : "diff";
  // The fence outgrows any backtick run in the code; every line is indented into its list item.
  const fence = "`".repeat(Math.max(3, ...body.map((x: string) => (x.match(/`+/g) ?? [""]).reduce((m, r) => Math.max(m, r.length + 1), 0))));
  return { addOnly, text: [`${fence}${lang}`, ...body, fence].map((x) => `   ${x}`).join("\n") };
}
// Single-line imports: Python (import x / from x import y), JS/TS (import … / const x = require(…)).
const IMPORT = /^\s*(import\s+\S|from\s+\S+\s+import\s+[^(]+$|export\s+\*?\s*\{?[^}]*\}?\s*from\s|(const|let|var)\s+.+=\s*require\()/;
const importOnly = (h: any) => h.lines.filter((l: any) => l[0] !== " " && l[3].trim()).every((l: any) => IMPORT.test(l[3]));
// A helper copied into several modules is embedded once; the other copies are named and
// linked ("same code in N files") — same test: 80% of changed lines.
const changed = (h: any) => new Set(h.lines.filter((l: any) => l[0] !== " " && l[3].trim()).map((l: any) => l[0] + l[3].trim()));
const same = (a: any, b: any) => { const A = changed(a), B = changed(b); let hit = 0; for (const x of B) if (A.has(x)) hit++; return hit > 2 && hit >= 0.8 * Math.min(A.size, B.size); };
const name = (f: string) => `${f.startsWith("modules/") ? `${f.split("/")[1]} · ` : ""}\`${path.basename(f)}\``;

const skipped: any[] = [];
const covered = new Set<string>();
const steps = (order.tour ?? [])
  .map((e) => {
    const hs = e.hunks.map((id) => hunks.get(normalizeId(id))).filter(Boolean);
    for (const h of hs) covered.add(h.id);
    skipped.push(...hs.filter(importOnly));
    // A step windowed onto part of a long hunk (`lines`) exports just that window.
    const cut = (h: any) => (e.lines ? { ...h, lines: h.lines.filter((l: any) => l[2] !== null && e.lines!.some(([a, b]) => l[2] >= a && l[2] <= b)) } : h);
    return { say: e.say, hs: hs.filter((h: any) => !importOnly(h)).map(cut) };
  })
  .filter((e) => e.hs.length);
const missing = [...hunks.values()].filter((h) => h.kind === "prod" && !covered.has(h.id) && !importOnly(h));
if (missing.length) {
  console.error(`order.json's tour misses ${missing.length} production hunk(s): ${missing.map((h) => `${h.id} (${h.file})`).join(", ")}`);
  process.exit(1);
}
console.log(`In the recommended review order. File names link to the lines on GitHub.\n`);
steps.forEach((e: any, i: number) => {
  const hs = e.hs;
  const shown: any[] = [], copies: string[] = [];
  for (const h of hs) {
    const orig = shown.find((x) => same(x, h));
    if (orig) { const l = lines(h); copies.push(`[${name(h.file)} ${l.span}](${l.url})`); } else shown.push(h);
  }
  const also = copies.length ? `\n   Same code in ${copies.join(" · ")}.\n` : "";
  console.log(`${i + 1}. ${e.say}\n${shown.map((h) => { const l = lines(h); const k = block(h); return `\n   ${k.addOnly ? "added in " : ""}[${name(h.file)} ${l.span}](${l.url})\n\n${k.text}\n`; }).join("")}${also}`);
});
if (skipped.length) {
  const links = skipped.map((h: any) => { const l = lines(h); return `[${name(h.file)} ${l.span}](${l.url})`; });
  console.log(`Not shown, imports only: ${links.join(" · ")}.`);
}

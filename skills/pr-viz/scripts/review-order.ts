#!/usr/bin/env bun
// review-order.ts — the diff tour as a PR-body list: each step's words, then its hunks as text
// GitHub colours. A fence gets ONE language, so per hunk: only added lines → the file's own
// language (syntax colours; all-green would say nothing), anything changed or removed →
// ```diff (red/green is the point). Unlike a permalink snippet (capped at ~10 visible lines)
// every line shows. Each block's label links to those lines in the PR's Files changed.
//
// The list is what needs a human's eyes, so a hunk whose every changed line is an import is
// left out — and named, with links, at the end. (The film still walks 100% of hunks: that is
// its promise.) The rule errs toward showing: a multi-line import isn't recognised, so it shows.
//
//   bun review-order.ts <viz-dir>   → markdown on stdout
//
// Needs plan.pr.repo + base/head and a built hunks.json (build.ts). Links go to the PR's Files
// changed once plan.pr.number exists, and to the compare view (same line anchors) before that,
// so a local draft links correctly before the PR is opened.

import { readFileSync } from "node:fs";
import path from "node:path";

const dir = path.resolve(process.argv[2] ?? ".");
const plan = JSON.parse(readFileSync(path.join(dir, "plan.json"), "utf8"));
const diff = JSON.parse(readFileSync(path.join(dir, "hunks.json"), "utf8"));
const { repo, number, base, head } = plan.pr ?? {};
if (!repo || !(number || (base && head))) throw new Error("plan.json pr needs repo, and number or base + head");
const diffPage = number ? `https://github.com/${repo}/pull/${number}/files` : `https://github.com/${repo}/compare/${base}...${head}`;

const hunks = new Map(diff.files.flatMap((f: any) => f.hunks.map((h: any) => [h.id, h])));
const sha = (p: string) => new Bun.CryptoHasher("sha256").update(p).digest("hex");
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
  json: "json", toml: "toml", md: "markdown", css: "css", scss: "scss", html: "html", sql: "sql", tf: "hcl" };
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
// linked, as the film draws them ("same code in N files") — same test: 80% of changed lines.
const changed = (h: any) => new Set(h.lines.filter((l: any) => l[0] !== " " && l[3].trim()).map((l: any) => l[0] + l[3].trim()));
const same = (a: any, b: any) => { const A = changed(a), B = changed(b); let hit = 0; for (const x of B) if (A.has(x)) hit++; return hit > 2 && hit >= 0.8 * Math.min(A.size, B.size); };
const name = (f: string) => `${f.startsWith("modules/") ? `${f.split("/")[1]} · ` : ""}\`${path.basename(f)}\``;
// The step's words: its written `text` if it has one (a spoken line says "dot py", "one forty-five"),
// else the spoken line as prose (pointer marks keep their words; "The diff tour, …" openers go).
const prose = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/^The diff tour[^.]*\.\s*/, "");

const skipped: any[] = [];
const steps = (plan.scenes ?? []).filter((s: any) => s.kind === "tour").flatMap((s: any) => s.entries ?? [])
  .map((e: any) => {
    const hs = (e.hunks ?? [e.hunk]).map((id: string) => hunks.get(id)).filter(Boolean);
    skipped.push(...hs.filter(importOnly));
    // A tour entry windowed onto part of a long hunk (`lines`) exports just that window.
    const cut = (h: any) => (e.lines ? { ...h, lines: h.lines.filter((l: any) => l[2] !== null && e.lines.some(([a, b]: number[]) => l[2] >= a && l[2] <= b)) } : h);
    return { say: e.text ?? e.say, hs: hs.filter((h: any) => !importOnly(h)).map(cut) };
  })
  .filter((e: any) => e.hs.length);
console.log(`In the recommended review order. File names link to the lines on GitHub.\n`);
steps.forEach((e: any, i: number) => {
  const hs = e.hs;
  const shown: any[] = [], copies: string[] = [];
  for (const h of hs) {
    const orig = shown.find((x) => same(x, h));
    if (orig) { const l = lines(h); copies.push(`[${name(h.file)} ${l.span}](${l.url})`); } else shown.push(h);
  }
  const also = copies.length ? `\n   Same code in ${copies.join(" · ")}.\n` : "";
  console.log(`${i + 1}. ${prose(e.say)}\n${shown.map((h) => { const l = lines(h); const k = block(h); return `\n   ${k.addOnly ? "added in " : ""}[${name(h.file)} ${l.span}](${l.url})\n\n${k.text}\n`; }).join("")}${also}`);
});
if (skipped.length) {
  const links = skipped.map((h: any) => { const l = lines(h); return `[${name(h.file)} ${l.span}](${l.url})`; });
  console.log(`Not shown, imports only: ${links.join(" · ")}. The film walks these too.`);
}

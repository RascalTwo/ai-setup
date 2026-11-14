#!/usr/bin/env bun
// Checks ADRs against r2-adr's format: dated filename, Status line, upstream's sections, no
// leftover template placeholders, and relative links that resolve.
//
//   bun adr-lint.ts                 every ADR in <git root>/docs/adr
//   bun adr-lint.ts <dir|file>...   those folders or files
//
// Prints `ok` and exits 0, or one line per problem and exits 1.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const DATED = /^(\d{4})-(\d{2})-(\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const NUMBERED = /^\d{4}-(?!\d{2}-\d{2}-)[a-z0-9-]+\.md$/;
const DATE = String.raw`\d{4}-\d{2}-\d{2}`;
const STATUS = new RegExp(
  String.raw`^Status: (?:Accepted|Proposed|Deprecated|Superseded by \[[^\]]+\]\(([^)]+)\)), (${DATE})$`,
);
const SECTIONS = ["## Context and Problem Statement", "## Decision", "## Alternatives Considered"];

function validDate(y: string, m: string, d: string) {
  const t = new Date(`${y}-${m}-${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(`${y}-${m}-${d}`);
}

export function lintFile(path: string): string[] {
  const name = basename(path);
  const at = (msg: string) => `${path}: ${msg}`;
  if (NUMBERED.test(name)) return [at("numbered ADR filename; migrate it to YYYY-MM-DD-slug.md (r2-adr)")];
  const m = DATED.exec(name);
  if (!m) return [at("filename must be YYYY-MM-DD-verb-phrase.md (lowercase, dashes)")];
  const problems: string[] = [];
  if (!validDate(m[1], m[2], m[3])) problems.push(at(`${m[1]}-${m[2]}-${m[3]} is not a real date`));

  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  if (lines[0] === "---") problems.push(at("YAML frontmatter is not used; put status in the Status line"));
  if (!/^# \S/.test(lines[0] ?? "")) problems.push(at("line 1 must be the H1 title (`# ...`)"));
  const statusLine = lines.slice(1).find((l) => l.trim() !== "") ?? "";
  const s = STATUS.exec(statusLine);
  if (!s) problems.push(at(`first line after the title must be a Status line, got: ${JSON.stringify(statusLine)}`));
  else if (!validDate(...(s[2].split("-") as [string, string, string]))) problems.push(at(`Status date ${s[2]} is not a real date`));

  // Sections and placeholders are judged outside code fences, so an ADR may quote markdown.
  let fenced = false;
  const prose: string[] = [];
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
    else if (!fenced) prose.push(l);
  }
  let last = -1;
  for (const h of SECTIONS) {
    const i = prose.findIndex((l) => l.trim() === h);
    if (i === -1) problems.push(at(`missing section "${h}"`));
    else if (i < last) problems.push(at(`section "${h}" is out of order`));
    else last = i;
  }
  for (const l of prose) {
    const p = /\{(?:TITLE|[A-Z][^{}`]{8,})\}/.exec(l.replace(/`[^`]*`/g, ""));
    if (p) problems.push(at(`template placeholder left in: ${p[0].slice(0, 40)}`));
  }

  for (const [, target] of text.matchAll(/\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(target)) continue;
    if (!existsSync(resolve(dirname(path), target))) problems.push(at(`link target not found: ${target}`));
  }
  return problems;
}

export function lintPaths(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) return [`${p}: not found`];
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (f.endsWith(".md") && f !== "README.md") files.push(join(p, f));
    } else files.push(p);
  }
  return files.flatMap(lintFile);
}

if (import.meta.main) {
  let args = process.argv.slice(2);
  if (args.length === 0) {
    const root = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"]).stdout.toString().trim() || process.cwd();
    args = [join(root, "docs/adr")];
    if (!existsSync(args[0])) {
      console.log("ok (no docs/adr)");
      process.exit(0);
    }
  }
  const problems = lintPaths(args);
  console.log(problems.length ? problems.join("\n") : "ok");
  process.exit(problems.length ? 1 : 0);
}

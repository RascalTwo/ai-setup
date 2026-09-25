#!/usr/bin/env bun
// Check every owned tool and skill against viz-pages/POSTER-STANDARD.md.
//
// The standard is five beats in a fixed order, marked with data-beat rather than by
// heading text — headings are the voice of the page and the checker has no business
// reading them.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const REPO = join(import.meta.dir, "..");
const BEATS = ["why", "using", "limits", "where", "how"] as const;
const VIZ = join(REPO, "viz-pages");

type Owned = { name: string; kind: string; manifest: Record<string, unknown> };

/** Every tool and skill, read off the frontmatter that already declares them. */
function owned(): Owned[] {
  const out: Owned[] = [];
  for (const [dir, file] of [["tools", "README.md"], ["skills", "SKILL.md"]]) {
    const root = join(REPO, dir);
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const p = join(root, name, file);
      if (!existsSync(p)) continue;
      const m = /^---\n([\s\S]*?)\n---/.exec(readFileSync(p, "utf8"));
      if (!m) continue;
      const block = /rascaltwo-ai-setup:\n([\s\S]*?)(?=\n\S|$)/.exec(m[1]);
      if (!block) continue;
      const man: Record<string, unknown> = {};
      for (const line of block[1].split("\n")) {
        const kv = /^\s{2}([a-z-]+):\s*(.*)$/.exec(line);
        if (kv) man[kv[1]] = kv[2];
      }
      out.push({ name, kind: dir === "tools" ? "tool" : "skill", manifest: man });
    }
  }
  return out;
}

function posterFor(name: string, kind: string): string | null {
  for (const slug of [`${kind}-${name}`, `skill-${name}`, `tool-${name}`]) {
    const p = join(VIZ, slug, "index.html");
    if (existsSync(p)) return p;
  }
  return null;
}

const problems: string[] = [];
const listOnly = process.argv.includes("--fix-list");
const needWork = new Set<string>();

let poster = 0, missing = 0;
for (const o of owned().sort((a, b) => a.name.localeCompare(b.name))) {
  const p = posterFor(o.name, o.kind);
  if (!p) { missing++; needWork.add(o.name); problems.push(`  ✗ ${o.name} — no poster`); continue; }
  poster++;
  const html = readFileSync(p, "utf8");
  // Only an ATTRIBUTE on a heading tag counts. Matching the bare string anywhere would
  // also catch a poster that *documents* data-beat in prose or a <pre> example — which
  // poster-standard does, at length, and which read as beats out of order.
  const found = [...html.matchAll(/<h[1-6][^>]*\sdata-beat="(\w+)"/g)].map((m) => m[1]);

  const absent = BEATS.filter((b) => !found.includes(b));
  if (absent.length) { needWork.add(o.name); problems.push(`  ✗ ${o.name} — missing beat(s): ${absent.join(", ")}`); }

  // order: first appearance of each present beat must follow BEATS
  const firsts = BEATS.filter((b) => found.includes(b)).map((b) => found.indexOf(b));
  if (firsts.some((v, i) => i && v < firsts[i - 1])) {
    needWork.add(o.name); problems.push(`  ✗ ${o.name} — beats out of order`);
  }

  // beat 5 must carry a visual, not just prose
  if (found.includes("how") && !/<svg|stepper\(|class="fig"/.test(html)) {
    needWork.add(o.name); problems.push(`  ✗ ${o.name} — "how" beat has no diagram or stepper`);
  }

  // A scaffold forked from the reference inherits five correctly-ordered beats and
  // therefore passes every structural check while being about the wrong thing entirely.
  // Two cheap tells: it still carries the reference's own prose, and it barely names
  // its own subject.
  if (/The mechanism was there, in pieces|check-posters\.ts<\/div>|scripts\/check-posters/.test(html)) {
    needWork.add(o.name); problems.push(`  ✗ ${o.name} — still carries poster-standard's prose; scaffold not written yet`);
  }
  const mentions = (html.match(new RegExp(o.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) ?? []).length;
  if (mentions < 3) {
    needWork.add(o.name); problems.push(`  ✗ ${o.name} — names its own subject only ${mentions}×; is this poster about it?`);
  }

  // beat 4 must agree with what the frontmatter declares
  if (found.includes("where")) {
    const st = String(o.manifest.state) === "true";
    const claims = new RegExp(`agents/state/${o.name}\\b`).test(html);
    if (st && !o.manifest["state-owner"] && !claims) {
      needWork.add(o.name); problems.push(`  ✗ ${o.name} — declares state but the poster never names ~/.agents/state/${o.name}`);
    }
    if (!st && claims) {
      needWork.add(o.name); problems.push(`  ✗ ${o.name} — poster claims state the manifest says it does not keep`);
    }
  }
}

if (listOnly) { console.log([...needWork].sort().join("\n")); process.exit(0); }

console.log(`${poster} with a poster, ${missing} without.\n`);
if (problems.length) { console.log(problems.join("\n")); console.log(`\n${needWork.size} need work.`); }
else console.log("All posters satisfy the standard.");
process.exit(problems.length ? 1 : 0);

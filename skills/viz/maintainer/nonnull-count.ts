// maintainer/nonnull-count.ts — how many non-null assertions (`x!`) are left, and of what kind (task viz-nonnull-conquer).
//
//   bun maintainer/nonnull-count.ts [--list] [--json] [root…]
//
// Runs Oxlint with typescript/no-non-null-assertion and nothing else over the four places the task covers: the central
// library (~/.agents/state/viz), the repo's viz-pages, skills/viz/viz-pages and the skill's own source. It counts what
// `viz lint` would: `.ts` only, no `.d.ts`, nothing under node_modules, vendor, __screenshots__ or a dot-folder, and no
// mirror or vendored copy (lib/copy.ts: those are checked at their origin). A `!` behind an
// `oxlint-disable-next-line … -- why` is not counted; the disables are listed separately. --list prints every finding.

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCopy } from "../lib/copy.ts";

export const SKILL = path.resolve(import.meta.dir, "..");
const OXLINT = path.join(SKILL, "node_modules/oxlint/bin/oxlint");
const RULE = "typescript/no-non-null-assertion";

export const DEFAULT_ROOTS = [
  path.join(os.homedir(), ".agents/state/viz"),
  path.resolve(SKILL, "../../viz-pages"),
  path.join(SKILL, "viz-pages"),
  SKILL,
];

/** The author's `.ts` under `dir`: skips what lint skips, copies, and (for the skill) its viz-pages, counted on their own. */
export function tsFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (isCopy(d)) return;
    for (const name of readdirSync(d)) {
      if (name.startsWith(".") || ["node_modules", "vendor", "__screenshots__"].includes(name))
        continue;
      const abs = path.join(d, name);
      if (dir === SKILL && abs === path.join(SKILL, "viz-pages")) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(abs);
    }
  };
  walk(dir);
  return out;
}

/** The task's buckets, read off the asserted expression's own text. */
export function category(expr: string): "dom" | "index" | "small" | "other" {
  if (/(?:\$|querySelector|getElementById|closest|need)\s*(?:<[^>]*>)?\s*\([^]*\)$/u.test(expr))
    return "dom";
  if (expr.endsWith("]")) return "index";
  if (/\.(?:get|pop|shift|find|findLast|match|exec|at)\s*\([^]*\)$/u.test(expr)) return "small";
  return "other";
}

/** One `x!`: `offset`/`length` are UTF-8 byte offsets of the whole expression, `!` included. */
export type Finding = {
  file: string;
  line: number;
  offset: number;
  length: number;
  expr: string;
  cat: string;
  test: boolean;
};

type Diagnostic = {
  code?: string;
  filename: string;
  labels?: { span: { offset: number; length: number; line: number } }[];
};

/** Every `!` Oxlint reports under `root`. */
export function count(root: string): { files: number; findings: Finding[] } {
  const files = tsFiles(root);
  if (files.length === 0) return { files: 0, findings: [] };
  const tmp = mkdtempSync(path.join(os.tmpdir(), "nonnull-count-"));
  try {
    const rc = path.join(tmp, "oxlintrc.json");
    writeFileSync(
      rc,
      JSON.stringify({ plugins: ["typescript"], categories: {}, rules: { [RULE]: "error" } }),
    );
    const outFile = path.join(tmp, "out.json"); // a file, not a pipe: see lib/lint/lint.ts
    Bun.spawnSync({
      cmd: [process.execPath, OXLINT, "-c", rc, "-f", "json", ...files],
      cwd: root,
      stdout: Bun.file(outFile),
    });
    const out = readFileSync(outFile, "utf8");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: Oxlint's documented report shape
    const report = JSON.parse(out.slice(out.indexOf("{"))) as { diagnostics: Diagnostic[] };
    const findings = report.diagnostics.flatMap((d) => {
      const span = d.labels?.[0]?.span;
      // Oxlint keeps its default correctness rules on whatever the config says, so keep this rule's findings only.
      if (!span || !d.code?.includes("no-non-null-assertion")) return [];
      const file = path.resolve(root, d.filename);
      // Oxlint's offsets count UTF-8 bytes, not UTF-16 units.
      const expr = readFileSync(file)
        .subarray(span.offset, span.offset + span.length - 1)
        .toString();
      return [
        {
          file,
          line: span.line,
          offset: span.offset,
          length: span.length,
          expr,
          cat: category(expr),
          test: file.split(path.sep).includes("tests"),
        },
      ];
    });
    return { files: files.length, findings };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Every deliberate remainder: a disable of this rule, which lint holds to carrying a reason. */
function disables(root: string): string[] {
  return tsFiles(root).flatMap((f) =>
    readFileSync(f, "utf8")
      .split("\n")
      .flatMap((l, i) => (l.includes(`disable-next-line ${RULE}`) ? [`${f}:${i + 2}`] : [])),
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const roots = args.filter((a) => !a.startsWith("--")).map((a) => path.resolve(a));
  const all = (roots.length > 0 ? roots : DEFAULT_ROOTS).map((root) => {
    const { files, findings } = count(root);
    return { root, files, findings, disables: disables(root) };
  });
  const findings = all.flatMap((r) => r.findings);
  const by = (key: (f: Finding) => string) =>
    Object.fromEntries(
      Object.entries(Object.groupBy(findings, key)).map(([k, v]) => [k, v?.length ?? 0]),
    );
  const summary = {
    total: findings.length,
    files: new Set(findings.map((f) => f.file)).size,
    byRoot: Object.fromEntries(
      all.map((r) => [r.root, { scanned: r.files, findings: r.findings.length }]),
    ),
    byCategory: by((f) => f.cat),
    tests: findings.filter((f) => f.test).length,
    disables: all.flatMap((r) => r.disables),
  };
  if (args.includes("--list"))
    for (const f of findings) console.log(`${f.file}:${f.line} [${f.cat}] ${f.expr}!`);
  console.log(JSON.stringify(summary, null, 2));
}

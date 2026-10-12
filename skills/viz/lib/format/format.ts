// lib/format/format.ts — the format step: oxfmt over a viz's TypeScript, CSS and HTML, plus one check oxfmt cannot do.
//
// oxfmt's defaults, on purpose: one style everywhere is the point, and it has no option that keeps hand-aligned columns.
// Where alignment IS the meaning (a data table), `// prettier-ignore` protects the next statement, but the comment must be
// exact (oxfmt 0.71.0 ignores `// prettier-ignore -- why`), so the reason goes on the line above, and a bare ignore fails
// the run, the way a bare lint disable does (lint.ts).
//
// Any unformatted file fails the run; `format(dir, [], true)` writes the fix. Generated and borrowed code is not the
// author's: `.js` (a viz's code is TypeScript, ADR 0023), declaration files, dot-folders, vendored and mirrored copies.

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { isCopy } from "../copy.ts";

const SKILL = path.resolve(import.meta.dir, "../..");
const OXFMT = path.join(SKILL, "node_modules/oxfmt/bin/oxfmt");
/** oxfmt's defaults, on purpose. Not `htmlWhitespaceSensitivity: "strict"`: it keeps every space, but writes closing tags
 *  as `</script\n  >`, which the skill's own regexes (`</script>`, `</head>`, `</body>`, `</title>`) do not match. The default
 *  re-indents the text of an element it cannot know is `white-space: pre` (a styled <div>), so those are marked
 *  `prettier-ignore` with a reason, and a before/after screenshot comparison (maintainer/parity.ts) finds any other. */
const CONFIG = {};
const EXT = [".ts", ".css", ".html"];

export type FormatResult = { files: number; findings: string[]; skipped: string | null };

/** Every file under `dir` that is the author's and that oxfmt formats. `skip` names folders relative to `dir`. */
function formattable(dir: string, skip: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    if (d !== dir && isCopy(d)) return;
    for (const name of readdirSync(d)) {
      if (
        name.startsWith(".") ||
        name === "node_modules" ||
        name === "vendor" ||
        name === "__screenshots__"
      )
        continue;
      const abs = path.join(d, name);
      if (skip.includes(path.relative(dir, abs))) continue;
      if (statSync(abs).isDirectory()) walk(abs);
      else if (EXT.some((e) => name.endsWith(e)) && !name.endsWith(".d.ts")) out.push(abs);
    }
  };
  walk(dir);
  return out.toSorted();
}

const IGNORE = /^\s*(?:\/\/|\/\*|<!--)\s*(?:prettier|oxfmt)-ignore\b/u;
const COMMENT = /^\s*(?:\/\/|\/\*|\*|<!--)/u;

/** An ignore must say why on the line above it: a comment of at least three words that is not itself an ignore. */
function bareIgnores(dir: string, files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    const lines = readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (!IGNORE.test(line)) return;
      const above = lines[i - 1] ?? "";
      const words = above
        .replaceAll(/^\s*(?:\/\/+|\/\*+|\*+|<!--)|(?:\*\/|-->)\s*$/gu, "")
        .trim()
        .split(/\s+/u)
        .filter(Boolean).length;
      if (!COMMENT.test(above) || IGNORE.test(above) || words < 3)
        out.push(
          `${path.relative(dir, f)}:${i + 1} format-ignore without a reason: say why in a comment on the line above`,
        );
    });
  }
  return out;
}

/** Run oxfmt over a viz (`write`: apply the formatting); null when it has nothing to format. */
export function format(dir: string, skip: string[] = [], write = false): FormatResult | null {
  const vizDir = realpathSync(dir);
  if (isCopy(vizDir)) return null;
  const files = formattable(vizDir, skip);
  if (files.length === 0) return null;
  const own = bareIgnores(vizDir, files);
  if (!existsSync(OXFMT))
    return {
      files: files.length,
      findings: own,
      skipped: `oxfmt is not installed in the viz skill — run \`bun install\` in ${SKILL}`,
    };

  const tmp = mkdtempSync(path.join(os.tmpdir(), "viz-format-"));
  try {
    writeFileSync(path.join(tmp, "oxfmtrc.json"), JSON.stringify(CONFIG));
    const rel = files.map((f) => path.relative(vizDir, f));
    const run = (mode: "--write" | "--list-different", paths: string[]) =>
      Bun.spawnSync({
        cmd: [
          process.execPath,
          OXFMT,
          "-c",
          path.join(tmp, "oxfmtrc.json"),
          "--disable-nested-config",
          mode,
          ...paths,
        ],
        cwd: vizDir,
        stdout: "pipe",
        stderr: "pipe",
      });
    // --list-different prints the unformatted paths, one per line.
    const differing = (r: ReturnType<typeof run>): string[] =>
      r.stdout
        .toString()
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => rel.includes(l));
    // oxfmt is not always idempotent in one pass (measured: guide.ts of the self-portrait needed two), so a fix repeats until stable.
    let r = run("--list-different", rel);
    if (write) {
      for (let pass = 0; pass < 3 && differing(r).length > 0; pass++) {
        run("--write", differing(r));
        r = run("--list-different", rel);
      }
    }
    const unformatted = differing(r);
    // Exit 1 means "some files differ"; anything else non-zero with nothing listed is oxfmt failing (a syntax error, a crash).
    if (r.exitCode !== 0 && unformatted.length === 0) {
      const why =
        (r.stderr.toString() + r.stdout.toString())
          .trim()
          .split("\n")
          .find((l) => l.trim() && !l.startsWith("No config")) ?? `exit ${r.exitCode}`;
      return {
        files: files.length,
        findings: [`oxfmt could not format: ${why.slice(0, 200)}`, ...own],
        skipped: null,
      };
    }
    const found = unformatted.map((f) => `${f} is not formatted: run \`viz format <viz> --fix\``);
    return { files: files.length, findings: [...found, ...own], skipped: null };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

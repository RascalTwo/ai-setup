// maintainer/codemods/need.ts — moves DOM lookups asserted with `!` onto the kit's `need` (task viz-nonnull-conquer).
//
//   bun maintainer/codemods/need.ts [--write] [root…]      (dry run unless --write; roots default to nonnull-count's)
//
//   $(sel)!  $<T>(sel, root)!            → need(sel) / need<T>(sel, root)
//   document.querySelector<T>(sel)!      → need<T>(sel)
//   root.querySelector<T>(sel)!          → need<T>(sel, root)
//   document.getElementById("a")!        → need("#a")
//
// The installed TypeScript (7) has no JavaScript compiler API, so the AST is Oxlint's: nonnull-count.ts hands over the
// exact span of every `x!`, and only an expression that is wholly one of the shapes above is rewritten. Anything else is
// left alone and listed with the reason: a computed selector, a non-literal id, a receiver that is not a plain name, a `$` that is not
// the kit's, a file that already has its own `need`, or a file that cannot import the kit (tests/ run in Bun, api.ts is a
// backend). `need` joins the file's existing kit import, or a new `import { need } from "@viz/kit"` is added to page code.
// A file that was formatted before is formatted again after; one that was not is left as it was. Running it twice
// changes nothing the second time: a rewritten lookup has no `!` left to find.

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { count, DEFAULT_ROOTS, SKILL, type Finding } from "../nonnull-count.ts";

const OXFMT = path.join(SKILL, "node_modules/oxfmt/bin/oxfmt");
// oxfmt's defaults, as lib/format/format.ts runs it.
const RC = path.join(mkdtempSync(path.join(os.tmpdir(), "need-codemod-")), "oxfmtrc.json");
writeFileSync(RC, "{}");
const oxfmt = (cwd: string, mode: "--write" | "--list-different", files: string[]) =>
  Bun.spawnSync({
    cmd: [
      process.execPath,
      OXFMT,
      "-c",
      RC,
      "--disable-nested-config",
      mode,
      ...files.map((f) => path.relative(cwd, f)),
    ],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

const STR = String.raw`"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\x60(?:[^\x60\\$]|\\.|\$\{[\w$.]+\})*\x60`;
const GEN = String.raw`<[\w$.]+>`;
const NAME = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`;
// A selector is a literal or a plain name: either is evaluated once and has no side effect, so moving it is safe.
const SEL = String.raw`${STR}|${NAME}`;
const ARGS = String.raw`\(\s*(${SEL})\s*(?:,\s*(${NAME})\s*)?,?\s*\)`;
const DOLLAR = new RegExp(String.raw`^\$(${GEN})?${ARGS}$`, "u");
const QUERY = new RegExp(
  String.raw`^(${NAME})\s*\.querySelector(${GEN})?\(\s*(${SEL})\s*,?\s*\)$`,
  "u",
);
const BY_ID = /^document\s*\.getElementById\(\s*(["'])([A-Za-z_][\w-]*)\1\s*\)$/u;

/** The kit import in `src`, if any: `@viz/kit`, the old `/_kit/viz.js`, or `./viz.*` inside the kit's own source. */
function kitImport(src: string, file: string): RegExpExecArray | null {
  const inKit = path.dirname(file) === path.join(SKILL, "kit/src");
  const spec = inKit ? String.raw`\.\/viz\.(?:js|ts)` : String.raw`@viz\/kit|\/_kit\/viz\.js`;
  // At the start of a line: an import statement, not one quoted in a code sample on the page.
  return new RegExp(
    String.raw`^[ \t]*import\s*\{([^}]*)\}\s*from\s*["'](?:${spec})["']`,
    "mu",
  ).exec(src);
}

/** `<HTMLElement>` is need's default, which lint calls unnecessary, unless a tag name would pick another type. */
const generic = (gen: string | undefined, sel: string | undefined) =>
  gen === "<HTMLElement>" && !/^["'`][a-z][a-z0-9-]*["'`]$/u.test(sel ?? "") ? "" : (gen ?? "");

/** The `need(…)` call that replaces `expr`, or why it cannot. */
export function rewrite(expr: string, kitDollar: boolean): { to: string } | { skip: string } {
  const d = DOLLAR.exec(expr);
  if (d) {
    if (!kitDollar) return { skip: "this $ is not imported from the kit" };
    return { to: `need${generic(d[1], d[2])}(${d[2]}${d[3] ? `, ${d[3]}` : ""})` };
  }
  const q = QUERY.exec(expr);
  if (q)
    return { to: `need${generic(q[2], q[3])}(${q[3]}${q[1] === "document" ? "" : `, ${q[1]}`})` };
  const g = BY_ID.exec(expr);
  if (g) return { to: `need("#${g[2]}")` };
  return { skip: "not a lookup of a literal or named selector on a plain name" };
}

/** Why `file` cannot import the kit, or null when it can. */
function noKit(file: string, src: string): string | null {
  // Type-only imports and exports vanish from the .js, so a file with only those is still a classic script.
  if (!/^\s*(?:import|export)\b(?!\s+(?:type|interface|declare)\b)/mu.test(src))
    return "a classic script (no import or export in its .js) cannot import";
  if (file.split(path.sep).includes("tests"))
    return "a test runs in Bun, where the kit's DOM is absent";
  if (path.basename(file) === "api.ts") return "a backend cannot import the page kit";
  return null;
}

type FileResult = { file: string; src: string; out: string; done: number; skipped: string[] };

/** Rewrites one file's DOM findings (all from `findings`, which are this file's). */
function editFile(file: string, findings: Finding[]): FileResult {
  const buf = readFileSync(file);
  const src = buf.toString();
  const imp = kitImport(src, file);
  const kitDollar = imp !== null && /(?:^|[\s,{])\$\s*(?:,|$)/u.test(imp[1] ?? "");
  const skipped: string[] = [];
  const at = (f: Finding, why: string) => `${file}:${f.line} ${f.expr}! — ${why}`;
  // A declaration or binding named need (not the word in a string): a function, variable, parameter or other import.
  const ownNeed =
    /\b(?:function|const|let|var|class)\s+need\b|[({,]\s*need\s*(?:[,)}:]|=(?!=))/u.test(
      imp ? src.replace(imp[0], "") : src,
    );
  const blocked = ownNeed ? "the file already has its own `need`" : imp ? null : noKit(file, src);
  const edits: { offset: number; length: number; to: string }[] = [];
  for (const f of findings) {
    const r = rewrite(f.expr, kitDollar);
    if ("skip" in r) skipped.push(at(f, r.skip));
    else if (blocked) skipped.push(at(f, blocked));
    else edits.push({ offset: f.offset, length: f.length, to: r.to });
  }
  if (edits.length === 0) return { file, src, out: src, done: 0, skipped };
  let out = buf;
  for (const e of edits.toSorted((a, b) => b.offset - a.offset))
    out = Buffer.concat([
      out.subarray(0, e.offset),
      Buffer.from(e.to),
      out.subarray(e.offset + e.length),
    ]);
  let text = out.toString();
  const now = kitImport(text, file);
  if (now) {
    if (!/(?:^|[\s,{])need\s*(?:,|$)/u.test(now[1] ?? "")) {
      const list = now[1] ?? "";
      const body = list.trimEnd().endsWith(",")
        ? `${list.trimEnd()} need,${list.slice(list.trimEnd().length)}`
        : `${list.trimEnd()}, need${list.slice(list.trimEnd().length)}`;
      // A function replacer: a string one would read the `$$` of `{ $, $$ }` as an escaped `$`.
      text = text.replace(now[0], () => now[0].replace(`{${list}}`, () => `{${body}}`));
    }
  } else {
    // After the last top-level import, else before the first line of code.
    const lines = text.split("\n");
    const lastImport = lines.findLastIndex((l) => /^import\b.*from\s*["'].*["'];?\s*$/u.test(l));
    const firstCode = lines.findIndex((l) => l.trim() !== "" && !/^\s*(?:\/\/|\/\*|\*)/u.test(l));
    lines.splice(
      lastImport >= 0 ? lastImport + 1 : Math.max(firstCode, 0),
      0,
      'import { need } from "@viz/kit";',
    );
    // The import makes the file a module, so a bare `export {}` marker is now useless (lint says so).
    text = lines.filter((l) => l.trim() !== "export {};").join("\n");
  }
  return { file, src, out: dropUnusedDollar(text, file), done: edits.length, skipped };
}

/** `$` taken out of the kit import once `need` has replaced its last use (else tsc: "declared but never read"). */
export function dropUnusedDollar(text: string, file: string): string {
  const imp = kitImport(text, file);
  if (!imp) return text;
  const list = imp[1] ?? "";
  const names = list.split(",").map((n) => n.trim());
  if (!names.includes("$")) return text;
  // A use is a call, `$(` or `$<T>(`: a bare `$` is as often a regex anchor or a price in a string. A `$`
  // passed as a value would lose its import here, and tsc then names it.
  if (/(?<![\w$.])\$\s*[(<]/u.test(text.replace(imp[0], ""))) return text;
  const kept = names.filter((n) => n !== "$" && n !== "").join(", ");
  return text.replace(imp[0], () => imp[0].replace(`{${list}}`, () => `{ ${kept} }`));
}

/** The files oxfmt would change, out of `files` (all under `cwd`). */
function unformatted(cwd: string, files: string[]): Set<string> {
  if (files.length === 0) return new Set();
  const r = oxfmt(cwd, "--list-different", files);
  return new Set(
    r.stdout
      .toString()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => path.resolve(cwd, l.trim())),
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const given = args.filter((a) => !a.startsWith("--")).map((a) => path.resolve(a));
  let done = 0;
  const skipped: string[] = [];
  const touched: string[] = [];
  for (const root of given.length > 0 ? given : DEFAULT_ROOTS) {
    const dom = count(root).findings.filter((f) => f.cat === "dom");
    const byFile = Map.groupBy(dom, (f) => f.file);
    const results = [...byFile].map(([file, fs]) => editFile(file, fs));
    const changing = results.filter((r) => r.done > 0);
    const wasRaw = unformatted(
      root,
      changing.map((r) => r.file),
    );
    for (const r of results) {
      done += r.done;
      skipped.push(...r.skipped);
    }
    if (!write) continue;
    for (const r of changing) writeFileSync(r.file, r.out);
    // oxfmt is not always idempotent in one pass (lib/format/format.ts), so repeat until stable.
    let toFormat = changing.map((r) => r.file).filter((f) => !wasRaw.has(f));
    for (let pass = 0; pass < 3 && toFormat.length > 0; pass++) {
      oxfmt(root, "--write", toFormat);
      const still = unformatted(root, toFormat);
      toFormat = toFormat.filter((f) => still.has(f));
    }
    touched.push(...changing.map((r) => r.file));
  }
  for (const s of skipped) console.log(`skip ${s}`);
  console.log(
    JSON.stringify({ write, rewritten: done, files: touched.length, skipped: skipped.length }),
  );
  if (write) for (const f of touched) console.error(`touched ${f}`);
}

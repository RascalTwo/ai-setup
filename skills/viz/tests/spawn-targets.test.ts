// tests/spawn-targets.test.ts — every script this skill runs must exist and be runnable.
//
// WHY: three spawn targets rotted silently when code moved into lib/. og.ts spawned
// lib/publish/verify.ts, ensureDevServer spawned lib/publish/server.ts (neither file ever
// existed there), and the vendor-guard hook ran `bun <vendor-guard.ts>` — a module with
// no entry point, so it exited 0 and blocked nothing. Each failed quietly: stderr was
// ignored, or there was nothing to print. A path built from import.meta.dir is resolved
// relative to wherever the file now lives, so a move breaks it without a type error.
//
// So this scans the source statically, the way a reviewer would, and resolves each path.

import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SKILL = path.dirname(import.meta.dir);

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(path.join(dir, e.name))
      : e.name.endsWith(".ts")
        ? [path.join(dir, e.name)]
        : [],
  );

const FILES = [
  ...walk(path.join(SKILL, "lib")),
  ...walk(path.join(SKILL, "commands")),
  ...readdirSync(SKILL)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => path.join(SKILL, f)),
  path.join(SKILL, "viz-pages/viz-self-portrait/api.ts"),
].filter(existsSync);

/** Source with comments blanked, so a path mentioned in prose is not mistaken for code. */
const code = (file: string) =>
  readFileSync(file, "utf8")
    .replaceAll(/^\s*\/\/.*$/gmu, "")
    .replaceAll(/\/\*[\s\S]*?\*\//gu, "");

/**
 * Does running this file DO something? Either an import.meta.main guard, or a statement
 * at column 0 that executes (a call, await, if/for/try) rather than declares.
 */
function hasEntryPoint(file: string): boolean {
  const src = code(file);
  return (
    src.includes("import.meta.main") ||
    /^(await\s|if\s*\(|for\s*\(|try\s*\{|process\.|[A-Za-z_$][\w$]*(\.[\w$]+)*\()/mu.test(src)
  );
}

type Target = { from: string; target: string; how: string };

/** Every script path a file builds from its own location, plus bridge() targets. */
function targetsOf(file: string): Target[] {
  const src = code(file);
  const here = path.dirname(file);
  // Identifiers that name a directory: `const X = import.meta.dir`, `= path.dirname(import.meta.dir)`,
  // `= path.resolve(import.meta.dir, "../..")`. SKILL/SKILL_DIR set from env mean the skill root.
  const bases = new Map<string, string>([["import.meta.dir", here]]);
  for (const m of src.matchAll(
    /const (\w+) = (?:path\.dirname\(import\.meta\.dir\)|path\.(?:resolve|join)\(import\.meta\.dir, "([^"]+)"\)|import\.meta\.dir);/gu,
  )) {
    bases.set(
      m[1]!,
      m[0].includes("dirname") ? path.dirname(here) : m[2] ? path.resolve(here, m[2]) : here,
    );
  }
  for (const n of ["SKILL", "SKILL_DIR"])
    if (!bases.has(n) && new RegExp(`const ${n} = process\\.env`, "u").test(src))
      bases.set(n, SKILL);

  const out: Target[] = [];
  for (const m of src.matchAll(
    /path\.(?:join|resolve)\(\s*([\w.]+)\s*,((?:\s*"[^"]+"\s*,?)+)\)/gu,
  )) {
    const base = bases.get(m[1]!);
    const segs = [...m[2]!.matchAll(/"([^"]+)"/gu)].map((s) => s[1]!);
    if (base && /\.(ts|js|mjs)$/u.test(segs.at(-1)!))
      out.push({ from: file, target: path.resolve(base, ...segs), how: m[0] });
  }
  for (const m of src.matchAll(/bridge\("([^"]+\.ts)"/gu))
    out.push({ from: file, target: path.join(SKILL, m[1]!), how: m[0] });
  // A string that runs THIS file (a hook template, a self-respawn) makes the file itself a target.
  if (src.includes(`\${import.meta.path}`))
    out.push({ from: file, target: file, how: "${import.meta.path}" });
  return out;
}

const rel = (p: string) => path.relative(SKILL, p);
const ALL = FILES.flatMap(targetsOf);

test("Given the source, when scanned, then it finds the spawn targets the skill actually uses", () => {
  // A scan that finds nothing passes everything; pin that it still sees the known ones.
  const found = new Set(ALL.map((t) => rel(t.target)));
  for (const known of ["viz.ts", "server.ts", "sync-runtimes.ts"]) expect(found).toContain(known);
});

// A .d.ts is read by tsc (lib/testing/global.d.ts is a root of the tests program), never run: it has no entry point by nature.
test("Given every script path built in code, when resolved, then it exists and a .ts one has an entry point", () => {
  const broken = ALL.filter(
    (t) =>
      !existsSync(t.target) ||
      (t.target.endsWith(".ts") && !t.target.endsWith(".d.ts") && !hasEntryPoint(t.target)),
  ).map(
    (t) =>
      `${rel(t.from)}: ${t.how} → ${rel(t.target)} ${existsSync(t.target) ? "(no entry point)" : "(missing)"}`,
  );
  expect(broken).toEqual([]);
});

test("Given a script spawned from lib/, when it fails, then its stderr is not thrown away", () => {
  // Scoped to spawns of bun scripts: a browser opener or a git probe ignoring stderr is a
  // deliberate best-effort call, but a script that errors into "ignore" is how auto-og died.
  const offenders = walk(path.join(SKILL, "lib")).flatMap((f) =>
    [...code(f).matchAll(/Bun\.spawn(?:Sync)?\(\s*\[([^\]]*)\][^)]*stderr:\s*"ignore"/gu)]
      .filter((m) => /process\.execPath|"bun"/u.test(m[1]!))
      .map((m) => `${rel(f)}: ${m[0].slice(0, 80)}`),
  );
  expect(offenders).toEqual([]);
});

test("Given the top-level scripts, when scanned, then no back-compat shim exists", () => {
  // The per-script shims duplicated `viz` and drifted from it — the dead vendor-guard hook
  // ran one. build.ts was the last, kept only until seven repos' deploy.sh moved to
  // `viz.ts publish`. A new caller gets `viz <verb>`, never a script of its own.
  const shims = readdirSync(SKILL).filter(
    (f) =>
      f.endsWith(".ts") &&
      readFileSync(path.join(SKILL, f), "utf8").includes("BACK-COMPAT ENTRY POINT"),
  );
  expect(shims).toEqual([]);
  for (const gone of ["bootstrap.ts", "manage.ts", "verify.ts", "build.ts"])
    expect(existsSync(path.join(SKILL, gone))).toBe(false);
});

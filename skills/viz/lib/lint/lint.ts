// lib/lint/lint.ts — the lint step: Oxlint with its type-aware engine (tsgolint), plus three checks Oxlint cannot do.
//
// Type-aware rules need a tsconfig.json IN the viz folder: measured, a --tsconfig pointing elsewhere is ignored
// (re-measured 2026-11-22 with oxlint 1.86 / tsgolint 7.0.2003: the flag only feeds import resolution, and running
// from a cwd that holds the config does not help either) and the same rule reports 133 hits instead of 0, because
// every type becomes `any`. A viz has no tsconfig of its own, so one is written for the length of the run and removed
// after. That is one file per viz, so lints of the same viz take turns (lockViz): two at once deleted or swapped each
// other's config mid-run (measured: 4 of 5 bursts of six gave a run bogus findings). If tsgolint cannot run (a locked-down
// Windows machine blocks the unsigned binary, tsgolint issue #876) the ordinary rules still run and the result
// says the type-aware part was skipped: a skip must never read as a pass.
//
// Any finding fails the run.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { oxlintConfig } from "./config.ts";
import { testShapes } from "./test-shape.ts";
import { isCopy } from "../copy.ts";
import { aliasKitImports } from "../server/kit-alias.ts";
import { STRICT, bareToSkill, cdnDeclarations, kitPaths } from "../verify/types.ts";

const SKILL = path.resolve(import.meta.dirname, "../..");
const OXLINT = path.join(SKILL, "node_modules/oxlint/bin/oxlint");
const TSGOLINT = path.join(
  SKILL,
  "node_modules/@oxlint-tsgolint",
  `${process.platform}-${process.arch}`,
  process.platform === "win32" ? "tsgolint.exe" : "tsgolint",
);
const TEMP_TSCONFIG = "viz-lint temporary: deleted when the lint run ends";

/** Generated and vendored code is not the author's. `.js` is out because a viz's code is TypeScript (ADR 0023). */
const IGNORE = [
  "**/node_modules/**",
  "**/vendor/**",
  "**/__screenshots__/**",
  "**/.*/**",
  "**/*.d.ts",
  "**/*.js",
  "**/*.mjs",
  "**/*.cjs",
  "**/*.jsx",
];

export type LintResult = { files: number; findings: string[]; skipped: string | null };

/** Every `.ts` under `dir` that is the author's: not a declaration file, a dot-folder, vendored or generated. */
function tsFiles(dir: string, skip: string[]): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
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
      const st = statSync(abs, { throwIfNoEntry: false }); // undefined: a dangling symlink
      if (!st) continue;
      const isDir = st.isDirectory();
      if (isDir && lstatSync(abs).isSymbolicLink()) continue; // a linked-in folder is not the viz's own
      if (isDir) walk(abs);
      else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(abs);
    }
  };
  walk(dir);
  return out.toSorted();
}

/** A disable comment must say why: `// oxlint-disable-next-line rule -- reason`. */
function bareDisables(vizDir: string, files: string[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8")
      .split("\n")
      .forEach((line, i) => {
        const m = line.match(/(?:oxlint|eslint)-disable[\w-]*(.*)$/u);
        if (!m) return;
        const [, tail = ""] = m; // group 1 always participates
        if (!/\s--\s+\S{3,}/u.test(tail))
          out.push(
            `${path.relative(vizDir, f)}:${i + 1} lint-disable without a reason: add " -- <why>"`,
          );
      });
  }
  return out;
}

/** Executable inline scripts: Oxlint skips HTML, so code left in a page would escape every rule. Import maps and data blocks are not code. */
function inlineScripts(vizDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(vizDir)
    .filter((n) => n.endsWith(".html"))
    .toSorted()) {
    const html = readFileSync(path.join(vizDir, name), "utf8");
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
      const [, attrs = "", body = ""] = m; // groups 1 and 2 always participate
      if (/\bsrc\s*=/u.test(attrs) || !body.trim()) continue;
      const type = attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/iu)?.[1]?.toLowerCase();
      if (type && type !== "module" && !/(?:java|ecma)script$/u.test(type)) continue; // importmap, application/json, …
      out.push(
        `${name}:${html.slice(0, m.index).split("\n").length} inline <script> holds code: move it to a .ts file (Oxlint does not read HTML)`,
      );
    }
  }
  return out;
}

/** The tsconfig a viz would have if it had one: verify's strictness, Node's and the DOM's types together. */
function tsconfigFor(ambient: string): string {
  return JSON.stringify({
    "//": TEMP_TSCONFIG,
    compilerOptions: {
      ...STRICT,
      noEmit: true,
      allowJs: true,
      checkJs: false,
      allowImportingTsExtensions: true,
      noPropertyAccessFromIndexSignature: false,
      types: ["node"],
      typeRoots: [path.join(SKILL, "node_modules/@types")],
      paths: { ...kitPaths, ...bareToSkill },
    },
    include: ["**/*.ts"],
    exclude: ["node_modules", "vendor"],
    files: [ambient, path.join(SKILL, "lib/testing/global.d.ts")], // the `viz` global the tests use: without it every call on it is `any`
  });
}

type Diagnostic = {
  message: string;
  code: string;
  filename: string;
  labels?: { span: { line: number; column: number } }[];
};

/** Whether the process that took `lock` is still running; a lock with no pid yet is its owner's first moments, so young ones count as held. */
function lockHeld(lock: string): boolean {
  try {
    process.kill(Number(readFileSync(path.join(lock, "pid"), "utf8")), 0);
    return true;
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "EPERM") return true; // alive, not ours to signal
    if (e instanceof Error && "code" in e && e.code === "ENOENT")
      return Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? 0) < 5000;
    return false; // ESRCH or a pid file with nonsense in it: the owner died without releasing
  }
}

/** Take the one lint slot of a viz and return its release. A directory in the OS temp folder named by the viz's real path (mkdir is atomic), holding its owner's pid: a killed run's lock is taken over, a live one is waited for. */
function lockViz(vizDir: string): () => void {
  const lock = path.join(
    os.tmpdir(),
    `viz-lint-${createHash("sha1").update(vizDir).digest("hex").slice(0, 16)}.lock`,
  );
  const giveUp = Date.now() + 10 * 60_000;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(path.join(lock, "pid"), String(process.pid));
      return () => rmSync(lock, { recursive: true, force: true });
    } catch (e) {
      if (!(e instanceof Error && "code" in e && e.code === "EEXIST")) throw e;
    }
    if (!lockHeld(lock)) rmSync(lock, { recursive: true, force: true });
    else if (Date.now() > giveUp)
      throw new Error(`another lint of ${vizDir} has run for over 10 minutes (lock ${lock})`);
    else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); // lint is synchronous: sleep, don't spin
  }
}

/** Run Oxlint over a viz (`fix`: apply its safe fixes first); null when it has no TypeScript to lint. `skip` names folders (relative to `dir`) to leave out: the skill lints its own code without the vizzes inside it. */
export function lint(dir: string, skip: string[] = [], fix = false): LintResult | null {
  const vizDir = realpathSync(dir);
  if (isCopy(vizDir)) return null; // checked at its origin (lib/copy.ts)
  const files = tsFiles(vizDir, skip);
  const own = [
    ...bareDisables(vizDir, files),
    ...inlineScripts(vizDir),
    // The skill's own tests are plain node tests; a viz's are steps (reference/testing.md).
    ...(vizDir === SKILL ? [] : testShapes(vizDir, files)),
  ];
  if (files.length === 0 && own.length === 0) return null;
  if (files.length === 0) return { files: 0, findings: own, skipped: null };
  if (!existsSync(OXLINT))
    return {
      files: files.length,
      findings: own,
      skipped: `oxlint is not installed in the viz skill — run \`npm install\` in ${SKILL}`,
    };

  if (fix)
    for (const f of files) {
      const was = readFileSync(f, "utf8"),
        now = aliasKitImports(was);
      if (now !== was) writeFileSync(f, now);
    }

  const unlock = lockViz(vizDir);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "viz-lint-"));
  const ownTsconfig = path.join(vizDir, "tsconfig.json");
  // A viz with its own tsconfig keeps it; a leftover of ours from a killed run is replaced.
  const writeOurs =
    !existsSync(ownTsconfig) || readFileSync(ownTsconfig, "utf8").includes(TEMP_TSCONFIG);
  try {
    writeFileSync(
      path.join(tmp, "oxlintrc.json"),
      JSON.stringify(oxlintConfig(path.resolve(dir) === SKILL)),
    );
    writeFileSync(
      path.join(tmp, "ambient.d.ts"),
      `declare module "https://*";\n${cdnDeclarations(files)}`,
    );
    if (writeOurs) writeFileSync(ownTsconfig, tsconfigFor(path.join(tmp, "ambient.d.ts")));
    const run = (typeAware: boolean) => {
      // To a FILE, not a pipe: oxlint exits before a pipe drains, and a big result (measured: 1.5 MB) arrives cut in half.
      const outFile = path.join(tmp, "out.json");
      const fd = openSync(outFile, "w");
      const r = spawnSync(
        process.execPath,
        [
          OXLINT,
          ...(typeAware ? ["--type-aware"] : []),
          ...(fix ? ["--fix"] : []),
          // A stale disable (its finding is gone) is a finding. Only with the type-aware engine: without it the type-aware rules did not run, so their disables would all look stale.
          ...(typeAware ? ["--report-unused-disable-directives"] : []),
          "-c",
          path.join(tmp, "oxlintrc.json"),
          "-f",
          "json",
          ...[...IGNORE, ...skip.map((d) => `${d}/**`)].flatMap((g) => ["--ignore-pattern", g]),
          vizDir,
        ],
        {
          cwd: vizDir,
          env: { OXLINT_TSGOLINT_PATH: TSGOLINT, ...process.env }, // a caller-set path wins, as for oxlint itself
          stdio: ["ignore", fd, "pipe"],
          encoding: "utf8",
        },
      );
      closeSync(fd);
      const out = readFileSync(outFile, "utf8"),
        start = out.indexOf("{");
      const parsed: unknown = start < 0 ? null : JSON.parse(out.slice(start));
      return {
        diagnostics:
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- JSON boundary: Oxlint's documented report shape
          parsed === null ? null : (parsed as { diagnostics?: Diagnostic[] }).diagnostics,
        why: ((r.stderr ?? "") + out).trim().split("\n")[0]?.slice(0, 200) ?? "",
      };
    };
    let skipped: string | null = null;
    let ran = run(true);
    if (!ran.diagnostics) {
      skipped = `type-aware lint skipped (${ran.why || "tsgolint did not run"})`;
      ran = run(false);
    }
    if (!ran.diagnostics)
      return { files: files.length, findings: own, skipped: `lint did not run: ${ran.why}` };
    // Only the viz's own files: a symlinked or path-mapped file from the skill is the skill's to fix, as in typecheck().
    // Oxlint names files relative to its cwd, which is the viz.
    // Real paths: a file reached through a symlinked folder (a poster's `skill/` link) resolves outside the viz.
    const real = (p: string) => (existsSync(p) ? realpathSync(p) : p);
    const root = real(vizDir);
    const found = ran.diagnostics
      .map((d) => ({ d, rel: path.relative(root, real(path.resolve(vizDir, d.filename))) }))
      .filter((x) => !x.rel.startsWith(".."))
      .map(({ d, rel }) => {
        const at = d.labels?.[0]?.span;
        const hint = d.code?.includes("no-absolute-path")
          ? ' (the kit is imported as "@viz/kit" / "@viz/kit/<file>.js": `viz lint --fix` rewrites it)'
          : "";
        return `${rel}:${at?.line ?? 0}:${at?.column ?? 0} ${d.code ?? "unused-disable"} — ${d.message}${hint}`;
      });
    return { files: files.length, findings: [...found, ...own], skipped };
  } finally {
    if (writeOurs) rmSync(ownTsconfig, { force: true });
    rmSync(tmp, { recursive: true, force: true });
    unlock();
  }
}

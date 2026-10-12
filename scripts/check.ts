#!/usr/bin/env bun
// Every check in this repo, in one table: which files a check covers and the command that runs it.
//
//   bun scripts/check.ts --staged   the checks the staged files touch (what pre-commit runs)
//   bun scripts/check.ts --all      every check, over every tracked file
//
// A row's `match` runs against repo-relative paths; its first capture group, when it has one, is the
// unit the command runs once per (a viz page, a skill). A tracked test file that no row matches fails
// the run, so a new suite cannot be silently left out. Add a row for it.
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const REPO = join(import.meta.dir, "..");
const VIZ_SERVER = "http://127.0.0.1:5180";

type Ctx = { root: string; staged: boolean };
type Row = {
  name: string;
  match: RegExp;
  cwd?: string;
  cmd: (unit: string, ctx: Ctx) => string[];
  warnOnly?: true; // reports, never fails the run
  vizServer?: true; // needs the viz server: skipped with a warning when staged, a failure under --all
  alone?: true; // timing-sensitive: runs after the parallel jobs, with nothing beside it
  skip?: (unit: string) => boolean;
};

const ROWS: Row[] = [
  {
    name: "viz verify",
    match: /^((?:skills\/viz\/)?viz-pages\/[^_/][^/]*)\//,
    cwd: "skills/viz",
    cmd: (page) => ["bun", "viz.ts", "verify", `${VIZ_SERVER}/${relative(process.env.HOME!, REPO)}/${page}/`],
    vizServer: true,
    // A mirror is a copy of a viz kept elsewhere; its origin is what gets verified (viz ADR 0006). Its
    // smoke render calls the origin's api/, which nothing serves at the mirror's path.
    skip: (page) => existsSync(join(REPO, page, ".mirror.json")),
  },
  {
    name: "viz suite",
    match: /^skills\/viz\//,
    cwd: "skills/viz",
    cmd: () => ["bun", "test"],
    alone: true, // its server and git tests have 5s timeouts that four browser verifies beside it blow
  },
  {
    name: "skills check",
    match: /^(skills\/[^/]+)\//,
    cmd: (skill) => ["python3", "scripts/skills-check.py", skill],
    warnOnly: true,
  },
  {
    // Judges what the commit will contain: under --staged it runs on the index exported to a temp dir.
    name: "posters",
    match: /^(?:skills\/[^/]+\/SKILL\.md|tools\/[^/]+\/README\.md|viz-pages\/(?:skill|tool)-[^/]+\/|scripts\/(?:check-posters|manifest|install-strip)\.ts)/,
    cmd: (_, { root }) => ["bun", join(root, "scripts/check-posters.ts")],
  },
  { name: "ai-tidemark", match: /^(?:tools|viz-pages)\/ai-tidemark\//, cwd: "tools/ai-tidemark", cmd: () => ["bun", "test"] },
  { name: "kelpie", match: /^tools\/kelpie\//, cwd: "tools/kelpie", cmd: () => ["bun", "test"] },
  {
    name: "pr-split",
    match: /^(?:tests\/pr-split\.test\.ts|skills\/(?:pr-split|pr-viz)\/)/,
    cmd: () => ["bun", "test", "tests/pr-split.test.ts"],
  },
  { name: "overlays", match: /^(?:tests\/overlays\.sh|install\.ts)$/, cmd: () => ["bash", "tests/overlays.sh"] },
  {
    name: "ttyimgspool",
    match: /^(?:tools\/ttyimgspool\/|tests\/ttyimgspool-[a-z]+\.sh)/,
    cmd: () => ["bash", "-c", "for t in tests/ttyimgspool-*.sh; do bash \"$t\" || exit 1; done"],
    alone: true, // drives a real pty with fixed waits; under parallel load a keypress lands late
  },
  { name: "genui-viz", match: /^skills\/genui-viz\//, cwd: "skills/genui-viz", cmd: () => ["bun", "test"] },
  {
    name: "transcribe-media",
    match: /^skills\/transcribe-media\//,
    cmd: () => ["bash", "skills/transcribe-media/tests/run-tests.sh"],
  },
];

const TEST_FILE = /(?:\.test\.[jt]s|\/test_[^/]+\.py|^tests\/[^/]+\.sh)$/;
const JOBS = 4;

const git = (...args: string[]) =>
  Bun.spawnSync(["git", "-C", REPO, ...args], { env: cleanEnv() }).stdout.toString().split("\n").filter(Boolean);

// git exports GIT_DIR / GIT_INDEX_FILE to hooks; a suite that makes throwaway repos would inherit them
// and run its git against THIS repo's index.
function cleanEnv() {
  const env = { ...process.env };
  for (const k of ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX"]) delete env[k];
  return env;
}

const mode = process.argv[2];
if (mode !== "--staged" && mode !== "--all") {
  console.error("usage: bun scripts/check.ts --staged | --all");
  process.exit(2);
}
const staged = mode === "--staged";
const files = staged ? git("diff", "--cached", "--name-only", "--diff-filter=d") : git("ls-files");

const orphans = files.filter((f) => TEST_FILE.test(f) && !ROWS.some((r) => r.match.test(f)));
const jobs = ROWS.flatMap((row) => {
  const units = new Set(files.flatMap((f) => row.match.exec(f)?.[1] ?? (row.match.test(f) ? [row.name] : [])));
  return [...units].filter((unit) => !row.skip?.(unit)).map((unit) => ({ row, unit }));
});

let root = REPO;
if (staged && jobs.some((j) => j.row.name === "posters")) {
  root = mkdtempSync(join(tmpdir(), "check-index-"));
  Bun.spawnSync(["git", "-C", REPO, "checkout-index", "-a", "-f", `--prefix=${root}/`], { env: cleanEnv() });
}
const vizUp = !jobs.some((j) => j.row.vizServer) || (await fetch(VIZ_SERVER, { signal: AbortSignal.timeout(2000) }).then(() => true, () => false));

let failed = orphans.length > 0;
for (const f of orphans) console.error(`✗ unchecked test file: ${f} — add a row for it in scripts/check.ts`);

async function run({ row, unit }: (typeof jobs)[number]) {
  const label = unit === row.name ? row.name : `${row.name}: ${unit}`;
  if (row.vizServer && !vizUp) {
    if (staged) return console.error(`⚠ ${label} SKIPPED — the viz server is not answering on :5180 (not a pass)`);
    failed = true;
    return console.error(`✗ ${label} — the viz server is not answering on :5180`);
  }
  // One file for both streams, so the output keeps its order; printed whole when the job ends.
  const log = join(mkdtempSync(join(tmpdir(), "check-")), "out");
  const fd = openSync(log, "w");
  const start = Date.now();
  const proc = Bun.spawn(row.cmd(unit, { root, staged }), {
    cwd: join(REPO, row.cwd ?? ""),
    env: cleanEnv(),
    stdio: ["ignore", fd, fd],
  });
  const code = await proc.exited;
  closeSync(fd);
  const ok = code === 0;
  if (!ok && !row.warnOnly) failed = true;
  const mark = ok ? "✓" : row.warnOnly ? "⚠" : "✗";
  const out = readFileSync(log, "utf8").trimEnd();
  rmSync(join(log, ".."), { recursive: true });
  console.error(`${mark} ${label} (${((Date.now() - start) / 1000).toFixed(0)}s)`);
  if (!ok && out) console.error(out.replace(/^/gm, "    "));
}

const queue = jobs.filter((j) => !j.row.alone);
await Promise.all(Array.from({ length: JOBS }, async () => {
  while (queue.length > 0) await run(queue.shift()!);
}));
for (const j of jobs.filter((j) => j.row.alone)) await run(j);
if (root !== REPO) rmSync(root, { recursive: true });
if (jobs.length === 0 && orphans.length === 0) console.error("· nothing to check");
process.exit(failed ? 1 : 0);

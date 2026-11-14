#!/usr/bin/env bun
// classify.ts — what a reviewer reads differently: prod | test | lock | binary | docs, by path.
// build.ts classes hunks.json with it; run on its own it prints a change's size line.
//
//   bun classify.ts <repo> <range> [--classify '{"resources/":"binary"}']
//     → Size: 23 files, 529 lines to read (310 code, 219 tests)
//
// Lines to read are added + removed lines of code, tests and docs; lockfiles and binaries
// are counted as files but never as lines.

export type Kind = "prod" | "test" | "lock" | "binary" | "docs";

/** `classify` ({ "path substring": kind }) wins; then binaries, lockfiles, tests, docs; the rest is prod. */
export function kindOf(file: string, binary = false, classify: Record<string, string> = {}): Kind {
  for (const [pat, kind] of Object.entries(classify)) if (file.includes(pat)) return kind as Kind;
  // Fixtures by extension: a hand-written text PDF diffs as text but is still a fixture, not code.
  if (binary || /\.(pdf|png|jpe?g|gif|webp|svg|ico|zip|gz|mp[34]|wav|docx?|xlsx?|pptx?)$/i.test(file)) return "binary";
  if (/(^|\/)(uv|poetry|Cargo|Gemfile|composer)\.lock$|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$|bun\.lockb?$|go\.sum$/.test(file)) return "lock";
  if (/(^|\/)(tests?|__tests__|spec)\/|(^|\/)test_[^/]*$|_test\.\w+$|\.(test|spec)\.\w+$/.test(file)) return "test";
  if (/\.(md|mdx|rst|txt)$/i.test(file)) return "docs";
  return "prod";
}

/** The size line from `git diff --numstat` output (a binary file shows "-\t-"). */
export function sizeLine(numstat: string, classify: Record<string, string> = {}) {
  const n: Record<Kind, number> = { prod: 0, test: 0, docs: 0, lock: 0, binary: 0 };
  const rows = numstat.trim().split("\n").filter(Boolean).map((r) => r.split("\t"));
  for (const [a, d, raw] of rows) {
    const file = raw.replace(/\{[^}]* => ([^}]*)\}/, "$1").replace(/^.* => /, "").replace("//", "/"); // a rename, by its new path
    const k = kindOf(file, a === "-", classify);
    if (k !== "lock" && k !== "binary") n[k] += +a + +d;
  }
  const parts = [[n.prod, "code"], [n.test, "tests"], [n.docs, "docs"]].filter(([x]) => x).map(([x, w]) => `${x} ${w}`);
  return `Size: ${rows.length} files, ${n.prod + n.test + n.docs} lines to read${parts.length ? ` (${parts.join(", ")})` : ""}`;
}

if (import.meta.main) {
  const [repo, range] = process.argv.slice(2);
  const i = process.argv.indexOf("--classify");
  if (!repo || !range) { console.error("usage: classify.ts <repo> <range> [--classify '<json>']"); process.exit(1); }
  // A rename is one row ("old => new"), counted by the lines it changes, not the file's length.
  const p = Bun.spawnSync(["git", "-C", repo, "-c", "core.quotePath=false", "diff", "--numstat", range], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  console.log(sizeLine(p.stdout.toString(), i > 0 ? JSON.parse(process.argv[i + 1]) : {}));
}

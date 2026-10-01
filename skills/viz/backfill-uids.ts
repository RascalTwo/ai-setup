#!/usr/bin/env bun
// One-off migration for ADR 0014: stamp a durable `viz:uid` into every viz that predates it.
//
//   bun backfill-uids.ts            # dry run — show what would change, write nothing
//   bun backfill-uids.ts --write    # stamp
//   bun backfill-uids.ts --write --commit   # stamp and commit, one commit per repo
//
// Idempotent: a viz that already has a uid is skipped, so re-running is safe and this can
// be left in place to catch anything created by an older copy of the skill.
//
// Deliberately NOT part of `viz` proper. It is a migration with a finite lifetime, and
// wiring a one-shot schema fix into the daily CLI is how one-shot fixes become permanent.

import { BUNDLED } from "./discovery.ts";
import { readUid } from "./lib/publish/meta.ts";
import { mintUid, setUidMeta } from "./lib/create/uid.ts";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const write = process.argv.includes("--write");
const commit = process.argv.includes("--commit");

const CENTRAL = path.join(HOME, ".agents", "state", "viz");
const registry = path.join(CENTRAL, ".discovered.json");
// BUNDLED (the skill's own viz-pages) is seeded in discovery.ts code, not in
// .discovered.json — omitting it silently skipped the bundled self-portrait.
const containers = [...new Set([CENTRAL, BUNDLED, ...(existsSync(registry) ? JSON.parse(readFileSync(registry, "utf8")) : [])])]
  .filter((c: string) => existsSync(c));

const sh = (args: string[], cwd: string) => Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
const repoOf = (dir: string) => {
  const p = sh(["git", "-C", dir, "rev-parse", "--show-toplevel"], dir);
  return p.success ? p.stdout.toString().trim() : "";
};

let stamped = 0, already = 0, noIndex = 0;
// Track the exact dirs touched per repo. `git add -A -- .` would sweep in unrelated
// dirty files from the host repo, which is somebody's client repo half the time.
const byRepo = new Map<string, string[]>();

for (const container of containers) {
  for (const e of readdirSync(container, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const dir = path.join(container, e.name);
    const idx = path.join(dir, "index.html");
    if (!existsSync(idx)) { noIndex++; continue; }          // not a viz (e.g. _thumbs/)
    // A mirror (.mirror.json) and a VENDORED copy (.vendored.json) are both copies of
    // some origin viz — they are the same viz, so they must not mint a second identity.
    // Vendored copies additionally must stay byte-identical to their origin; stamping
    // one tripped the vendor-drift pre-commit guard, which is how this was caught.
    if (existsSync(path.join(dir, ".mirror.json"))) continue;
    if (existsSync(path.join(dir, ".vendored.json"))) continue;
    if (readUid(dir)) { already++; continue; }

    const uid = mintUid();
    const rel = path.relative(HOME, dir);
    if (write) {
      writeFileSync(idx, setUidMeta(readFileSync(idx, "utf8"), uid));
      const repo = repoOf(dir);
      if (repo) byRepo.set(repo, [...(byRepo.get(repo) ?? []), path.join(dir, "index.html")]);
    }
    console.log(`  ${write ? "stamped" : "would stamp"}  ${uid}  ${rel}`);
    stamped++;
  }
}

console.log(`\n${write ? "stamped" : "would stamp"} ${stamped} · already had one ${already} · skipped ${noIndex} non-viz dir(s)`);

if (write && commit) {
  console.log("");
  for (const [repo, files] of byRepo) {
    const n = files.length;
    const add = sh(["git", "-C", repo, "add", "--", ...files], repo);
    if (!add.success) { console.log(`  ✗ ${path.basename(repo)}: git add failed`); continue; }
    const msg = `viz: backfill durable viz:uid (ADR 0014)\n\nStamps ${n} viz(es) with a random, never-recomputed identity so anything\nthat accumulates knowledge about a viz survives \`viz move\`.\n`;
    const c = sh(["git", "-C", repo, "commit", "-q", "-m", msg], repo);
    console.log(`  ${c.success ? "✓" : "✗"} ${path.basename(repo)}: ${n} viz(es)`);
  }
}
if (!write) console.log("\nDry run. Re-run with --write (add --commit to commit per repo).");

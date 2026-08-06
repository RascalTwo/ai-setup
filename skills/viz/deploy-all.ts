#!/usr/bin/env bun
// One command to deploy EVERY viz-pages container that's set up for it.
//
//   bun ~/.claude/skills/viz/deploy-all.ts
//
// "Set up" = the container root has an executable deploy.sh (see the template
// dropped into each repo's viz-pages/). Reuses the skill's own discovery — the
// same .discovered.json the server maintains — refreshed first so a brand-new
// repo is never silently missed.
//
// GUARD: a container whose viz-pages subtree is not clean-committed (any
// untracked / unstaged / uncommitted change) is SKIPPED. We only ever deploy
// committed state, so what ships always matches what's in git.
//
// Exit 0 = every attempted deploy succeeded; 1 = at least one failed.
import { allContainers, writeRegistry, deepScan } from "./discovery.ts";
import { existsSync, statSync } from "fs";
import path from "path";

// Freshen the registry so a newly-created repo isn't missed by a stale cache.
await writeRegistry(await deepScan());

const results: { c: string; status: string }[] = [];

for (const c of allContainers()) {
  const sh = path.join(c, "deploy.sh");
  if (!existsSync(sh)) continue; // not set up for deploy — skip silently
  if (!(statSync(sh).mode & 0o111)) {
    results.push({ c, status: "⚠️  deploy.sh not executable (chmod +x it)" });
    continue;
  }
  // git-clean gate: porcelain status of the viz-pages subtree must be empty.
  const st = Bun.spawnSync(["git", "-C", c, "status", "--porcelain", "."]);
  if (!st.success) {
    results.push({ c, status: "⚠️  not a git repo — skipped" });
    continue;
  }
  if (st.stdout.toString().trim()) {
    results.push({ c, status: "⏭️  DIRTY (commit viz-pages first) — skipped" });
    continue;
  }
  console.log(`\n🚀 ${c}`);
  const run = Bun.spawnSync(["bash", sh], { cwd: c, stdout: "inherit", stderr: "inherit" });
  results.push({ c, status: run.success ? "✅ deployed" : "❌ FAILED" });
}

console.log("\n──────── summary ────────");
if (!results.length) console.log("No containers with a deploy.sh found.");
for (const r of results) console.log(`${r.status}  ${r.c}`);
process.exit(results.some((r) => r.status.startsWith("❌")) ? 1 : 0);

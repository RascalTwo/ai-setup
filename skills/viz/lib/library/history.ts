// lib/library/history.ts — Per-viz git history and rollback, central or repo-local.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- ops: history, rollback, and the server ----
//
// These were documented in reference/ops.md as raw git/curl/kill one-liners, which meant
// every caller re-derived them and the MCP wrapper ended up hand-rolling its own copy.
// They live here now so there is one implementation. gitRoot() makes central and
// repo-local identical: a viz's history is just its path inside whatever repo contains it.

import { die } from "../../cli.ts";
import path from "node:path";
import { gitRoot } from "./git.ts";
import { Viz } from "./viz.ts";

export function cmdHistory(viz: Viz, flags: Record<string, string | boolean>): void {
  const root = gitRoot(viz.dir);
  if (!root) die(`ERROR: ${viz.dir} is not inside a git repo — nothing to show.`, 2);
  const rel = path.relative(root, viz.dir);
  const n = typeof flags.n === "string" ? flags.n : "20";
  const res = Bun.spawnSync(["git", "-C", root, "log", `-${n}`, "--oneline", "--", rel]);
  if (res.exitCode !== 0) die(res.stderr.toString().trim() || "git log failed", res.exitCode);
  const out = res.stdout.toString().trim();
  console.log(`repo: ${root}\npath: ${rel}\n`);
  console.log(out || "(no commits touching this viz)");
}

export function cmdRollback(viz: Viz, hash: string | undefined): string[] {
  if (!hash) die("ERROR: missing <commit-hash>. Run `history` first to pick one.", 2);
  const root = gitRoot(viz.dir);
  if (!root) die(`ERROR: ${viz.dir} is not inside a git repo — nothing to roll back to.`, 2);
  const rel = path.relative(root, viz.dir);
  const res = Bun.spawnSync(["git", "-C", root, "checkout", hash, "--", rel]);
  if (res.exitCode !== 0) die(res.stderr.toString().trim() || "git checkout failed", res.exitCode);
  console.log(`✓ rolled ${viz.slug} back to ${hash} (browser auto-reloads)`);
  return [viz.dir];
}

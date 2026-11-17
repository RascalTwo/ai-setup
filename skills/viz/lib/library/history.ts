// lib/library/history.ts — Per-viz git history and rollback, central or repo-local.
//
// Extracted from the since-deleted manage.ts, which was 878 lines of everything.

// ---- ops: history, rollback, and the server ----
//
// These were documented in reference/ops.md as raw git/curl/kill one-liners, which meant
// every caller re-derived them and the MCP wrapper ended up hand-rolling its own copy.
// They live here now so there is one implementation. gitRoot() makes central and
// repo-local identical: a viz's history is just its path inside whatever repo contains it.

import { die, emit } from "../../cli.ts";
import path from "node:path";
import { gitRoot } from "./git.ts";
import type { Viz } from "./viz.ts";

export function cmdHistory(viz: Viz, flags: Record<string, string | boolean>): void {
  const root = gitRoot(viz.dir);
  if (!root) die(`ERROR: ${viz.dir} is not inside a git repo — nothing to show.`, 2);
  const rel = path.relative(root, viz.dir);
  const n = typeof flags.n === "string" ? flags.n : "20";
  // Tab-separated so a subject containing spaces (all of them) splits cleanly.
  const res = Bun.spawnSync([
    "git",
    "-C",
    root,
    "log",
    `-${n}`,
    "--format=%H%x09%aI%x09%s",
    "--",
    rel,
  ]);
  if (res.exitCode !== 0) die(res.stderr.toString().trim() || "git log failed", res.exitCode);
  const commits = res.stdout
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash = "", date, ...subject] = l.split("\t");
      return { hash, date, subject: subject.join("\t") };
    });
  emit(flags, commits, () => {
    console.log(`repo: ${root}\npath: ${rel}\n`);
    console.log(
      commits.map((c) => `${c.hash.slice(0, 7)} ${c.subject}`).join("\n") ||
        "(no commits touching this viz)",
    );
  });
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

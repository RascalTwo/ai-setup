// lib/library/git.ts — Surgical, fail-soft staging and commits — per repo, since a cross-repo move spans two.
//
// Extracted from manage.ts, which was 878 lines of everything.

// ---- git: surgical staging, fail-soft, per-repo (a cross-repo move spans two) ----
import { start } from "../../server-control.ts";
import { existsSync } from "node:fs";
import path from "node:path";
export function gitRoot(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

export function commitPaths(paths: string[], msg: string): void {
  const byRepo = new Map<string, string[]>();
  for (const p of paths) {
    const root = gitRoot(path.dirname(p));
    if (!root) continue;
    const list = byRepo.get(root) ?? [];
    list.push(p);
    byRepo.set(root, list);
  }
  if (byRepo.size === 0) {
    console.error("  ⚠️  not a git repo — change saved, not committed.");
    return;
  }
  for (const [root, ps] of byRepo) {
    try {
      // Drop gitignored paths (mirrors.json is local-only by policy) so we never
      // try to commit something git refuses to track.
      const rels = ps
        .map((p) => path.relative(root, p))
        .filter((rel) => Bun.spawnSync(["git", "-C", root, "check-ignore", "-q", "--", rel]).exitCode !== 0);
      if (rels.length === 0) continue;
      if (Bun.spawnSync(["git", "-C", root, "add", "--", ...rels]).exitCode !== 0) {
        console.error(`  ⚠️  git add failed in ${root} — change saved, not committed.`);
        continue;
      }
      const commit = Bun.spawnSync(["git", "-C", root, "commit", "-m", msg, "--", ...rels]);
      if (commit.exitCode !== 0) {
        console.error(`  ⚠️  git commit: ${commit.stderr.toString().trim() || "nothing committed"}`);
      } else {
        console.log(`  ✓ committed in ${path.basename(root)}: ${msg}`);
      }
    } catch (e) {
      console.error(`  ⚠️  git error (${(e as Error).message}) — change saved, not committed.`);
    }
  }
}

export function maybeCommit(paths: string[], noCommit: boolean, msg: string): void {
  if (noCommit) {
    console.log("  (--no-commit: filesystem change kept, not committed)");
    return;
  }
  commitPaths(paths, msg);
}

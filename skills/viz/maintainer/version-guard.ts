// lib/version-guard.ts — "did you forget to bump?" as a check, not a convention.
//
// WHY NOT IN squash-to-main.sh: that script and scripts/drop-guard-pre-push.sh both
// declare themselves identical across every full-tree repo. Putting skill-specific logic
// in a file whose whole value is being the same everywhere is how it drifts — this repo's
// own CLAUDE.md records squash-to-main's branch name sitting stale for months because
// nothing executable checked it. So the guard lives with the thing it guards.

import path from "node:path";
import { VERSION, SEMVER } from "../lib/version.ts";

const SKILL_DIR = path.dirname(import.meta.dir);
export const TAG_PREFIX = "viz-v";

function git(args: string[]): string | null {
  const p = Bun.spawnSync(["git", "-C", SKILL_DIR, ...args], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString().trim() : null;
}

export type GuardResult =
  | { ok: true; reason: string }
  | { ok: false; reason: string; released: string; changed: string[] };

/**
 * Fails when the skill has changed since the last release but the version has not moved.
 *
 * Deliberately NOT "every commit must bump" — most commits are docs, and building 147MB
 * of bundles per commit is waste. The rule is only that you cannot SHIP a change under a
 * version that already shipped something else.
 */
export function checkVersionBumped(): GuardResult {
  if (!SEMVER.test(VERSION)) {
    return { ok: false, reason: `package.json version "${VERSION}" is not semver`, released: "", changed: [] };
  }
  // `gh release create` tags on the REMOTE, so a purely local `git tag --list` reports
  // "no release yet" immediately after publishing one — which is exactly when the guard
  // most needs to be right. Sync tags first; best-effort, so being offline degrades to
  // whatever is already local rather than failing the check.
  git(["fetch", "--tags", "--quiet"]);
  const tags = (git(["tag", "--list", `${TAG_PREFIX}*`, "--sort=-v:refname"]) ?? "").split("\n").filter(Boolean);
  if (tags.length === 0) return { ok: true, reason: "no release yet — nothing to compare against" };

  const latest = tags[0];
  const released = latest.slice(TAG_PREFIX.length);
  // Committed changes since the tag, PLUS anything uncommitted — because stage() copies
  // files off disk, so a dirty tree ships whether or not it was committed. Comparing
  // only committed state would let an uncommitted edit into a bundle unguarded.
  const changed = [
    ...(git(["diff", "--name-only", `${latest}..HEAD`, "--", "."]) ?? "").split("\n"),
    // porcelain is two status chars then whitespace then the path; slicing a fixed
    // offset ate a character on some statuses ("kills/viz/..."), so strip by shape.
    ...(git(["status", "--porcelain", "--", "."]) ?? "").split("\n").map((l) => l.slice(2).trim()),
  ]
    .filter(Boolean)
    // Bundles are built from source; a changed lockfile alone is not a user-visible change.
    .filter((f) => !f.endsWith("bun.lock"));

  const unique = [...new Set(changed)];
  if (unique.length === 0) return { ok: true, reason: `no changes since ${latest}` };
  if (VERSION === released) {
    return {
      ok: false,
      reason: `${unique.length} file(s) changed since ${latest}, but package.json is still ${VERSION}`,
      released,
      changed: unique,
    };
  }
  return { ok: true, reason: `${VERSION} > ${released}, ${unique.length} file(s) changed` };
}

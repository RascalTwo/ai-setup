#!/usr/bin/env bun
// Re-stamp every vendored runtime from the skill's canonical copy.
//
//   bun sync-runtimes.ts [--dry-run]
//
// ADR 0002 deferred this ("a cross-repo `sync-runtimes` is deferred, and will reuse this
// same re-stamp"). A vendored runtime is a copy, so it goes stale the moment the skill
// moves; nothing told you, and the copies sat months behind — one still shipped the
// EventSource hot-reload client that wedges after six open tabs.
//
// REFRESHES ONLY, NEVER CREATES. A .runtime/ exists because someone passed --runtime, and
// that opt-in is the decision about whether this repo needs one; a sweeper that created
// them would quietly undo it and put the runtime back into all ten repos.
//
// Does not touch git. Every target is somebody's repo — often a client's — so the diff is
// left for a human to read and commit, the same contract bootstrap keeps ("we did NOT
// commit"). Run --dry-run first if you want the list before the writes.

import { existsSync } from "node:fs";
import path from "node:path";
import { allContainers } from "./discovery.ts";
import { parseFlags, bool } from "./cli.ts";
import { vendorRuntime } from "./vendor-runtime.ts";

const SKILL = import.meta.dir;
const SYNC_USAGE =
  "usage: bun sync-runtimes.ts [--dry-run]\n" +
  "\n" +
  "  Re-stamp every vendored viz-pages/.runtime/ copy from this skill.\n" +
  "  --dry-run   report what would change, write nothing";
const { flags: syncFlags } = parseFlags(process.argv.slice(2), {
  known: ["dry-run", "help"],
  usage: SYNC_USAGE,
});
if (bool(syncFlags, "help")) {
  console.log(SYNC_USAGE);
  process.exit(0);
}
const dryRun = bool(syncFlags, "dry-run");

// Does this entry point actually resolve? The one guard that matters. Stamping copies
// whatever is on disk, and a skill dir caught mid-edit can be internally inconsistent —
// this bit for real on 2026-08-17, when recordings.ts had already dropped an export that
// server.ts still imported and three repos got a runtime that would not boot at all.
// A copy that doesn't start is strictly worse than a stale one that does.
// process.execPath, not "bun": under launchd there is no login PATH, so a bare "bun"
// is ENOENT and the whole sweep dies on the first check. Caught only because this was
// tested through a real `launchctl kickstart` rather than from an interactive shell —
// from a shell it passes, which is how it would have rotted unnoticed.
async function resolves(entry: string): Promise<boolean> {
  const p = Bun.spawn([process.execPath, "build", "--target=bun", entry, "--outfile=/dev/null"], {
    stdout: "ignore",
    stderr: "ignore",
  });
  return (await p.exited) === 0;
}

if (!(await resolves(path.join(SKILL, "server.ts")))) {
  console.error(
    `ERROR: ${path.join(SKILL, "server.ts")} does not resolve — refusing to stamp a broken\n` +
      `runtime into anyone's repo. Fix the skill (mid-edit?), then re-run.`,
  );
  process.exit(1);
}

// Deliberately the registry, not a filesystem crawl: ADR 0010 rejected scanning as
// authority ("the obvious-but-wrong fix"). existsSync drops registry entries whose
// directory is gone.
const targets = allContainers()
  .map((c) => path.join(c, ".runtime"))
  .filter((rt) => existsSync(rt));

if (targets.length === 0) {
  console.log("No vendored runtimes found. Nothing to sync.");
  process.exit(0);
}

console.log(
  `${dryRun ? "Would re-stamp" : "Re-stamping"} ${targets.length} vendored runtime${targets.length === 1 ? "" : "s"} from ${SKILL}\n`,
);

let failed = 0;
for (const rt of targets) {
  const label = rt.replace(process.env.HOME ?? "", "~");
  if (dryRun) {
    console.log(`  would stamp  ${label}`);
    continue;
  }
  vendorRuntime(SKILL, rt);
  if (await resolves(path.join(rt, "server.ts"))) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}  — stamped copy does NOT resolve, look at it before committing`);
    failed++;
  }
}

if (!dryRun) {
  console.log(
    `\n${targets.length - failed}/${targets.length} stamped clean.` +
      (failed ? `  ${failed} FAILED.` : "") +
      `\nNothing was committed — review each repo's diff and commit it there.`,
  );
}
process.exit(failed ? 1 : 0);

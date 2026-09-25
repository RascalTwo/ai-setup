#!/usr/bin/env bun
// release.ts — the one viz release: every target, or none. Run by scripts/after-drop.sh on each
// squash-to-main, and by hand the same way.
//
// Bumping "version" in package.json IS the decision to release; a drop is only the moment it
// happens. So: bumped → ship everything; changed but not bumped → say so loudly and ship
// nothing; unchanged → nothing to say.
//
// ORDER: the Gem goes first because release-mcpb creates the viz-v<version> tag, and the tag is
// what marks a version as released. Tagging first would let a failed Gem publish be skipped for
// good on the next run; this way a failure anywhere leaves the version untagged, and re-running
// retries everything (a Gem publish is an idempotent in-place update).

import path from "node:path";
import { VERSION } from "../lib/version.ts";
import { checkVersionBumped } from "./version-guard.ts";

const SKILL_DIR = path.dirname(import.meta.dir);

function run(cmd: string[]): void {
  console.error(`\n$ ${cmd.join(" ")}`);
  const p = Bun.spawnSync(cmd, { cwd: SKILL_DIR, stdout: "inherit", stderr: "inherit" });
  if (p.exitCode !== 0) {
    console.error(`\n✗ viz release ${VERSION} stopped at: ${cmd.join(" ")} — nothing was tagged; re-run release.ts`);
    process.exit(1);
  }
}

const guard = checkVersionBumped();
if (!guard.ok) {
  const { reason, released, changed } = guard;
  console.error(
    `\n${"!".repeat(72)}\n  viz NOT released: ${reason}\n  Bump "version" in skills/viz/package.json above ${released} to ship:\n    ` +
      changed.slice(0, 8).join("\n    ") + (changed.length > 8 ? `\n    …and ${changed.length - 8} more` : "") +
      `\n${"!".repeat(72)}\n`,
  );
  process.exit(0); // not a failure: the drop itself succeeded
}
if (guard.reason.startsWith("no ")) {
  console.error(`viz: ${guard.reason} — nothing to release`);
  process.exit(0);
}

console.error(`viz: releasing ${VERSION} (${guard.reason})`);
run(["bun", "maintainer/build-gem.ts"]);
run(["uv", "run", "maintainer/publish-gem.py"]);
run(["bun", "maintainer/release-mcpb.ts"]);
console.error(`\n✓ viz ${VERSION} released: Gemini Gem + .mcpb bundles`);

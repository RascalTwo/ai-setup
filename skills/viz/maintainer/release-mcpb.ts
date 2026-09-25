#!/usr/bin/env bun
// release-mcpb.ts — build the three .mcpb bundles and publish them as a GitHub Release.
//
// WHY RELEASES AND NOT A BRANCH: a branch is part of the git object database, so every
// `git clone` of this repo would pull ~130MB of binaries nobody asked for — and
// force-pushing only moves the ref, the objects linger until GitHub garbage-collects.
// Release assets live in separate blob storage and never touch a clone, so the repo
// stays the size it is. GitHub's limits are 2 GiB per file and 1000 assets per release,
// with no total size or bandwidth cap on public repos.
//
// WHY ONE MACHINE CAN BUILD ALL THREE: bun publishes per-platform binaries as npm
// packages (@oven/bun-darwin-aarch64 and friends), so there is no cross-platform CI
// matrix to maintain — we fetch the target's binary and ship it inside the bundle.
//
// RETENTION: old releases are pruned to --keep (default 3). They are fully mutable —
// `gh release delete` and `gh release delete-asset` both exist — so nothing is stuck
// out there, and the list stays readable instead of accreting every version forever.

import { existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import path from "node:path";
import { VERSION } from "../lib/version.ts";
import { stage } from "./build-mcpb.ts";
import { checkVersionBumped } from "./version-guard.ts";

const SKILL_DIR = path.dirname(import.meta.dir);
const DIST = path.join(SKILL_DIR, ".mcpb-dist");
const TAG = `viz-v${VERSION}`;

/** Tag prefix, so this skill's releases never collide with anything else in the repo. */
const TAG_PREFIX = "viz-v";

type Platform = "darwin" | "win32" | "linux";
/** npm packages holding each target's prebuilt bun. macOS gets both, then lipo. */
const BUN_PKGS: Record<Platform, string[]> = {
  darwin: ["@oven/bun-darwin-aarch64", "@oven/bun-darwin-x64"],
  win32: ["@oven/bun-windows-x64"],
  linux: ["@oven/bun-linux-x64"],
};

async function sh(cmd: string[], cwd?: string): Promise<string> {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  if ((await p.exited) !== 0) throw new Error(`${cmd.join(" ")}\n${err || out}`);
  return out.trim();
}

/** Download one @oven/bun-* package and return the path to the binary inside it. */
async function fetchBun(pkg: string, version: string, into: string): Promise<string> {
  mkdirSync(into, { recursive: true });
  const tgz = (await sh(["npm", "pack", `${pkg}@${version}`, "--silent"], into)).split("\n").pop()!.trim();
  await sh(["tar", "-xzf", tgz], into);
  for (const name of ["bun", "bun.exe"]) {
    const p = path.join(into, "package", "bin", name);
    if (existsSync(p)) return p;
  }
  throw new Error(`no bun binary inside ${pkg}`);
}

/**
 * macOS ships ONE bundle because the manifest distinguishes OS and not architecture,
 * so an Intel and an Apple Silicon bundle would be indistinguishable to the installer.
 * lipo merges both into a single binary that runs natively on either.
 */
async function universalMac(arm: string, x64: string, out: string): Promise<string> {
  await sh(["lipo", "-create", "-output", out, arm, x64]);
  return out;
}

async function buildBundle(platform: Platform, bunVersion: string): Promise<string> {
  const work = path.join(DIST, `_bun-${platform}`);
  rmSync(work, { recursive: true, force: true });
  // Cleaned again at the end of this function: a bun binary is 58-110 MB and the staged
  // tree another ~50, so leaving them behind costs ~400 MB PER RUN. A few builds during
  // development had left 1.2 GB sitting in .mcpb-dist.
  const bins: string[] = [];
  for (const pkg of BUN_PKGS[platform]) {
    bins.push(await fetchBun(pkg, bunVersion, path.join(work, pkg.replace(/[@/]/g, "_"))));
  }
  const binary =
    platform === "darwin" && bins.length === 2
      ? await universalMac(bins[0], bins[1], path.join(work, "bun-universal"))
      : bins[0];

  const dir = stage(platform, binary);
  const out = path.join(DIST, `viz-${platform}.mcpb`);
  rmSync(out, { force: true });
  await sh(["zip", "-qr", out, "."], dir);
  // The .mcpb is the artifact; the downloaded binary and the staged tree are scaffolding.
  rmSync(work, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  return out;
}

async function prune(keep: number): Promise<void> {
  const listed = await sh(["gh", "release", "list", "--limit", "100", "--json", "tagName"]);
  const tags = (JSON.parse(listed) as { tagName: string }[])
    .map((r) => r.tagName)
    .filter((t) => t.startsWith(TAG_PREFIX));
  // gh lists newest first; everything past `keep` goes, tag included.
  for (const t of tags.slice(keep)) {
    await sh(["gh", "release", "delete", t, "--yes", "--cleanup-tag"]);
    console.log(`  pruned ${t}`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: bun maintainer/release-mcpb.ts [--check] [--dry-run] [--keep=N] [--bun=VERSION]\n" +
        "\n" +
        "  --check      run the version guard and stop\n" +
        "  --dry-run    build all three bundles, publish nothing\n" +
        "  --keep=N     releases to retain after publishing (default 3)\n" +
        "\n" +
        "MAINTAINER TOOLING. Not part of the skill: maintainer/ is excluded from the\n" +
        "published bundle, because a user installing viz should not receive the code\n" +
        "that builds viz.",
    );
    process.exit(0);
  }
  const keep = Number(args.find((a) => a.startsWith("--keep="))?.split("=")[1] ?? 3);
  const dryRun = args.includes("--dry-run");
  const bunVersion = args.find((a) => a.startsWith("--bun="))?.split("=")[1] ?? Bun.version;

  // The guard runs here rather than being a `viz` verb: a user installing this skill
  // should not receive the machinery that builds it. Shipping the build tooling inside
  // the artifact it builds is a layering error, however convenient the verb was.
  const guard = checkVersionBumped();
  console.error(guard.ok ? `\u2713 version check: ${guard.reason}` : `\u2717 version check: ${guard.reason}`);
  if (!guard.ok) {
    console.error(`\n  Bump "version" in package.json above ${(guard as { released: string }).released} first.`);
    console.error(`  Changed: ${(guard as { changed: string[] }).changed.slice(0, 5).join(", ")}`);
    process.exit(2);
  }
  if (args.includes("--check")) process.exit(0);

  mkdirSync(DIST, { recursive: true });
  const assets: string[] = [];
  for (const p of ["darwin", "win32", "linux"] as const) {
    process.stderr.write(`building ${p} (bun ${bunVersion}) … `);
    const f = await buildBundle(p, bunVersion);
    const mb = (Bun.file(f).size / 1048576).toFixed(0);
    process.stderr.write(`${mb} MB\n`);
    assets.push(f);
  }

  if (dryRun) {
    console.log(`\n--dry-run: built ${assets.length} bundles for ${TAG}, published nothing.`);
    for (const a of assets) console.log("  " + a);
    process.exit(0);
  }

  await sh(["gh", "release", "create", TAG, ...assets,
            "--title", `viz ${VERSION}`,
            "--notes", `One-click MCP install for Claude Desktop.\n\n` +
                       `**Why 8.x when the first release was 1.0.0:** the skill has existed since ` +
                       `2026-05-09 and was already running ~1200 invocations a week before it was ` +
                       `first put under version control. Versioning started late, so 1.0.0 described ` +
                       `"first tagged release" rather than the state of the software. Reconstructing ` +
                       `semver across its whole history — 157 commits, four repos, eight breaking ` +
                       `changes — puts it here. The 1.0.0 tag has been removed as misleading.\n\n` +
                       `Download the bundle for your OS and open it — Claude Desktop installs it from ` +
                       `Settings → Extensions. Bun ships inside; nothing else to install.\n\n` +
                       `There is no auto-update: the .mcpb format has no update mechanism, so grab a ` +
                       `newer bundle here when you want one.`]);
  console.log(`published ${TAG}`);
  await prune(keep);
}

export { buildBundle, prune, TAG_PREFIX };

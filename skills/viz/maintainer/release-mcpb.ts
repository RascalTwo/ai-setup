#!/usr/bin/env node
// release-mcpb.ts — build the three .mcpb bundles and publish them as a GitHub Release.
//
// WHY RELEASES AND NOT A BRANCH: a branch is part of the git object database, so every
// `git clone` of this repo would pull ~130MB of binaries nobody asked for — and
// force-pushing only moves the ref, the objects linger until GitHub garbage-collects.
// Release assets live in separate blob storage and never touch a clone, so the repo
// stays the size it is. GitHub's limits are 2 GiB per file and 1000 assets per release,
// with no total size or bandwidth cap on public repos.
//
// WHY ONE MACHINE CAN BUILD ALL THREE: nodejs.org publishes a prebuilt node per platform
// (checked against its SHASUMS256.txt), so there is no cross-platform CI matrix to maintain
// — we fetch the target's binary and ship it inside the bundle (build-mcpb.ts says why).
//
// RETENTION: old releases are pruned to --keep (default 3). They are fully mutable —
// `gh release delete` and `gh release delete-asset` both exist — so nothing is stuck
// out there, and the list stays readable instead of accreting every version forever.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { run, runSync } from "../lib/proc.ts";
import { VERSION } from "../lib/version.ts";
import { stage } from "./build-mcpb.ts";
import { checkVersionBumped } from "./version-guard.ts";

const SKILL_DIR = path.dirname(import.meta.dirname);
const DIST = path.join(SKILL_DIR, ".mcpb-dist");
const TAG = `viz-v${VERSION}`;

/** Tag prefix, so this skill's releases never collide with anything else in the repo. */
const TAG_PREFIX = "viz-v";

type Platform = "darwin" | "win32" | "linux";
/** The nodejs.org archives holding each target's node. macOS gets both, then lipo. */
const NODE_DIST: Record<Platform, string[]> = {
  darwin: ["darwin-arm64.tar.gz", "darwin-x64.tar.gz"],
  win32: ["win-x64.zip"],
  linux: ["linux-x64.tar.gz"],
};

async function sh(cmd: string[], cwd?: string, env?: Record<string, string>): Promise<string> {
  const r = await run(cmd, {
    ...(cwd !== undefined && { cwd }),
    ...(env && { env: { ...process.env, ...env } }),
  });
  if (r.code !== 0) throw new Error(`${cmd.join(" ")}\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

/** Download one nodejs.org archive, check it against SHASUMS256.txt, and return the node binary inside it. */
async function fetchNode(archive: string, version: string, into: string): Promise<string> {
  mkdirSync(into, { recursive: true });
  const base = `https://nodejs.org/dist/v${version}`;
  const file = `node-v${version}-${archive}`;
  const get = async (url: string): Promise<Buffer> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
    return Buffer.from(await res.arrayBuffer());
  };
  const [bytes, sums] = await Promise.all([get(`${base}/${file}`), get(`${base}/SHASUMS256.txt`)]);
  const want = sums
    .toString()
    .split("\n")
    .find((l) => l.endsWith(`  ${file}`))
    ?.split(" ")[0];
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== want) throw new Error(`${file}: sha256 ${got} is not the published ${want}`);
  const archivePath = path.join(into, file);
  writeFileSync(archivePath, bytes);
  await (archive.endsWith(".zip")
    ? sh(["unzip", "-q", file], into)
    : sh(["tar", "-xzf", file], into));
  const root = path.join(into, file.replace(/\.(?:tar\.gz|zip)$/u, ""));
  for (const p of [path.join(root, "bin", "node"), path.join(root, "node.exe")])
    if (existsSync(p)) return p;
  throw new Error(`no node binary inside ${file}`);
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

async function buildBundle(platform: Platform, nodeVersion: string): Promise<string> {
  const work = path.join(DIST, `_node-${platform}`);
  rmSync(work, { recursive: true, force: true });
  // Cleaned again at the end of this function: a node binary is ~100 MB and the staged
  // tree another ~50, so leaving them behind costs ~400 MB PER RUN. A few builds during
  // development had left 1.2 GB sitting in .mcpb-dist.
  const bins = await Promise.all(
    NODE_DIST[platform].map(async (archive) => {
      const bin = await fetchNode(archive, nodeVersion, path.join(work, archive));
      return bin;
    }),
  );
  const [first, second] = bins;
  if (!first) throw new Error(`no node binary fetched for ${platform}`);
  const binary =
    platform === "darwin" && second
      ? await universalMac(first, second, path.join(work, "node-universal"))
      : first;

  const dir = stage(platform, binary);
  const out = path.join(DIST, `viz-${platform}.mcpb`);
  rmSync(out, { force: true });
  await sh(["zip", "-qr", out, "."], dir);
  // The .mcpb is the artifact; the downloaded binary and the staged tree are scaffolding.
  rmSync(work, { recursive: true, force: true });
  rmSync(dir, { recursive: true, force: true });
  return out;
}

/**
 * Env for gh calls that write to this repo: GH_TOKEN of a logged-in account that can push.
 *
 * gh acts as the ACTIVE account, and with several accounts logged in the active one may have
 * no write here — GitHub then answers a delete with 404, not 403 (the viz 9.5.0 prune). A
 * per-call token instead of `gh auth switch`: the user's active account is never touched, and
 * another session switching accounts mid-release can't pull the rug out.
 */
async function pusherEnv(): Promise<Record<string, string>> {
  const nwo = await sh(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  const canPush = async (env?: Record<string, string>): Promise<boolean> => {
    try {
      return (
        (await sh(["gh", "api", `repos/${nwo}`, "--jq", ".permissions.push"], undefined, env)) ===
        "true"
      );
    } catch {
      return false;
    }
  };
  if (await canPush()) return {};
  const status = runSync(["gh", "auth", "status", "-h", "github.com"]);
  const accounts = [...`${status.stdout}${status.stderr}`.matchAll(/account (\S+) /gu)].map(
    ([, user = ""]) => user,
  ); // the group always participates
  for (const user of accounts) {
    // oxlint-disable-next-line no-await-in-loop -- accounts are tried in order; the first that can push wins
    const token = await sh(["gh", "auth", "token", "-h", "github.com", "-u", user]).catch(() => "");
    // oxlint-disable-next-line no-await-in-loop -- same ordered probe as above
    if (token && (await canPush({ GH_TOKEN: token }))) {
      console.error(`  ↳ gh: releasing as ${user} (write access to ${nwo})`);
      return { GH_TOKEN: token };
    }
  }
  throw new Error(
    `no logged-in gh account can push to ${nwo} — \`gh auth login\` with one that can`,
  );
}

async function prune(keep: number, env: Record<string, string> = {}): Promise<void> {
  const listed = await sh(
    ["gh", "release", "list", "--limit", "100", "--json", "tagName"],
    undefined,
    env,
  );
  const parsed: unknown = JSON.parse(listed);
  const tags = (Array.isArray(parsed) ? parsed : []).flatMap((r: unknown) =>
    r !== null &&
    typeof r === "object" &&
    "tagName" in r &&
    typeof r.tagName === "string" &&
    r.tagName.startsWith(TAG_PREFIX)
      ? [r.tagName]
      : [],
  );
  // gh lists newest first; everything past `keep` goes, tag included.
  for (const t of tags.slice(keep)) {
    // oxlint-disable-next-line no-await-in-loop -- deletes run one at a time so a failure stops at a known tag
    await sh(["gh", "release", "delete", t, "--yes", "--cleanup-tag"], undefined, env);
    console.log(`  pruned ${t}`);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      "usage: node maintainer/release-mcpb.ts [--check] [--dry-run] [--keep=N] [--node=VERSION]\n" +
        "\n" +
        "  --check      run the version guard and stop\n" +
        "  --dry-run    build all three bundles, publish nothing\n" +
        "  --keep=N     releases to retain after publishing (default 3)\n" +
        "  --node=V     the node version to ship (default: the one running this)\n" +
        "\n" +
        "MAINTAINER TOOLING. Not part of the skill: maintainer/ is excluded from the\n" +
        "published bundle, because a user installing viz should not receive the code\n" +
        "that builds viz.",
    );
    process.exit(0);
  }
  const keep = Number(args.find((a) => a.startsWith("--keep="))?.split("=")[1] ?? 3);
  const dryRun = args.includes("--dry-run");
  const nodeVersion =
    args.find((a) => a.startsWith("--node="))?.split("=")[1] ?? process.versions.node;

  // The guard runs here rather than being a `viz` verb: a user installing this skill
  // should not receive the machinery that builds it. Shipping the build tooling inside
  // the artifact it builds is a layering error, however convenient the verb was.
  const guard = checkVersionBumped();
  console.error(
    guard.ok ? `\u2713 version check: ${guard.reason}` : `\u2717 version check: ${guard.reason}`,
  );
  if (!guard.ok) {
    console.error(
      `\n  Bump "version" in package.json above ${(guard as { released: string }).released} first.`,
    );
    console.error(`  Changed: ${(guard as { changed: string[] }).changed.slice(0, 5).join(", ")}`);
    process.exit(2);
  }
  if (args.includes("--check")) process.exit(0);

  mkdirSync(DIST, { recursive: true });
  const assets: string[] = [];
  for (const p of ["darwin", "win32", "linux"] as const) {
    process.stderr.write(`building ${p} (node ${nodeVersion}) … `);
    // oxlint-disable-next-line no-await-in-loop -- one bundle at a time: each stages ~150 MB on disk and the node downloads are heavy
    const f = await buildBundle(p, nodeVersion);
    const mb = (statSync(f).size / 1048576).toFixed(0);
    process.stderr.write(`${mb} MB\n`);
    assets.push(f);
  }

  if (dryRun) {
    console.log(`\n--dry-run: built ${assets.length} bundles for ${TAG}, published nothing.`);
    for (const a of assets) console.log("  " + a);
    process.exit(0);
  }

  const env = await pusherEnv();
  await sh(
    [
      "gh",
      "release",
      "create",
      TAG,
      ...assets,
      "--title",
      `viz ${VERSION}`,
      "--notes",
      `One-click MCP install for Claude Desktop.\n\n` +
        `**Why 8.x when the first release was 1.0.0:** the skill has existed since ` +
        `2026-05-09 and was already running ~1200 invocations a week before it was ` +
        `first put under version control. Versioning started late, so 1.0.0 described ` +
        `"first tagged release" rather than the state of the software. Reconstructing ` +
        `semver across its whole history — 157 commits, four repos, eight breaking ` +
        `changes — puts it here. The 1.0.0 tag has been removed as misleading.\n\n` +
        `Download the bundle for your OS and open it — Claude Desktop installs it from ` +
        `Settings → Extensions. Node ships inside; nothing else to install.\n\n` +
        `There is no auto-update: the .mcpb format has no update mechanism, so grab a ` +
        `newer bundle here when you want one.`,
    ],
    undefined,
    env,
  );
  console.log(`published ${TAG}`);
  // The release is out; failing to tidy old ones must not report it as unreleased.
  await prune(keep, env).catch((e: unknown) =>
    console.error(
      `⚠️  ${TAG} published, but pruning old releases failed:\n${e instanceof Error ? e.message : String(e)}`,
    ),
  );
}

export { buildBundle, fetchNode, prune, pusherEnv, TAG_PREFIX };

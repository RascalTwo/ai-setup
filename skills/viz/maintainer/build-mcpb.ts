#!/usr/bin/env node
// build-mcpb.ts — package the MCP server as .mcpb bundles for one-click install.
//
// WHY A BUNDLE AT ALL: Claude Desktop is the only host with no `mcp add` command. A user
// there otherwise installs Node, installs the skill, hand-edits claude_desktop_config.json
// (absolute paths, valid JSON) and restarts the app. A .mcpb makes that one click.
// Everyone else — Codex CLI, ChatGPT desktop — is already a single command, and coding
// agents don't need the MCP server at all.
//
// WHY WE SHIP A NODE BINARY RATHER THAN USE CLAUDE DESKTOP'S: `server.type: "node"` runs the
// entry point on Desktop's built-in Node, but that Node is Electron's, and it cannot do the
// two things this server needs.
//   1. mcp.ts deliberately SPAWNS `viz.ts` (with process.execPath) so a command calling
//      process.exit cannot kill the server. Under "node", process.execPath is the app's
//      `Claude Helper (Plugin)` executable, and Claude.app ships with Electron's `RunAsNode`
//      fuse OFF (read from the Electron Framework binary), so it cannot be re-run as plain
//      Node: launching it with ELECTRON_RUN_AS_NODE=1 and `-e` just starts the app.
//   2. The skill is TypeScript run directly (Node type stripping, no build step). Nothing in
//      the docs promises that Electron's embedded Node strips types, or which Node version a
//      given Desktop ships (one report found Node 24.22.0 inside Electron 44.9.3).
// So the bundle is `server.type: "binary"`: the official Node 24 binary is its entry point,
// with the skill's own .ts files beside it, unchanged — the same shape the Bun bundle had.
// The manifest has no compatibility.runtimes: the MCPB spec says binary extensions need none,
// because the runtime is inside the bundle. Type stripping is off under node_modules/, but the
// skill's files sit at the bundle root, so it applies.
//
// PLATFORMS: the manifest's compatibility.platforms distinguishes darwin/win32/linux and
// NOT architecture, so one bundle per OS is exactly the granularity the format offers.
// macOS gets a universal binary via lipo rather than two bundles it could not tell apart.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  cpSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { VERSION } from "../lib/version.ts";
import { RUNTIME_FILES, RUNTIME_DIRS } from "../vendor-runtime.ts";

const SKILL_DIR = path.dirname(import.meta.dirname);
const OUT = path.join(SKILL_DIR, ".mcpb-dist");

/** Everything the MCP server needs at runtime, on top of the serve runtime. */
const MCP_FILES = [
  "mcp.ts",
  "viz.ts",
  "program.ts",
  "check-exchange.ts",
  "deploy-all.ts",
  "sync-runtimes.ts",
  "inline.ts",
  "keystore.ts",
  "vendor-runtime.ts",
  "package.json",
  "package-lock.json",
  "SKILL.md",
  ...RUNTIME_FILES,
];
// node_modules SHIPS. Without it the bundle still ran on my machine — the runtime resolved the
// SDK from a global install cache — and failed on any machine without that cache:
//   error: Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'
// A one-click installer that needs a network fetch on first run is not one click.
// It is a PRODUCTION install into the bundle, not a copy of this checkout's node_modules:
// devDependencies (the type packages verify checks CDN imports against, the pairwise
// source) are tooling, and mermaid alone would add hundreds of MB to every download.
// NOTE the absence of "maintainer": the bundle must not carry the tooling that
// builds it. That is why this list is explicit rather than "everything but".
// viz-pages is the bundled container: the templates `viz create --from` copies, and the
// self-portrait the server's root redirects to. Without it a bundle has neither.
const MCP_DIRS = ["commands", "lib", "reference", "templates", "viz-pages", ...RUNTIME_DIRS];
const MCP_GLOBS = ["hero-template.html"];

type Platform = "darwin" | "win32" | "linux";

type Manifest = {
  manifest_version: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  author: { name: string; url: string };
  repository: { type: string; url: string };
  homepage: string;
  license: string;
  server: {
    type: string;
    entry_point: string;
    mcp_config: { command: string; args: string[]; env: Record<string, string> };
  };
  compatibility: { platforms: Platform[] };
};

function manifest(platform: Platform): Manifest {
  const exe = platform === "win32" ? "bin/node.exe" : "bin/node";
  return {
    manifest_version: "0.3",
    name: "viz",
    display_name: "viz — ad-hoc HTML visualizations",
    version: VERSION,
    description:
      "Render charts, graphs, 3D scenes, state machines, dashboards and animated explainers " +
      "as live pages, from a chat app. Runs on your machine, outside the sandbox.",
    author: { name: "RascalTwo", url: "https://github.com/RascalTwo" },
    repository: { type: "git", url: "https://github.com/RascalTwo/ai-setup" },
    homepage: "https://rascaltwo.github.io/ai-setup/viz-self-portrait/",
    license: "MIT",
    server: {
      type: "binary",
      entry_point: exe,
      mcp_config: { command: `\${__dirname}/${exe}`, args: [`\${__dirname}/mcp.ts`], env: {} },
    },
    compatibility: { platforms: [platform] },
  };
}

/** CPU architectures a bundle's native packages must cover. macOS is one universal bundle. */
const CPUS: Record<Platform, [string, ...string[]]> = {
  darwin: ["arm64", "x64"],
  win32: ["x64"],
  linux: ["x64"],
};

/**
 * `npm ci` for the TARGET's native packages (tsc, oxlint, tsgolint, oxfmt, esbuild ship one per
 * os/cpu), not the build host's. --libc matters on linux: without it npm drops every
 * glibc-only package (oxfmt, oxlint) — and "*" is not a wildcard for --cpu, only the last
 * --cpu counts, hence one install per CPU, merged by `mergeMissing`.
 */
function install(dir: string, platform: Platform, cpu: string) {
  const r = spawnSync(
    "npm",
    [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `--os=${platform}`,
      `--cpu=${cpu}`,
      ...(platform === "linux" ? ["--libc=glibc"] : []),
    ],
    { cwd: dir, encoding: "utf8", shell: process.platform === "win32" },
  );
  if (r.status !== 0) throw new Error(`production install failed:\n${r.stderr}${r.error ?? ""}`);
}

/** Copy into `to` every package directory (one level, or two under an @scope) it lacks. */
function mergeMissing(from: string, to: string) {
  for (const name of readdirSync(from)) {
    if (name === ".bin" || name.startsWith(".")) continue;
    if (!name.startsWith("@")) {
      if (!existsSync(path.join(to, name)))
        cpSync(path.join(from, name), path.join(to, name), { recursive: true });
      continue;
    }
    mkdirSync(path.join(to, name), { recursive: true });
    for (const pkg of readdirSync(path.join(from, name)))
      if (!existsSync(path.join(to, name, pkg)))
        cpSync(path.join(from, name, pkg), path.join(to, name, pkg), { recursive: true });
  }
}

function stage(platform: Platform, nodeBinary: string): string {
  const dir = path.join(OUT, platform);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "bin"), { recursive: true });

  for (const f of [...MCP_FILES, ...MCP_GLOBS]) {
    const src = path.join(SKILL_DIR, f);
    if (existsSync(src)) cpSync(src, path.join(dir, f));
  }
  for (const d of MCP_DIRS) {
    const src = path.join(SKILL_DIR, d);
    // Never a page's local data: .viz-data holds the user's spoken feedback and screen crops,
    // .verify its screenshots and logs. Both are git-ignored and must not ship in a public bundle.
    if (existsSync(src))
      cpSync(src, path.join(dir, d), {
        recursive: true,
        filter: (from) => !/[/\\]\.(viz-data|verify)([/\\]|$)/u.test(from),
      });
  }
  const [first, ...others] = CPUS[platform];
  install(dir, platform, first);
  for (const cpu of others) {
    const scratch = mkdtempSync(path.join(tmpdir(), "viz-mcpb-"));
    try {
      for (const f of ["package.json", "package-lock.json"])
        cpSync(path.join(dir, f), path.join(scratch, f));
      install(scratch, platform, cpu);
      mergeMissing(path.join(scratch, "node_modules"), path.join(dir, "node_modules"));
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  cpSync(nodeBinary, path.join(dir, "bin", platform === "win32" ? "node.exe" : "node"));
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(manifest(platform), null, 2) + "\n",
  );
  return dir;
}

if (import.meta.main) {
  const platform = (["darwin", "win32", "linux"] as const).find((p) => p === process.argv[2]);
  const nodeBinary = process.argv[3] ?? process.execPath;
  if (platform === undefined || !existsSync(nodeBinary)) {
    console.error(
      "usage: node build-mcpb.ts <darwin|win32|linux> [path-to-node-binary]\n" +
        "\n" +
        "  The node binary is SHIPPED INSIDE the bundle, so it must be the one for the\n" +
        "  target platform (Node 24+, for type stripping) — not necessarily the one you\n" +
        "  are running. It defaults to the running node.",
    );
    process.exit(2);
  }
  const dir = stage(platform, nodeBinary);
  console.log(`staged ${platform} v${VERSION} -> ${dir}`);
  console.log(`pack it:  cd ${dir} && zip -qr ../viz-${platform}.mcpb .`);
}

export { manifest, stage, MCP_FILES, MCP_DIRS };

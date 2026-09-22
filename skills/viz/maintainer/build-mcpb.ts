#!/usr/bin/env bun
// build-mcpb.ts — package the MCP server as .mcpb bundles for one-click install.
//
// WHY A BUNDLE AT ALL: Claude Desktop is the only host with no `mcp add` command. A user
// there otherwise installs Bun, installs the skill, hand-edits claude_desktop_config.json
// (absolute paths, valid JSON) and restarts the app. A .mcpb makes that one click.
// Everyone else — Codex CLI, ChatGPT desktop — is already a single command, and coding
// agents don't need the MCP server at all.
//
// WHY WE SHIP BUN RATHER THAN COMPILE: `bun build --compile` produces a binary that dies
// at startup here. discovery.ts calls realpathSync(import.meta.dir) to normalise BUNDLED,
// and a compiled binary's import.meta.dir is `/$bunfs/root`, which has no real path:
//   realpathSync FAILED: ENOENT: lstat '/$bunfs/root'
// Second problem, independent of the first: mcp.ts deliberately SPAWNS `viz.ts` so a
// command calling process.exit cannot kill the server — and a single-file binary has no
// viz.ts on disk to spawn. So the bundle ships the real bun binary as its `binary`
// entry point, with the skill's own files beside it, unchanged.
//
// PLATFORMS: the manifest's compatibility.platforms distinguishes darwin/win32/linux and
// NOT architecture, so one bundle per OS is exactly the granularity the format offers.
// macOS gets a universal binary via lipo rather than two bundles it could not tell apart.

import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VERSION } from "../lib/version.ts";
import { RUNTIME_FILES, RUNTIME_DIRS } from "../vendor-runtime.ts";

const SKILL_DIR = path.dirname(import.meta.dir);
const OUT = path.join(SKILL_DIR, ".mcpb-dist");

/** Everything the MCP server needs at runtime, on top of the serve runtime. */
const MCP_FILES = [
  "mcp.ts", "viz.ts", "program.ts",
  "bootstrap.ts", "manage.ts", "verify.ts", "build.ts",
  "check-exchange.ts", "deploy-all.ts", "sync-runtimes.ts",
  "inline.ts", "keystore.ts", "vendor-runtime.ts",
  "package.json",
  "SKILL.md",
  ...RUNTIME_FILES,
];
// node_modules SHIPS. Without it the bundle still ran on my machine — Bun resolved the
// SDK from its global install cache — and failed on any machine without that cache:
//   error: Cannot find module '@modelcontextprotocol/sdk/server/mcp.js'
// A one-click installer that needs a network fetch on first run is not one click.
// NOTE the absence of "maintainer": the bundle must not carry the tooling that
// builds it. That is why this list is explicit rather than "everything but".
const MCP_DIRS = ["commands", "lib", "reference", "templates", "node_modules", ...RUNTIME_DIRS];
const MCP_GLOBS = ["deck-template.html", "poster-template.html", "poster-dive-template.html",
                   "exchange-template.html", "hero-template.html", "exchange-content-template.js"];

type Platform = "darwin" | "win32" | "linux";

function manifest(platform: Platform) {
  const exe = platform === "win32" ? "bin/bun.exe" : "bin/bun";
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

function stage(platform: Platform, bunBinary: string): string {
  const dir = path.join(OUT, platform);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "bin"), { recursive: true });

  for (const f of [...MCP_FILES, ...MCP_GLOBS]) {
    const src = path.join(SKILL_DIR, f);
    if (existsSync(src)) cpSync(src, path.join(dir, f));
  }
  for (const d of MCP_DIRS) {
    const src = path.join(SKILL_DIR, d);
    if (existsSync(src)) cpSync(src, path.join(dir, d), { recursive: true });
  }
  cpSync(bunBinary, path.join(dir, "bin", platform === "win32" ? "bun.exe" : "bun"));
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest(platform), null, 2) + "\n");
  return dir;
}

if (import.meta.main) {
  const platform = (process.argv[2] ?? "") as Platform;
  const bunBinary = process.argv[3] ?? Bun.which("bun") ?? "";
  if (!["darwin", "win32", "linux"].includes(platform) || !existsSync(bunBinary)) {
    console.error(
      "usage: bun build-mcpb.ts <darwin|win32|linux> [path-to-bun-binary]\n" +
        "\n" +
        "  The bun binary is SHIPPED INSIDE the bundle, so it must be the one for the\n" +
        "  target platform — not necessarily the one you are running.",
    );
    process.exit(2);
  }
  const dir = stage(platform, bunBinary);
  console.log(`staged ${platform} v${VERSION} -> ${dir}`);
  console.log(`pack it:  cd ${dir} && zip -qr ../viz-${platform}.mcpb .`);
}

export { manifest, stage, MCP_FILES, MCP_DIRS };

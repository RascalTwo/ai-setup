#!/usr/bin/env bun
// Deterministic installer for this AI-agent setup. Requires Bun.
//
// Links this repo's skills + rules into Claude Code (~/.claude) and Codex
// (~/.codex, ~/.agents) via symlinks, so editing a live file edits the repo.
// Idempotent, safe to re-run, never overwrites a real (non-symlink) file, and
// self-heals if the repo moves (re-run it from the new location).
//
//   bun install.ts
//
// "Full setup = layer both repos": run this repo's installer, then the private
// overlay's. Each links its own skills; order doesn't matter.

import { existsSync, lstatSync, statSync, rmSync, mkdirSync, readdirSync, symlinkSync,
         readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parse as parseToml } from "smol-toml";

const REPO = import.meta.dir;
const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude");
const CODEX_DIR = join(HOME, ".codex");
const AGENTS_SKILLS = join(HOME, ".agents", "skills"); // Codex user skill path
const haveCodex = existsSync(CODEX_DIR);

function lstatSafe(p: string) { try { return lstatSync(p); } catch { return null; } }
function statSafe(p: string) { try { return statSync(p); } catch { return null; } } // follows symlinks

// Idempotent symlink; refuses to clobber a real (non-symlink) file.
function link(target: string, name: string): void {
  const st = lstatSafe(name); // lstat: does not follow the link
  if (st?.isSymbolicLink()) rmSync(name);
  else if (st) { console.warn(`  SKIP (real file, not a symlink): ${name}`); return; }
  mkdirSync(dirname(name), { recursive: true });
  symlinkSync(target, name);
  console.log(`  ${name} -> ${target}`);
}

console.log(`Installing from: ${REPO}`);

console.log("== Rules ==");
link(join(REPO, "CLAUDE.md"), join(CLAUDE_DIR, "CLAUDE.md")); // Claude reads CLAUDE.md (-> AGENTS.md)
if (haveCodex) link(join(REPO, "AGENTS.md"), join(CODEX_DIR, "AGENTS.md")); // Codex reads AGENTS.md

// Link every skill dir under <root>/skills into both agents' skill paths.
function linkSkills(root: string): void {
  const d = join(root, "skills");
  for (const name of existsSync(d) ? readdirSync(d) : []) {
    const src = join(d, name);
    if (!statSafe(src)?.isDirectory()) continue; // follow symlinks: overlays may gather skills via links
    link(src, join(CLAUDE_DIR, "skills", name));
    if (haveCodex) link(src, join(AGENTS_SKILLS, name));
  }
}

// Overlays: `--overlay <dir>` (repeatable). Private/company repos reuse THIS installer
// instead of shipping their own — one source of truth, no drift.
const overlays: string[] = [];
for (let i = 2; i < process.argv.length; i++)
  if (process.argv[i] === "--overlay" && process.argv[i + 1]) overlays.push(resolve(process.argv[++i]));

console.log("== Skills ==");
linkSkills(REPO);
for (const ov of overlays) { console.log(`  overlay: ${ov}`); linkSkills(ov); }

// Third-party skills, reproduced deterministically from external-skills.json via `npx skills`.
// Opt-in (network): `bun install.ts --externals`. The manifest is the source of truth, not prose.
if (process.argv.includes("--externals")) {
  console.log("== External skills (npx skills) ==");
  const mf = join(REPO, "external-skills.json");
  const repos: Record<string, string[]> = existsSync(mf)
    ? (JSON.parse(readFileSync(mf, "utf8")).repos ?? {}) : {};
  for (const [repo, skills] of Object.entries(repos)) {
    console.log(`  ${repo}: ${skills.length} skills`);
    spawnSync("npx", ["-y", "skills", "add", repo, "-s", skills.join(","),
      "-g", "-a", "claude-code", "-a", "codex", "--yes"], { stdio: "inherit" });
  }
}

console.log("== Subagents (r2-sdlc reviewers) ==");
// Authored once in reviewers/.ruler/agents/, compiled by Ruler to each native
// format (committed), symlinked here. Editing reviewers needs Ruler; installing does not.
const claudeAgents = join(REPO, "reviewers", ".claude", "agents");
for (const f of existsSync(claudeAgents) ? readdirSync(claudeAgents) : [])
  if (f.endsWith(".md")) link(join(claudeAgents, f), join(CLAUDE_DIR, "agents", f));
if (haveCodex) {
  const codexAgents = join(REPO, "reviewers", ".codex", "agents");
  for (const f of existsSync(codexAgents) ? readdirSync(codexAgents) : [])
    if (f.endsWith(".toml")) link(join(codexAgents, f), join(CODEX_DIR, "agents", f));
}

console.log("== Statusline (Claude Code) ==");
const settingsDir = join(REPO, "settings");
for (const f of existsSync(settingsDir) ? readdirSync(settingsDir) : []) {
  if (/^statusline-.*\.sh$/.test(f) || f === "ccstatusline.json")
    link(join(settingsDir, f), join(CLAUDE_DIR, f));
}

console.log("== settings.json (Claude Code) ==");
// No machine-specific paths remain (marketplace removed) → symlink for write-through,
// like everything else. link() refuses to clobber an existing real settings.json.
link(join(settingsDir, "settings.json"), join(CLAUDE_DIR, "settings.json"));

console.log("== MCP: basic-memory (Codex) ==");
// Claude Code already has it (~/.claude.json). Mirror into Codex, idempotently.
if (haveCodex) {
  const cfg = join(CODEX_DIR, "config.toml");
  const body = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
  // Parse to detect robustly; append (not re-stringify) so Codex's own comments/order survive.
  let registered: boolean;
  try { registered = Boolean((parseToml(body) as any).mcp_servers?.["basic-memory"]); }
  catch { registered = /^\[mcp_servers\.basic-memory\]/m.test(body); } // unparseable -> regex fallback
  if (registered) {
    console.log(`  already registered in ${cfg}`);
  } else {
    appendFileSync(cfg, `\n[mcp_servers.basic-memory]\ncommand = "uvx"\nargs = ["basic-memory", "mcp"]\n`);
    console.log(`  appended [mcp_servers.basic-memory] to ${cfg}`);
  }
}

console.log("Done. Restart Claude Code / Codex to pick up changes.");
console.log("Manual/AI-assisted extras (not scripted): Chrome extension, computer-use,");
console.log("Atlassian OAuth, Ollama models for local-vision. See integrations/ and setup-prompt.md.");

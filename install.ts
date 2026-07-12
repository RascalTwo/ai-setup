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
         readFileSync, writeFileSync, appendFileSync } from "node:fs";
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
    // One `add` per skill: a comma-list silently no-ops for repos that nest
    // skills under plugins/*/skills/ (e.g. levnikolaevich). Single names always
    // resolve, and "*" as the sole entry still installs the whole repo.
    for (const skill of skills)
      spawnSync("npx", ["-y", "skills", "add", repo, "-s", skill,
        "-g", "-a", "claude-code", "-a", "codex", "--yes"], { stdio: "inherit" });
  }
}

console.log("== Subagents ==");
// Authored once in subagents/.ruler/agents/, compiled by Ruler to each native
// format (committed), symlinked here. Editing them needs Ruler; installing does not.
const claudeAgents = join(REPO, "subagents", ".claude", "agents");
for (const f of existsSync(claudeAgents) ? readdirSync(claudeAgents) : [])
  if (f.endsWith(".md")) link(join(claudeAgents, f), join(CLAUDE_DIR, "agents", f));
if (haveCodex) {
  const codexAgents = join(REPO, "subagents", ".codex", "agents");
  for (const f of existsSync(codexAgents) ? readdirSync(codexAgents) : [])
    if (f.endsWith(".toml")) link(join(codexAgents, f), join(CODEX_DIR, "agents", f));
}

console.log("== Statusline (Claude Code) ==");
const settingsDir = join(REPO, "settings", "claude-code");
for (const f of existsSync(settingsDir) ? readdirSync(settingsDir) : []) {
  if (/^statusline-.*\.sh$/.test(f) || f === "ccstatusline.json")
    link(join(settingsDir, f), join(CLAUDE_DIR, f));
}
// ccstatusline reads its ACTIVE config from ~/.config/ccstatusline/settings.json
if (existsSync(join(settingsDir, "ccstatusline.json")))
  link(join(settingsDir, "ccstatusline.json"), join(HOME, ".config", "ccstatusline", "settings.json"));

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

console.log("== Codex prefs (config.toml) ==");
// config.toml mixes user prefs (top-level scalars) with Codex-managed tables
// ([plugins], [projects], ...). We can't symlink it, so we merge the desired scalars
// into the region ABOVE the first [table] — a bare TOML key after a table header
// would bind to that table. Machine-managed tables are copied through untouched.
// Prefs come from settings/codex/config-prefs.toml in the core AND each overlay
// (overlay wins), so personal/dangerous values stay out of the public installer.
if (haveCodex) {
  const desired: Record<string, unknown> = {};
  for (const root of [REPO, ...overlays]) {
    const pf = join(root, "settings", "codex", "config-prefs.toml");
    if (existsSync(pf)) Object.assign(desired, parseToml(readFileSync(pf, "utf8")));
  }
  const keys = Object.keys(desired);
  if (keys.length) {
    const cfg = join(CODEX_DIR, "config.toml");
    const fmt = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));
    const lines = (existsSync(cfg) ? readFileSync(cfg, "utf8") : "").split("\n");
    let firstTable = lines.findIndex((l) => /^\s*\[/.test(l));
    if (firstTable === -1) firstTable = lines.length;
    const head = lines.slice(0, firstTable);
    const tail = lines.slice(firstTable);
    let changed = false;
    for (const k of keys) {
      const line = `${k} = ${fmt(desired[k])}`;
      const idx = head.findIndex((l) => new RegExp(`^\\s*${k}\\s*=`).test(l));
      if (idx === -1) { head.unshift(line); changed = true; }
      else if (head[idx] !== line) { head[idx] = line; changed = true; }
    }
    if (changed) {
      writeFileSync(cfg, [...head, ...tail].join("\n"));
      console.log(`  merged into ${cfg}: ${keys.join(", ")}`);
    } else {
      console.log(`  already current: ${keys.join(", ")}`);
    }
  }
}

console.log("Done. Restart Claude Code / Codex to pick up changes.");
console.log("Manual extras (not scripted): browser extension, computer-use, and Atlassian/Google");
console.log("connectors — enable in each agent's connector/plugin UI. Plus Ollama models. See README.");

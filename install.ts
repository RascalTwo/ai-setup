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
         readFileSync, writeFileSync, appendFileSync, readlinkSync } from "node:fs";
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

// Overlays: private/company repos reuse THIS installer instead of shipping their
// own — one source of truth, no drift. An overlay is any repo with a `skills/`
// dir; there is no second shape, so a repo that is itself one skill puts it at
// `skills/<name>/` like everyone else.
//
// The LIST cannot live in this file: it is machine-local paths, and this repo is
// public. It lives at ~/.agents/overlays.json — a real file, or a symlink into a
// private repo if you want it versioned; readFileSync neither knows nor cares.
// No manifest → this installer behaves exactly as it did before.
//
//   { "overlays": ["~/code/my-private-setup", "~/code/some-tool"] }
const OVERLAYS_MANIFEST = join(HOME, ".agents", "overlays.json");
const untilde = (p: string) => (p.startsWith("~/") ? join(HOME, p.slice(2)) : resolve(p));

const overlays: string[] = existsSync(OVERLAYS_MANIFEST)
  ? (JSON.parse(readFileSync(OVERLAYS_MANIFEST, "utf8")).overlays ?? []).map(untilde)
  : [];
for (let i = 2; i < process.argv.length; i++) // `--overlay <dir>` still works, for one-offs
  if (process.argv[i] === "--overlay" && process.argv[i + 1]) overlays.push(resolve(process.argv[++i]));

const skillsOf = (root: string): string[] =>
  (existsSync(join(root, "skills")) ? readdirSync(join(root, "skills")) : [])
    .filter((n) => statSafe(join(root, "skills", n))?.isDirectory());

// `--list`: what is installed, and from where. Changes nothing.
if (process.argv.includes("--list")) {
  const known = new Map<string, string>(); // skill name -> source repo
  for (const root of [REPO, ...overlays]) {
    const skills = skillsOf(root);
    console.log(`${root}  — ${skills.length}`);
    for (const n of skills) { known.set(n, root); console.log(`    ${n}`); }
  }
  // Live but unaccounted for: hand-linked, or from a repo nobody wrote down. This
  // is the part with teeth — an unlisted skill is one a rebuild silently loses.
  const live = existsSync(AGENTS_SKILLS) ? readdirSync(AGENTS_SKILLS) : [];
  const strays = live.filter((n) => lstatSafe(join(AGENTS_SKILLS, n))?.isSymbolicLink() && !known.has(n));
  console.log(strays.length ? `\nNOT IN ANY SOURCE (${strays.length}) — add to ${OVERLAYS_MANIFEST}:` : "\nNo strays.");
  for (const n of strays) console.log(`    ${n} -> ${readlinkSync(join(AGENTS_SKILLS, n))}`);
  process.exit(0);
}

console.log("== Skills ==");
linkSkills(REPO);
for (const root of overlays) { console.log(`  overlay: ${root}`); linkSkills(root); }

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

console.log("== MCP: basic-memory ==");
// Claude Code keeps MCP servers in ~/.claude.json, which it rewrites constantly and
// fills with per-project state — not a file to symlink or hand-edit. Go through the
// CLI instead; `mcp get` is a clean 0/1 probe, so this stays idempotent.
{
  const probe = spawnSync("claude", ["mcp", "get", "basic-memory"]);
  const manual = "claude mcp add -s user basic-memory -- uvx basic-memory mcp";
  if (probe.error) console.warn("  claude CLI not found — skipping Claude Code registration");
  else if (probe.status === 0) console.log("  already registered with Claude Code");
  else if (spawnSync("claude", ["mcp", "add", "-s", "user", "basic-memory",
                                "--", "uvx", "basic-memory", "mcp"], { stdio: "inherit" }).status === 0)
    console.log("  registered with Claude Code (user scope)");
  else console.warn(`  registration failed — run manually: ${manual}`);
}
// Codex keeps its servers in config.toml, which we already merge into. Mirror there.
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

console.log("== RTK (token compression) ==");
// Deterministic command-output compression via a PreToolUse hook on BOTH agents.
// Claude Code: the hook lives in settings.json (symlinked above) → `rtk hook claude`.
// Codex has no rtk built-in, so we symlink an adapter and register it in config.toml.
// The adapter wraps `rtk hook claude` and adds permissionDecision="allow" — Codex needs
// that to apply the rewrite (rtk emits Claude-style output without it). If rtk isn't
// installed, both hooks no-op and commands run raw, so this degrades safely.
{
  const haveRtk = spawnSync("rtk", ["--version"]).status === 0;
  if (haveRtk) console.log("  rtk already installed");
  else if (spawnSync("brew", ["--version"]).status === 0) {
    console.log("  installing rtk via brew…");
    spawnSync("brew", ["install", "rtk"], { stdio: "inherit" });
  } else console.warn("  rtk missing and brew unavailable — install manually: https://github.com/rtk-ai/rtk");

  if (haveCodex) {
    link(join(REPO, "settings", "codex", "rtk-hook.sh"), join(CODEX_DIR, "rtk-hook.sh"));
    const cfg = join(CODEX_DIR, "config.toml");
    const body = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
    if (/rtk-hook\.sh/.test(body)) {
      console.log(`  Codex hook already registered in ${cfg}`);
    } else {
      appendFileSync(cfg,
        `\n# RTK token-compression hook (managed by install.ts). No-op if rtk is absent.\n` +
        `[[hooks.PreToolUse]]\nmatcher = "^Bash$"\n\n` +
        `[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "~/.codex/rtk-hook.sh"\n`);
      console.log(`  appended [[hooks.PreToolUse]] to ${cfg}`);
    }
  }
}

// Append a TOML block to a file we do not own, once. Same idea as the Codex
// rtk-hook registration above: detect with a marker, append rather than
// re-stringify, so the tool's own comments and ordering survive.
function appendTomlIfAbsent(cfg: string, block: string, marker: RegExp, label: string): void {
  const body = existsSync(cfg) ? readFileSync(cfg, "utf8") : "";
  if (marker.test(body)) { console.log(`  already present: ${label}`); return; }
  mkdirSync(dirname(cfg), { recursive: true });
  appendFileSync(cfg, (body && !body.endsWith("\n") ? "\n" : "") + "\n" + block);
  console.log(`  appended ${label} to ${cfg}`);
}

const HERDR_CFG = join(HOME, ".config", "herdr", "config.toml");
const haveHerdr = spawnSync("herdr", ["--version"]).status === 0;

console.log("== herdr ==");
// ~/.config/herdr holds live state (sockets, logs, session.json) and herdr rewrites
// config.toml itself during keybinding migrations, so prefs are MERGED, not symlinked
// — a rewrite would replace a symlink with a real file and silently detach the repo.
// See settings/herdr/settings-map.md.
if (!haveHerdr) {
  console.warn("  herdr not installed — skipping (https://herdr.dev)");
} else {
  // settings.json registers a SessionStart hook pointing at herdr's generated
  // agent-state script. herdr owns that file ("reinstalling overwrites this file"),
  // so regenerate it here instead of tracking a copy that would go stale.
  spawnSync("herdr", ["integration", "install", "claude"], { stdio: "inherit" });
  // Codex gets the same agent-state reporting; its hooks.json is machine-managed
  // and untracked, so there is no duplicate to normalize there.
  if (haveCodex) spawnSync("herdr", ["integration", "install", "codex"], { stdio: "inherit" });

  // `integration install` also writes its own SessionStart entry into settings.json,
  // hardcoding an absolute path next to the portable $HOME entry this repo tracks.
  // Without this, every install adds another duplicate and the hook fires N times.
  {
    const sf = join(settingsDir, "settings.json");
    const cfg = JSON.parse(readFileSync(sf, "utf8"));
    const starts: any[] = cfg.hooks?.SessionStart ?? [];
    const cmds = (e: any) => (e?.hooks ?? []).map((h: any) => h?.command ?? "");
    const kept = starts.filter((e) =>
      !cmds(e).some((c: string) => /herdr-agent-state\.sh/.test(c)) ||
       cmds(e).some((c: string) => c.includes("$HOME")));
    const seen = new Set<string>();
    const final = kept.filter((e) => {
      const k = JSON.stringify(e);
      return seen.has(k) ? false : (seen.add(k), true);
    });
    if (final.length !== starts.length) {
      cfg.hooks.SessionStart = final;
      writeFileSync(sf, JSON.stringify(cfg, null, 2) + "\n");
      console.log(`  removed ${starts.length - final.length} duplicate SessionStart hook(s) added by herdr`);
    }
  }

  const prefs = join(REPO, "settings", "herdr", "config-prefs.toml");
  if (existsSync(prefs))
    appendTomlIfAbsent(HERDR_CFG, readFileSync(prefs, "utf8"),
                       // Guard on the NEWEST pref in config-prefs.toml — a machine that already
                       // has the older ones would otherwise never receive additions.
                       /^\s*kitty_graphics\s*=/m, "[experimental] kitty_graphics");
}

console.log("== ttyimgspool (terminal screenshot gallery) ==");
// Viewer + PostToolUse hook. The hook's registration rides along in the symlinked
// settings.json; only the scripts and the herdr keybinding need wiring here.
{
  const dir = join(REPO, "ttyimgspool");
  link(join(dir, "ttyimgspool"), join(CLAUDE_DIR, "bin", "ttyimgspool"));
  link(join(dir, "ttyimgspool-hook.py"), join(CLAUDE_DIR, "hooks", "ttyimgspool-hook.py"));

  // chafa does the rendering. Without it the hook still spools images and only the
  // viewer comes up blank, so a missing chafa is a warning, not a failure.
  if (spawnSync("chafa", ["--version"]).status === 0) console.log("  chafa already installed");
  else if (spawnSync("brew", ["--version"]).status === 0) {
    console.log("  installing chafa via brew…");
    spawnSync("brew", ["install", "chafa"], { stdio: "inherit" });
  } else console.warn("  chafa missing and brew unavailable — install manually: brew install chafa");

  // The keybinding belongs to this tool, not to herdr. `~` is not expanded by herdr
  // in the command field, so bake the absolute path in at install time.
  const keybind = join(dir, "herdr-keybind.toml");
  if (haveHerdr && existsSync(keybind))
    appendTomlIfAbsent(HERDR_CFG, readFileSync(keybind, "utf8").replaceAll("~/", `${HOME}/`),
                       /ttyimgspool/, "[[keys.command]] prefix+i");
  if (haveHerdr)
    console.warn("  herdr needs a FULL restart for kitty_graphics: `herdr server stop`, then reattach");
}

console.log("== claude-tab (prefix+a → new herdr tab running claude) ==");
{
  const dir = join(REPO, "claude-tab");
  link(join(dir, "claude-tab"), join(CLAUDE_DIR, "bin", "claude-tab"));

  // Same deal as ttyimgspool: the binding belongs to this tool, and herdr does
  // not expand `~` in the command field, so bake the absolute path in here.
  const keybind = join(dir, "herdr-keybind.toml");
  if (haveHerdr && existsSync(keybind))
    appendTomlIfAbsent(HERDR_CFG, readFileSync(keybind, "utf8").replaceAll("~/", `${HOME}/`),
                       /claude-tab/, "[[keys.command]] prefix+a");

  if (spawnSync("jq", ["--version"]).status !== 0)
    console.warn("  jq missing — claude-tab parses herdr's JSON with it: brew install jq");
}

console.log("== herdr-autolabel (living tab names from a local model) ==");
// Stop hook. Its registration rides along in the symlinked settings.json; only
// the script needs wiring. No-ops outside herdr, so it is safe everywhere.
{
  link(join(REPO, "herdr-autolabel", "herdr-autolabel"), join(CLAUDE_DIR, "bin", "herdr-autolabel"));

  const model = "qwen2.5-coder:7b";
  const have = spawnSync("ollama", ["list"], { encoding: "utf8" });
  if (have.status !== 0) console.warn(`  ollama missing — herdr-autolabel stays a no-op until: brew install ollama && ollama pull ${model}`);
  else if (!have.stdout.includes(model)) console.warn(`  model missing — run: ollama pull ${model}`);
  else console.log(`  ${model} already pulled`);
}

console.log("Done. Restart Claude Code / Codex to pick up changes.");
console.log("Manual extras (not scripted): browser extension, computer-use, and Atlassian/Google");
console.log("connectors — enable in each agent's connector/plugin UI. Plus Ollama models. See README.");

---
disable-model-invocation: true
name: ai-setup-audit
description: "Weekly interactive audit of the AI-agent setup shared across Claude Code and OpenAI Codex — AGENTS.md rules, skills, MCP servers, settings, subagents, basic-memory. Use when the user asks to audit, optimize, clean up, or review their agent setup, keep their config fresh, or says 'run the weekly audit'. Also for stale skills, unused MCP servers, orphaned skills, drift in external-skills.json, or checking what's changed. Also refreshes the published explorables in viz-pages — the setup tour and the per-skill posters — so the public face of the setup doesn't drift from reality."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    claude-code: settings, skills, plugins, MCP servers
    codex: config, skills, MCP servers
    basic-memory: note inventory
    github-pages: viz-pages explorables
  requires: [jq, gh, npx, claude, codex]
---

# AI Agent Setup Audit

A phased, interactive audit of the user's agent-agnostic AI coding setup. The setup is a **public core** (`RascalTwo/ai-setup`) plus **private overlays**, installed deterministically by symlink into the paths **both** Claude Code and OpenAI Codex read. The goal is to keep everything fresh, eliminate cruft, and strengthen cross-references across the ecosystem — on both agents.

**Golden rule: never auto-apply changes.** Present every recommendation individually and let the user decide. Explain the reasoning — don't just say "remove this," say why it's a candidate for removal.

## How the Setup Fits Together

One setup drives two agents. Every live entry is a **symlink into a git repo**; the repos are the source of truth. The repos:

- **Public core** — `github.com/RascalTwo/ai-setup`, local at `$HOME/Desktop/Desktop/Code/ai-setup`. `main` = squashed public snapshot (one orphan commit); `private/trunk` = local working branch (real history, not pushed).
- **Private overlays** — one or more separate repos holding company/personal skills that must NOT go public. Overlays have no installer of their own; `install.ts --overlay <dir>` layers their `skills/` on top of the core. (The concrete paths are machine-local, so they live in `~/.agents/overlays.json`, not in this public file. `bun install.ts --list` prints them along with every skill each one provides.)

The connected pieces, and where each lives:

- **Rules file** — `ai-setup/AGENTS.md` is canonical (Codex's native name). `ai-setup/CLAUDE.md` is a symlink to `AGENTS.md`. Live: `~/.claude/CLAUDE.md` → repo `CLAUDE.md` (→ `AGENTS.md`) and `~/.codex/AGENTS.md` → repo `AGENTS.md`. **Both agents read the same bytes.**
- **Skills** — canonical dir is **`~/.agents/skills`** (Codex's path). `~/.claude/skills` is a **whole-dir symlink → `~/.agents/skills`**, so Claude sees the same catalog. Owned skills are per-skill symlinks into `ai-setup/skills/` or an overlay's `skills/`; third-party skills are real dirs installed by `npx skills`.
- **MCP servers** — registered per agent: Claude in `~/.claude.json` (`mcpServers`), Codex in `~/.codex/config.toml` (`[mcp_servers.*]`, also visible via `codex mcp list`).
- **Settings** — Claude `~/.claude/settings.json` (symlink → `ai-setup/settings/claude-code/settings.json`) + `~/.config/ccstatusline/settings.json`. Codex settings have no shared format and are hand-maintained per `ai-setup/settings/codex/settings-map.md`.
- **Subagents** (r2-sdlc reviewers) — authored once in `ai-setup/subagents/.ruler/agents/`, compiled by **Ruler** to `subagents/.claude/agents/*.md` + `subagents/.codex/agents/*.toml`, symlinked to `~/.claude/agents` + `~/.codex/agents`.
- **Basic-memory** — persistent notes in `~/basic-memory/` via the basic-memory MCP server, registered in BOTH agents. Notes link to each other via permalinks and wiki-links.

Any of these can reference any other. AGENTS.md can point to a skill. A skill can reference a memory note. A memory note can link to another note. Dead references waste tokens and confuse the model. Missing references mean missed opportunities.

## The Symlink-Into-Repos Model — Read Before Auditing

**By design**, every live entry under `~/.claude/`, `~/.codex/`, and `~/.agents/` is a **symlink into one of the repos** (or, for third-party skills, a real dir installed from a manifest). The repo IS the source of truth; the live entry is a pointer. This is NOT the old single-`claude-setup`-mirror model — links point into MULTIPLE repos (public core + overlays).

**Pre-flight classification (run BEFORE Phase 1 discovery output):**

```bash
# Where does a live entry actually resolve, and is it a healthy link into a repo?
classify() {
  local live="$1"
  if [ ! -e "$live" ] && [ ! -L "$live" ]; then echo "ABSENT"; return; fi
  if [ -L "$live" ]; then
    local tgt; tgt=$(readlink "$live")
    if [ -e "$live" ]; then echo "SYMLINK -> $tgt"; else echo "BROKEN -> $tgt (target missing)"; fi
    return
  fi
  echo "REAL_DIR"   # not a symlink — third-party skill, or an orphan (see Phase 3 invariant)
}

# Rules file (both agents)
classify ~/.claude/CLAUDE.md
classify ~/.codex/AGENTS.md

# Each skill in the canonical dir
for d in ~/.agents/skills/*; do printf '%s\t' "$(basename "$d")"; classify "$d"; done
```

⚠️ **Trailing-slash gotcha:** `ls -ld ~/.agents/skills/foo/` shows `d` (drwx...) even when `foo` is a symlink, because the trailing slash makes `ls` follow the link. Always test with `[ -L ]` or `readlink`, NEVER infer "real directory" from `ls -ld`. Same trap for `stat -f '%i'` — it follows symlinks by default.

How to use the classification:
- **SYMLINK → repo** — healthy. Do not flag as "duplicate" or "stale snapshot." A symlinked file is one file on disk; there is no token doubling. Phase 9 does not `cp` these.
- **BROKEN** — the link's target is gone (a source dir was deleted/moved). This is real work: re-point or re-install. Sweep `~/.claude`, `~/.codex`, `~/.agents`, `~/.config/ccstatusline`, `~/.local/bin` for other links to the same vanished target.
- **REAL_DIR** — a real directory, not a link. For skills this is EITHER a legitimate third-party install (must be in `external-skills.json`) OR an **orphan** (Phase 3 invariant). For the rules file, a real (non-symlink) `CLAUDE.md`/`AGENTS.md` means the install broke — the repo copy is canonical.
- **ABSENT** — expected entry missing; re-run `install.ts`.

**Phase 9 corollary:** for healthy SYMLINK entries there is nothing to copy — you edit the repo file directly and the live link already reflects it. Never `cp` over a symlink — it replaces the link with a regular file and silently breaks the setup.

## The phases

Work through them in order. **Read each phase's file when you reach that phase, not before** — each one is long and only matters once you are in it. Phases refer to each other by number; this table is how you find them.

| Phase | What it does | File |
|---|---|---|
| 0 | Usage snapshot from session transcripts. Start it in the **background**, then go straight to Phase 1 while it runs. | [reference/phase-0-usage.md](reference/phase-0-usage.md) |
| 1 | Discovery: inventory everything, read-only, with parallel subagents. | [reference/phase-1-discovery.md](reference/phase-1-discovery.md) |
| 2 | Rules file audit (AGENTS.md). | [reference/phase-2-rules-file.md](reference/phase-2-rules-file.md) |
| 3 | Skills audit: the hard invariant, upstream freshness, per-skill review. | [reference/phase-3-skills.md](reference/phase-3-skills.md) |
| 4–5 | Subagents audit; MCP servers and settings audit. | [reference/phase-4-5-subagents-mcp-settings.md](reference/phase-4-5-subagents-mcp-settings.md) |
| 6–7 | Basic-memory audit; ecosystem links summary. | [reference/phase-6-7-memory-and-links.md](reference/phase-6-7-memory-and-links.md) |
| 8 | Refresh the published explorables (the tour and the skill posters). | [reference/phase-8-explorables.md](reference/phase-8-explorables.md) |
| 9 | Sync and publish. | [reference/phase-9-sync-publish.md](reference/phase-9-sync-publish.md) |

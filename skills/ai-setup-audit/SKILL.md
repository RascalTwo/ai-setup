---
description: "Weekly interactive audit of the entire AI-agent setup shared across Claude Code and OpenAI Codex — the AGENTS.md rules file, skills, MCP servers, settings, subagents, and basic-memory. Use when the user asks to audit, optimize, clean up, or review their agent setup, mentions wanting to keep their config fresh, or says something like 'run the weekly audit'. Also use when the user mentions stale skills, unused MCP servers, orphaned skills, drift in external-skills.json, or wants to check what's changed in their setup."
---

# AI Agent Setup Audit

A phased, interactive audit of the user's agent-agnostic AI coding setup. The setup is a **public core** (`RascalTwo/ai-setup`) plus **private overlays**, installed deterministically by symlink into the paths **both** Claude Code and OpenAI Codex read. The goal is to keep everything fresh, eliminate cruft, and strengthen cross-references across the ecosystem — on both agents.

**Golden rule: never auto-apply changes.** Present every recommendation individually and let the user decide. Explain the reasoning — don't just say "remove this," say why it's a candidate for removal.

## How the Setup Fits Together

One setup drives two agents. Every live entry is a **symlink into a git repo**; the repos are the source of truth. The repos:

- **Public core** — `github.com/RascalTwo/ai-setup`, local at `$HOME/Desktop/Desktop/Code/ai-setup`. `main` = squashed public snapshot (one orphan commit); `r2-main` = local working branch (real history, not pushed).
- **Private overlays** — one or more separate repos holding company/personal skills that must NOT go public. Overlays have no installer of their own; `install.ts --overlay <dir>` layers their `skills/` on top of the core. (The concrete overlay paths are machine-local — resolve them from your install command or your private notes, not from this public file.)

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
- **SYMLINK → repo** — healthy. Do not flag as "duplicate" or "stale snapshot." A symlinked file is one file on disk; there is no token doubling. Phase 7 does not `cp` these.
- **BROKEN** — the link's target is gone (a source dir was deleted/moved). This is real work: re-point or re-install. Sweep `~/.claude`, `~/.codex`, `~/.agents`, `~/.config/ccstatusline`, `~/.local/bin` for other links to the same vanished target.
- **REAL_DIR** — a real directory, not a link. For skills this is EITHER a legitimate third-party install (must be in `external-skills.json`) OR an **orphan** (Phase 3 invariant). For the rules file, a real (non-symlink) `CLAUDE.md`/`AGENTS.md` means the install broke — the repo copy is canonical.
- **ABSENT** — expected entry missing; re-run `install.ts`.

**Phase 7 corollary:** for healthy SYMLINK entries there is nothing to copy — you edit the repo file directly and the live link already reflects it. Never `cp` over a symlink — it replaces the link with a regular file and silently breaks the setup.

## Phase 0: Usage Snapshot (from session transcripts)

Usage data comes from Claude Code's own local session transcripts at
`~/.claude/projects/**/*.jsonl`. Claude Code writes these unconditionally, so
there is 6+ months of gap-free history and nothing to keep running. (This
replaced a Prometheus/Loki/Tempo/OTEL Docker stack: it only had data while it
was up, had to be babysat, and was down at audit time — the transcripts had
everything it would have provided and more. Decommissioned 2026-07-11.)

**Caveat — Claude-only signal.** The report reflects Claude Code sessions.
Codex does not expose an equivalent easy transcript stream, so "0 calls this
window" for a skill/MCP means "unused *by Claude*," not "globally dead." A skill
you drive mostly from Codex can be quiet here and still load-bearing — confirm
with the user before treating low Claude usage as a removal signal.

**Launch the usage report in the BACKGROUND now**, then go straight to Phase 1
while it runs — it greps ~1GB at a 30d window (~1 min), so overlap it with
discovery rather than blocking:

```bash
# run_in_background: true — read the result during/after Phase 1
bash ~/.agents/skills/ai-setup-audit/scripts/usage-report.sh --days 30
```

The report gives: skill invocation counts, MCP calls by server and by full
tool, top built-in tools, an error signal (count + top signatures), and token
totals for the window.

**Turn it into audit signal** by diffing against the Phase-1 inventory:
- Any installed skill NOT in the skill-invocation list → 0 Claude calls this
  window → least-used / removal candidate (subject to the Codex caveat above).
- Any configured MCP server NOT in the "by server" list → dormant → removal
  candidate (same caveat).
- Tools with high error counts → investigate in Phase 3/4.

If `~/.claude/projects` is empty or the script errors, say so and fall back to
manual judgment — don't block. Present the report + derived candidates to the
user before proceeding.

## Phase 1: Discovery

Use subagents in parallel to inventory everything. All discovery is read-only.

**Subagent 1 — Rules file (both agents):**
```bash
# Canonical rules + the two live links that should point at it
cat ~/Desktop/Desktop/Code/ai-setup/AGENTS.md
readlink ~/.claude/CLAUDE.md ; readlink ~/.codex/AGENTS.md
# Per-project rules
find ~/Desktop/Desktop/Code -maxdepth 3 \( -name "AGENTS.md" -o -name "CLAUDE.md" \) 2>/dev/null
```

**Subagent 2 — Skills:**
```bash
# Canonical catalog + provenance of each entry
for d in ~/.agents/skills/*; do
  if [ -L "$d" ]; then echo "$(basename "$d")  SYMLINK -> $(readlink "$d")"
  else echo "$(basename "$d")  REAL_DIR (third-party or orphan)"; fi
done | sort
# Third-party manifest (source of truth for REAL_DIR skills)
cat ~/Desktop/Desktop/Code/ai-setup/external-skills.json
# Project-local skills, if any
find ~/Desktop/Desktop/Code -path "*/skills/*/SKILL.md" -maxdepth 6 2>/dev/null | grep -v /.agents/
```

**Subagent 3 — MCP servers & settings (both agents):**
```bash
# Claude MCP + settings
jq -r '.mcpServers | keys[]' ~/.claude.json 2>/dev/null
cat ~/.claude/settings.json
# Codex MCP + settings
codex mcp list 2>/dev/null || grep -nE '^\[mcp_servers' ~/.codex/config.toml
sed -n '1,40p' ~/.codex/config.toml
cat ~/Desktop/Desktop/Code/ai-setup/settings/codex/settings-map.md
```

**Subagent 4 — Subagents & basic-memory:**
```bash
# Subagents should be symlinks into ai-setup/subagents/.{claude,codex}/agents/
for d in ~/.claude/agents/* ~/.codex/agents/*; do
  [ -e "$d" ] || echo "BROKEN: $d"; [ -L "$d" ] && echo "$(basename "$d") -> $(readlink "$d")"
done
find ~/basic-memory -name "*.md" 2>/dev/null
```
Also use `mcp__basic-memory__search_notes` / `mcp__basic-memory__recent_activity` for a semantic inventory.

**Present a summary table** like:

| Category | Count | Details |
|----------|-------|---------|
| Rules file (AGENTS.md) | 1 canonical | + N per-project |
| Owned skills (symlink → repo) | N | list names + which repo |
| Third-party skills (real dir) | N | list names |
| MCP servers | N | Claude: … / Codex: … |
| Subagents | N | both agents resolve? |
| Basic-memory notes | N | list directories |

Then ask: **"Which phases do you want to run? All of them, or specific ones?"**

## Phase 2: Rules File Audit (AGENTS.md)

`AGENTS.md` is the single rules file both agents load every session. Review it **section by section** (by top-level heading).

For each section, evaluate:

1. **Staleness** — Does this still apply? Referencing outdated tools, versions, or workflows?
2. **Redundancy** — Does this duplicate something an agent already does by default? Be honest about built-in vs. unsure — if unsure, say so. Note behavior can differ between Claude and Codex; flag instructions that only make sense for one.
3. **Duplication across files** — Is the same instruction repeated in AGENTS.md and a per-project CLAUDE.md/AGENTS.md? It probably belongs in one place.
4. **Demote to memory?** — Niche or situational? Better as a basic-memory note retrieved on demand than loaded every session? Good candidates: instructions that apply to <10% of sessions.
5. **Promote from memory?** — Are there basic-memory notes retrieved so often they should just be in AGENTS.md? Check the Phase 0 usage report (basic-memory MCP frequency) or ask.
6. **Missing references** — Should this section point to a skill, memory note, or MCP server? If a section describes a workflow that has a corresponding skill, it should name that skill.

Present each recommendation one at a time. Wait for the user's decision before moving on.

## Phase 3: Skills Audit

### The hard invariant (check first)

**Every entry in `~/.agents/skills` is EITHER a symlink into one of the repos (owned) OR listed in `external-skills.json` (third-party). Any real dir not in the manifest is an orphan.** This is the single most important skills check — run it every audit:

A skill passes the invariant if it is a symlink (owned), OR its name is explicitly listed in the manifest, OR it was installed from a repo the manifest lists with a `"*"` wildcard. That last case (e.g. a whole-catalog install) means the individual skill name is NOT in the manifest, so a name-only grep gives false orphans — use the on-machine install record `~/.agents/.skill-lock.json` to map a real dir back to its source repo and accept it if that repo is a manifest key.

```bash
DOC=$HOME/Desktop/Desktop/Code/ai-setup/external-skills.json
LOCK=$HOME/.agents/.skill-lock.json
manifest_repos=$(jq -r '.repos | keys[]' "$DOC")

echo "--- Orphans: real dirs neither owned nor traceable to a manifest repo ---"
for d in ~/.agents/skills/*; do
  name=$(basename "$d")
  [ -L "$d" ] && continue                        # symlink into a repo = owned, fine
  grep -qF "\"$name\"" "$DOC" && continue         # explicitly named third-party, fine
  # Wildcard-repo install: trace dir -> source repo via the lock file.
  src=$(jq -r --arg n "$name" \
    '.skills|to_entries[]|select((.value.skillPath//"")|test("/"+$n+"/"))|.value.source' \
    "$LOCK" 2>/dev/null | head -1)
  { [ -n "$src" ] && echo "$manifest_repos" | grep -qxF "$src"; } && continue
  echo "ORPHAN: $name (real dir, not owned, not traceable to a manifest repo)"
done

echo "--- Documented but not installed (manifest names it, disk doesn't have it) ---"
jq -r '.repos | to_entries[] | .value[]' "$DOC" | grep -v '^\*$' | sort -u | while read s; do
  [ -e ~/.agents/skills/"$s" ] || echo "MISSING on disk: $s"
done

echo "--- Broken owned symlinks (target repo dir moved/deleted) ---"
for d in ~/.agents/skills/*; do
  [ -L "$d" ] && [ ! -e "$d" ] && echo "BROKEN: $(basename "$d") -> $(readlink "$d")"
done
```

For each finding:
- **ORPHAN** — a real dir that's neither owned nor traceable to a documented repo. Either it should be an owned skill (move it into `ai-setup/skills/` or an overlay and let `install.ts` symlink it) or it's a third-party install missing from `external-skills.json` (add `owner/repo: [skill]` under `repos`). Ask the user which.
- **MISSING on disk** — the manifest promises it but it isn't installed. Re-install via `install.ts --externals` (or `npx skills add <repo> -s <skill> -g -a claude-code -a codex --yes`), or drop the manifest entry. (Wildcard `"*"` repos are skipped by this direction — their catalog isn't enumerable offline; verify those by inspection.)
- **BROKEN** — an owned symlink whose repo target vanished. Re-point or re-run `install.ts`.

`external-skills.json` shape, for reference:
```json
{ "repos": { "owner/repo": ["skill-a", "skill-b"], "other/repo": ["*"] } }
```

### Per-skill review (owned + third-party)

For each skill (read its SKILL.md):

1. **Quality** — Is the description clear and specific enough to trigger correctly, on BOTH agents? Is the body well-structured?
2. **Staleness** — Does it reference files, APIs, or workflows that no longer exist?
3. **Dead references** — Does it reference other skills, memory notes, or files that don't exist? Check each.
4. **Cross-references** — Should it reference other skills or memory notes it currently doesn't? Would a "See also" help?
5. **Usage** — From the Phase 0 report, how often is it invoked (subject to the Codex-blind caveat)? Low Claude usage + stale content = removal candidate, but confirm it isn't a Codex-driven or rare-but-critical skill.
6. **Overlay placement** — Does an owned skill contain company/client specifics? If so it belongs in a **private overlay**, not the public core. Flag any such skill sitting in `ai-setup/skills/`.

Present recommendations one at a time.

## Phase 4: MCP & Settings Audit

### MCP Servers (both agents)

List servers from `~/.claude.json` (`mcpServers`) and `~/.codex/config.toml` (`[mcp_servers.*]` / `codex mcp list`). For each:

1. **Parity** — Is a server the user wants shared registered in BOTH agents? `basic-memory` in particular must be in both (`install.ts` manages the Codex `[mcp_servers.basic-memory]` table). Flag any intended-shared server present in only one.
2. **Still needed?** — Phase 0 call counts (Claude-side). Zero calls = candidate, subject to the Codex caveat.
3. **Working?** — Phase 0 error signal. High error count = investigate.
4. **Referenced?** — Do AGENTS.md or any skill reference this server? Unreferenced AND unused = strong removal candidate.
5. **Missing?** — Do any skills or AGENTS.md sections reference an MCP server that isn't configured?

Note Codex bundles its own runtime MCP servers (computer-use, node_repl, sites, etc.) — those are Codex-managed, not part of this setup; don't propose removing them.

### Settings (both agents)

**Claude** — `~/.claude/settings.json` (symlink → `ai-setup/settings/claude-code/`):

1. **Hooks** — Still relevant? Do they reference scripts that exist?
2. **Permissions** — Still needed?
3. **Telemetry** — The OTEL monitoring stack was decommissioned (Phase 0). Confirm `OTEL_*` / `CLAUDE_CODE_ENABLE_TELEMETRY` is disabled — should not export to a dead endpoint.
4. **Conflicts** — Any setting that contradicts AGENTS.md?
5. **Statusline binary** — `statusLine.command` runs the locally-installed `ccstatusline` (not `npx @latest`, to avoid a network resolve each refresh). Trade-off: no auto-update. Refresh on the audit cadence:
   ```bash
   npm outdated -g ccstatusline    # newer version out?
   npm i -g ccstatusline@latest     # update if so
   ```
   The pacing widgets (`statusline-{cache,5h,wk}.sh` + `statusline-lib.sh`) are custom-command widgets in `settings/claude-code/ccstatusline.json` — if a ccstatusline update bumps the config `version` or the stdin contract, re-verify one render: `echo '{...}' | ccstatusline`.

**Codex** — settings have no shared format; they're hand-maintained per `ai-setup/settings/codex/settings-map.md`. Walk that map: for each Claude preference, confirm the documented Codex equivalent still holds in `~/.codex/config.toml` (reasoning effort, `approval_policy`/`sandbox_mode`, notify hooks, memory off, basic-memory MCP). Flag any row whose Codex status has drifted from what the map claims.

Present recommendations one at a time.

## Phase 5: Basic-Memory Audit

Use the basic-memory MCP tools to inventory all notes. For each note:

1. **Staleness** — Content outdated? Check dates and accuracy.
2. **Duplicates** — Overlapping notes? Use `search_notes` to find near-duplicates.
3. **Dead references** — Links to notes, files, or skills that no longer exist? (Watch for references to the old `claude-audit` name → now `ai-setup-audit`, and to any renamed skill.)
4. **Linkability** — Related notes not yet linked? Propose wiki-links.
5. **Cross-ecosystem references** — Should this note reference a skill or AGENTS.md section, or vice versa?
6. **Promote to AGENTS.md?** — Retrieved so often it belongs in the rules file?
7. **Demote from AGENTS.md?** — Verify Phase 2 demotion candidates and offer to create the notes.

Present recommendations one at a time.

## Phase 6: Ecosystem Links Summary

Final cross-cutting pass. You've reviewed everything individually — now look at the connections.

1. **Map the reference graph.** List references across the ecosystem:
   - AGENTS.md → skills, memory, MCP
   - Skills → other skills, memory, files
   - Memory → other memory, skills
   - Mark each healthy (target exists) or dead (target missing).
2. **Dead links.** Summarize all dead references found across phases; address any not yet handled.
3. **New link opportunities.** Propose cross-references that strengthen the setup (a skill that does X should reference the memory note about X; an AGENTS.md section about workflow Y should name the skill for Y; two related notes should link).
4. **Session summary.** List all changes made this session: rules-file edits, skills added/modified/removed, MCP servers changed, memory notes touched, links added.

Present recommendations one at a time.

## Phase 7: Sync & Publish

Because every live entry is a symlink into a repo, edits made during the audit already live in the repo — there is nothing to `cp` back. This phase commits them and, if the public core changed, publishes safely.

### Steps

1. **Confirm no orphaned edits.** Re-run the Phase 3 invariant and the Phase 1 `classify` sweep — every live entry should still resolve into a repo. Fix any BROKEN/ORPHAN/ABSENT before committing.

2. **Re-run the installer** if any skill/overlay/subagent was added, removed, or renamed, so links match the repos:
   ```bash
   bun ~/Desktop/Desktop/Code/ai-setup/install.ts \
     --overlay <path-to-private-overlay> [--overlay <path-to-another-overlay> ...]
   ```
   `install.ts` is idempotent and self-heals, but is add-only — if a skill was **renamed**, remove the stale `~/.agents/skills/<old>` symlink by hand first (the whole-dir `~/.claude/skills` link means Claude picks up the change automatically).

3. **Subagents** — if a reviewer subagent changed, recompile with Ruler (from `ai-setup/subagents/`) and re-check the `~/.claude/agents` + `~/.codex/agents` links:
   ```bash
   cd ~/Desktop/Desktop/Code/ai-setup/subagents && \
     npx @intellectronica/ruler apply --agents claude,codex --subagents --skills=false --with-mcp=false
   ```

4. **external-skills.json drift** — re-run the Phase 3 orphan/missing checks. If a third-party skill was installed or dropped this session, propose the concrete `external-skills.json` edit (correct `owner/repo: [skills]`) and let the user approve.

5. **README** — if owned skills were added/removed/renamed, ask whether the README skill table needs updating.

6. **Commit to `r2-main`.** Show `git status` and `git diff` in `ai-setup`, then offer a descriptive commit **on `r2-main`** (never commit the public snapshot directly).

### Publishing the public core (only if `ai-setup` changed)

The public `main` branch is a squashed snapshot force-pushed by `./squash-to-main.sh`. **Before publishing, a secrets scan is mandatory** — company/client data belongs in the private overlays only. Keep the universal patterns below as-is; swap the `ORG` placeholder for your own org/client identifiers (kept out of this public file on purpose — pull them from your private notes at run time):

```bash
cd ~/Desktop/Desktop/Code/ai-setup
ORG='your-org-slug|client-name|internal-domain'   # fill from private notes; do NOT commit real values here
grep -rInE "$ORG"'|awsapps\.com|[0-9]{12}|/Users/[^/ ]+/|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}' . \
  --include='*.md' --include='*.json' --include='*.ts' | grep -v node_modules
# → Review every hit. Universal patterns can false-positive on intentional
#   placeholders (an all-zeros account id, an example SSO-portal URL) — fine.
#   Real org identifiers, real account numbers, hardcoded home paths, AWS
#   keys, or GitHub tokens are NOT — move them to a private overlay.
```

If clean, publish and verify (reuse the same `$ORG`):
```bash
./squash-to-main.sh    # switches to the repo-owner gh account, force-pushes main, restores active account
gh api repos/RascalTwo/ai-setup/git/trees/main?recursive=1 --jq '.tree[].path' | grep -iE "$ORG"'|private' || echo "clean"
```
If a `gh` call fails with "Repository not found" / "Could not resolve to a Repository," the wrong account is active — `gh auth status`, then `gh auth switch -u <repo-owner-account>`, and retry. Restore your usual active account when done. **Private overlay repos publish through their own normal git flow, not `squash-to-main.sh`.**

**Golden rule still applies:** present every change individually. Don't auto-commit or auto-publish.

End with: **"Audit complete. Setup repos are in sync"** (and, if applicable, **"public core published and verified clean"**). **"Anything else you want to revisit?"**

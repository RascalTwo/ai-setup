---
description: "Weekly interactive audit of the AI-agent setup shared across Claude Code and OpenAI Codex — AGENTS.md rules, skills, MCP servers, settings, subagents, basic-memory. Use when the user asks to audit, optimize, clean up, or review their agent setup, keep their config fresh, or says 'run the weekly audit'. Also for stale skills, unused MCP servers, orphaned skills, drift in external-skills.json, or checking what's changed. Also refreshes the published explorables in viz-pages — the setup tour and the per-skill posters — so the public face of the setup doesn't drift from reality."
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
- **SYMLINK → repo** — healthy. Do not flag as "duplicate" or "stale snapshot." A symlinked file is one file on disk; there is no token doubling. Phase 9 does not `cp` these.
- **BROKEN** — the link's target is gone (a source dir was deleted/moved). This is real work: re-point or re-install. Sweep `~/.claude`, `~/.codex`, `~/.agents`, `~/.config/ccstatusline`, `~/.local/bin` for other links to the same vanished target.
- **REAL_DIR** — a real directory, not a link. For skills this is EITHER a legitimate third-party install (must be in `external-skills.json`) OR an **orphan** (Phase 3 invariant). For the rules file, a real (non-symlink) `CLAUDE.md`/`AGENTS.md` means the install broke — the repo copy is canonical.
- **ABSENT** — expected entry missing; re-run `install.ts`.

**Phase 9 corollary:** for healthy SYMLINK entries there is nothing to copy — you edit the repo file directly and the live link already reflects it. Never `cp` over a symlink — it replaces the link with a regular file and silently breaks the setup.

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

The report gives: skill invocation counts, subagent invocation counts (owned
reviewers, bare + namespaced folded together), MCP calls by server and by full
tool, top built-in tools, an error signal (count + top signatures), and token
totals for the window.

**Turn it into audit signal** by diffing against the Phase-1 inventory:
- Any installed skill NOT in the skill-invocation list → 0 Claude calls this
  window → least-used / removal candidate (subject to the Codex caveat above).
- Any owned subagent (r2-sdlc reviewer) NOT in the subagent-invocation list → 0
  Claude calls this window → dormant, subject to the Codex caveat **and** a
  pipeline caveat: reviewers are dispatched by the r2-sdlc pipeline and the
  gauntlet, so a quiet window usually means the pipeline was idle, not that the
  reviewer is dead — confirm before treating as a removal signal.
- Any configured MCP server NOT in the "by server" list → dormant → removal
  candidate (same caveat).
- Tools with high error counts → investigate in Phase 3/4/5.

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
# Owned reviewers: source of truth is .ruler/agents/*.md (Ruler compiles both).
ls ~/Desktop/Desktop/Code/ai-setup/subagents/.ruler/agents/*.md
# Live entries should be symlinks into ai-setup/subagents/.{claude,codex}/agents/
for d in ~/.claude/agents/* ~/.codex/agents/*; do
  [ -e "$d" ] || echo "BROKEN: $d"; [ -L "$d" ] && echo "$(basename "$d") -> $(readlink "$d")"
done
find ~/basic-memory -name "*.md" 2>/dev/null
```
The full source→compiled→live-link integrity check runs in Phase 4.
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

`external-skills.json` is the **single, manually-maintained source of truth** for third-party skills. (There is an `npx`-managed lock file on disk, but it silently fails to update, so do NOT trust it for provenance — the manifest is authoritative.) A real dir is accounted for **only** if its name is explicitly listed in the manifest. This means a repo entry of `"*"` (whole-catalog wildcard) defeats the check — its individual skill names aren't in the manifest, so they can't be verified by name. **Prefer enumerating a repo's skills explicitly over `"*"`**; that's the whole point of maintaining the manifest by hand, and it makes this check exact.

```bash
DOC=$HOME/Desktop/Desktop/Code/ai-setup/external-skills.json

# Repos documented with a "*" wildcard — their skills can't be name-verified.
wildcard_repos=$(jq -r '.repos | to_entries[] | select(.value | index("*")) | .key' "$DOC")

echo "--- Unaccounted: real dirs whose name is not explicitly in the manifest ---"
for d in ~/.agents/skills/*; do
  name=$(basename "$d")
  [ -L "$d" ] && continue                        # symlink into a repo = owned, fine
  grep -qF "\"$name\"" "$DOC" && continue         # explicitly named third-party, fine
  echo "UNACCOUNTED: $name"
done
[ -n "$wildcard_repos" ] && echo "(note: these repos use \"*\" — their skills appear above until enumerated: $wildcard_repos)"

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
- **UNACCOUNTED** — a real dir whose name isn't in the manifest. Two cases: (a) it belongs to a `"*"` wildcard repo listed in the note — the real fix is to replace that repo's `"*"` with its explicit skill list so the check goes quiet and precise; or (b) it's a genuine orphan — either promote it to an owned skill (move into `ai-setup/skills/` or an overlay so `install.ts` symlinks it) or document it (`owner/repo: ["skill"]` under `repos`). Ask the user which.
- **MISSING on disk** — the manifest promises it but it isn't installed. Re-install via `install.ts --externals` (or `npx skills add <repo> -s <skill> -g -a claude-code -a codex --yes`), or drop the manifest entry.
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

## Phase 4: Subagents Audit

The owned subagents are the **r2-sdlc reviewers** — agent definitions authored once in `ai-setup/subagents/.ruler/agents/*.md` and compiled by **Ruler** into `.claude/agents/*.md` (Claude) + `.codex/agents/*.toml` (Codex), then symlinked live on both agents. Audit them as rigorously as skills (Phase 3): they are owned, invocable units that put a description on every session's dispatch menu and waste tokens or mis-dispatch runs when stale, over-scoped, or vaguely triggered.

### The invariant (check first)

**The source of truth is `.ruler/agents/*.md`. Every source MUST have a compiled `.claude/agents/<name>.md` AND `.codex/agents/<name>.toml`, plus a healthy live symlink on BOTH agents.** Ruler does not delete a stale compiled file when a source is renamed or removed, so orphaned outputs are the common drift.

```bash
SUB=$HOME/Desktop/Desktop/Code/ai-setup/subagents
echo "--- Source reviewers missing a compiled output or a live link ---"
for s in "$SUB"/.ruler/agents/*.md; do
  n=$(basename "$s" .md)
  [ -f "$SUB/.claude/agents/$n.md" ]  || echo "MISSING compiled .claude: $n"
  [ -f "$SUB/.codex/agents/$n.toml" ] || echo "MISSING compiled .codex:  $n"
  { [ -L ~/.claude/agents/"$n".md ]  && [ -e ~/.claude/agents/"$n".md ];  } || echo "LINK broken/absent (claude): $n"
  { [ -L ~/.codex/agents/"$n".toml ] && [ -e ~/.codex/agents/"$n".toml ]; } || echo "LINK broken/absent (codex):  $n"
done
echo "--- Compiled outputs with NO source (stale after a rename/remove) ---"
for d in "$SUB"/.claude/agents/*.md; do
  n=$(basename "$d" .md); [ -f "$SUB/.ruler/agents/$n.md" ] || echo "ORPHAN compiled: $n"
done
```

- **MISSING compiled / LINK broken** — Ruler hasn't run since a source changed, or `install.ts` hasn't re-linked. Fix in Phase 9 (recompile + re-install).
- **ORPHAN compiled** — a reviewer was renamed/removed at the source but its compiled output and live links survive. Delete the stale `.claude/*.md` + `.codex/*.toml` + both live links by hand, then recompile.

### Per-subagent review (read each `.ruler/agents/*.md`)

Review the **source** file, never the compiled output — edits must land in `.ruler/agents/` or the next Ruler run overwrites them. For each reviewer:

1. **Description / triggering** — the frontmatter `description` (the "Use when… / Does NOT…" text) is what puts this reviewer on the dispatch menu on BOTH agents. Is it specific enough to fire at the right time and *not* fire otherwise? Vague descriptions cause mis-dispatch and wasted subagent runs — the subagent equivalent of a badly-triggered skill.
2. **Tool grants** — the `tools:` field. Least-privilege: does it grant exactly what the reviewer needs (a read-only reviewer gets `Read, Grep, Glob`, not `Edit`/`Write`/`Bash`)? Flag both over-grants and a tool the reviewer's job clearly needs but lacks.
3. **Staleness / dead references** — reviewers cite skills by name (`r2-sdlc-testing-paradigm`, `r2-sdlc-documentation-philosophy`) and name sibling reviewers in their scope boundaries. Verify every referenced skill and reviewer still exists.
4. **Scope boundaries** — each reviewer declares what it does NOT check and which sibling owns that ("test-reviewer handles tests"). Across the whole set, confirm the boundaries are mutually exclusive (no two reviewers claim the same job) and complete (no quality dimension falls through the cracks).
5. **Usage** — from the Phase 0 subagent-invocation counts. Zero Claude calls this window is subject to the Codex-blind caveat **and** the pipeline caveat (reviewers are dispatched by the r2-sdlc pipeline and the gauntlet, so a quiet window usually means the pipeline was idle). Confirm before treating as a removal signal.
6. **Overlay placement** — the reviewers are generic and public-safe by design. Flag any company/client specifics that crept into a definition; those belong in a private overlay, not the public core.
7. **Compiled parity** — after any edit to a source file, the `.md` and `.toml` must be recompiled together (Phase 9) so both agents see the same reviewer.

Present recommendations one at a time.

## Phase 5: MCP & Settings Audit

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

## Phase 6: Basic-Memory Audit

Use the basic-memory MCP tools to inventory all notes. For each note:

1. **Staleness** — Content outdated? Check dates and accuracy.
2. **Duplicates** — Overlapping notes? Use `search_notes` to find near-duplicates.
3. **Dead references** — Links to notes, files, or skills that no longer exist? (Watch for references to the old `claude-audit` name → now `ai-setup-audit`, and to any renamed skill.)
4. **Linkability** — Related notes not yet linked? Propose wiki-links.
5. **Cross-ecosystem references** — Should this note reference a skill or AGENTS.md section, or vice versa?
6. **Promote to AGENTS.md?** — Retrieved so often it belongs in the rules file?
7. **Demote from AGENTS.md?** — Verify Phase 2 demotion candidates and offer to create the notes.

Present recommendations one at a time.

## Phase 7: Ecosystem Links Summary

Final cross-cutting pass. You've reviewed everything individually — now look at the connections.

1. **Map the reference graph.** List references across the ecosystem:
   - AGENTS.md → skills, subagents, memory, MCP
   - Skills → other skills, memory, files
   - Subagents → skills, sibling subagents (scope-boundary references)
   - Memory → other memory, skills
   - Mark each healthy (target exists) or dead (target missing).
2. **Dead links.** Summarize all dead references found across phases; address any not yet handled.
3. **New link opportunities.** Propose cross-references that strengthen the setup (a skill that does X should reference the memory note about X; an AGENTS.md section about workflow Y should name the skill for Y; two related notes should link).
4. **Session summary.** List all changes made this session: rules-file edits, skills added/modified/removed, MCP servers changed, memory notes touched, links added.

Present recommendations one at a time.

## Phase 8: Refresh the Published Explorables

`ai-setup/viz-pages/` publishes a **lobby** of explorables to GitHub Pages — the public face of
this setup. Two kinds of page live there, and **both drift**:

- **The tour** (`rascal-ai-setup-tour/`) — the onboarding map of the whole setup.
- **The skill posters** (`skill-<atom>/`) — one self-hero card per atom, each selling why that
  atom exists, with a deep dive below the fold.

All of it is **hand-authored HTML** built with this repo's own `/viz` skill. Nothing regenerates
any of it, so it drifts silently every time a skill, MCP server, or subagent changes. **This audit
is the only cadence that catches that.** Treat these as deliverables of the audit, not static
pages — a published page that lies about the setup is worse than no page.

Run this after Phases 1–7, so the refresh reflects both the real inventory and every decision made
this session.

### A. The tour

#### Find the drift (mechanical check)

The tour names skills inline as `<strong>skill-name</strong>`, grouped into district sections
(`Owned core and setup operations`, `Media and local AI`, `Cloud, API, and delivery`,
`External community packs`), plus prose/summary strings that re-enumerate the owned set.

```bash
TOUR=$HOME/Desktop/Desktop/Code/ai-setup/viz-pages/rascal-ai-setup-tour/index.html

echo "--- Owned skills MISSING from the tour (added since the last refresh) ---"
for d in "$HOME"/Desktop/Desktop/Code/ai-setup/skills/*/; do
  n=$(basename "$d"); grep -qF "$n" "$TOUR" || echo "MISSING from tour: $n"
done

echo "--- Names the tour still claims that aren't installed (removed/renamed) ---"
grep -oE '<strong>[a-z0-9][a-z0-9-]{3,}</strong>' "$TOUR" | sed -E 's#</?strong>##g' | sort -u |
while read -r n; do [ -e "$HOME/.agents/skills/$n" ] || echo "possibly STALE in tour: $n"; done
```

The first list is **exact** — act on it. The second is a **heuristic**: the tour uses `<strong>`
for ordinary emphasis too, so eyeball the hits before treating one as stale.

### What to reconcile

Walk each finding against the Phase 1 inventory and this session's decisions:

1. **Skills** — every owned skill added / removed / renamed must be reflected, and a new one placed
   in the **right district** (a local-media skill belongs under "Media and local AI", not "Cloud,
   API, and delivery"). Third-party changes land in "External community packs".
2. **Summary / narration strings** — the tour repeats the owned set in prose (e.g. the
   `"Owned set: …"` line). A skill added to a district but missed here leaves the page
   self-contradictory — grep the skill name and fix **every** hit, not just the first.
3. **MCP servers, subagents, settings, install flow** — if Phase 4/5 changed any of these, the
   stops describing them are stale.
4. **Counts and shape** — the tour advertises "ten stops". If a stop is added or removed, fix the
   count everywhere it appears (headline, map, nav).
5. **Prose accuracy** — a stop describing a workflow that changed this session (a new AGENTS.md
   rule, a retired MCP server, a skill that now delegates to another) needs its *words* updated,
   not just its lists.

### B. The skill posters

Each poster stamps its subject on its card as **`data-atom="<skill-name>"`**. That's deliberate:
it keeps this check a one-second grep instead of a semantic judgment ("is this pitch still
compelling?"), which is slow and fails quietly.

```bash
REPO=$HOME/Desktop/Desktop/Code/ai-setup

echo "--- Posters whose atom NO LONGER EXISTS (renamed/removed skill) — real defect ---"
grep -rhoE 'data-atom="[^"]+"' "$REPO"/viz-pages/skill-*/index.html 2>/dev/null |
  cut -d'"' -f2 | sort -u |
  while read -r a; do [ -d "$REPO/skills/$a" ] || echo "ORPHAN poster: $a (advertises a skill that's gone)"; done

echo "--- Owned skills with no poster — a MENU, not a defect ---"
for d in "$REPO"/skills/*/; do
  n=$(basename "$d")
  grep -rqF "data-atom=\"$n\"" "$REPO"/viz-pages/skill-*/index.html 2>/dev/null || echo "no poster: $n"
done
```

Read the two lists **differently** — this is the part that matters:

- **ORPHAN poster** — a real defect, and the worst kind: a published page confidently selling a
  skill that no longer exists. Fix or delete it, and remember it's `public`+`listed`, so it's on
  the lobby right now. Renamed skill → rename the viz dir (`manage.ts move`) and update `data-atom`.
- **no poster** — **not** a defect. Posters are deliberately opt-in; most skills will never have
  one and that's correct. This list exists so adding one is a *decision* rather than an oversight.
  Do not read it out as a to-do list, and do not offer to generate the whole backlog — that's the
  meta-tooling trap. Raise a skill here only if it's genuinely load-bearing and undersold.

Then per **changed** atom: if a skill's behavior moved this session (a new flag, a delegation, a
retired dependency), its poster's **hook, proof, or receipt may now be a lie**. Check the posters
of skills you touched in Phases 2–5 specifically — those are the ones with real drift.

### Verify the render before moving on

These are live pages — a broken edit is invisible in a diff. Always re-render **every viz you
touched**:

```bash
V=$HOME/.claude/skills/viz/verify.ts
BASE=http://127.0.0.1:5180/Desktop/Desktop/Code/ai-setup/viz-pages

# ONE AT A TIME. See the caveat below — never run these concurrently.
bun "$V" "$BASE/rascal-ai-setup-tour/"          # tour: render only
bun "$V" "$BASE/skill-<atom>/" --og             # poster: ALSO regenerates og.auto.png
```

Require **`✓ 0 error(s)`**, then read `.verify/latest.png` and confirm the layout holds (no
overflowing labels, no orphaned arrows). Fix anything you find before Phase 9 — these are
committed and deployed there.

⚠️ **Two traps, both learned the hard way:**

1. **`verify.ts` is NOT parallel-safe.** It writes to one shared `.verify/latest.png` keyed to the
   *skill* dir, not the viz. Run two verifies at once (or fan out subagents that each verify) and
   they clobber each other — you will read a screenshot of a **different page** and cheerfully
   confirm a layout you never looked at. Verify **serially**, or copy `latest.png` somewhere
   unique immediately after each run.
2. **A poster's `og.auto.png` does not regenerate itself.** Edit a card and the *page* updates
   while the unfurl image stays stale — so chat keeps previewing the old pitch. Any poster whose
   card changed **must** be re-run with `--og`. Confirm it's still exactly 1200×630:
   `sips -g pixelWidth -g pixelHeight <og.auto.png>`.

   ⚠️ **`og.auto.png` is git-ignored** (`viz-pages/.gitignore`) — it is a **build input on disk**,
   not a tracked artifact. Two consequences: committing is not what makes it live (`deploy.sh`
   reads `viz-pages/` **off disk**, so regenerate *before* deploying, not before committing); and
   a **fresh clone has no OG images at all** until `--og` is re-run per viz, which silently
   degrades every unfurl and the lobby's grid thumbnails + auto-montage. If you ever publish from
   a clean checkout, regenerate first.

**Golden rule still applies:** present each change individually. Don't rewrite a page wholesale,
and don't auto-apply.

## Phase 9: Sync & Publish

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

6. **Explorables** — confirm Phase 8's refresh is on disk (`viz-pages/`) and rendered clean: the tour, plus any poster you touched (including its regenerated `og.auto.png`). They're committed with everything else in the next step, and deployed below.

7. **Commit to `r2-main`.** Show `git status` and `git diff` in `ai-setup`, then offer a descriptive commit **on `r2-main`** (never commit the public snapshot directly).

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
**Deploy the explorables** (only if Phase 8 changed any). The whole `viz-pages/` container — lobby,
tour, and every poster — publishes to GitHub Pages together, on its own path, **not** via
`squash-to-main.sh`:

```bash
DRY_RUN=1 ~/Desktop/Desktop/Code/ai-setup/viz-pages/deploy.sh   # build only, sanity-check first
~/Desktop/Desktop/Code/ai-setup/viz-pages/deploy.sh              # deploy (exit 0 = deployed)
```

It reads `viz-pages/` off disk (works from any branch/state), auto-detects the host from `origin`,
and auto-switches to a `gh` account with push access — no manual `gh auth switch`. Afterwards,
confirm the live page actually renders the refresh:
<https://rascaltwo.github.io/ai-setup/rascal-ai-setup-tour/>. A tour refreshed in Phase 8 but never
deployed leaves the *public* map stale — which is the exact failure this phase exists to prevent.

If a `gh` call fails with "Repository not found" / "Could not resolve to a Repository," the wrong account is active — `gh auth status`, then `gh auth switch -u <repo-owner-account>`, and retry. Restore your usual active account when done. **Private overlay repos publish through their own normal git flow, not `squash-to-main.sh`.**

**Golden rule still applies:** present every change individually. Don't auto-commit or auto-publish.

End with: **"Audit complete. Setup repos are in sync"** (and, if applicable, **"public core published and verified clean"**). **"Anything else you want to revisit?"**

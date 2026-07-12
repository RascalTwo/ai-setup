---
description: "Weekly interactive audit of the entire Claude Code ecosystem — CLAUDE.md files, skills, MCP servers, settings, and basic-memory. Use when the user asks to audit, optimize, clean up, or review their Claude Code setup, mentions wanting to keep their config fresh, or says something like 'run the weekly audit'. Also use when the user mentions stale skills, unused MCP servers, or wants to check what's changed in their setup."
---

# Claude Code Ecosystem Audit

A phased, interactive audit of the user's entire Claude Code setup. The goal is to keep everything fresh, eliminate cruft, and strengthen cross-references across the ecosystem.

**Golden rule: never auto-apply changes.** Present every recommendation individually and let the user decide. Explain the reasoning — don't just say "remove this," say why it's a candidate for removal.

## How the Ecosystem Fits Together

The user's Claude Code setup is a connected graph, not isolated silos:

- **CLAUDE.md files** — persistent instructions loaded every session (global at `~/.claude/CLAUDE.md`, per-project at `<project>/CLAUDE.md`)
- **Skills** — reusable workflows invoked by `/name` or auto-triggered by description matching
  - Custom skills: `~/.claude/skills/` (global) and `<project>/.claude/skills/` (project)
  - Installed skills: `~/.claude/plugins/marketplaces/` (from plugin marketplaces)
- **MCP servers** — external tool integrations defined in `.mcp.json` files under `~/.claude/plugins/marketplaces/.../external_plugins/`
- **Settings** — `~/.claude/settings.json` (hooks, telemetry, behavior) and `~/.claude/settings.local.json` (permissions, MCP enables)
- **Basic-memory** — persistent notes in `~/basic-memory/` managed by the basic-memory MCP server. Notes can link to each other via permalinks and wiki-links.

Any of these can reference any other. A CLAUDE.md can point to a skill. A skill can reference a memory note. A memory note can link to another note. Dead references waste tokens and confuse the model. Missing references mean missed opportunities.

## The claude-setup Repo Mirror — Read Before Auditing

The user keeps a version-controlled snapshot of their Claude Code config at `$HOME/Desktop/Desktop/Code/ai-setup`. **By design**, the live entries under `~/.claude/` are **symlinks** into that repo (or into related repos like `sai-jm-snippets/r2-sdlc`, `sai-jm-snippets/ai-journaling`, `~/.agents/`). The repo IS the source of truth; the live entries are pointers.

The standard sync mechanism is **directory-level symlinks**:

- `~/.claude/CLAUDE.md` → symlink to a file in `claude-setup/`
- `~/.claude/skills/<name>/` → symlink to a directory under `claude-setup/skills/<name>/` (or another repo). The whole skill folder is one link, so SKILL.md plus any siblings (scripts/, references/, supporting .md, etc.) are all shared automatically.

**Pre-flight classification (run BEFORE Phase 1 discovery output):**

```bash
classify() {
  local live="$1" repo="$2"
  if [ -L "$live" ]; then echo "SYMLINK"; return; fi
  if [ ! -e "$repo" ]; then echo "LIVE_ONLY"; return; fi
  if diff -rq "$live" "$repo" >/dev/null 2>&1; then echo "COPY_IN_SYNC"
  else echo "DRIFT"; fi
}

# CLAUDE.md
classify ~/.claude/CLAUDE.md ~/Desktop/Desktop/Code/ai-setup/CLAUDE.md

# Each skill
for d in ~/.claude/skills/*/; do
  name=$(basename "$d")
  classify "${d%/}" "$HOME/Desktop/Desktop/Code/ai-setup/skills/$name"
done
```

⚠️ **Trailing-slash gotcha:** `ls -ld ~/.claude/skills/foo/` shows `d` (drwx...) even when `foo` is a symlink, because the trailing slash makes `ls` follow the link. Always test with `[ -L ]` or `readlink`, NEVER infer "real directory" from `ls -ld`. Same trap for `stat -f '%i'` — it follows symlinks by default and returns the target's inode, which can make two symlinked locations look "hardlinked" when they're actually one symlink resolving to one target.

How to use the classification:
- **SYMLINK / COPY_IN_SYNC** — never flag as "duplicate," "stale snapshot," or "section-for-section copy of global." Phase 7 has nothing to do.
- **DRIFT** — this is the real Phase 7 work. Show the diff and propose `cp live → repo` (NOT the other way around — live is canonical).
- **LIVE_ONLY** — skill or file exists locally but isn't tracked in the repo. Two subtypes:
  - *Plugin-installed* (under `~/.claude/plugins/marketplaces/...`) — tracked by `enabledPlugins` in `settings.json`, not by file copy. Don't propose copying.
  - *External-referenced* (symlink target under `~/.agents/skills/...`) — installed by `npx skills add`, tracked **by reference** in `ai-setup/external-skills.json` and `~/.agents/.skill-lock.json`. Don't propose copying — instead verify it's documented in `external-skills.json`. See Phase 3 → External Skills.
  - *Truly untracked* — neither of the above. Ask the user if it should be added to `claude-setup/skills/` or to `external-skills.json`.

When Phase 1 reports the inventory, **deduplicate symlink targets** — a symlinked SKILL.md or skill dir is one skill, not two. Same for the symlinked CLAUDE.md.

**Even if a CLAUDE.md were auto-loaded from inside `claude-setup/`, a symlinked file is one file on disk — there is no token doubling.** The user does not start Claude Code from the `claude-setup` folder anyway. Do not raise "auto-load risk" or "token duplication" as a finding for any mirrored file.

**Phase 7 corollary:** for SYMLINK and COPY_IN_SYNC pairs there is nothing to copy. Only run `cp` for genuinely DRIFT pairs. Never `cp` over a symlink — it would replace the link with a regular file and silently break the snapshot relationship.

## Phase 0: Usage Snapshot (from session transcripts)

Usage data comes from Claude Code's own local session transcripts at
`~/.claude/projects/**/*.jsonl`. Claude Code writes these unconditionally, so
there is 6+ months of gap-free history and nothing to keep running. (This
replaced a Prometheus/Loki/Tempo/OTEL Docker stack: it only had data while it
was up, had to be babysat, and was down at audit time — the transcripts had
everything it would have provided and more. Decommissioned 2026-07-11.)

**Launch the usage report in the BACKGROUND now**, then go straight to Phase 1
while it runs — it greps ~1GB at a 30d window (~1 min), so overlap it with
discovery rather than blocking:

```bash
# run_in_background: true — read the result during/after Phase 1
bash ~/.claude/skills/claude-audit/scripts/usage-report.sh --days 30
```

The report gives: skill invocation counts, MCP calls by server and by full
tool, top built-in tools, an error signal (count + top signatures), and token
totals for the window.

**Turn it into audit signal** by diffing against the Phase-1 inventory:
- Any installed skill NOT in the skill-invocation list → 0 calls this window →
  least-used / removal candidate. (Confirm with the user — some skills are
  legitimately rare-but-critical, e.g. an incident-response skill.)
- Any configured MCP server NOT in the "by server" list → dormant (0 calls) →
  removal candidate.
- Tools with high error counts → investigate in Phase 3/4.

If `~/.claude/projects` is empty or the script errors, say so and fall back to
manual judgment — don't block. Present the report + derived candidates to the
user before proceeding.

## Phase 1: Discovery

Use subagents in parallel to inventory everything:

**Subagent 1 — CLAUDE.md files:**
```bash
# Global
cat ~/.claude/CLAUDE.md
# All projects
find ~/Desktop/Desktop/Code -name "CLAUDE.md" -maxdepth 3 2>/dev/null
```

**Subagent 2 — Skills:**
```bash
# Global skills (mix of in-repo symlinks and external-referenced symlinks)
ls -la ~/.claude/skills/
# Resolve each symlink to learn its provenance (sai-jm-snippets vs ~/.agents vs other)
for d in ~/.claude/skills/*; do
  [ -L "$d" ] && echo "$(basename "$d") -> $(readlink "$d")"
done | sort
# External skills install record (referenced, not vendored)
jq -r '.skills | to_entries[] | "\(.key)\t\(.value.source)"' ~/.agents/.skill-lock.json 2>/dev/null
# Project custom skills (all projects)
find ~/Desktop/Desktop/Code -path "*/.claude/skills/*" -name "SKILL.md" -maxdepth 5 2>/dev/null
# Plugin-installed skills (separate channel from external skills)
ls ~/.claude/plugins/marketplaces/claude-plugins-official/plugins/ 2>/dev/null
```

**Subagent 3 — MCP servers and settings:**
```bash
# MCP server definitions
find ~/.claude/plugins -name ".mcp.json" 2>/dev/null
# Settings
cat ~/.claude/settings.json
cat ~/.claude/settings.local.json
```

**Subagent 4 — Basic-memory:**
Use `mcp__basic-memory__search_notes` or `mcp__basic-memory__recent_activity` to get a full inventory. Also list the directory structure:
```bash
find ~/basic-memory -name "*.md" 2>/dev/null
```

**Present a summary table** like:

| Category | Count | Details |
|----------|-------|---------|
| CLAUDE.md files | N | global + N projects |
| Custom skills (global) | N | list names |
| Custom skills (project) | N | list names + projects |
| Installed skills | N | list names |
| MCP servers | N | list names |
| Basic-memory notes | N | list directories |

Then ask: **"Which phases do you want to run? All of them, or specific ones?"**

## Phase 2: CLAUDE.md Audit

For each CLAUDE.md file found, review it **section by section** (by top-level heading).

For each section, evaluate:

1. **Staleness** — Does this still apply? Is it referencing outdated tools, versions, or workflows?
2. **Redundancy** — Does this duplicate something Claude Code already does by default? (Be honest about what you know is built-in vs. what you're unsure about — if unsure, say so.)
3. **Duplication across files** — Is the same instruction repeated in global and project CLAUDE.md? If so, it probably belongs in only one place.
4. **Demote to memory?** — Is this niche or situational? Would it be better as a basic-memory note retrieved on demand rather than loaded every session? Good candidates: instructions that apply to <10% of sessions.
5. **Promote from memory?** — Are there basic-memory notes the user retrieves so frequently they should just be in CLAUDE.md? Check the Phase 0 usage report (basic-memory MCP call frequency) or ask the user.
6. **Missing references** — Should this section point to a skill, memory note, or other resource? For example, if a section describes a workflow that has a corresponding skill, it should reference that skill.

Present each recommendation one at a time. Wait for the user's decision before moving on.

## Phase 3: Skills Audit

### Custom Skills

For each custom skill (read its SKILL.md):

1. **Quality** — Is the description clear and specific enough to trigger correctly? Is the body well-structured? Are there obvious improvements?
2. **Staleness** — Does it reference files, APIs, or workflows that no longer exist?
3. **Dead references** — Does it reference other skills, memory notes, or files that don't exist? Check each reference.
4. **Cross-references** — Should it reference other skills or memory notes that it doesn't currently? Would a "See also" section help?
5. **Usage** — From the Phase 0 report, how often is this skill invoked (Skill-tool count)? Low usage + stale content = strong removal candidate.

### External Skills (`~/.agents/skills/`)

These are skills installed via `npx skills add` (vercel-labs/skills CLI). They live in `~/.agents/skills/<name>/`, are symlinked from `~/.claude/skills/<name>/`, and are tracked **by reference** in `ai-setup/external-skills.json`. The on-machine record is `~/.agents/.skill-lock.json`.

**Drift check — run this every audit.** The on-disk dirs in `~/.agents/skills/` are the source of truth for what's installed (more reliable than the lock file, which can have display-name quirks like `Hook Development` vs `hook-development`). `external-skills.json` is the human-readable mirror. They WILL drift if a new skill is installed without updating the doc (this has happened — new external installs slipped past several audits before being caught). To diff:

```bash
DOC=$HOME/Desktop/Desktop/Code/ai-setup/external-skills.json

# Each on-disk skill should appear somewhere in the doc.
echo "--- Installed but undocumented ---"
for s in $(ls ~/.agents/skills/); do
  grep -qF "$s" "$DOC" || echo "MISSING in doc: $s"
done

# Each install URL in the doc should resolve to an installed skill.
# (Pulls skill names out of fenced `npx skills add .../tree/.../<skill>` URLs.
#  Bare-repo URLs without /tree/ are bulk or single-skill-at-root installs;
#  skip them here — verify those by inspection.)
echo "--- Documented but uninstalled ---"
grep -oE 'npx skills add https://[^ )]+' "$DOC" \
  | awk '{print $NF}' \
  | grep '/tree/' \
  | sed -E 's|.*/tree/[^/]+/||; s|/$||' \
  | awk -F/ '{print $NF}' \
  | sort -u \
  | while read s; do
      [ -d ~/.agents/skills/"$s" ] || echo "DOC references but not on disk: $s"
    done
```

For each finding:
- **MISSING in doc** — undocumented install. Open `external-skills.json` and add the install URL under the right source section. Ask the user before writing.
- **DOC references but not on disk** — uninstalled but still documented. Either re-install (`cd ~ && npx skills add <url>`) or remove the doc entry.

Note: deep-research's URL is the bare repo (no `/tree/main/...` suffix). The "documented but uninstalled" check correctly handles that — its repo-root install URL gets reduced to `claude-deep-research-skill`, which won't match a `~/.agents/skills/` dir. As long as deep-research itself appears somewhere in the doc body (it does, in the source-section header), the "installed but undocumented" check passes. If you add another bare-repo install, document the skill name in the section heading or a code comment so the substring grep finds it.

Also confirm every external symlink in `~/.claude/skills/` has a corresponding `~/.agents/skills/<name>/` directory (catches half-broken installs):

```bash
for d in ~/.claude/skills/*; do
  if [ -L "$d" ] && [[ "$(readlink "$d")" == */.agents/skills/* ]]; then
    [ -e "$d" ] || echo "BROKEN: $(basename "$d") -> $(readlink "$d") (target missing)"
  fi
done
```

Then for each external skill present, sanity-check it the same way as Custom Skills above (quality, staleness, dead references, usage).

### Plugin-Installed Skills

List all skills installed from the plugins marketplace (`~/.claude/plugins/marketplaces/.../plugins/`). For each:

1. **Enabled?** — Check `enabledPlugins` in `~/.claude/settings.json`. A plugin on disk but not enabled is dormant and not loaded into sessions.
2. **Still needed?** — Does the user still use this? Check the Phase 0 usage report, otherwise ask.
3. **Overlap** — Does it overlap with a custom or external skill the user has written? If so, which is better?
4. **Working?** — Are there error signals in the Phase 0 report suggesting it's broken?

Present recommendations one at a time.

## Phase 4: MCP & Settings Audit

### MCP Servers

List all configured MCP servers from `.mcp.json` files. For each:

1. **Still needed?** — Check the Phase 0 report (MCP calls by server/tool) for call counts. Zero calls in the window = removal candidate.
2. **Working?** — Check the Phase 0 report's error signal. High error count = needs investigation.
3. **Referenced?** — Do any CLAUDE.md files or skills reference this server? If it's unreferenced AND unused, strong removal candidate.
4. **Missing?** — Do any skills or CLAUDE.md sections reference an MCP server that isn't configured?

### Settings

Review `~/.claude/settings.json` and `settings.local.json`:

1. **Hooks** — Are all configured hooks still relevant? Do they reference scripts that exist?
2. **Permissions** — Are the allowlisted permissions still needed?
3. **OTEL telemetry** — The monitoring stack was decommissioned (see Phase 0). Confirm the `OTEL_*` / `CLAUDE_CODE_ENABLE_TELEMETRY` env in settings.json is disabled — it should not be exporting to a dead endpoint. (Re-enable only if the user spins up an on-demand stack.)
4. **Conflicts** — Any settings that contradict CLAUDE.md instructions?
5. **Statusline binary** — The `statusLine.command` runs the locally-installed `ccstatusline` (not `npx @latest`, to avoid a network resolve every refresh). Trade-off: it won't auto-update. Refresh it here on the audit cadence:

   ```bash
   npm outdated -g ccstatusline    # is a newer version out?
   npm i -g ccstatusline@latest     # update if so
   ```

   The pacing widgets it drives (`statusline-{cache,5h,wk}.sh` + `statusline-lib.sh`) are custom-command widgets defined in `settings/ccstatusline.json` — if a ccstatusline update changes the config schema (`version` bump) or the custom-command stdin contract, re-verify one render: `echo '{...}' | ccstatusline`.

Present recommendations one at a time.

## Phase 5: Basic-Memory Audit

Use the basic-memory MCP tools to inventory all notes.

For each note:

1. **Staleness** — Is the content outdated? Check modification dates and whether the information is still accurate.
2. **Duplicates** — Are there notes with overlapping content? Use `mcp__basic-memory__search` to find similar notes.
3. **Dead references** — Does the note link to other notes, files, or skills that no longer exist?
4. **Linkability** — Are there notes that relate to each other but aren't linked? Use `mcp__basic-memory__search` to find topically related notes and propose wiki-links between them.
5. **Cross-ecosystem references** — Should this note reference a skill or CLAUDE.md section? Should a skill or CLAUDE.md reference this note?
6. **Promote to CLAUDE.md?** — Is this note retrieved so often it should be in CLAUDE.md instead?
7. **Demote from CLAUDE.md?** — (Already covered in Phase 2, but verify the demotion candidates from that phase and offer to create the memory notes.)

Present recommendations one at a time.

## Phase 6: Ecosystem Links Summary

This is the final cross-cutting pass. By now you've reviewed everything individually — this phase looks at the connections between them.

1. **Map the reference graph.** List all references found across the ecosystem:
   - CLAUDE.md → skills, memory, MCP
   - Skills → other skills, memory, files
   - Memory → other memory, skills
   - Show which are healthy (target exists) and which are dead (target missing)

2. **Dead links.** Summarize all dead references found across all phases. If any weren't addressed in earlier phases, address them now.

3. **New link opportunities.** Propose cross-references that would strengthen the ecosystem. Examples:
   - A skill that does X should reference the memory note about X
   - A CLAUDE.md section about workflow Y should mention the skill for Y
   - Two memory notes about related topics should link to each other

4. **Session summary.** List all changes made during this audit session:
   - Sections removed/edited in CLAUDE.md files
   - Skills removed/modified
   - MCP servers removed
   - Memory notes created/updated/deleted
   - Links added

Present recommendations one at a time.

## Phase 7: Sync to claude-setup Repository

The user maintains a version-controlled snapshot of their Claude Code setup at:
`$HOME/Desktop/Desktop/Code/ai-setup`

This phase syncs any changes made during the audit (or since the last sync) back to that repo so it stays current.

### File Mappings

| Live Config | Repo Location |
|---|---|
| `~/.claude/CLAUDE.md` | `claude-setup/CLAUDE.md` |
| `~/.claude/settings.json` | `claude-setup/settings/settings.json` |
| `~/.claude/skills/<name>/SKILL.md` | `claude-setup/skills/<name>/SKILL.md` |

### Steps

1. **Diff each mapped file** — compare the live config to the repo copy using `diff`. Present each diff to the user.

2. **Handle new skills** — check if there are custom skills in `~/.claude/skills/` that don't have a corresponding directory in `claude-setup/skills/`. For each new skill, ask the user if it should be added to the repo.

3. **Handle removed skills** — check if there are skill directories in `claude-setup/skills/` that no longer exist in `~/.claude/skills/`. For each, ask the user if it should be removed from the repo.

4. **Apply approved changes** — for each diff the user approves, copy the live file to the repo location. For new skills, create the directory and copy the SKILL.md. For removed skills, delete the directory.

5. **External-skills drift check** — re-run the diff from Phase 3 → External Skills (`jq`/`grep`/`diff` against `~/.agents/.skill-lock.json` and `ai-setup/external-skills.json`). If anything dropped during the session or was installed without doc updates, propose a concrete edit to `external-skills.json` (with the right install URL under the right source section) and let the user approve it.

6. **Check README** — if in-repo skills were added or removed, ask the user if the README table needs updating.

7. **Offer to commit** — show the user `git status` and `git diff --staged` in the claude-setup repo, then offer to create a commit with a descriptive message summarizing what changed.

**Golden rule still applies:** present every change individually and let the user decide. Don't auto-copy files.

End with: **"Audit complete. claude-setup repo is in sync. Anything else you want to revisit?"**

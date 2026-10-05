## Contents
- Phase 1: Discovery

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

**Subagent 5 — Plugins (Claude only):**

Claude Code plugins are a SEPARATE install surface from `~/.agents/skills`, and
nothing else in this audit looks at them. They ship their own skills, so a plugin
can silently duplicate a skill you installed directly — and an uninstalled or
moved plugin leaves a registration behind pointing at a path that no longer exists.
Found on 2026-08-30: a duplicate `frontend-design`, a duplicate `ponytail`, and an
`r2-sdlc@claude-setup` entry whose `installPath` had been deleted, its marketplace
still named for the pre-rename repo.

```bash
claude plugin list                      # name, version, scope, enabled/disabled
jq -r '.plugins | to_entries[] | "\(.key)  \(.value[0].scope)  \(.value[0].installedAt[0:10])"' \
  ~/.claude/plugins/installed_plugins.json
jq -r 'keys[]' ~/.claude/plugins/known_marketplaces.json

# DEAD registration: installPath no longer on disk
jq -r '.plugins | to_entries[] | "\(.key)\t\(.value[0].installPath)"' \
  ~/.claude/plugins/installed_plugins.json |
  while IFS=$'\t' read -r n p; do [ -d "$p" ] || echo "DEAD installPath: $n -> $p"; done

# DEAD marketplace: a directory-sourced marketplace whose path is gone
jq -r 'to_entries[] | select(.value.source.source=="directory") | "\(.key)\t\(.value.installLocation)"' \
  ~/.claude/plugins/known_marketplaces.json |
  while IFS=$'\t' read -r n p; do [ -d "$p" ] || echo "DEAD marketplace: $n -> $p"; done

# COLLISION: a plugin ships a skill name you also install directly
for f in $(/usr/bin/find ~/.claude/plugins/cache -name SKILL.md 2>/dev/null); do
  n=$(basename "$(dirname "$f")")
  [ -e ~/.agents/skills/"$n" ] && echo "COLLISION: $n (plugin + ~/.agents/skills)"
done | sort -u

# STALE cache, two levels. `claude plugin uninstall` does NOT delete the cached
# plugin dir, so a collision can survive the uninstall that was meant to end it.
/bin/ls ~/.claude/plugins/cache 2>/dev/null | while read -r m; do          # marketplace level
  jq -e --arg m "$m" 'has($m)' ~/.claude/plugins/known_marketplaces.json >/dev/null \
    || echo "ORPHAN cache dir: $m ($(du -sh ~/.claude/plugins/cache/$m | cut -f1))"
done
for d in ~/.claude/plugins/cache/*/*; do                                   # plugin level
  [ -d "$d" ] || continue; n=$(basename "$d")
  jq -e --arg n "$n" '.plugins | keys | map(split("@")[0]) | index($n)' \
    ~/.claude/plugins/installed_plugins.json >/dev/null 2>&1 \
    || echo "STALE cache: $n ($(du -sh "$d" | cut -f1)) — uninstalled but not deleted"
done
```

Report each finding with its remedy: `claude plugin uninstall <name@marketplace>`,
`claude plugin marketplace remove <name>`, or removing an orphan cache dir by hand
(`claude plugin prune` only removes AUTO-installed dependencies — it will report
"nothing to prune" while orphan cache dirs sit there).

**Prefer a skill over a plugin when both exist.** A skill in `~/.agents/skills` is
reproducible by `install.ts` from a manifest; a plugin is not, and is invisible to
every other check in this audit. Uninstalling a duplicate plugin does NOT remove
the directly-installed skill — verify that after, it is the whole point.

**Present a summary table** like:

| Category | Count | Details |
|----------|-------|---------|
| Rules file (AGENTS.md) | 1 canonical | + N per-project |
| Owned skills (symlink → repo) | N | list names + which repo |
| Third-party skills (real dir) | N | list names |
| MCP servers | N | Claude: … / Codex: … |
| Subagents | N | both agents resolve? |
| Basic-memory notes | N | list directories |
| Plugins (Claude) | N | enabled/disabled; collisions; dead paths |

Then ask: **"Which phases do you want to run? All of them, or specific ones?"**


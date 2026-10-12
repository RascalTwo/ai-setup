## Phase 4: Subagents Audit

The owned subagents are the **r2-sdlc reviewers** — agent definitions authored once in `ai-setup/subagents/.ruler/agents/*.md` and compiled by **Ruler** into `.claude/agents/*.md` (Claude) + `.codex/agents/*.toml` (Codex), then symlinked live on both agents. Audit them as rigorously as skills (Phase 3): they are owned, invocable units that put a description on every session's dispatch menu and waste tokens or mis-dispatch runs when stale, over-scoped, or vaguely triggered.

### The invariant (check first)

**The source of truth is `.ruler/agents/*.md`. Every source MUST have a compiled `.claude/agents/<name>.md` AND `.codex/agents/<name>.toml`, plus a healthy live link on BOTH agents.** Ruler does not delete a stale compiled file when a source is renamed or removed, so orphaned outputs are the common drift.

The two agents are linked differently (`install.ts`, "Subagents"): `~/.claude/agents` is ONE
whole-dir symlink to `subagents/.claude/agents`, while `~/.codex/agents/` is a real dir of
per-file links. Testing `[ -L ~/.claude/agents/<name>.md ]` is therefore false for every
healthy reviewer — check the directory link instead.

```bash
SUB=$HOME/Desktop/Desktop/Code/ai-setup/subagents
echo "--- Claude's agents dir must be one link to the compiled dir ---"
[ "$(readlink ~/.claude/agents)" = "$SUB/.claude/agents" ] || echo "LINK wrong (claude): ~/.claude/agents -> $(readlink ~/.claude/agents)"
echo "--- Source reviewers missing a compiled output or a live link ---"
for s in "$SUB"/.ruler/agents/*.md; do
  n=$(basename "$s" .md)
  [ -f "$SUB/.claude/agents/$n.md" ]  || echo "MISSING compiled .claude: $n"
  [ -f "$SUB/.codex/agents/$n.toml" ] || echo "MISSING compiled .codex:  $n"
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
3. **Staleness / dead references** — reviewers cite skills by name (`r2-testing-paradigm`, `r2-sdlc-documentation-philosophy`) and name sibling reviewers in their scope boundaries. Verify every referenced skill and reviewer still exists.
4. **Scope boundaries** — each reviewer declares what it does NOT check and which sibling owns that ("test-reviewer handles tests"). Across the whole set, confirm the boundaries are mutually exclusive (no two reviewers claim the same job) and complete (no quality dimension falls through the cracks).
5. **Usage** — from the Phase 0 subagent-invocation counts. Zero Claude calls this window is subject to the Codex-blind caveat **and** the pipeline caveat (reviewers are dispatched by the r2-sdlc pipeline and the gauntlet, so a quiet window usually means the pipeline was idle). Confirm before treating as a removal signal.
6. **Overlay placement** — the reviewers are generic and public-safe by design. Flag any company/client specifics that crept into a definition; those belong in a private overlay, not the public core.
7. **Compiled parity** — after any edit to a source file, the `.md` and `.toml` must be recompiled together (Phase 9) so both agents see the same reviewer.

Present recommendations one at a time.

## Phase 5: MCP & Settings Audit

### Health probe — `/doctor` (Claude only, run first)

Claude Code ships a self-diagnosis that covers install health, settings parse errors, MCP connectivity, and IDE integration, and can fix some of what it finds:

```
/doctor          # alias: /checkup
```

Run it first and fold its output into this phase — it front-runs the manual checks below on the Claude side. **Then set it aside.** It is one probe of one agent, and it knows nothing about Codex, the overlays, the symlink model, or basic-memory. **Every other check in this audit still runs in full** — a green `/doctor` means Claude's own install is healthy, never that the setup is.

There is no Codex counterpart. Codex-side health stays manual: `codex mcp list` for server reachability, plus the `settings-map.md` walk below.

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
   The pacing widgets (`statusline-{cache,5h,wk}.sh` + `statusline-lib.sh`) are custom-command widgets in `tools/statusline/ccstatusline.json` — if a ccstatusline update bumps the config `version` or the stdin contract, re-verify one render: `echo '{...}' | ccstatusline`.

**Codex** — settings have no shared format; they're hand-maintained per `ai-setup/settings/codex/settings-map.md`. Walk that map: for each Claude preference, confirm the documented Codex equivalent still holds in `~/.codex/config.toml` (reasoning effort, `approval_policy`/`sandbox_mode`, notify hooks, memory off, basic-memory MCP). Flag any row whose Codex status has drifted from what the map claims.

Present recommendations one at a time.


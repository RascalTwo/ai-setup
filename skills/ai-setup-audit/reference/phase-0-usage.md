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


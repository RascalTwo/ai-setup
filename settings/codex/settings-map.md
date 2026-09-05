# Claude ↔ Codex settings: the non-obvious bits

What's actively SET lives in the real files — `settings/claude-code/settings.json`,
`settings/codex/config-prefs.toml` (+ private overlay), and the table-appends in
`install.ts` (`[mcp_servers.basic-memory]`, `[[hooks.PreToolUse]]` for rtk). This
file records ONLY what isn't visible there, so it can't be re-derived — no mirror
of set values (that just rots).

## Claude settings Codex satisfies by default, or we deliberately leave unset
- `cleanupPeriodDays: 99999` → Codex keeps sessions by default (no time-based retention).
- `autoMemoryEnabled: false` → shared memory is basic-memory (MCP). Codex 0.149 renamed this
  from `features.memories` to a top-level `[memories]` table, and now ships a real
  consolidation pipeline (`memories_1.sqlite`, `memory_consolidate_global`). We set no
  `[memories]` table, so it runs on Codex defaults — and those defaults are **not verified
  off**. Re-check before trusting this row (audited 2026-08-30).
- `autoCompactEnabled: false` → Codex 0.149 **does** have knobs now —
  `model_auto_compact_token_limit` (+ `_scope`), plus `features.token_budget.*`. We set
  none of them, so behavior is unchanged, but "leave default" is now a choice we are
  making rather than the only option (audited 2026-08-30).

## Claude-only (no Codex equivalent)
`voiceEnabled`, `awaySummaryEnabled`, `agentPushNotifEnabled`.

## Reasoning effort — at parity
Both sides sit at `high` (Claude `effortLevel`, Codex `model_reasoning_effort`). The
earlier `xhigh` vs `high` gap closed when Claude moved down to `high`; nothing to do.
If Claude is ever bumped back to `xhigh`, re-check whether the Codex model supports it.

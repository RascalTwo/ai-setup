# Claude ↔ Codex settings: the non-obvious bits

What's actively SET lives in the real files — `settings/claude-code/settings.json`,
`settings/codex/config-prefs.toml` (+ private overlay), and the table-appends in
`install.ts` (`[mcp_servers.basic-memory]`, `[[hooks.PreToolUse]]` for rtk). This
file records ONLY what isn't visible there, so it can't be re-derived — no mirror
of set values (that just rots).

## Claude settings Codex already satisfies by default (so intentionally unset)
- `cleanupPeriodDays: 99999` → Codex keeps sessions by default (no time-based retention).
- `autoMemoryEnabled: false` → Codex `features.memories` off by default; shared memory is basic-memory (MCP).
- `autoCompactEnabled: false` → Codex has no disable flag; leave default unless unwanted compaction appears.

## Claude-only (no Codex equivalent)
`voiceEnabled`, `awaySummaryEnabled`, `agentPushNotifEnabled`.

## Reasoning effort — at parity
Both sides sit at `high` (Claude `effortLevel`, Codex `model_reasoning_effort`). The
earlier `xhigh` vs `high` gap closed when Claude moved down to `high`; nothing to do.
If Claude is ever bumped back to `xhigh`, re-check whether the Codex model supports it.

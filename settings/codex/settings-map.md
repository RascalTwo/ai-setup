# Claude ↔ Codex settings: the non-obvious bits

What's actively SET lives in the real files — `settings/claude-code/settings.json`,
`settings/codex/config-prefs.toml` (+ private overlay), and the table-appends in
`install.ts` (`[mcp_servers.basic-memory]`, `[mcp_servers.voicemode]`, `[[hooks.PreToolUse]]`
for rtk, `[[hooks.Stop]]` for herdr-autolabel, and herdr's SessionStart hook via
`herdr integration install codex`). This
file records ONLY what isn't visible there, so it can't be re-derived — no mirror
of set values (that just rots).

## Claude settings Codex satisfies by default, or we deliberately leave unset
- `cleanupPeriodDays: 99999` → Codex keeps sessions by default (no time-based retention).
- `autoMemoryEnabled: false` → shared memory is basic-memory (MCP). Codex 0.149 renamed this
  from `features.memories` to a top-level `[memories]` table, and now ships a real
  consolidation pipeline (`memories_1.sqlite`, `memory_consolidate_global`). We set no
  `[memories]` table, so it runs on Codex defaults — **verified off 2026-09-27**: codex-cli
  0.154 `codex features list` → `memories  stable  false`. Re-check on a Codex upgrade.
- `autoCompactEnabled: false` → Codex 0.149 **does** have knobs now —
  `model_auto_compact_token_limit` (+ `_scope`), plus `features.token_budget.*`. We set
  none of them, so behavior is unchanged, but "leave default" is now a choice we are
  making rather than the only option (audited 2026-08-30).

## Claude-only (no Codex equivalent)
`voiceEnabled`, `awaySummaryEnabled`, `agentPushNotifEnabled`.

Near-miss, deliberately NOT treated as a counterpart (audited 2026-09-19): Codex's
`[desktop] realtimeVoiceScreenContextEnabled = true` (the `[desktop]` table of `~/.codex/config.toml`) is the
only voice-adjacent Codex key. It governs whether realtime voice can see screen context —
not whether voice is enabled at all — so it is not an equivalent of `voiceEnabled` and
these two do NOT need to track each other. Recorded so the next audit does not
re-litigate it as drift.

## Reasoning effort — at parity
Both sides sit at `high` (Claude `effortLevel`, Codex `model_reasoning_effort`). The
earlier `xhigh` vs `high` gap closed when Claude moved down to `high`; nothing to do.
If Claude is ever bumped back to `xhigh`, re-check whether the Codex model supports it.

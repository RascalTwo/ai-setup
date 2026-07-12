# Claude ↔ Codex settings map (Tier 3)

Settings have **no shared cross-agent format**, so they're hand-maintained per tool
("do it twice"). This maps each Claude `settings.json` preference to its Codex
`~/.codex/config.toml` equivalent. Most already hold on this machine.

| Claude (`settings.json`) | Intent | Codex (`config.toml`) | Status |
|---|---|---|---|
| `effortLevel: "xhigh"` | max reasoning | `model_reasoning_effort` | Set to `"high"`. Codex allows `"xhigh"` (model-dependent) — bump for parity if `gpt-5.5` supports it. |
| `skipDangerousModePermissionPrompt` + dangerous mode | no permission prompts | `approval_policy = "never"`, `sandbox_mode = "danger-full-access"` | ✅ set |
| Stop + Notification hooks | notify when done / needs input | `notify = [...]` | ✅ set (computer-use notifier) |
| `cleanupPeriodDays: 99999` | never auto-delete sessions | *(no time-based retention in Codex — sessions kept by default)* `history.persistence = "save-all"` (default); don't set `history.max_bytes` | ✅ satisfied by default |
| `autoMemoryEnabled: false` | built-in memory off (use basic-memory) | `features.memories = false` (off by default) / `memories.use_memories = false` | ✅ off by default. Shared memory is basic-memory (MCP). |
| `autoCompactEnabled: false` | no auto-compaction | `model_auto_compact_token_limit` (no disable flag; set very high to suppress) | Optional — leave Codex default unless unwanted compaction appears. |
| basic-memory MCP | shared persistent memory | `[mcp_servers.basic-memory]` | ✅ set by `install.ts` |
| `voiceEnabled`, `awaySummaryEnabled`, `agentPushNotifEnabled` | Claude-specific | *(no equivalent)* | Claude-only |

## Not auto-applied

`install.ts` only manages `[mcp_servers.basic-memory]` in `config.toml` (a discrete,
safe-to-append table). The preference keys above are top-level scalars that are
easy to duplicate/clobber and reflect deliberate choices, so they're documented
here rather than machine-edited. On a fresh machine, set them by hand once.

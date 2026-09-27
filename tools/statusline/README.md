---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: [statusLine]
    ccstatusline: widget commands
  requires: [ccstatusline]
---

# statusline

The Claude Code status line: `ccstatusline.json` plus the widget scripts it calls.

`ccstatusline` reads its config from its own default path, `~/.config/ccstatusline/settings.json`,
which `install.ts` symlinks here — so the tracked `settings.json` names no path at all.

## Widgets

| Script | Shows |
| --- | --- |
| `statusline-cost.sh` | session cost |
| `statusline-5h.sh` | the 5-hour usage window and when it resets |
| `statusline-wk.sh` | the weekly window |
| `statusline-duration.sh` | how long the current turn has run |
| `statusline-ttyimgspool.sh` | this session's image count and how fresh the newest is |
| `statusline-cache.sh` | prompt-cache hit ratio |
| `statusline-lib.sh` | `verdict()` / `hms()`, sourced by the pacing widgets |
| `statusline-usage-scan.py` | scans transcripts for each session's share of the window; run detached |

The widgets find each other with `dirname "$0"`, so they only need to stay in one directory
together — nothing links them individually.

## Where things live

| | |
| --- | --- |
| Config | `~/.config/ccstatusline/settings.json` → `tools/statusline/ccstatusline.json` |
| Widgets | `~/.agents/ai-setup/tools/statusline/` |
| State | `~/.agents/state/statusline/` — `usage-share.json`, `usage-scan-memo.json` |

`refreshInterval` is set to 30 in `settings.json`. Absent means **no periodic refresh at all**,
not a default interval, and the clock-driven widgets here would sit frozen between events.

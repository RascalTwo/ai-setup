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
| `statusline-context.sh` | context used / window, color-banded by size and % full (also mirrored to the herdr sidebar, below); also runs the [auto-handoff](../auto-handoff/README.md) idle trigger |
| `statusline-cost.sh` | session cost |
| `statusline-5h.sh` | the 5-hour usage window and when it resets |
| `statusline-wk.sh` | the weekly window |
| `statusline-duration.sh` | how long the current turn has run |
| `statusline-ttyimgspool.sh` | this session's image count and how fresh the newest is |
| `statusline-cache.sh` | prompt-cache countdown (60 min TTL; goes negative once expired) and the cost to rewarm it (also mirrored to the herdr sidebar, below) |
| `statusline-lib.sh` | `verdict()` / `hms()`, sourced by the pacing widgets |
| `statusline-usage-scan.py` | scans transcripts for each session's share of the window; run detached |

The widgets find each other with `dirname "$0"`, so they only need to stay in one directory
together — nothing links them individually.

## herdr sidebar mirror

Inside a herdr pane, `statusline-context.sh` and `statusline-cache.sh` also push their value to
that pane's herdr sidebar (`herdr pane report-metadata`, row 2 of `herdr-autolabel/herdr-sidebar.toml`):
`142k · 42m`. herdr rules can't compare `42m`, so each reports into one of several tokens
named by colour band (`ctx_g/y/o/m/r`, `cache_ok/warn/exp`) and clears the others; the sidebar
config gives each token the widget's own colour. Tokens carry a 90s TTL against the 30s refresh,
so a dead session's row disappears. Outside herdr the block is a no-op.
`test-cache-herdr.sh` checks every band from inside a herdr pane. (The pane's live statusline
rewrites these tokens every ~30s, so a rare FAIL that passes on rerun is that tick landing mid-check.)

## Where things live

| | |
| --- | --- |
| Config | `~/.config/ccstatusline/settings.json` → `tools/statusline/ccstatusline.json` |
| Widgets | `~/.agents/ai-setup/tools/statusline/` |
| State | `~/.agents/state/statusline/` — `usage-share.json`, `usage-scan-memo.json` |

`refreshInterval` is set to 30 in `settings.json`. Absent means **no periodic refresh at all**,
not a default interval, and the clock-driven widgets here would sit frozen between events.

---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: [statusLine]
    ccstatusline: widget commands
  requires:
    manual: [ccstatusline]
---

# statusline

The Claude Code status line: `ccstatusline.json` plus the widget scripts it calls.

`ccstatusline` reads its config from its own default path, `~/.config/ccstatusline/settings.json`,
which `install.ts` symlinks here — so the tracked `settings.json` names no path at all.

## Widgets

The line is context │ model and effort │ 5h │ week │ today (cache prints nothing; see its row). A widget that prints nothing takes
no room: ccstatusline drops its separator too.

| Script | Shows |
| --- | --- |
| `statusline-context.sh` | context used / window, color-banded by size and % full (also mirrored to the herdr sidebar, below); also runs the [auto-handoff](../auto-handoff/README.md) idle trigger |
| `statusline-cost.sh` | session cost (not on the line; kept for re-adding) |
| `statusline-5h.sh` | the 5-hour usage window and when it resets; on the line only when on pace to hit the cap |
| `statusline-wk.sh` | the weekly window and when it resets; red when on pace to hit the cap |
| `statusline-day.sh` | today's budget: `☀️8.0/15.5%` is 8% used of a 15.5% day. Days start at the reset's time of day; at each boundary the week's remainder is split over the days left, so a light day grows the rest and a heavy one shrinks them. Yellow when today's pace runs out before the day ends (`⚠out~4h`), red once used passes the budget. `test-today.sh` replays a week through it |
| `statusline-duration.sh` | how long the current turn has run (not on the line) |
| `statusline-ttyimgspool.sh` | this session's image count and how fresh the newest is (not on the line; the spool itself still works) |
| `statusline-cache.sh` | prompt-cache countdown (60 min TTL; goes negative once expired) and the cost to rewarm it; shown only in the herdr sidebar (below); it stays on the line config because running it feeds the sidebar, and `STATUSLINE_CACHE_ON_LINE=1` puts it back on the line in its last 15m |
| `statusline-eta.sh` | when the session next needs you, shown only in the herdr sidebar (below); prints nothing on the line. `test-eta.sh` checks each pane state against a fake herdr |
| `statusline-lib.sh` | `verdict()` / `hms()` / `today()`, sourced by the pacing widgets |
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
`herdr-space-cache.sh` (run by `statusline-cache.sh` after each report) rolls the panes' `cache_*` values
up into the Space's own row in the Spaces list: the least cache left among its sessions plus its agent count (`34m · 2 agents`), as
`spcache_ok/warn/exp` workspace tokens (expired sessions are skipped unless all are). `test-space-cache.sh`
checks the roll-up on a fixed pane list.
`statusline-eta.sh` adds a third value from herdr's own pane state (`herdr pane get`): while working, `⏳~6m` (blue, from the deadline of the latest running app-panel progress bar, which the host writes as `due` in `~/.agents/state/app-panel/sessions/<pane>.json`; `⏳+3m` orange once overdue) or, with no bar, a gray guess `~3m?`: the median of past turns longer than this one has run, minus what it has run, from Claude Code's own `turn_duration` records (last 30 days, rebuilt daily into `~/.agents/state/statusline/turn-durations.txt`, ~25s in the background); past 95% of past turns it shows the time run, `12m…`. Blocked on a permission prompt or question: `🔔4m` magenta. Idle: nothing. Tokens `eta_due/over/g/wait`.
`test-cache-herdr.sh` checks every band from inside a herdr pane. (The pane's live statusline
rewrites these tokens every ~30s, so a rare FAIL that passes on rerun is that tick landing mid-check.)

## Where things live

| | |
| --- | --- |
| Config | `~/.config/ccstatusline/settings.json` → `tools/statusline/ccstatusline.json` |
| Widgets | `~/.agents/ai-setup/tools/statusline/` |
| Day-start state for `today()` | `~/.agents/state/statusline/day-start.json` |
| State | `~/.agents/state/statusline/` — `usage-share.json`, `usage-scan-memo.json` |

`refreshInterval` is set to 30 in `settings.json`. Absent means **no periodic refresh at all**,
not a default interval, and the clock-driven widgets here would sit frozen between events.

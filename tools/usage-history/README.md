---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: retain
  integrates:
    claude-code: [statusLine]
    codex: session rollouts
    launchd: [com.jmilliken.usage-history, com.jmilliken.usage-history-codex]
  requires: [python3, jq]
---

# usage-history

Keeps a record of how much of each rate-limit window you actually used.

Nothing else does. Claude Code shows the current 5-hour and weekly percentages and
then discards them — `/usage`, the claude.ai usage page and the statusline payload
all report *now*, never *last Tuesday*. The Admin API's usage and cost reports cover
API organisations, not subscriptions. Once a window resets, what you did with it is
gone, which makes "was there room I never used?" unanswerable after the fact.

Codex is the exception: it already writes `rate_limits` into every session rollout.
So this tool records for Claude Code and only *scrapes* for Codex.

## The three pieces

| Script | Runs | Does |
| --- | --- | --- |
| `statusline-capture.sh` | every statusline render | wraps `ccstatusline`; appends when the value changes, then renders |
| `usage-poll.py` | launchd, every 5 min | calls the usage endpoint when >15 min stale or a reset is near |
| `codex-usage-scrape.py` | launchd, hourly | lifts `rate_limits` out of `~/.codex/sessions` |

`statusline-capture.sh` is a wrapper, not a widget: `statusLine.command` points at it
and it pipes the payload through to `ccstatusline` unchanged. Capture is fail-silent
on every path — a broken recorder must never cost a statusline.

## Two sources, two fidelities

Records carry a `src` field because the two are not equally trustworthy.

`src: api` is live-computed and accurately timestamped. `src: statusline` is free but
lagged: Claude Code refreshes its own usage cache far less often than it renders —
measured at ~25 minutes between changes, 37 of 39 samples identical — so a statusline
record means *"by this time it had reached X"*, not *"it became X at this time"*.
Those are monotone lower bounds, useful as corroboration, not as a timeline.

For the same reason `usage-poll.py` keys its throttle on the last `src: api` record
rather than the log's mtime. Keyed on mtime, tee writes suppressed the poller and
substituted stale data for the only accurate source there is.

## Where things live

| | |
| --- | --- |
| Scripts | `~/.agents/ai-setup/tools/usage-history/` |
| History | `~/.agents/state/usage-history/{claude-code,codex}/YYYY-MM.jsonl` |
| Codex safety copy | `~/.agents/state/usage-history/backups/` |
| Errors | `~/.agents/state/usage-history/claude-code/poll-errors.log` |

History is append-only and `deletion-policy: retain` for the obvious reason: it cannot
be regenerated. The Codex half can (rescan the rollouts), the Claude Code half cannot.

## Install

`install.ts` wires the statusline pointer. The launchd agents are opt-in:

```sh
for p in launchd/*.plist; do
  sed "s|/Users/YOUR-USER|$HOME|g" "$p" > ~/Library/LaunchAgents/$(basename "$p")
  launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$(basename "$p")
done
```

## Known ceilings

- **The percentages are integers.** 100 steps across a 7-day window, so ~1% per 101
  minutes at uniform full burn. Sampling faster than hourly cannot see more.
- **Only this account, only this machine.** Windows are account-wide; usage from
  claude.ai, mobile or another machine burns them invisibly. `seven_day_breakdown`
  in the API response is what tells you whether that is happening.
- **The token is Claude Code's.** `usage-poll.py` reads it from the login keychain
  but cannot renew it. Leave Claude Code closed long enough for it to expire and
  polling fails with 401 until you start it again — logged, not silent.
- **No backfill of percentages.** History starts the day this was installed. Burn
  before that can be reconstructed from transcripts only as a cost proxy.

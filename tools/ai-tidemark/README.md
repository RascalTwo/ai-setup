---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: retain
  integrates:
    claude-code: [statusLine]
    codex: session rollouts
    launchd: [com.rascaltwo.ai-tidemark.poll, com.rascaltwo.ai-tidemark.codex]
    viz: viz-pages/ai-tidemark
  requires:
    commands: [python3, jq, bun]
  platforms: macOS (poller + scraper jobs); the recorder and dashboard are portable
---

# ai-tidemark

Keeps a record of how much of each rate-limit window you actually used, and a
dashboard, [`viz-pages/ai-tidemark`](../../viz-pages/ai-tidemark/), that shows it:
5-hour and weekly utilisation against even pace, per-window headroom, and when you
burn. It was called `usage-history` until 2026-09.

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
| `statusline-capture.sh` | every statusline render | appends when a window advances (newer or higher than its high-water mark), then hands the payload to your statusline |
| `usage-poll.py` | launchd, every 5 min | calls the usage endpoint when >15 min stale or a reset is near |
| `codex-usage-scrape.py` | launchd, hourly | lifts `rate_limits` out of `~/.codex/sessions` |

`statusline-capture.sh` is a wrapper, not a widget: `statusLine.command` is the wrapper
followed by your real statusline command (`…/statusline-capture.sh ccstatusline`), which
receives the payload unchanged. With no command it records and draws nothing. Capture
is fail-silent on every path — a broken recorder must never cost a statusline.

It writes on a per-window high-water mark (`.statusline-hwm.json`), not on "changed
since the last line": every open session renders its own stale cache, so the last
line comes from whichever session rendered last, and comparing against it logged
every flip between sessions — 78% of lines, before the fix.

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
| Scripts | `~/.agents/ai-setup/tools/ai-tidemark/` |
| History | `~/.agents/state/ai-tidemark/{claude-code,codex}/YYYY-MM.jsonl` |
| Codex safety copy | `~/.agents/state/ai-tidemark/backups/` |
| Errors | `~/.agents/state/ai-tidemark/claude-code/poll-errors.log` |

History is append-only and `deletion-policy: retain` for the obvious reason: it cannot
be regenerated. The Codex half can (rescan the rollouts), the Claude Code half cannot.

## Install

With the whole ai-setup, `install.ts` does the state directories and the
statusline pointer rides along in `settings.json`; the launchd jobs stay opt-in.

For anything else — including an agent told "install ai-tidemark from this repo" —
these are the steps. Each ends with a check; don't move on until it passes.
`$REPO` is this repository's checkout.

1. **Requirements.** `jq`, `python3`, `bun` on PATH. Check: `jq --version && python3 --version && bun --version`.
2. **Recorder.** In `~/.claude/settings.json`, set `statusLine.command` to
   `$REPO/tools/ai-tidemark/statusline-capture.sh` followed by the statusline command
   already there (or nothing). Check: after the next render,
   `~/.agents/state/ai-tidemark/claude-code/.statusline-hwm.json` exists — if the account
   has rate-limit data at all (subscription logins do; API keys don't).
3. **Poller and Codex scraper (macOS, optional).** The plists are checked in with
   placeholder paths; substitute and load:
   ```sh
   mkdir -p ~/.agents/state/ai-tidemark/{claude-code,codex}
   for p in "$REPO"/tools/ai-tidemark/launchd/*.plist; do
     sed -e "s|/Users/YOUR-USER/.agents/ai-setup|$REPO|g" -e "s|/Users/YOUR-USER|$HOME|g" "$p" \
       > ~/Library/LaunchAgents/$(basename "$p")
     launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/$(basename "$p")
   done
   ```
   Check: `launchctl list | grep ai-tidemark` shows both with exit status 0, and
   `claude-code/YYYY-MM.jsonl` gains a `"src":"api"` line within 5 minutes. Only
   Homebrew's `python3` path is assumed; edit the plist if yours differs.
4. **Dashboard.** Served by the viz skill in this repo:
   `bun $REPO/skills/viz/viz.ts server start`, then open
   `http://127.0.0.1:5180/<$REPO relative to $HOME>/viz-pages/ai-tidemark/`.
   Check: the page shows your sources and **no** "Demo data" banner.

**Upgrading from `usage-history`:** `install.ts` moves `~/.agents/state/usage-history`
to `ai-tidemark` once and leaves a symlink. Unload the old
`com.jmilliken.usage-history{,-codex}` jobs (`launchctl bootout gui/$(id -u)/<label>`),
delete their plists from `~/Library/LaunchAgents`, then do step 3.

## The dashboard

`viz-pages/ai-tidemark/api.ts` reads the history off disk on every request; the page
re-asks on load, every minute and when the tab regains focus. Any source may be
missing — Claude Code only, Codex only, or neither all render.

Published, there is no `api.ts` to answer, so the page falls back to
`fixtures/demo.json` and says so; `?demo` forces that locally. The demo is simulated
by `fixtures/generate.ts` from a fixed seed and shaped by the real `api.ts` — never
derived from real history, which a test enforces. Rerun the generator after changing
the data shape.

The one-tier-down line on the 5-hour bars reads `organizationRateLimitTier` from
`~/.claude.json` — that field only — and uses the documented 5-hour multiples (Max
20x = 4× Max 5x = 20× Pro). Weekly ratios between tiers aren't published, so there is
no weekly equivalent.

## Tests

`bun test tools/ai-tidemark` — behaviour tests that run the real scripts in a
throwaway `$HOME` with stand-ins on PATH (keychain CLI, usage endpoint, statusline),
plus the dashboard's data route. The page itself: `viz verify` on the dashboard URL,
which also runs `viz-pages/ai-tidemark/verify.interactions.ts`.

## Known ceilings

- **The percentages are integers.** 100 steps across a 7-day window, so ~1% per 101
  minutes at uniform full burn. Sampling faster than hourly cannot see more.
- **Only this account, only this machine.** Windows are account-wide; usage from
  claude.ai, mobile or another machine burns them invisibly. `seven_day_breakdown`
  in the API response is what tells you whether that is happening.
- **macOS only for the jobs.** The poller reads the token with `security` (keychain)
  and both jobs are launchd agents. Elsewhere, the recorder and dashboard still work.
- **The token is Claude Code's.** `usage-poll.py` reads it from the login keychain
  but cannot renew it. Leave Claude Code closed long enough for it to expire and
  polling fails with 401 until you start it again — logged, not silent.
- **No backfill of percentages.** History starts the day this was installed. Burn
  before that can be reconstructed from transcripts only as a cost proxy.

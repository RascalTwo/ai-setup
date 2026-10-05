---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: [Stop, statusline]
    herdr: types /clear and the continue prompt into the pane
  requires: [herdr, python3]
---

# auto-handoff

Auto-compact, but with a handoff instead of a summary. When a Claude Code session's context
reaches 250k, it writes an [`r2-handoff`](../../skills/r2-handoff/SKILL.md) document, gets
`/clear`ed, and is told `read <handoff> and continue`. You only notice the context dropped.

Why 250k: see [Choosing the threshold](#choosing-the-threshold).

## Flow

1. **Stop hook** (`auto-handoff stop`). At the end of a turn with context ≥ 250k, it blocks the
   stop once with an instruction to write the handoff to a fixed path (the `Auto` section of
   r2-handoff).
2. On the next stop, if the file exists, it launches the **injector** detached and lets the turn end.
3. The injector waits for the agent to go idle and for the prompt box to be empty (it never types
   into your draft), sends `/clear`, waits 4 s, then sends `read <path> and continue`. The handoff carries a
   `Topic:` line (at most 12 words).

**Idle trigger.** The statusline context widget calls `auto-handoff idle` every 30 s once the
context is ≥ 150k. After 55 minutes with no API reply (the 1h prompt cache is about to expire), it
asks for a handoff while the cache is still warm, clears, and **types the continue prompt without
sending it**, prefixed with `(idle handoff saved your cache; you were: <topic>)`, so a cleared
screen still tells you what the session was.

**Never hands off while anything runs.** The Stop hook's payload carries `background_tasks`,
Claude Code's live list of the session's tasks (`type`: `subagent`, `workflow`, `shell`; `status`;
`description`). The field is not in the hooks docs; it was found in real payloads. Any running task
makes it wait. That includes shells, even though `/clear` would keep them (tested 2026-10-03),
because a shell a subagent left behind is still unfinished work. That was the case when it first
fired. When a task finishes, its notification starts a turn, and that turn's stop checks again. A
shell that never ends (a dev server, a watcher) blocks auto handoff until you stop it. Over the
threshold, every stop shows you a `systemMessage` naming what it is waiting on. A payload without
the list counts as busy, so a Claude Code change makes auto handoff stop rather than kill an agent.

Every stop is logged to `<state>/log.jsonl`: context size, phase, the raw task list, and whether it
waited.

Model and effort: the handoff doc carries `Next session: model <m>, effort <e>`, one of exactly three pairs
(haiku high, sonnet high, opus medium; anything else is ignored, so no Opus high), written by r2-handoff's auto mode;
no line keeps the session's own. After `/clear`, `inject` types `/model` and
`/effort` into the pane, so the switch lands on an empty cache and costs nothing extra. It only ever
raises them (haiku < sonnet < opus; low < … < max), compared with the session's last reply: a lower,
equal or unknown value, or no line, leaves that setting alone.

Outside herdr every verb does nothing: only herdr can type into a live session.

## Off switch

```sh
auto-handoff off          # this herdr pane (run it with `! ` from inside Claude)
auto-handoff off --all    # everywhere
auto-handoff on [--all]
auto-handoff status
AUTO_HANDOFF=0 claude     # this launch only
```

Switching off mid-handoff drops the pending handoff.

## Knobs

Set these per launch, or for every session in the `env` block of `settings.json` (both hooks and
the statusline receive it; checked). `AUTO_HANDOFF_TOKENS` (250000), `AUTO_HANDOFF_IDLE_TOKENS`
(150000; the statusline gate reads it too), `AUTO_HANDOFF_STATE` (state dir, default `~/.agents/state/auto-handoff`; point a test session
elsewhere so the global off switch does not apply to it). `CLEAR_WAIT` in the script if the continue
prompt ever gets eaten.

## Choosing the threshold

[`sweep.py`](sweep.py) replays every main-chain request since 2026-09-22 (237 sessions) under each
threshold, with a handoff's real costs: the doc-writing turn at full context, then a new session
whose start (41k measured baseline, the doc, and files re-read) is written to the 1h cache. Run on
2026-10-03, at the central assumptions (30k re-read, cache reads at 0.35x on the meter):

| Replay | Best | Within 1% of best | Saving at 250k |
|---|---|---|---|
| all sessions, actual models | 250k (-15.4%) | 190-260k | -15.4% |
| all sessions at Opus 5.5 prices | 250k (-13.8%) | 210-260k | -13.8% |
| all sessions at Sonnet 5.5 / Haiku 4.5 prices | 210k (-20.3%) | 160-250k | -20.0% |
| Opus 5.5 sessions at own prices | 250k (-14.9%) | 190-260k | -14.9% |
| Sonnet 5.5 sessions at own prices | 250k (-16.6%) | 170-260k | -16.6% |

The first row reproduces the original analysis (250k, 15-17%), the check that the replay is sound.

- **By model**: Sonnet and Haiku prices pull the optimum lower than Opus prices do, since an Opus
  cache read is 0.05x input against 0.1x, so an Opus rebuild costs 40 reads, a Sonnet one 20.
  Haiku is Sonnet halved, so it shares Sonnet's optimum exactly. But 250k costs Sonnet only 0.3
  points, and Sonnet's own sessions peak at 250k anyway. One number, 250k, stays within 1% of the best everywhere.
- **The assumptions matter more than the model.** Re-read tokens of 0 / 30k / 60k move the Opus
  optimum 180k / 250k / 270k; a meter read weight of 0.2 / 0.35 / 0.55 / 1.0 moves it
  250k / 250k / 240k / 170k. In every case Sonnet's optimum is at or below Opus's.
- **Next measurement**: the re-read cost is the weakest input. After a week of real auto handoffs,
  measure how much context each continued session adds before its first real work, then rerun with
  `--reorient <that>`.

## Testing

Start a scratch herdr pane with `AUTO_HANDOFF_TOKENS=30000 AUTO_HANDOFF_STATE=/tmp/ah-test claude
--model sonnet`. A fresh session already holds ~40k, so below that threshold every turn hands off
again; switch the pane off once you have seen one cycle.

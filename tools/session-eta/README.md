---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: retain
  integrates:
    claude-code-hooks: [UserPromptSubmit, PreToolUse .*, PostToolUse .*, Stop]
  requires:
    commands: [python3, ollama]
  platforms: macOS, Linux
---
# session-eta

A Claude Code hook that keeps one app-panel bar per turn answering "how long until this session needs me?", without Claude having to call the `progress` tool (it often doesn't, however it's told).

## How it works

A watchdog process started with each turn wakes every few seconds and re-estimates on that schedule, because hooks only fire between tool calls, so one long subagent or command would otherwise never get a bar.

1. **Record (every tool call, no model, ~40 ms).** PreToolUse and PostToolUse add each call to `~/.agents/state/session-eta/sessions/<session>.json`. A foreground Bash command that runs 5 s or more is also added to `durations.jsonl`, keyed by its first words (`npm run build`, `bun test`) and cwd. That history is how the bar knows the test suite takes four minutes.
2. **Estimate (detached, local model).** Once a turn is 45 s old, at most once a minute, or right away when a command starts whose past runs took a minute or more, the hook starts a background process. That process gives `qwen3.5:9b` the request, Claude's last few lines of prose (where it states its plan), the steps so far with their durations, and what is running now. The model returns stages and the minutes left. The time left that's shown is the geometric mean of the model's end time and the median length of your past turns that ran longer than this one has so far (`history_end`). That goes to the panel as `stages`, `stage` and `eta`, and the bar fills toward it between estimates.
3. **Finish.** Stop marks the bar done and logs the turn's length. An estimate that comes back after Stop is dropped, so it can't reopen a finished bar. If another Stop hook sends Claude back to work, the next tool call restarts the watchdog.

If Claude calls `mcp__app-panel__progress` itself, the hook stays out of that turn. Outside herdr, or with no panel for the pane, it does nothing.

## Calibration

Each estimate goes to `estimates.jsonl` and each finished turn's real length to `actuals.jsonl`, both keyed by `session` and `turn`, so how far off the model was can be read straight from the logs:

```sh
cd ~/.agents/state/session-eta && jq -s 'group_by(.session,.turn) | map(select(length>1))' estimates.jsonl actuals.jsonl
```

Errors go to `errors.jsonl` and the estimator's output to `estimator.log`.

## Measuring changes

`python3 replay.py [turns] [days]` rebuilds real past turns from `~/.claude/projects/*/*.jsonl` as the hook would have seen them at 10%, 40% and 70% of the way through, asks each variant for the end time, and prints the median error factor. Run it before changing the prompt or the blend. `python3 replay.py seed` adds the last 30 days of turn lengths to `actuals.jsonl` once, so history works from day one.

First run (2026-11-01, 15 turns, about 43 checkpoints), median error factor where 1.0 is perfect:

| Variant | All | @10% | @40% | @70% |
|---|---|---|---|---|
| model, minutes left | 1.67 | 1.67 | 1.62 | 1.80 |
| model, percent done | 1.75 | 2.51 | 1.14 | 2.00 |
| history only | 1.44 | 2.43 | 1.16 | 1.44 |
| **model × history (shipped)** | **1.40** | **1.40** | 1.32 | 1.66 |

The live trial before this showed the same thing: asked for minutes left, the model kept saying about 6 more whatever the elapsed time, so it ran 2–3× long.

## Model notes (measured 2026-11-01)

- `qwen3.5:9b` with `format: "json"` and `think: false` answers in 3–8 s once warm. With a JSON-schema `format` and no `think: false` it hung past 300 s, so the shape is only asked for in the prompt and `stage_of` accepts whatever field names come back.
- `d1:3b` can't do this: Ollama reports it `does not support generate` (it is a decision model).
- Override the model with `$SESSION_ETA_MODEL`.

## Test

`python3 session-eta.test.py` runs one turn against a fake panel and a fake Ollama.

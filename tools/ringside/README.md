---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: reads session transcripts in ~/.claude/projects (never writes them)
    ollama: gemma4:e4b writes labels, outcomes, lanes, strip summaries and the story
    viz: viz-pages/ringside
  requires:
    skills: [viz]
    commands: [bun, ollama]
---

# ringside

A live seat at a Claude Code session, for a room. Built for mob programming: while Claude works, everyone watches what it is doing, why, and what came of it, instead of a spinner. It also replays any past session.

Open it at `http://127.0.0.1:5180/<$REPO relative to $HOME>/viz-pages/ringside/` (here: [`/.agents/ai-setup/viz-pages/ringside/`](http://127.0.0.1:5180/.agents/ai-setup/viz-pages/ringside/)). The [viz](../../skills/viz/SKILL.md) server serves it; "follow newest" picks the most recent session, or choose one from the list.

## What it shows

- **Right now**: the action Claude is on, how long it has run, and its last words.
- **Round**: how the current round's time split across kinds of work, its actions, errors and files changed. Step back through earlier rounds with ‹ ›.
- **Timeline**: every action as a bar, one row per kind of work, plus a **You** row for time Claude sat waiting on a person. Helpers (subagents) get their own rows. Zoom, pan, brush on the overview, or pick This round / Last N min / Whole session. Click a bar to pin its details; click it again or press Esc to follow the latest.
- **The story so far**: the whole session retold in chapters.
- **Conversation**: your prompts and Claude's final replies, with what happened in between folded into strips, each summed up as "set out to do → what came of it" plus bullets.

## How actions get their row

Plan, Look, Run, Verify, Change, Delegate, Outside. Tool calls are sorted by tool name. A shell command is split into its steps (heredoc bodies and quoted text cannot split it) and takes the row of its strongest step: Change, then Verify, then Run, then Look. When a step is an interpreter running code the rules cannot read (`python3 - <<EOF`, `bun -e`, `bash x.sh`), the local model reads the script and picks the row; the details box marks that with ✦ and lists each step under the row it would get alone.

## The local model

Everything marked ✦ is written by gemma4:e4b through Ollama, only for the session being watched and only while the page is open: labels for calls with none, outcomes for finished calls, rows for scripts, a summary per finished strip, and the story. Accuracy comes first in every prompt; brevity is second. Answers are cached in `~/.agents/state/ringside/` (safe to delete; they are written again on demand).

## Tests

`viz verify viz-pages/ringside` runs the unit, API and browser tests (98, with a 100% branch-coverage floor), types, lint and format. The tests use fixtures and a faked backend; they never read real transcripts or call Ollama.

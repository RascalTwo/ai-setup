---
name: delegate-to-local
description: "Hands a small, well-specified coding task to Qwen3.6 running locally in Claude Code through Ollama, costing no Claude or ChatGPT quota. Use when the user says \"delegate to local\", \"use Qwen\" (\"Quinn\"), \"run it locally\", or asks to save quota with a local model. Never trigger it on usage level alone."
rascaltwo-ai-setup:
  kind: skill
  state: true
  integrates:
    claude-code: headless local-model subagent
  requires:
    commands: [ollama, claude]
---

# Delegate to local

One launcher runs **one Claude Code turn on `qwen3.6:35b-a3b`** (MoE, ~3B active, 23 GB) through Ollama's Anthropic-compatible endpoint. It runs with an isolated config folder plus `--safe-mode`, so none of the user's hooks, MCP servers, skills, plugins or CLAUDE.md load. It works like `delegate-to-codex`, but the compute is this Mac.

Why Claude Code as the harness: on 4 agentic bench tasks with this model, Claude Code passed 4/4 (~13.5 min total), Qwen Code 3/4 (a stream error on the hardest one), Codex `--oss` 0/4 (the model never sees its tools).

The local model is much weaker than you. Delegate **small, well-specified tasks with a test or an exact check**: implement a function against tests, fix a named bug, a one-file edit. Keep design, ambiguity and anything needing judgement or broad repo reading for yourself.

## Run it

```bash
~/.claude/skills/delegate-to-local/scripts/delegate-local.py -C <working-dir> "<task prompt>"
```

Options: `--minutes N` time limit (default 30), `--resume <session_id>` continue a previous run, `--model M` (default `qwen3.6:35b-a3b`).

Run it as a background Bash call (`run_in_background: true`): a task takes 1-7 min, and the first call adds ~30 s to load the model. When it finishes, it prints one line (`done` / `error` / `timed out after N min`, the run folder, the session id) and exits 0 / 1 / 124. Stopping the launcher (or its background task) stops the local run with it. Read **`<run folder>/result.md`**, not stdout. The run folder (`~/.agents/state/delegate-to-local/runs/<timestamp>/`) also holds `session_id`, `meta.json`, raw `stdout.json` and `stderr.log`.

Full access in place: it runs with `--dangerously-skip-permissions` in `<working-dir>`, like Codex's bypass mode. Prefer a git repo with a clean tree as the working dir, so the change is a reviewable diff.

## Pre-flight refusals (exit 2)

The launcher checks before starting and refuses with a message saying what to do. Relay it to the user; act on it only with their go-ahead.

- **Ollama not answering**: start Ollama.
- **Model missing**: it names the download size and the `ollama pull` command. It never downloads by itself. Ask the user before pulling 23 GB.
- **Another model ≥ 2 GB loaded** (`ollama ps`): it names it and gives `ollama stop <name>`. Two big models don't fit in 36 GB. The user's own hook helpers are the exception: session-eta's `qwen3.5:9b` and herdr-autolabel's `qwen2.5-coder:7b` are unloaded automatically, and both hooks hold off while a run is going.
- **Another delegate-local run in progress**: runs go one at a time; there is no fan-out.

Swap and memory pressure are printed as a note only. Most of the swap is in use on an ordinary day.

## One call is one turn

Inside one call the model runs its own agent loop (read, edit, run tests) until it decides the turn is done. It never blocks to ask. If it needs something, it ends the turn with a question in `result.md`. Answer it (from the conversation, or ask the user) and continue the same session:

```bash
delegate-local.py -C <working-dir> --resume <session_id> "<your answer / next instruction>"
```

The session id is fixed before the run starts, so a timed-out run can be resumed too.

## Writing the task prompt

It starts cold, with none of this conversation. Front-load everything:

- The goal and an exact **definition of done**: the test command that must pass, or the precise change.
- Exact file paths, relative to the working dir. Name the files it must not touch (tests).
- When the task is already written down (a `TASK.md`, a handoff doc), pass the path: "Read TASK.md and do what it says."
- Ask it to end with a one-paragraph summary of what it changed.

## Check the work yourself

The model saying "done" is a claim, not a result. Before you report the task as done:

1. Read the diff (`git -C <dir> diff`, or the files it names). Look for edits outside the task, deleted or weakened tests, and stubs.
2. Run the tests or the check yourself.
3. Fix small slips yourself, or resume the session with what's wrong. Report what you verified.

On `timed out after N min`, tell the user exactly that, show `git diff` of what it changed so far, then resume with a narrower instruction or finish the work yourself.

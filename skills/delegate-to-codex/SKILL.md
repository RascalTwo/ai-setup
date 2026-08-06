---
name: delegate-to-codex
description: >-
  Delegate a coding or research task to the OpenAI Codex CLI running headless,
  so the work is billed to the ChatGPT subscription instead of spending Claude
  tokens. Use this WHENEVER the user wants to offload/hand off/farm out work to
  Codex, "spawn a codex agent", run a sub-agent without burning Claude
  subscription tokens, save Claude context/quota, get a second (OpenAI/GPT)
  opinion on a change, or fan out several independent tasks cheaply. Triggers on
  "delegate to codex", "use codex for this", "have codex do it", "offload to
  codex", "codex subagent", "don't use my Claude tokens for this". Homophones
  "code X", "codecs", "co-dex" mean Codex. Do NOT use for tasks the user wants
  Claude itself to do, or when Codex is not logged in.
---

# Delegate to Codex

Run the OpenAI **Codex CLI** as a headless sub-agent via `codex exec`. Codex does
the actual work (reads files, edits code, runs commands, answers questions) and
returns a result you collect and relay. Because Codex authenticates with the
user's **ChatGPT subscription**, none of this consumes Claude tokens — that is
the entire point of delegating.

Think of it as the `Agent` tool, but the compute is on OpenAI's dime.

## When to reach for this

- The user explicitly wants Codex to do the work ("delegate to codex", "let codex handle it").
- A task is token-heavy or long-running and the user wants to conserve Claude quota/context.
- You want an independent second opinion from a different model on a diff or design.
- Several independent tasks can run in parallel cheaply.

Do **not** use it when the user asked *Claude* to do something, for trivial work
where the ~5-10s Codex startup isn't worth it, or when Codex isn't authenticated.

## Preflight (once per session, cheap)

```bash
codex login status   # want: "Logged in using ChatGPT"  → work is billed to ChatGPT, not Claude
```

If it says logged out / API key, tell the user — running on an API key would spend
real OpenAI money, and the token-saving rationale still holds vs. Claude but flag it.
`codex --version` confirms the CLI is installed (`~/.local/bin/codex`).

## The core invocation

Default to **full access, no sandbox** — the user runs this on their own machine
and wants Codex to actually get the job done without babysitting:

```bash
codex exec \
  --dangerously-bypass-approvals-and-sandbox \
  --dangerously-bypass-hook-trust \
  --skip-git-repo-check \
  -C "<working-dir>" \
  --output-last-message "<scratch>/result.txt" \
  "<the full task prompt>" < /dev/null
```

Then read `<scratch>/result.txt` — that file holds Codex's final message, clean,
with none of the streaming noise. Relay/act on it.

Flag-by-flag, why each matters:

- `--dangerously-bypass-approvals-and-sandbox` — the YOLO switch. No approval
  prompts (there's no human at the keyboard in a delegated run) and no sandbox,
  so Codex can edit files and run commands freely. This is the intended default
  here. To lock a call down instead, drop this flag and use
  `-s read-only | workspace-write | danger-full-access` for a graduated sandbox.
- `--dangerously-bypass-hook-trust` — skips the first-run "trust this hook?" prompt
  for any Codex lifecycle hooks (e.g. an rtk rewrite hook). Without it a headless
  run can hang on an un-trusted hook.
- `--skip-git-repo-check` — lets Codex run outside a git repo. Harmless inside one.
- `-C <dir>` — Codex's working root. Set it to the repo/folder the task is about.
- `--output-last-message <file>` — **the clean way to collect the answer.** Always
  use this instead of scraping stdout.
- `< /dev/null` — **required.** Without stdin redirected, `codex exec` blocks on
  "Reading additional input from stdin..." and hangs forever. This is the #1
  gotcha.

Optional additions:

- `-m <model>` — pick a model (e.g. `-m gpt-5.5`). Omit to use the configured default.
- `--oss --local-provider ollama` — run against a **local** model instead — literally
  zero cost, no cloud tokens at all. Good for cheap/bulk/offline delegation; weaker
  than the cloud model, so reserve for simpler tasks.
- `--ephemeral` — don't persist the session to disk (good for throwaway one-shots).
- `--json` — stream events as JSONL to stdout (see "Watching progress" below).

## Interaction model — this is a turn-based agent, not one-shot

Understand this before delegating anything non-trivial:

- **One `codex exec` call = one full autonomous turn**, not one action. Inside a
  single call Codex runs its own agent loop (read, run commands, edit, re-check,
  many steps) until it decides the turn is done. A big multi-step task can
  complete in a single call.
- **It never blocks mid-run to ask you a question.** In `exec` mode approvals are
  off, so Codex decides for itself and proceeds; a failed command is fed back to
  Codex to recover from, not to you. It will **not hang** waiting on a human. If
  it truly needs something, it ends the turn and states the question/blocker/
  assumption in its **final message**.
- **You are not limited to one shot.** `codex exec resume <thread_id> "<reply>"`
  continues the *same session with full memory* (verified: a value set in turn 1
  is recalled in a separate turn-2 process). So the delegation loop is:

  ```
  codex exec "<task>"            # Codex works a turn, returns final message
  read the final message:
    done            → collect result
    asked / blocked → resume with the answer:
      codex exec resume <thread_id> \
        --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check \
        --output-last-message result.txt "<your answer / next instruction>" < /dev/null
  # repeat until done
  ```

  **Claude Code is the orchestrator that answers Codex's questions on the user's
  behalf** — pull the answer from the conversation, or ask the user, then resume.
  This makes it an interactive session, just at turn boundaries rather than a
  live blocking prompt.

**Capturing the `thread_id` to resume:** run turn 1 with `--json` and grab the
`thread.started` event's `thread_id` (a UUID); or skip the id and use
`codex exec resume --last`. Do NOT use `--ephemeral` if you intend to resume —
ephemeral sessions aren't persisted and can't be resumed.

**Resume flag notes:** put options *before* the positional `<thread_id>` and
`<prompt>`. `-C`/`--cd` is **not** a resume flag — the working dir is inherited
from the original session. `--output-last-message`, `--output-schema`, `--json`,
and the bypass flags all work on resume.

**Making "needs input" machine-detectable:** pair resume with `--output-schema`
and a status field, e.g. `{"status": "done"|"needs_input", "question": "...",
"result": "..."}`. Then branch on `status` instead of parsing prose to decide
whether to resume.

**Approval caveat:** bypass mode means Codex never asks permission before risky
actions — it just does them. There is no "ask before acting" in headless exec;
that only exists in the interactive TUI. That's the price of unattended delegation.

## Structured output (typed results)

To get a machine-parsable object back instead of prose — the equivalent of the
`Agent` tool's `schema` — write a JSON Schema file and pass `--output-schema`:

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check \
  -C "<dir>" \
  --output-schema "<scratch>/schema.json" \
  --output-last-message "<scratch>/result.json" \
  "<prompt that asks for those fields>" < /dev/null
```

**Critical gotcha:** Codex enforces OpenAI *strict* structured-output mode. The
schema **must** set `"additionalProperties": false` on every object and list
**every** property in `required`, or the call fails with a 400
`invalid_json_schema` before doing any work. Minimal valid example:

```json
{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "summary": { "type": "string" },
    "files_changed": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["summary", "files_changed"]
}
```

`result.json` then contains exactly that shape — parse it with `jq` and act on it.

## Watching progress on a long task

For long delegations, add `--json` and tee it to a log so you can inspect what
Codex actually did (which commands it ran, what it read):

```bash
codex exec --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check \
  -C "<dir>" --json --output-last-message "<scratch>/result.txt" \
  "<prompt>" < /dev/null > "<scratch>/events.jsonl" 2>&1
```

Each line is an event; `command_execution` events show the shell commands Codex
ran. If a run misbehaves, read `events.jsonl` to see why. For very long runs,
prefer launching in the background (a background Bash call) and polling the log,
rather than blocking — Codex tasks can take minutes.

## Fanning out (parallel delegation)

Independent tasks run concurrently — launch several `codex exec` calls as
background processes writing to separate result files, then collect:

```bash
codex exec ... -C repoA "task A" < /dev/null > a.log 2>&1 &
codex exec ... -C repoB "task B" < /dev/null > b.log 2>&1 &
wait
# read result-a.txt, result-b.txt
```

Each is a fully independent agent. This is where delegation shines: N tasks, zero
Claude tokens, wall-clock of the slowest one.

## Writing the task prompt

Codex is a capable agent but starts cold — it has none of this conversation's
context. Treat it like dispatching a subagent: give it everything up front.

- State the **goal** and the **definition of done** concretely.
- Name **exact file paths** and the **working dir** (via `-C`).
- If you want a specific return shape, either use `--output-schema` or say
  "end your final message with just X" so `--output-last-message` is clean.
- It cannot ask follow-ups mid-run — front-load every constraint.

## Gotchas, distilled

- **`< /dev/null` or it hangs.** Non-negotiable for headless runs.
- **`--output-schema` needs `additionalProperties: false` + all fields `required`** (OpenAI strict mode), else a 400 before any work.
- **`-a` / `--ask-for-approval` is NOT an `exec` flag** — it's top-level only. `exec` is non-interactive by design; control execution with `-s` or the bypass flag instead.
- **Codex loads the user's `~/.codex` skills** on each run — a minor context tax, occasionally a "descriptions shortened" warning. Harmless.
- **Collect via `--output-last-message`, not stdout scraping.** Stdout carries banners, token counts, and (with `--json`) event noise.
- Startup is ~5-10s even for trivial prompts; that's the floor, not a bug.

---
name: retro-catchup
description: Show the user which Claude Code sessions have not yet been retro'd, as a copy-pasteable list of `/retro <session-id>` commands. Use ONLY when the user explicitly invokes this skill by name — e.g., "/retro-catchup", "run retro-catchup", or "what retros am I behind on". Do NOT auto-trigger on generic requests to "check my retros" or "what did I miss". Takes no arguments. This skill is a printer, not a dispatcher — it does not run the retro skill on the user's behalf, because subagent environments can't reliably spawn further subagents. It reports the work and the user runs each command themselves. Pairs with a user-maintained skiplist for flagging sessions as not-retro-worthy.
---

# retro-catchup

Scan every Claude Code session on disk and report the ones that have no matching retro yet, as a list of commands the user can copy-paste.

This skill **does not execute** `retro`. It just prints what's pending. Same design constraint as `journal-catchup`: catchup often runs in subagent contexts where further subagent dispatch isn't reliable, and "tell the user what to run" is always correct.

## Arguments

None. This skill takes no arguments.

## Workflow

### 1. Run the pending script

```bash
./skills/retro-catchup/scripts/retro-pending.sh
```

The script scans `~/.claude/projects/*/*.jsonl`, filters out subagent sessions and sessions with zero turns, excludes anything already retro'd (matched by session ID in filenames under `ai-setup/skills/retro/retros/`), excludes anything listed in the skiplist at `ai-setup/skills/retro/retros/.retro-skip`, and emits TSV to stdout.

Columns: `SESSION_ID  PROJECT  STARTED  MESSAGES`. Sorted by start time, most recent first.

### 2. Parse the output

Count the rows. If zero, output a single line: `All caught up — no pending retros.` and stop.

If non-zero, proceed to Step 3.

### 3. Format the report

Group the pending sessions into a single list, preserving the script's order (most recent first). Each line becomes a `/retro <session-id>` command with a short parenthetical showing project, date (from the `STARTED` ISO timestamp, truncated to `YYYY-MM-DD`), and message count.

```
## Pending retros (N sessions)

Run `/retro <session-id>` for each session you want to retrospect. Sessions are ordered most-recent first.

- /retro 5dbd6f3a-9ea1-4b84-93f5-0fdd3d8b4235  # sai-jm-snippets · 2026-04-19 · 84 msgs
- /retro a28b712a-42d6-478c-bc99-38626d98b94d  # unified-graph · 2026-04-19 · 103 msgs
- /retro edd86d75-a12f-4228-adb6-7c0fbe189a24  # unified-graph · 2026-04-19 · 561 msgs
  ...

To skip a session (mark it not-retro-worthy), append its session ID to `ai-setup/skills/retro/retros/.retro-skip` (one per line, `#` comments allowed).
```

If the list is very long (>100 rows), note the total up front, still print them all, and remind the user that the skiplist is the right tool to shrink future runs.

### 4. Report

Print the formatted output. Do not run any `/retro` commands yourself. Do not "helpfully" pick a subset to retro — the whole point of this skill is that the user decides which sessions are worth retrospecting and which aren't.

## The skiplist — opt-out, human-controlled

The skiplist lives at `ai-setup/skills/retro/retros/.retro-skip`. Format:

```
# One session ID per line. Full UUID or 8-char prefix.
# Lines starting with `#` and blank lines are ignored.
# Inline comments after `#` are fine too.
32735899-ce5a-407f-8dfc-b5b0d00b42ab   # one-shot test session
5dbd6f3a                                 # short form is OK
```

The user adds entries manually — retro-catchup never writes to this file. The file may not exist yet; that's fine, the script handles that.

Design principles:

- **No auto-noise-filtering.** The script does not guess what's worth retrospecting based on message count, age, tool mix, etc. Every session shows up until the user says otherwise.
- **Opt-out, not opt-in.** Default is "show me all sessions." Skipping is an explicit, reviewable action.
- **Session-scoped, not pattern-scoped.** One ID at a time. If you want to skip an entire project, that's a different tool — don't bolt project-level filters onto this one.

## Guardrails

- **Printer, not dispatcher.** You do not run `/retro`. You print the commands and stop.
- **Never write to the retros directory** from this skill — not the skiplist, not the retro reports, not anything else. Read-only.
- **Do not modify `retro-pending.sh`** to add filters, flags, or arguments to "make catchup smarter." Any new behavior should preserve the "list every missing session" contract, and the skill prompt is a thin formatter.
- **Subagent sessions are already filtered out** by the script (`isSidechain: true`). Don't re-implement that logic in the prompt.

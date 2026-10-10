---
name: r2-handoff
description: Hands off this conversation to a fresh agent, splits it into one handoff per parallel work stream with `/r2-handoff split`, or rescues an abandoned Claude session from its transcript with `/r2-handoff rescue {herdr tab | session id}`.
argument-hint: "[split | rescue <tab|session-id>] [what will the next session be used for?]"
disable-model-invocation: true
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    herdr: resolves a tab label to a Claude session (rescue mode only)
  requires:
    commands: [python3]
---

# r2-handoff

One document, two sources, and a split mode that fans one handoff into several. Every mode writes to [`template.md`](template.md); that section list is where the quality comes from. Derived from an upstream skill: see [`PROVENANCE.md`](PROVENANCE.md) before editing the first block below.

## Handoff: this session writes its own

Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.

Cover every section of `template.md`. Done when each one is present and the final reply is the file's path.

## Split: one handoff per parallel work stream

`split`: the remaining work fans out into parallel fresh sessions. Any words after `split` narrow which work to split. The default handoff above stays the plain one-session path.

1. **Partition.** List every remaining next step with the files, repos and skills it touches and what it depends on. Two steps share a stream when they touch the same file or one needs the other's output; only steps with no shared file and no dependency become separate streams. Done when every step sits in exactly one stream, each with a one-line reason.
2. **Confirm.** Show the user each stream: name, steps, why grouped, and a recommended model (Opus for ambiguous design or work that can lose data, Sonnet for the rest, Haiku only for mechanical work). Wait for them to merge, split or approve. A single stream means a plain handoff: write that instead and stop.
3. **Write.** One shared document, `handoff-<slug>-shared.md`, holds `template.md` sections 1, 2, 5, 6, 7 and 9 once. One document per stream, `handoff-<slug>-<stream>.md`, holds sections 3, 4 and 8 for its slice plus "suggested skills", and opens by naming the shared document as the first read. Every document carries the lineage line. Save all of them to the OS temporary directory. Done when every section lives in exactly one file, every stream document names the shared one, and every document opens with the lineage line.
4. **Reply** with one row per stream: name, document path, model, and the launch line `claude --model <model> "read <stream doc> and continue"`.

## Auto: the session is about to be cleared

Reached when a message starting `AUTO HANDOFF` names an output path; it comes from [`tools/auto-handoff`](../../tools/auto-handoff/README.md), not the user. The session is cleared and resumed from the document with no human in between, so:

- Ask nothing. Write the default handoff above to the given path, not a new one.
- Right after the lineage line, add `Topic: <at most 12 words: what you were doing, what remains>`. It is shown to the user, who may not have seen this session for an hour.
- Right after `Topic:`, add one `Next session:` line, copied exactly from these three options (nothing else is honoured; there is no Opus high):
  - `Next session: model haiku, effort high`: mechanical, well-specified work.
  - `Next session: model sonnet, effort high`: ordinary coding and research.
  - `Next session: model opus, effort medium`: ambiguous design, or work that can lose data.
  Auto handoff types `/model` and `/effort` after `/clear`, when the cache is already gone, so the switch is free. Leave the line out to keep this session's own model and effort. Auto handoff only ever keeps or raises them: a lower choice is ignored.
- In section 3, list every background task that outlives `/clear` (background Bash, Monitors, scheduled tasks): its ID, what it does, and its output path. Subagents and workflows do not survive; auto handoff waits for them.
- When the remaining steps fall into independent streams (the Split test above), add one line suggesting `/r2-handoff split`. Never split.
- If the user asked a question that is still unanswered, put it first in section 8, so the next session asks it again.

Done when the file exists at the given path; end the turn with its path and nothing else.

## Rescue: a session you already walked away from

`rescue <target>`: the session is never resumed, so its expired prompt cache is never rewritten. `<target>` is a herdr tab label, a tab or pane id, or a session id; any words after it say what the next session is for. Claude Code sessions only.

1. **Resolve.** Run `python3 <this folder>/scripts/resolve.py <target>`. Done when it prints one session as JSON (`session_id`, `transcript`, `title`, `age_minutes`). On an ambiguous match, ask the user which.
2. **Digest.** Run `python3 <this folder>/scripts/digest.py <transcript> > <temp dir>/digest-<first 8 of session_id>.md`. It keeps every user message, the assistant's text, one line per tool call and the last turns verbatim; it drops tool results and thinking.
3. **Write.** Dispatch one general-purpose subagent with the prompt below, filled in. Relay its path and summary to the user; read the document back into this context only on request.

```
Write ONE file only: <temp dir>/handoff-<tab or title slug>-<first 8 of session_id>.md. Change nothing else; run only read-only commands.

Context: a Claude Code session (<tab> / "<title>", id <session_id>, cwd <cwd>) went idle and its prompt cache expired; no handoff was written. Write the handoff for a FRESH session. The user dictates by voice, so odd words may be homophones. <If the user gave a focus: the next session will be used for: <focus>.>

PRIMARY INPUT, read fully: <digest path>. It holds the user's messages, the assistant's text (clipped), tool calls as one line each, tool errors and the last turns; tool results and thinking are dropped.
FULL TRANSCRIPT, for targeted lookups only, never read whole: <transcript>. When the digest leaves a fact open (did a command succeed, what did a test print, why was an approach rejected, did the assistant retract something), grep or jq for it. Count the lookups.

Follow <this folder>/template.md, and add the "suggested skills" section. Check every path with ls, and read-only `git status`/`git log`, so the document states the state now.

Reply with only: the output path, a 4-line summary, the lookup count, and where the digest was insufficient. Under 200 words.
```

Done when the subagent's reply names an output file that exists.

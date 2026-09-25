---
name: timeline-studio-tasks
description: Read and write the user's task plan in Timeline Studio — one plan holding all their work and life tasks, with real dependencies — and record YOUR OWN work there so a session that ends does not take its state with it. Use WHENEVER they say what they need to do, defer something ("later", "remind me", "I should", "after X I'll Y", "waiting on someone"), ask what to work on next / what's ready / what's blocked / what's due, or finish or abandon something. Also use when you are about to start work that may outlive this session, when a session ends with work left over, and when they ask about their plan, their tasks, their backlog, or their queue. Homophones "timeline studio", "time line studio", "TL studio" all mean this.
---

# Timeline Studio — the user's plan

**This skill holds only what the served documentation cannot**: where the plan is
on this machine, and the policy for it. Everything about *how* to drive a plan is
published by the plan itself and is not repeated here, because a second copy is a
copy that goes stale without anyone noticing.

## Where the plan is

`~/.config/timeline-studio/config.json` — `{ "base": ..., "token": ... }`.
Deliberately outside this repository: the token is the whole credential, so it
must not be somewhere that can be committed. Send it as an `x-timeline-token`
header and keep it out of URLs, logs and commits. If the file is missing, ask for
the share link; the token is the part after the `#`.

## Where the reference is, and the trap

Read **`/llms.txt`**, which points at `/AGENTS.md`, which is the whole reference
and indexes the OpenAPI spec and the command vocabulary.

**They are NOT on `base`.** `base` is the API. Those files are served by the
PAGE, which is a different origin when the stack runs locally — so `<base>/llms.txt`
is a 404 there, and every session that tried it silently gave up and guessed
instead. On a deployed instance one host fronts both and it works.

## Capture is the job

The plan is only worth reading if it is complete, and it is only complete if
things land in it when they are said. When the user mentions work — in passing,
as an aside, as a complaint — add it. Do not wait to be asked and do not batch it
to the end of the session.

Add it even when it is vague. A badly-named task that exists beats a
well-specified one that never got written down, and a label is cheap to fix.
Confirm in a few words and carry on.

**Adding without asking is allowed and intended.** `refinedAt` is what makes it
safe: it means *the user has read this and agreed*, they sweep what they never
refined, and that is the system working rather than a mess. Which is also why you
never send `setRefined` — self-certifying turns their sign-off into a rubber
stamp, and `/api/ready` gates on it, so an agent that refines its own work can
declare its own work ready.

If an edit of yours drops a sign-off, say so. Do not quietly restore it.

## Recording your own work

**Anything you work on: `setActuals` when you start, and again when you finish.**
Starting matters as much as finishing — a task with `actualStart` and no
`actualEnd` is how a dead session leaves a trail instead of a silence. Setting it
is also your claim on the task, so set it before the work, not after.

**Decompose only what could outlive this session, or what the user pins for
later.** Work that finishes inside one session gets start and finish on their
task and nothing else. No step-by-step: eight sequential rows is a list drawn in
a graph tool, and the graph is what this is for. How fine to go beyond that is
your judgement — write what a future session would need to resume, and stop.

**Your own tasks get `shape: "ai"` and `noQueue: true`.** The shape says a machine
made this and is how they filter and sweep them; `noQueue` keeps your days out of
their capacity, because a lane rations working time and your work is not queued
behind theirs. Give them the same Project colour as the work they belong to.
Their task depends on yours, never the reverse.

**Never touch the label, description or duration of a task they refined** to make
your decomposition tidy — each of those silently clears the sign-off, with no
event and no log line.

**In-flight work is not yours to take.** A task with `actualStart` and no
`actualEnd` may belong to a session that is still running. Resume it only
deliberately, and say that you are.

## The session-start hook

`hooks/inflight.py` reports work left in flight when a session opens, and says
nothing at all when there is none. See the header of that file for why reading
is a hook when writing is a skill. Register it on `SessionStart`:

```json
{ "matcher": "startup|resume",
  "hooks": [{ "type": "command",
              "command": "python3 \"$HOME/.claude/skills/timeline-studio-tasks/hooks/inflight.py\"",
              "timeout": 5 }] }
```

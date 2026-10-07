---
name: timeline-studio-tasks
description: "Reads and writes the user's Timeline Studio task plan, and records its own work there so it survives the session. Use when they state something to do, defer it (\"later\", \"remind me\", \"waiting on\"), ask what's next/ready/blocked/due, or finish or abandon work."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    timeline-studio: the plan's HTTP API, read and written with a token header
    claude-code: SessionStart hook that reports interrupted agent work
  requires:
    manual: [timeline-studio]
---

# Timeline Studio — the user's plan

**This skill holds only what the served documentation cannot**: where the plan is
on this machine, and the policy for it. Everything about *how* to drive a plan is
published by the plan itself and is not repeated here, because a second copy is a
copy that goes stale without anyone noticing.

## Where the plan is

`~/.config/timeline-studio/config.json` — `{ "base": ..., "page": ..., "token": ... }`.
`base` is the API and `page` the web UI. Read them from that file, never type one from
memory. When the file has no `base` or `page`, the default is the public instance,
`https://timeline-studio.rascaltwo.com` (code: RascalTwo/timeline-studio, at
`~/Desktop/Desktop/Code/timeline-studio`). A machine that reaches the service another way (a
private network, say) puts that address in `base` and `page` instead, and nothing else
changes. The token has no default. A local stack (`scripts/local-up.sh`) is for
developing the tool, never for the plan.
Deliberately outside this repository: the token is the whole credential, so it
must not be somewhere that can be committed. Send it as an `x-timeline-token`
header and keep it out of URLs, logs and commits. If the file is missing, ask for
the share link; the token is the part after the `#`.

## Where the reference is

**`<base>/api/openapi.json`** — the API's own schema: every route, every command, and
what every field means. Read it before writing; it is held to the code by tests. Its
description links whatever else the plan serves.

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

**Anything you work on: start it before the work and finish it after.** Starting is your
claim on the task, and a task started and never finished is how a dead session leaves a
trail instead of a silence. The commands for it, the time formats and the units are in the
spec; use what it says rather than what this file remembers. **Log progress as a comment,
not in the description** — the spec's docs say why.

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

**In-flight work is not yours to take.** A task that has started and not finished
may belong to a session that is still running. Resume it only
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

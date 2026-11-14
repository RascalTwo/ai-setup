# Tidy Kelpie's queues by skipping tasks in the tick, never by closing them

Status: Accepted, 2026-11-14

## Context and Problem Statement

Kelpie's queues grew work nobody wants: yesterday's copies of a recurring calendar task (`gcal-<event id>_<instant>`), and delegated tasks that sat for weeks, so a build could start days after anyone cared. "Kelpie calm" (`.scratch/kelpie-calm/SPEC.md`) wants Kelpie to tidy this itself, with no agent and no quota, and to ask Joseph only about what is left.

## Decision

The tick marks queued tasks in memory and the dispatcher skips them. Nothing is closed, edited or deleted without Joseph's answer.

- **Superseded:** of a recurring event's open copies, only the next one (the first whose due, the event's end, has not passed; else the latest) can run. The older queued copies read as `superseded` and drop out of the queues and `status`.
- **Stale:** a queued, not-calendar task untouched for 14 days (`STALE_DAYS`) reads as `stale`. Kelpie stops dispatching it and `status` lists it with three answers: `kelpie keep <id>` (a `[tidy] keep` comment resets the clock), `kelpie drop <id>` (the same close as `close`: a `[dispatch] closed` comment and `finishTask`) and `kelpie later <id>` (`setNotBefore` +14 days and a `[tidy] later` comment).
- **Touched** is the latest of the plan's created, edited and signed-off stamps and any comment, from either side. Setting For: Agent counts as keep: the tick, which already sets `noQueue` on a newly handed-over task, writes `[tidy] keep` then.
- **Calendar tasks are never stale.** They are created weeks before their event, so their age says nothing; they keep their fast lane.
- `[tidy]` comments, not `[dispatch]`, so `derive` does not read them as a run's history.

## Alternatives Considered

- Close superseded copies and stale tasks automatically: tidiest queue, but it destroys work on a guess, and the plan's finish also adds the next repeat copy.
- Delete superseded copies: the plan's sync would likely recreate them, and a deletion cannot be undone.
- Ask an agent to triage the backlog: spends quota on a rule that fits in ten lines.
- Judge staleness from the plan's `updatedAt` alone: it moves only on label, description or duration edits, so it neither sees comments nor setting For: Agent.

## More Information

- Superseded copies stay open in the plan, invisible to Kelpie, until the calendar sync or Joseph closes them.

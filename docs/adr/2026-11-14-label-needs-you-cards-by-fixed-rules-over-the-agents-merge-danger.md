# Label Needs-you cards by fixed rules over the agent's Merge Danger, and make green one click

Status: Accepted, 2026-11-14

## Context and Problem Statement

"Kelpie calm" (`.scratch/kelpie-calm/SPEC.md`) wants most items on the board's Needs-you list approvable in seconds, but a one-click Approve is only safe when the change is easy to walk back. Something has to say which cards those are. [ADR: answer from a Needs-you card](2026-11-14-answer-from-the-needs-you-card-in-your-own-words.md) kept every button greyed until Joseph typed, so that the record never claims words he did not say.

## Decision

Every build review and refine handover carries three lines after its impact sentence, taken from Matt Pocock's `pr` skill ("Merge Danger"): `Door: one-way | two-way`, `Blast radius: small | wide — <words>`, `Undo: <one line>` (`tools/kelpie/prompt.md`, `refine.md`). `riskOf` in `viz-pages/kelpie-board/needs.ts` turns them into a label by fixed rules:

| Door | Blast radius | Label |
|---|---|---|
| two-way | small | 🟢 |
| two-way | wide | 🟡 |
| one-way | any | 🔴 |
| the project deploys on approval (a build card only) | any | 🔴, even if the agent wrote two-way |
| missing, partial or garbled | | 🟡 "no risk block", never 🟢 |

The agent writes the word `small` or `wide` itself, by a test the briefing spells out (one project's own files or the human alone, nobody else sees it, one revert undoes all of it: otherwise wide). A word list in code would be brittle and judge the wrong thing, and a number would invite a guess. What code cannot be talked out of is the outward-facing case: the project file says whether approval deploys, so that is red regardless, and one-way is the agent's default when unsure. A wrong "small" on a two-way door costs one revertible change approved in a click.

On a 🟢 card, Approve and a spec's default *Sign off · when a slot frees* work without typed words and record fixed ones ("approved from the board (🟢 two-way, small)"), so the history shows it was a one-click approval. Words typed in the box still win. 🟡 and 🔴 cards, *Sign off · build now* and *hold*, and every other button keep requiring typed words; a 🔴 card says it needs full attention. Stale cards, questions and stuck runs get no label.

This amends the earlier ADR's "nothing sends a fixed phrase" for 🟢 cards only.

## Alternatives Considered

- A model scores each card's risk or confidence: Decky's ADR found that a model's own confidence "is not reliable enough to act on" ([2026-11-12-let-a-small-model-decide-what-decky-answers](https://github.com/sourceallies/decky/blob/main/docs/adrs/2026-11-12-let-a-small-model-decide-what-decky-answers.md)). Here the agent reports facts (which door, who is touched) and code decides.
- Code guesses the door from the diff or a word list (deploy, delete, send): misses new kinds of outward-facing change, and the agent already knows.
- One click on every card, or typed words on every card: the first approves destructive work without thought, the second leaves the backlog as slow as it was.

## More Information

- Prior art: Jack Viers's Merge Danger sections ([sai-actitime#427](https://github.com/sourceallies/sai-actitime/pull/427), [unified-graph#500](https://github.com/sourceallies/unified-graph/pull/500)) and Kyle Hoehns's "Undo and Impact" variant ([hacker-rank-queue#607](https://github.com/sourceallies/hacker-rank-queue/pull/607)), which adds the revert steps this uses as `Undo`.
- A copied template (`one-way | two-way`) is unparseable on purpose, so an agent that echoes the form gets 🟡.

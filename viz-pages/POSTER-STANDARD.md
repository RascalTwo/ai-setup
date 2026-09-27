# Poster standard

> **The reference is [`viz-pages/poster-standard/`](poster-standard/) — this standard, as a
> poster following it.** Read that before writing one. It is deliberately not a tool's poster:
> picking a favourite tool as the exemplar makes the exemplar drift when that tool changes,
> and makes every other poster a copy of one thing rather than an application of a rule.
> The meta poster cannot drift without visibly breaking its own spec.


Every tool and skill this repo owns gets a poster in `viz-pages/`, built on the
`poster-dive` scaffold: a 1200×630 card that *is* the share image, and a dive below it.

The card is free. The dive is not.

## Five beats, in order

| # | Beat | `data-beat` | What it has to answer |
|---|---|---|---|
| 1 | Why it exists | `why` | What was broken before this. The before-state, not the feature list. |
| 2 | Using it | `using` | The trigger — keys, command, or when the skill fires. |
| 3 | What it doesn't do | `limits` | Accepted ceilings and refusals. Early, on purpose: a reader deciding whether to care deserves the limits before the internals. |
| 4 | Where it lives | `where` | What it integrates with, what it requires, where its state is and whether that state is safe to delete. |
| 5 | How it actually works | `how` | The mechanism, end to end. The deep one. |

Order is fixed. Beats may be split across several `<h2>` sections — three sections can
all carry `data-beat="how"` — but the beats themselves may not interleave.

## Headings stay yours

The checker never reads heading text. *"The predecessor died and nobody noticed"* is a
better heading than *"Why it exists"*, and a standard that flattened those into generic
labels would cost more than it bought. Mark the section instead:

```html
<h2 data-beat="why">The predecessor died and nobody noticed</h2>
```

## Beat 5 has a bar

This is the one the standard exists for. Prose alone does not satisfy it.

- **Name the real things.** Processes, files, protocols, functions, line numbers. Not
  "it hooks into the agent" — `PostToolUse` fires, writes to this path, read back by that.
- **End to end.** A reader should be able to trace one input from entry to effect without
  leaving the section. Scattered "why X is like that" asides do not count; that was the
  state of these posters before this standard and the reason it was written.
- **At least one visual.** A diagram, or a `stepper()` walkthrough of the sequence.
- **Skills included.** A prose-only skill still has an architecture — it is the shape of
  what the model is being told to do, in what order, and what it is told never to do.
  `steelman`'s flow and `documandments`' decision ladder are architecture.

## Beat 4 agrees with the manifest

`where` restates what the frontmatter already declares: `integrates`, `requires`, `state`,
`deletion-policy`. It is written by hand — a generated table would make the page a
rendering of data rather than something authored — and `scripts/check-posters.ts`
asserts it matches. Drift is a failure, not a difference of opinion.

## Checking

```sh
bun scripts/check-posters.ts          # every tool and skill
bun scripts/check-posters.ts --fix-list  # just the names that need work
```

It reports: anything owned with no poster, beats missing, beats out of order, a `how`
beat with no diagram or stepper, and a `where` beat disagreeing with the frontmatter.

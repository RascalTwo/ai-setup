# Answer from a Needs-you card, with buttons that stay greyed until you have typed your own words

Status: Accepted, 2026-11-14

## Context and Problem Statement

"Kelpie calm" (`.scratch/kelpie-calm/SPEC.md`) puts everything waiting on Joseph in one living "Needs you" section of the board, and wants each card answerable there, with no terminal. Until now the board never signed off, approved, closed or parked: `signoff`, `approve`, `close` and `park` quote "their words" into the task, and the README said they stay on Joseph's word, in the pane or on a spec or demo page.

## Decision

A run's card has one text box, and every button that speaks for Joseph is disabled until it holds text (`api.ts` checks it again): `kelpie signoff|approve|park|close "<text>"` and `kelpie page "<text>"` (a reply or a request for changes) run from the run's folder (`~/.agents/state/kelpie/runs/<project>/<task>`), where those commands find their task, with `HERDR_PANE_ID` removed so `approve` takes the board for a page and not the agent. Nothing sends a fixed phrase. Stale cards, which carry no words, run `kelpie keep|drop|later <task>`. Every action is a button press, never a side effect of the list refreshing.

- Text starting with `--` is refused: the CLI reads any such argument as a flag.
- Runs waiting on Joseph come first, oldest first, then stale items; each waiting run holds its project's slot, a stale item blocks nothing.

## Alternatives Considered

- A fixed phrase on Approve ("approved from the board"): one click, but the history would claim he said something he did not, which `signoff`, `approve`, `close` and `park` exist to prevent.
- Only links to the spec or demo page: the page has the richer judgments, but then the card cannot clear the list, and a question or an idle run has no page.
- Order by most-blocking: needs a measure of what each run holds up; oldest first is the same order the tick and the old strip used.

## More Information

- Park and Close from the board do not close the run's herdr pane the way the same command in the pane does (it closes itself 10 seconds later); a closed task's pane is closed by the tick, a parked one lingers until closed by hand.
- `kelpie page` credits the comment to "Joseph (spec page)", whichever surface sent it.
- [2026-11-14-label-needs-you-cards-by-fixed-rules-over-the-agents-merge-danger.md](2026-11-14-label-needs-you-cards-by-fixed-rules-over-the-agents-merge-danger.md) lets a 🟢 two-way, small card send fixed words from Approve and the default Sign off; everything else here still holds.

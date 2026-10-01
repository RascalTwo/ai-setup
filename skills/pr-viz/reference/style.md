# House style

The owner's review preferences — follow them unless the user says otherwise for this PR.

## Structure: Why → What → How → Proof → Risk → Verdict
- **Why** — the problem or the value, from the reviewer's side: who hits it, what it costs.
  Whether it is a bug fix or a feature is the reader's call; show the behaviour, not the label.
- **What** — the behaviour change, before and after, on real input.
- **How** — where it lands, then the mechanism, then the diff tour (every production hunk).
- **Proof** — the trace (every behavior → what proves it), real runs, test and CI status, a
  mutation score if one exists (otherwise say the tests weren't mutation-checked).
- **Risk & rollout** — what a careful reviewer would notice, and every step after merge.
- **Verdict** — what approving means, in four or five checks. Never the approval itself: no
  "safe to approve" stamp or line — the reviewer decides, the film only sums up.

## Picture
- No header labels on the film — no repo/PR tag top-left, no chapter title top-right. The
  chapter bar at the bottom is the navigation.
- Before/after: what didn't change is muted; what changed is the only colour on screen.
  Identical steps across a before/after get connector lines between them (`pipeline`).
- Every scene fills the stage (the template fits it automatically); nothing smaller than
  ~16px at 1080p — split a crowded scene rather than shrink it.

## Diff tour
- **Follow the data**: start where the change is triggered (the call site), then open the
  function it calls, the way a reader would step through it. Name the function at the call
  site ("a new function, `inline_link_urls`") so the next step has something to land on.
- **Point while you talk, as granular as possible**: every phrase that names a piece of code
  marks the smallest thing it means — the identifier, the argument, the `else` branch
  (`[the page's own address](L69:source_url)`), a whole line only when the sentence really is
  about the whole line. The viewer should never have to scan a highlighted line for the part
  you meant. Erring too fine is fine; someone will say so. (scenes.md → Pointers)
- **Highlight or point, not both**: lighting a thing and aiming the cursor at it says the
  same thing twice — visual noise. Highlight by default; point (`^`) at something *inside* a
  highlighted region, or instead of a highlight where lighting it would be too much. A cursor
  aims at the centre of its target.
- **Group, don't flood**: several things at once get one outline around the set, never a
  box each; and don't point at what colour or position already says.
- **Say reuse out loud**: when a step uses something already shown, say so ("using that
  same function"). Code copied into several files is one step — "the same code in all three
  modules" — never one step per copy.

## Script
- Spoken English: short sentences, no parentheses, numbers as words where they're read aloud
  ("eleven eighty-seven", "fifteen of fifteen").
- Each line earns its beat: it says what the picture shows, then why it matters.
- Leave out caveats that don't bear on approving — "not run yet" lists, process trivia.
- Cite only what the audience can see: tests, CI, real runs, public docs. Never an internal
  or private tool (a review bot, a local skill) — they can't check it, so it proves nothing.
- Story scenes (Why, and the headline What) carry motion: a page that visibly loses its links
  beats three static cards. `flow` is that scene as a kind — reach for it first, and for a
  `custom` scene only when the story isn't a flow.

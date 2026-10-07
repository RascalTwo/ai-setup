---
name: grill-me-viz
description: "Grills the user through a live viz page: prototypes to react to, visual options to pick, explanatory diagrams. Use for \"grill me visually\", \"grill me viz\" (or \"grill me vis\"), or when a grilling question can't be settled in words (how a screen looks, one layout or three)."
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires:
    skills: [grilling, viz]
---

# Grill me visually

Grilling where the page is the medium. The question discipline is `grilling`'s; the page craft is `viz`'s. This skill only covers how the two combine.

## Steps

1. **Load both.** Call the Skill tool with "grilling", then with "viz". Set up viz in its full mode (live URL, viz ≥ 9.4 for the page data route); in fallback mode the pick and Send buttons save nothing, so answers come by terminal only, and say so.

2. **Create one page for the session.** `viz create grill-<topic>` and tag it `viz update <dir> --tags grill-session` (hidden from the library's default views), then copy [`grill.ts`](grill.ts), [`grill.css`](grill.css) and [`grill-expand.js`](grill-expand.js) beside its `index.html`; load `grill.css` after the kit stylesheet, and last `<script src="grill.js"></script><script src="grill-expand.js"></script>` (the viz server strips grill.ts's types; in fallback mode paste the generated [`grill.js`](grill.js) instead). `grill-expand.js` adds the top-right "Expand all / Collapse all" button, which opens every decision and every "Show what you were asked" at once. They own the shared look (question cards, options, folding, decided lines, Send); the page adds only its own visuals. Voice and typed feedback come from viz's feedback widget, which the server injects on every live page (the pill in the bottom-right; `reference/review-layer.md` in viz). Its mic transcribes on the device: in Chrome it works at once, and the pill's ⬆ offers the skill's own speech model (Parakeet, ~2.4 GB once, cached in the browser after). Hand the user the URL once; the tab stays open all session and hot-reloads as you edit.
   **Done when:** the URL is in the terminal and the page renders round 1.

3. **Run each round on the page.** Each round is a `<section class="round" data-round="N">` appended at the bottom; `grill.ts` scrolls to it once when it first appears, and if the tab isn't focused, swaps in an attention favicon and title until it is. Per question, a `<div class="q">` with an `<h3>`:
   - Title and body, same as a terminal round, then a `.rec` box holding only *why* you recommend the option marked `data-rec`: the badge already says which, so the box skips "➡️ A".
   - A visual **where it adds value**: a throwaway prototype to react to, the options rendered side by side, or a diagram that explains the context the question rests on. A plain naming or yes/no question stays text. Every visual follows `viz`'s bar (meaning in space, `data-viz-id` on marks).
   - Options as `<button data-pick="Q3:B">` inside `.opts`, one per choice, when the question has discrete options; put `data-rec` on the one you recommend so the card itself shows it. Picking folds the question to its answer; clicking it reopens.
   Before handing a round over, **check its visuals are readable, not just rendered**: open the page in a Chrome tab at the user's window size, run `grill.tinyText()` in it (text in the newest round rendering under 11 px; an SVG shrunk to fit a card is the usual cause) and fix until it returns `[]`, then look at a screenshot of the round with a native image read and fix anything you had to squint at. A render check passing is not this check.
   End the section with `<button data-send="N">Send round N</button>`. In the terminal print one line pointing at it ("Round 4 is on the page: Q9–Q11, recommendations marked"), not the round again; the user can still answer there by question number.

4. **Wait for answers.** Either a terminal reply arrives or the page logs round N's Send: the line `{"type":"send","round":N}` in `<viz-dir>/.viz-data/feedback.jsonl`. Wait for Send in the background (Claude Code: Bash `run_in_background` running `until grep -q '"type":"send","round":N}' <viz-dir>/.viz-data/feedback.jsonl; do sleep 1; done`), so a terminal reply still interrupts. The round's button and the widget's Send write the same line.
   **Done when:** the user replied in the terminal or round N's Send entry exists.

5. **Read the answers** from both channels: the terminal reply, and `viz feedback <viz-dir>` (the page's picks, the latest per question wins, and every line the user spoke or typed, grouped by what it's anchored to: a question card reads `[Q3]`, an option its `data-label`; add `--detail` for pointer position and scroll when an anchor alone doesn't say what they meant). A terminal answer overrides the page for the same question. Once a round is read, run `viz feedback <viz-dir> --clear` so its lines leave the page and pins never pile up across rounds (the user asked for this; on grill pages it replaces viz's resolve-then-clear lifecycle). The log keeps everything.

6. **Rewrite answered questions as decisions, in place.** Collapse each settled question into `<details class="decided"><summary><span class="n">Q3</span><decision><span class="pick">B</span></summary>…</details>` keeping the question exactly as it was asked (its `.q`, options and visuals) inside a nested `<details class="original"><summary>Show what you were asked</summary>…</details>`, so the decision reads in one line and the original is two clicks away. The page becomes the decision record; it carries no separate summary section. If the repo has `CONTEXT.md` or ADRs, update them too, per `domain-modeling`.
   **Done when:** every question the user answered this round reads as a decision.

7. Recompute the frontier and go to step 3, until `grilling` says the session is done. End with a terminal summary of the decisions and the page URL.

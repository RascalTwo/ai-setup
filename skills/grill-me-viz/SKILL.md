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

2. **Create one page for the session.** `viz create grill-<topic>` and tag it `viz update <dir> --tags grill-session` (hidden from the library's default views), then copy [`grill.ts`](grill.ts), [`grill.css`](grill.css) and [`grill-expand.js`](grill-expand.js) beside its `index.html`; load `grill.css` after the kit stylesheet, and last `<script src="grill.js"></script><script src="grill-expand.js"></script>` (the viz server strips grill.ts's types; in fallback mode paste the generated [`grill.js`](grill.js) instead). `grill-expand.js` adds the top-right "Expand all / Collapse all" button, which opens every decision and every "Show what you were asked" at once. They own the shared look (question cards, options, folding, decided lines, Send); the page adds only its own visuals. Voice and typed feedback come from viz's feedback widget, which every page carries (the 🎙 💬 pill in the bottom-right; `reference/review-layer.md` in viz). Its mic transcribes on the device: in Chrome it works at once, and ⬆ Parakeet in the 💬 panel offers the skill's own speech model (~2.4 GB once, cached in the browser after). Hand the user the URL once; the tab stays open all session and hot-reloads as you edit. To grill someone without the server (a teammate, over Slack), export the page to one file: they answer it in their browser, and the panel's Copy hands their answers back as text and a picture.
   **Done when:** the URL is in the terminal and the page renders round 1.

3. **Run each round on the page.** Each round is a `<section class="round" data-round="N">` appended at the bottom; `grill.ts` scrolls to it once when it first appears, and if the tab isn't focused, swaps in an attention favicon and title until it is. Per question, a `<div class="q">` with an `<h3>`:
   - Title and body, same as a terminal round, then a `.rec` box holding only *why* you recommend the option marked `data-rec`: the badge already says which, so the box skips "➡️ A".
   - A visual **where it adds value**: a throwaway prototype to react to, the options rendered side by side, or a diagram that explains the context the question rests on. A plain naming or yes/no question stays text. Every visual follows `viz`'s bar (meaning in space, `data-viz-id` on marks).
   - Options as `<button data-pick="Q3:B">` inside `.opts`, one per choice, when the question has discrete options; put `data-rec` on the one you recommend so the card itself shows it. Picking folds the question to its answer; clicking it reopens.
   Before handing a round over, **check its visuals are readable, not just rendered**: open the page in a Chrome tab at the user's window size, run `grill.tinyText()` in it (text in the newest round rendering under 11 px; an SVG shrunk to fit a card is the usual cause) and fix until it returns `[]`, then look at a screenshot of the round with a native image read and fix anything you had to squint at. A render check passing is not this check.
   End the section with `<button data-send="N">Send round N</button>`. In the terminal print one line pointing at it ("Round 4 is on the page: Q9–Q11, recommendations marked"), not the round again; the user can still answer there by question number.

4. **Wait for answers.** Either a terminal reply arrives or the page logs round N's Send: the line `{"type":"send","round":N}` in `<viz-dir>/.viz-data/feedback.jsonl`. Wait for Send in the background (Claude Code: Bash `run_in_background` running `until grep -q '"type":"send","round":N}' <viz-dir>/.viz-data/feedback.jsonl; do sleep 1; done`), so a terminal reply still interrupts. The round's button and the panel's Send write the same line.
   **Done when:** the user replied in the terminal or round N's Send entry exists.

5. **Read the answers** from both channels: the terminal reply, and `viz feedback <viz-dir>` (the page's picks, the latest per question wins, and every line the user spoke or typed, grouped by what it's anchored to: a question card reads `[Q3]`, an option its `data-label`; add `--detail` for pointer position and scroll when an anchor alone doesn't say what they meant). A terminal answer overrides the page for the same question. Once a round is read, run `viz feedback <viz-dir> --clear` so its lines leave the page and pins never pile up across rounds (the user asked for this; on grill pages it replaces viz's resolve-then-clear lifecycle). The log keeps everything.

6. **Rewrite answered questions as decisions, in place.** Collapse each settled question into `<details class="decided"><summary><span class="n">Q3</span><decision><span class="pick">B</span></summary>…</details>` keeping the question exactly as it was asked (its `.q`, options and visuals) inside a nested `<details class="original"><summary>Show what you were asked</summary>…</details>`, so the decision reads in one line and the original is two clicks away. The page becomes the decision record; it carries no separate summary section. If the repo has `CONTEXT.md` or ADRs, update them too, per `domain-modeling`.
   **Done when:** every question the user answered this round reads as a decision.

7. Recompute the frontier and go to step 3, until `grilling` says the session is done. End with a terminal summary of the decisions and the page URL.
   When the grill was about a task someone will build, offer to turn its decisions into a spec page for it (Spec mode, below): each decision becomes an example or assumption.

## Spec mode

The same page, rendered from data: a task agreed well enough to start. `pr-viz` shows a change well
enough to approve; spec mode shows what is about to be built well enough that the user can be sure you
mean the same thing. You make the page; the user does the agreeing, and **signing off is theirs, never
yours**. Use it for Kelpie refine runs and whenever the user says "spec this" / "agree the spec"
(`spec-viz` is an alias for this section). No grilling needed first: with nothing to grill, the page is
the whole interview. `$SPEC` is `spec/` beside this file.

It uses the grill page's cards and feedback, fed by one `spec.json` (shape: `$SPEC/template/spec.schema.ts`;
what `pr-viz` does with it: `pr-viz/reference/spec.md`). Two modes from one file: the **page**, and its
**film** (`#{"mode":"film"}`, about a minute, narrated, in the page, no mp4).

1. **Know the task.** Read what the refine run read: the task, the project's code and docs. If a grill
   page decided things, lift each decision into an example or assumption. *Done when* you can say the
   task in one sentence a stranger would get.

2. **Write `spec.json`.** `$SPEC/template/spec.json` is a blank skeleton: every field says what goes
   there, so replace all of it. Nothing in this skill is an example to copy from.
   - `ask`: one or two sentences, your words, specific enough to be wrong.
   - `examples`: **concrete cases**, not principles: at least three `should`, two `shouldnt`. A good one
     names a real input and the exact result. A `shouldnt` is the misreading a sensible person might
     make; write the one you were most tempted by.
   - `assumptions`: what you decided without being told, each a claim that can be wrong.
   - `visual` on **every example and assumption** where the thing is visual: a mock of that case (a
     visible change) or a map with the affected part lit (an invisible one), inline SVG or HTML.
     Every mark's position or size means something you can name (viz bar 1). Leave it off only when the
     item is not visual (a naming rule, a sequence of API calls); don't draw decoration to fill the slot.
   - `hero.done`: the three examples that matter most, short. `hero.scope`: one plain sentence, what it
     is then what it isn't. `hero.slot`: the picture of the whole result (a mock, or a map).
   - `visuals`: pictures for the task as a whole (where, in what order, how much, only with real
     numbers), each with a `says` line naming what its position or size encodes.
   - `plan`: the steps you expect to take, in order. You may deviate and must say why at handover.
   - `task.folder`: your run folder (`~/.agents/state/kelpie/runs/<project>/<task>`), so sign-off finds
     the task. `version` 1, `signedOffAt` null.
   *Done when* every field is filled and no example is vague.

3. **Create it.** `viz create spec-<task-id> --from "$SPEC/template"`, put `spec.json` in its folder,
   then `bun "$SPEC/build.ts" <viz-dir>` (writes `narration.json` from the same words and copies the
   shared grill files beside the page, so run it again after any change to `spec.json`).
   `viz verify <viz-dir>`, then `viz verify '<url>#{"mode":"film"}'` (compiles the voice, then times the
   film to it). Read `.verify/chapters.png`: it is the whole film in one image. *Done when* both verify
   clean and every chapter reads at a glance.

4. **Hand it over.** In your pane, give the URL and what to do: pick **✓ Right**, **~ Kinda** or
   **✗ Wrong** on each card, pin a comment on any that isn't ✓ (Alt-click it, or the 🎙 💬 pill), press
   *Send corrections*. Then stop and wait. In a **Kelpie run** the page tells your pane itself: pressing
   *Send corrections* or *Sign off* types a `[kelpie] …` message into this session, so don't start a
   watcher. Anywhere else, wait for the `"type":"send"` line in `<viz-dir>/.viz-data/feedback.jsonl` in the
   background, as step 4 above. *Done when* you've given the URL and are waiting.

5. **Revise.** `viz feedback <viz-dir>` lists the picks and every comment grouped by the card it is
   pinned to (`[E3]`). A ✗ is wrong; a **kinda** means partly right, and *what part* is exactly what
   the comments on that card say, so read them before rewriting. Rewrite those items (text and
   picture) in `spec.json`, leave agreed ones alone, rebuild, hand over again, and
   `viz feedback <viz-dir> --clear` what you've read. Rebuilding (`build.ts`) stamps `revisedAt`, and
   that is the hand-back: the ✗ and kinda picks the user sent come back as unjudged cards marked
   "revised: judge again", while their ✓ stay. So rebuild only once the revision is done.

6. **Sign-off is not yours.** The Sign off button stays locked until every card is ✓, then runs
   Kelpie's sign-off for the user: it records their picks on the task, sets Refined, and ends your
   run. Never run `signoff` on the strength of "looks good"; a signed spec is on its page.

**When the user changes their mind later:** bump `version`, add `{ "v": N, "what": "…" }` to
`changes`, set `signedOffAt` to null, rewrite what changed, and ask for the picks again. A build agent
in flight is told through Kelpie's relay; `pr-viz` checks the latest version and says which it checked.

**Not yet:** a lighter spec for a tiny task, a phone, a second voice, the hero's image on the Timeline
Studio task. Kinda's meaning is read from the comments by you; the page doesn't summarise them.

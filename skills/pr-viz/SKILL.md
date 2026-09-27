---
name: pr-viz
description: Turn a pull request or local diff into a narrated review film (mp4) plus an interactive review page, detailed enough that a reviewer can approve from it. Use when the user wants a PR explained, reviewed, demoed or "turned into a video", a reviewable walkthrough of a change or branch, or says "pr viz" / "review video" / "PR film". Needs the viz skill.
rascaltwo-ai-setup:
  kind: skill
  state: true
  requires: [viz, bun, ffmpeg]
---

# PR viz — a change, explained well enough to approve

One viz, two modes, rendered from one `plan.json`:

- **Film** (default): a narrated walkthrough with a chapter bar — Why → What → How
  (including a tour of every changed line) → Proof → Risk & rollout → Verdict. `viz render`
  makes it an mp4.
- **Review**: the same scenes laid out as a page, with the transcript, the full diff, and
  the acceptance criteria, and a "reviewed" box per file. "▶ watch" plays that scene's section
  in place.

The viz craft is `viz`'s (load it first); the film engine is its kit `film()`. This skill is
the reviewing: what to find out, how to structure it, and the template that renders it.

`$PRVIZ` below is this skill's directory.

## Steps

1. **Pin the change.** A PR (URL or `owner/repo#n`) or a local range (`main...branch`).
   Get a local checkout at the head — the surrounding code is part of the review, not just
   the diff. Note base and head SHAs; everything below is about exactly those.
   *Done when* `git -C <checkout> diff <base>...<head> --stat` matches the PR's file count.

2. **Research like the reviewer who has to defend it.** Read **`reference/research.md`** and
   do all of it. *Done when* you can answer, each with a source you read: why this change
   exists, what changes for whom, how every hunk works, what proves each behavior, what
   could break, and how it ships.

3. **Create the viz from the template.**
   `viz create pr-<n>-<slug> --from "$PRVIZ/template"` — it lands with `pr-viz.js`,
   `pr-viz.css` and an `index.html` you never edit.

4. **Write `plan.json`.** Format: **`reference/plan.md`**. Scene kinds: **`reference/scenes.md`**.
   House style: **`reference/style.md`** — read all three before the first scene. Acceptance
   criteria (AC1…ACn) first, each with its proof; then scenes in Why → What → How → Proof → Risk →
   Verdict order. Say lines are the script: short sentences, spoken English.

5. **Build.** `bun "$PRVIZ/scripts/build.ts" <viz-dir>` writes `hunks.json` and
   `narration.json`, and runs the add-ons the change calls for (a Python call graph, rendered
   PDF fixtures — scenes.md → Add-ons). It refuses until the diff tour covers every
   production hunk and lists the ones missing. *Done when* it prints `✓ … covers N/N production hunks`.

6. **Verify until clean.** `viz verify <viz-id>` twice — the first compiles the narration,
   the second times every beat to its real clip. Read `.verify/chapters.png` for layout,
   then **every `.verify/chapter-NN.png` at full size** — a highlight that skips a space or
   a clipped glyph is invisible in the tiled sheet. Check review mode too: verify the URL
   with hash `#{"mode":"review"}` and `--full`.
   *Done when* 0 errors, no narration warnings, and every full-size chapter frame reads
   cleanly — nothing clipped, overlapping, mis-highlighted, or too small at 1080p.

7. **Render** — `viz render start <viz-id> --out ~/Desktop/pr-<n>.mp4` returns at once. While
   it runs, pull a frame from mid-way through each dense scene (`ffmpeg -ss <t> -i … -frames:v 1`)
   and read them: mid-chapter states are what `verify` never shoots. The mp4 carries the
   film's chapters, and `pr-<n>.chapters.txt` lists them for a YouTube description.

8. **Hand it over** — the mp4 (+ `.vtt`), the live URL (film, and review via the
   "Review this ↗" button), and anything you could not verify. Posting to the PR is the
   user's move; leave it to them.

## When the template doesn't fit

A visual only this PR needs is a `custom` scene (`reference/scenes.md`) — it plays in both
modes. A kind that *several* PRs would need belongs in the template: add it to
`template/pr-viz.js` + `pr-viz.css` and document it in `reference/scenes.md`. Template files
are copied per viz at create; to update an existing one, copy the two files over again.

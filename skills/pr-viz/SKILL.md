---
name: pr-viz
description: "Turns a PR or local diff into a narrated review film (mp4) plus an interactive review page a reviewer can approve from. Use for \"explain/demo this PR\", \"turn it into a video\", \"pr viz\", \"review video\", \"PR film\". Needs the viz skill."
rascaltwo-ai-setup:
  kind: skill
  state: true
  requires:
    skills: [viz]
    commands: [bun, ffmpeg]
---

# PR viz — a change, explained well enough to approve

One viz, three modes, rendered from one `plan.json`:

- **Film** (default): a narrated walkthrough with a chapter bar — Why → What → Where to look →
  How (including a tour of every changed line) → Proof → Risk & rollout → Check these.
  `viz render` makes it an mp4.
- **Review**: the same scenes laid out as a page, with the transcript, the full diff, and
  the acceptance criteria, and a "reviewed" box per file in story order. A tick survives a push
  when that file's diff didn't change; a changed file comes back unticked and badged.
  "▶ watch" plays that scene's section in place.
- **Poster**: the review page with only the pictures — every scene finished, the diff tour as
  the film shows it (production hunks, in review order) — one tall image for anyone who won't
  play the film.

Plus a **hero**: the one scene (`plan.json` `hero`) that says what the PR is about, as a
1080p still. `scripts/stills.ts` shoots the hero and the poster.

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
   `viz create pr-<n>-<slug> --from "$PRVIZ/template"` — it lands with `pr-viz.ts`,
   `pr-viz.css` and an `index.html` you never edit.

4. **Write `plan.json`.** Format: **`reference/plan.md`**. Scene kinds: **`reference/scenes.md`**.
   House style: **`reference/style.md`** — read all three before the first scene. Acceptance
   criteria (AC1…ACn) and `lookHere` first; then scenes in Why → What → Where to look → How →
   Proof → Risk → Check these order. Say lines are the script: short sentences, spoken English. Name the `hero`:
   the scene that, alone, tells a stranger what the PR does. Pick the short cut's scenes
   against its three questions (plan.md → The short cut).

5. **Build.** `bun "$PRVIZ/scripts/build.ts" <viz-dir>` writes `hunks.json` and
   `narration.json`, and runs the add-ons the change calls for (a Python call graph, rendered
   PDF fixtures — scenes.md → Add-ons). It refuses until the diff tour covers every
   production hunk and lists the ones missing. *Done when* it prints `✓ … covers N/N production hunks`.

6. **Verify until clean.** `viz verify <viz-id>` twice — the first compiles the narration,
   the second times every beat to its real clip. Read `.verify/<viz>/chapters.png` for layout,
   then **every `.verify/<viz>/chapter-NN.png` at full size** — a highlight that skips a space or
   a clipped glyph is invisible in the tiled sheet. `<viz-id>` is the id `viz search` prints
   (`.agents/state/viz/pr-…`), not the bare slug — a bare slug 404s. Check review mode too:
   verify the full `http://127.0.0.1:5180/<viz-id>/#{"mode":"review"}` URL with `--full` (a
   bare id drops the hash); its "FILM TIMELINE NEVER REGISTERED" error is expected there.
   *Done when* 0 errors, no narration warnings, and every full-size chapter frame reads
   cleanly — nothing clipped, overlapping, mis-highlighted, or too small at 1080p.

7. **Render** both films as background jobs — `viz render start` returns at once, so start the
   short cut and then the full film straight after it, without waiting. The short cut is the
   same page at `#{"cut":"short"}` (plan.md → The short cut), rendered from its full URL:
   `viz render start 'http://127.0.0.1:5180/<viz-id>/#{"cut":"short"}' --out ~/Desktop/pr-<n>.short.mp4`.
   It warns once per line it leaves out ("the timeline has no beat N") — expected. It is a
   fifth of the length, so it finishes first: then read `pr-<n>.short.vtt` top to bottom as the
   stranger — *done when* its words alone answer all three questions in plan.md → The short
   cut; otherwise re-mark the scenes and start it again. A render re-times the viz's live
   narration to the film it shot, so once both jobs are done, `viz verify <viz-id>` once more
   puts the live page back on the full film.
   `viz render start <viz-id> --out ~/Desktop/pr-<n>.mp4` is the full film. While
   it runs, pull a frame from mid-way through each dense scene (`ffmpeg -ss <t> -i … -frames:v 1`)
   and read them: mid-chapter states are what `verify` never shoots. The mp4 carries the
   film's chapters, and `pr-<n>.chapters.txt` lists them for a YouTube description.
   Then `bun "$PRVIZ/scripts/stills.ts" <viz-dir>` writes `~/Desktop/pr-<n>.hero.png` and
   `pr-<n>.poster.png`, and paints the hero onto both mp4s' first frame — GitHub's player
   shows that frame as the video's thumbnail. Read the hero, and the poster in slices (it is
   too tall to read whole). Re-rendering replaces the mp4, so run stills again after.
   `bun "$PRVIZ/scripts/review-order.ts" <viz-dir>` prints the diff tour as markdown (the
   changes walkthrough): each step's words, then its code as text GitHub colours (added-only
   hunks in the file's language, changed ones as `diff`), linked to those lines on GitHub.
   Import-only hunks are left out and listed at the end; the film still walks every hunk.

8. **Hand it over**: the mp4 and the short cut (+ `.vtt`), hero, poster and walkthrough markdown, the live URL
   (film, and review via the "Review this ↗" button), and anything you could not verify. pr-viz
   stops here. Putting these on a PR is `r2-pr`'s job.

## When the template doesn't fit

A visual only this PR needs is a `custom` scene (`reference/scenes.md`; 3D, and when it earns its place: `reference/3d.md`) — it plays in both
modes. A kind that *several* PRs would need belongs in the template: add it to
`template/pr-viz.ts` + `pr-viz.css` and document it in `reference/scenes.md`. Template files
are copied per viz at create; to update an existing one, copy the two files over again.

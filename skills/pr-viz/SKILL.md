---
name: pr-viz
description: "Makes a PR's hero: one picture that explains the change's idea, as a 1920×1080 still (PNG) and a 6 s looping GIF of it building up. Use for \"hero for this PR\", \"pr viz\", \"picture of this change\", and from r2-pr for every PR. Needs the viz skill, node and ffmpeg."
rascaltwo-ai-setup:
  kind: skill
  state: true
  state-owner: viz
  requires:
    skills: [viz]
    commands: [node, ffmpeg]
---

# PR viz: the hero

A hero is the one picture that tells a stranger what a PR is about. It comes as a still and a GIF of the same picture: 4 s of motion building it up, then a 2 s hold on the finished picture, looping, 960 px wide, under 5 MB, no sound. The GIF's last frame is the still. The code tour is `hunk-review-viz`'s and the PR text is `r2-pr`'s; this skill makes only the picture.

Every hero shares one fixed frame: the title top-left, one subtitle line under it, a repo#PR badge top-right, and a large drawing area below. Only the drawing changes per PR. `$PRVIZ` below is this skill's directory.

## Steps

1. **Pin the change and read it.** A PR (URL or `owner/repo#n`) or a local range; get a checkout at the head and note base and head. Read the diff and the code around it until you can say the idea in one sentence to someone who has never seen the repo. *Done when* `git diff <base>...<head> --stat` matches what you read and the sentence names who is helped or what now works.

2. **Create the viz.** `viz create pr-<n>-<slug> --from "$PRVIZ/template"` (no number yet: `pr-<slug>`). It lands with `index.html` and `frame.ts` (never edit these), `ramp.ts`, `hero.json` and `drawing.ts`.

3. **Fill `hero.json`.** `title` is the PR title in plain English (`code` spans render mono), `subtitle` is one line: who it is for or what it does. `repo` and `pr` make the badge `repo #pr`; with `"pr": null` it shows `repo · branch`, and with no `branch` just the repo.

4. **Draw the idea in `drawing.ts`.** Replace the starter. `export default function mount(area)` runs once, builds SVG or HTML in `area` (1760×770 CSS px on the 1920×1080 stage, styled with the viz kit's tokens) and returns `draw(t)`: `t` is seconds, 0 to 4, and `t = 4` is the finished picture. `draw` is a pure function of `t` (the film is seeked, not played): set attributes and styles from `t` with `ramp(t, from, to)`; timers, CSS transitions and rAF do not render. Read viz's `SKILL.md` first (the ambition bar and the form menu) and give each mark a `data-viz-id` and `data-label`. *Done when* the picture at `t = 4` explains the idea with no other text on the page.

5. **Verify.** `viz verify .agents/state/viz/<viz>` until 0 errors (lint and format included), then read `.verify/<viz>/chapters.png`: its two frames are the end of the build and the end of the hold. Fix what is clipped, overlapping or too small, and verify again.

6. **Make the files.** `node "$PRVIZ/scripts/hero.ts" <viz-dir> [--out <prefix>]` writes `<prefix>.hero.png` and `<prefix>.hero.gif` (default prefix `~/Desktop/pr-<pr number, else the folder name>`). Over 5 MB it retries with fewer frames, then fewer colours, and fails naming the size.

7. **Check both outputs.** Read the PNG at full size. `ffprobe` the GIF. *Done when* the PNG is 1920×1080, the GIF is 960 px wide, at most 6 s and at most 5 MB, and the picture reads cleanly.

8. **Hand over** the two paths and anything you could not verify. Putting them on the PR is `r2-pr`'s job.

## What makes a good hero drawing

- **The idea, not the file list.** Show what the change makes possible or prevents, as a mechanism a stranger can follow: a request flowing through checks, before and after, a gap closing. Names of files and functions are noise unless they are the idea.
- **Meaning in position, size and colour.** Point at any mark and say what its place, length or colour encodes (viz's ambition bar). A box with words in it is a document.
- **Motion tells the order.** Build in the order the idea reads (cause, then effect) so the 4 s is a sentence; everything is on screen and still for the last 2 s.
- **Readable at 960 px wide.** The GIF halves everything: no text under 14 px at 1920, aim for 22 px and up for labels a reader needs, and keep the drawing to one idea, not every detail.

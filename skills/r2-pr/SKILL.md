---
name: r2-pr
description: "Opens or updates a GitHub PR the house way: local draft the user approves, a bite-size summary over the pr-viz walkthrough, pr-shape run on every branch, repo PR template kept, only r2-pr's marked sections refreshed on later pushes. Use when opening, drafting, or updating a PR or its description."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    github: gh (push, pr create/edit, markdown rendering)
    demo-viz: makes or reuses the branch's live demo (walk.json, its story pictures) for the body's What changes table
  requires:
    skills: [pr-shape, pr-viz, demo-viz, github-attach-media, unslop, design-doc-mermaid]
    commands: [gh, git, bun, rsvg-convert]
---

# r2-pr: a PR, opened or updated

r2-pr owns the PR: the body, its layout, getting it onto GitHub, and refreshing it after new
commits. It does not watch CI, answer reviews or merge. The pieces come from other skills:

- **pr-shape** rebuilds the branch as reviewable commits in reading order, and cuts it into pieces when it holds more than one change.
- **pr-viz** makes the **walkthrough**: the image and the changes walkthrough (the diff in review order, as text), plus the video (its first frame is the hero) when another person will read the PR; its `plan.json` `lookHere` is the body's Where to look.
- **demo-viz** makes the **demo**: one card per change, with a before and an after picture. r2-pr decides whether the change can be demoed, and the demo's cards become the body's **What changes** table.
- **github-attach-media** puts the video, the image and the demo's pictures on GitHub.
- **unslop** is applied to every sentence r2-pr writes.

The body's layout, sections, title rule and the GitHub facts behind them:
**[`reference/body.md`](reference/body.md)**. Read it before drafting.

`$R2PR` is this skill's directory, `$PRVIZ` pr-viz's; state lives in `~/.agents/state/r2-pr/<owner>-<repo>/<branch>/`.

## Steps

1. **Pin it.** Repo (`owner/name`), branch, base, head SHA, and whether a PR already exists
   (`gh pr view <branch> --json number,url,state`). An existing PR → **update** (step 9); none →
   continue. A `gh` "Could not resolve to a Repository" means the wrong account is active:
   `gh auth status`, then `gh auth switch -u <account>`.
   *Done when* all five are known.

2. **Read the repo's conventions.** Its PR template, `CONTRIBUTING.md`'s PR guidance, and its
   title style (`gh pr list --state all --limit 20 --json title,author`). If `r2-sdlc` ran on this
   branch, its `understood.md` and Phase 7 summary (`~/.agents/state/r2-sdlc/<repo-id>/<slug>/`)
   are the starting point for Why and Evidence.
   Then answer: **will anyone besides the user read this PR?** Yes when a teammate or client reviews it, or the repo is shared (an organisation's or a client's, or other people author its PRs); no when the user is its only reviewer. Unsure: ask. Step 5 renders the video only on a yes.
   *Done when* you can name the headings the body must carry, the title convention (or that
   there are none), and the reader answer with its reason.

3. **Is it ready?** r2-pr describes a change; making it ready is the author's job, and r2-pr
   says so when it isn't. Check the branch against what the PR will claim:
   - every behavior it claims has a test (a claim you could only prove by hand is a missing test);
   - the tests and linters it touches pass locally;
   - nothing that belongs in the PR is uncommitted or unpushed;
   - it merges cleanly onto the base;
   - no doc the change makes stale is left unchanged.

   Anything that fails: stop, and **push back** with the list and what would fix each ("no test
   pins that clients without gzip get plain JSON: add one to `test_evals.py`?"). Fix nothing
   yourself; the user either fixes it, asks you to, or says to go ahead as it is, and a
   go-ahead puts the gap in the body (Evidence, "Not proven yet").
   Once they pass (or are ruled on), run **`pr-shape`** on the branch, every PR, whatever its size, before its first push, so shaping the commits needs no force-push. "Already shaped", or commits reshaped → carry on. Pieces → this run ends here, and each piece's branch goes through r2-pr from step 1, readiness included.
   *Done when* every check passes or the user has ruled on it, and pr-shape has answered.

4. **Decide on a demo.** A change can be demoed when something a person sees or does is different before and after: a screen, a message, a command's output, an agent's behaviour, a developer's task (demo-viz's Kinds table).
   - **A live demo already exists** for this branch (a Kelpie build hands one over; step 6's `demo.ts` finds it): use it.
   - **Demoable, no demo yet:** run `demo-viz` in live mode on the shaped head, so its `walk.json` `change` names this repo and the head commit. Outside a Kelpie run there is no `spec.json` to build from: write one in the state dir in the shape of demo-viz's `fixtures/*/spec.json`, with a persona per kind of person the change reaches, one `should` example per behaviour the PR claims, `task.folder` the state dir, and `signedOffAt` the time the user asked for this PR (the code is already built; the user judges the demo itself at step 7).
   - **Nothing a person sees or does changes** (a lint, CI or dependency-only PR): no demo. Write the one-line reason for step 7 ("CI-only: no one sees a difference").

   *Done when* the branch has a live demo whose `viz verify` is clean, or step 7 has the reason it has none.

5. **Make the walkthrough.** Run `pr-viz` through its hand-over, always, unless the user said to
   skip it. Every PR carries it, Kelpie's and hand-opened ones alike. pr-viz shows the user the viz first and renders only once they approve it; the run
   waits there. This is pr-viz's code film, not `demo-viz`'s click-through of the running build. A Kelpie build hands over a `demo-viz` demo, never a PR draft. It runs r2-pr only when its productionalize step opens a PR (at ship time), and runs pr-viz alone only when the user asks for "the diff tour". Its `plan.json` names the `hero` and carries `lookHere`.
   **The video is for other people.** On step 2's yes, render as pr-viz's step 8 says; `scripts/stills.ts` then paints the hero onto the video's first frame and shoots the image. On a no, skip both renders: run `scripts/stills.ts` anyway (with no mp4 it shoots the image and paints nothing), and the draft carries no video.
   Either way, `scripts/review-order.ts` prints the changes walkthrough.
   *Done when* the image and the walkthrough markdown exist, the mp4 too on a yes, and pr-viz's own checks passed.

6. **Draft locally.** Write `pr.md` in the state dir, in [`reference/body.md`](reference/body.md)'s
   order, and a title.
   **The demo pictures first:**
   `bun "$R2PR/scripts/demo.ts" <owner/repo> <checkout> <base> <head> <branch> --out <state dir>/pics > demo.md`.
   It takes the newest live `demo-viz` demo made for this repo that has a commit on the branch (or
   the branch's tree, since pr-shape changes commit ids, never the tree), else one whose subject names
   the branch; converts its SVG pictures to PNG; and prints the `r2-pr:demo` section, one row per
   change card. Paste it into `pr.md` after Why and before Where to look, with its section link
   (`[What changes](#user-content-what-changes)`). Empty output means no demo: leave the section out. When
   step 4 made one, its `walk.json` `change` doesn't name this branch: fix that and run `demo.ts` again.
   With no video (step 5's no), the walkthrough section leaves out the `r2-pr:video` line and its note.
   Then `bun "$R2PR/scripts/body.ts" preview <pr.md> <owner/repo> --review <url>` renders it on this
   machine and opens it; the draft goes nowhere. `<url>` is pr-viz's review page for this PR
   (`http://127.0.0.1:5180/<viz-id>/#{"mode":"review"}`): the preview shows it in a dashed
   local-only panel above the body, so the user can read the diff in story order without
   pushing to GitHub. The panel is never part of `pr.md`. `--github` renders the body with GitHub's own renderer
   instead (exact, but it sends the draft to GitHub): only when the user asks.
   *Done when* the preview opens, the demo section is in when step 4 has a demo, and every section is filled or deleted, with no placeholder left.

7. **Get the yes.** Give the user the draft's path, the preview, the title, and two lines: the
   demo (its URL, or step 4's reason there is none) and the video (rendered or skipped, with step
   2's reason). Their approval of this draft is the one gate. Edits → redraft → re-preview.
   *Done when* the user approves.

8. **Publish.** In order:
   1. Push the branch (a plain push; a force-push asks first, every time). When the force-push
      only rewrites history (squash, reword, reorder), the content must not move: compare
      `git rev-parse origin/<head>^{tree}` with `HEAD^{tree}`, and a difference stops the push
      until the user has seen what changed.
   2. If the title differs from pr-viz's `plan.json` `pr.title`, set it there and re-run pr-viz's
      `scripts/stills.ts` (the image's header shows it). Then upload the video (when there is one) and the image with
      `github-attach-media`; check the served bytes match. Upload each demo picture the same way
      (every `r2-pr:pic:<path>` in `pr.md`) and write `pics.json`, `{"<path>": "<url>"}`.
   3. `bun "$R2PR/scripts/body.ts" finalize <pr.md> video=<url> image=<url> pics=pics.json > final.md`
      (leave `video=` out when the draft has no video line, and `pics=` when it has no demo section).
   4. `gh pr create --draft --title "<title>" --body-file final.md` (ready instead, only when
      the user said so).
   5. Open the PR page: any video shows its hero, the note and both walkthroughs render, every
      demo picture shows, and a section link jumps. Chrome won't load video in a background tab; that isn't GitHub.

   *Done when* the draft PR is up, checked, and its URL is with the user. They mark it ready.

9. **Update** (an existing PR, after new commits). Re-pin pr-viz's plan to the new head. If the
   patch is unchanged (a rebase: compare `git diff <old-range>` with `git diff <new-range>`),
   re-pin only: the body names no commit, so nothing a reader sees changes. Otherwise ask step 2's reader question again, then rebuild, re-render (on a yes), run stills and the walkthrough again, upload the new
   media, regenerate the `r2-pr:walkthrough`, `r2-pr:look` and `r2-pr:demo` sections in `pr.md` (look: the
   new `lookHere` and a fresh size line; demo: step 6's `demo.ts` again, then upload its pictures), finalize, and
   `bun "$R2PR/scripts/body.ts" sync final.md <owner/repo> <number>`, which replaces only
   r2-pr's marked sections. A PR opened before the `r2-pr:look` or `r2-pr:demo` section existed gets it added by
   hand once (look: under Why; demo: after Why, with its section link), with a yes from the user. A PR
   that has a demo section while `demo.ts` now finds no demo keeps it, and the user hears of it. Written sections belong to people once posted: when one is stale,
   say so and propose the edit; apply it only on a yes.
   *Done when* every marked section reflects the new head, and every stale written section is
   raised with the user.

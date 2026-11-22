---
name: r2-pr
description: "Opens or updates a GitHub PR the house way: local draft the user approves, a bite-size summary led by the change's hero GIF, a hunk-by-hunk walkthrough from the user's hunk review, pr-shape run on every branch, repo PR template kept, only r2-pr's marked sections refreshed on later pushes. Use when opening, drafting, or updating a PR or its description."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    github: gh (push, pr create/edit, markdown rendering)
    demo-viz: makes or reuses the branch's live demo (walk.json, its story pictures) for the body's What changes table
  requires:
    skills: [pr-shape, hunk-review-viz, pr-viz, demo-viz, github-attach-media, unslop, design-doc-mermaid]
    commands: [gh, git, node, rsvg-convert]
---

# r2-pr: a PR, opened or updated

r2-pr owns the PR: the body, its layout, getting it onto GitHub, and refreshing it after new
commits. It does not watch CI, answer reviews or merge. The pieces come from other skills:

- **pr-shape** rebuilds the branch as reviewable commits in reading order, and cuts it into pieces when it holds more than one change.
- **hunk-review-viz** gives the user the **hunk review**, the page they review the code in, commit by commit in story order. Its `order.json` holds the story (a sentence per hunk), which `walkthrough.ts` prints as the body's folded **changes walkthrough** for other reviewers, and its `lookHere` is the body's Where to look.
- **pr-viz** makes the **hero**: one picture of the change's idea, as a still and a GIF. The GIF goes under Why.
- **demo-viz** makes the **demo**: one card per change, with a before and an after picture. r2-pr decides whether the change can be demoed, and the demo's cards become the body's **What changes** table.
- **github-attach-media** puts the hero GIF and the demo's pictures on GitHub.
- **unslop** is applied to every sentence r2-pr writes.

The body's layout, sections, title rule and the GitHub facts behind them:
**[`reference/body.md`](reference/body.md)**. Read it before drafting.

`$R2PR` is this skill's directory, `$HRV` hunk-review-viz's; state lives in `~/.agents/state/r2-pr/<owner>-<repo>/<branch>/`.

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
   *Done when* you can name the headings the body must carry, and the title convention (or that
   there are none).

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

5. **Make the review, the walkthrough and the hero.** Every PR gets all three, Kelpie's and hand-opened ones alike.
   - **The hunk review**, for the user: `hunk-review-viz` steps 1 and 2 on the shaped branch (`open "<owner/repo>#<branch>" --repo <checkout> --range <base>...<branch>`), with `order.json` carrying `pr`, `lookHere` and a `tour` that covers every production hunk. Research the change the way a reviewer who has to defend it would: why it exists, what changes for whom, how every hunk works, what proves each behaviour, what could break, how it ships.
   - **The changes walkthrough**, for other reviewers: `node ~/.claude/skills/hunk-review-viz/scripts/walkthrough.ts <review name>`, saved beside `pr.md`.
   - **The hero**: `pr-viz` through its hand-over, with `--out <state dir>/pr`, giving `pr.hero.png` and `pr.hero.gif`. Its title is the PR's title.
   A Kelpie build hands over a `demo-viz` demo, never a PR draft. It runs r2-pr only when its productionalize step opens a PR (at ship time).
   *Done when* the hunk review opens with every production hunk in its tour, the walkthrough printed without refusing, and the hero's still and GIF exist within pr-viz's limits.

6. **Draft locally.** Write `pr.md` in the state dir, in [`reference/body.md`](reference/body.md)'s
   order, and a title.
   **The demo pictures first:**
   `node "$R2PR/scripts/demo.ts" <owner/repo> <checkout> <base> <head> <branch> --out <state dir>/pics > demo.md`.
   It takes the newest live `demo-viz` demo made for this repo that has a commit on the branch (or
   the branch's tree, since pr-shape changes commit ids, never the tree), else one whose subject names
   the branch; converts its SVG pictures to PNG; and prints the `r2-pr:demo` section, one row per
   change card. Paste it into `pr.md` after Why and before Where to look, with its section link
   (`[What changes](#user-content-what-changes)`). Empty output means no demo: leave the section out. When
   step 4 made one, its `walk.json` `change` doesn't name this branch: fix that and run `demo.ts` again.
   When the task came through Kelpie and has a signed `spec.json`, follow [`reference/spec.md`](reference/spec.md) for Proven, Evidence and Why.
   Then `node "$R2PR/scripts/body.ts" preview <pr.md> <owner/repo> --review <url>` renders it on this
   machine (with `marked`: `npm install` in `$R2PR` once; the other commands need no install) and opens it; the draft goes nowhere. `<url>` is the hunk review's URL: the preview shows it in a dashed
   local-only panel above the body, so the user can review the diff in story order without
   pushing to GitHub. The panel is never part of `pr.md`. `--github` renders the body with GitHub's own renderer
   instead (exact, but it sends the draft to GitHub): only when the user asks.
   *Done when* the preview opens, the demo section is in when step 4 has a demo, and every section is filled or deleted, with no placeholder left.

7. **Get the yes.** Give the user the draft's path, the preview, the title, the hunk review's
   URL, and one line on the demo (its URL, or step 4's reason there is none). Their approval of this draft is the one gate. Edits → redraft → re-preview.
   *Done when* the user approves.

8. **Publish.** In order:
   1. Push the branch (a plain push; a force-push asks first, every time). When the force-push
      only rewrites history (squash, reword, reorder), the content must not move: compare
      `git rev-parse origin/<head>^{tree}` with `HEAD^{tree}`, and a difference stops the push
      until the user has seen what changed.
   2. If the title changed since the hero was made, set it in the hero's `hero.json` and re-run pr-viz's
      `scripts/hero.ts` (the hero shows it). Then upload the hero GIF with
      `github-attach-media`; check the served bytes match. Upload each demo picture the same way
      (every `r2-pr:pic:<path>` in `pr.md`) and write `pics.json`, `{"<path>": "<url>"}`.
   3. `node "$R2PR/scripts/body.ts" finalize <pr.md> hero=<url> pics=pics.json > final.md`
      (leave `pics=` out when it has no demo section).
   4. `gh pr create --draft --title "<title>" --body-file final.md` (ready instead, only when
      the user said so).
   5. Open the PR page: the hero GIF plays, the mermaid picture and the walkthrough render, every
      demo picture shows, and a section link jumps.

   *Done when* the draft PR is up, checked, and its URL is with the user. They mark it ready.

9. **Update** (an existing PR, after new commits). Refresh the hunk review (`review.ts refresh`). If the
   patch is unchanged (a rebase: compare `git diff <old-range>` with `git diff <new-range>`),
   stop there: the body names no commit, so nothing a reader sees changes. Otherwise extend `order.json`'s tour to the new hunks, print the walkthrough again, redraw the hero if the idea changed (then re-run `hero.ts` and upload the new GIF), regenerate the `r2-pr:hero`, `r2-pr:walkthrough`, `r2-pr:look` and `r2-pr:demo` sections in `pr.md` (look: the
   new `lookHere` and a fresh size line; demo: step 6's `demo.ts` again, then upload its pictures), finalize, and
   `node "$R2PR/scripts/body.ts" sync final.md <owner/repo> <number>`, which replaces only
   r2-pr's marked sections. A PR opened before the `r2-pr:hero`, `r2-pr:look` or `r2-pr:demo` section existed gets it added by
   hand once (hero: right under Why; look: under the hero; demo: after the hero, with its section link), with a yes from the user. A PR
   that has a demo section while `demo.ts` now finds no demo keeps it, and the user hears of it. Written sections belong to people once posted: when one is stale,
   say so and propose the edit; apply it only on a yes.
   *Done when* every marked section reflects the new head, and every stale written section is
   raised with the user.

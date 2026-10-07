---
name: r2-pr
description: "Opens or updates a GitHub PR the house way: local draft the user approves, a bite-size summary over the pr-viz walkthrough, pr-split offered on every branch, repo PR template kept, only r2-pr's marked sections refreshed on later pushes. Use when opening, drafting, or updating a PR or its description."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    github: gh (push, pr create/edit, markdown rendering)
  requires:
    skills: [pr-split, pr-viz, github-attach-media, unslop, design-doc-mermaid]
    commands: [gh, git, bun]
---

# r2-pr: a PR, opened or updated

r2-pr owns the PR: the body, its layout, getting it onto GitHub, and refreshing it after new
commits. It does not watch CI, answer reviews or merge. The pieces come from other skills:

- **pr-split** checks the branch is one change, and cuts it into pieces when it isn't.
- **pr-viz** makes the **walkthrough**: the video (its first frame is the hero), the image, and
  the changes walkthrough (the diff in review order, as text); its `plan.json` `lookHere` is the
  body's Where to look.
- **github-attach-media** puts the video and image on GitHub.
- **unslop** is applied to every sentence r2-pr writes.

The body's layout, sections, title rule and the GitHub facts behind them:
**[`reference/body.md`](reference/body.md)**. Read it before drafting.

`$R2PR` is this skill's directory, `$PRVIZ` pr-viz's; state lives in `~/.agents/state/r2-pr/<owner>-<repo>/<branch>/`.

## Steps

1. **Pin it.** Repo (`owner/name`), branch, base, head SHA, and whether a PR already exists
   (`gh pr view <branch> --json number,url,state`). An existing PR → **update** (step 8); none →
   continue. A `gh` "Could not resolve to a Repository" means the wrong account is active:
   `gh auth status`, then `gh auth switch -u <account>`.
   *Done when* all five are known.

2. **Read the repo's conventions.** Its PR template, `CONTRIBUTING.md`'s PR guidance, and its
   title style (`gh pr list --state all --limit 20 --json title`). If `r2-sdlc` ran on this
   branch, its `understood.md` and Phase 7 summary (`~/.agents/state/r2-sdlc/<repo-id>/<slug>/`)
   are the starting point for Why and Evidence.
   *Done when* you can name the headings the body must carry and the title convention, or that
   there are none.

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
   Once they pass (or are ruled on), run **`pr-split`** on the branch, every PR, whatever its
   size. "One PR is right" → carry on. Pieces → this run ends here, and each piece's branch goes
   through r2-pr from step 1, readiness included.
   *Done when* every check passes or the user has ruled on it, and pr-split has answered.

4. **Make the walkthrough.** Run `pr-viz` through its hand-over, always, unless the user said to
   skip it. Its `plan.json` names the `hero` and carries `lookHere`; after the render, pr-viz's `scripts/stills.ts`
   paints the hero onto the video's first frame and shoots the image, and
   `scripts/review-order.ts` prints the changes walkthrough.
   *Done when* the mp4, the image and the walkthrough markdown exist, and pr-viz's own checks passed.

5. **Draft locally.** Write `pr.md` in the state dir, in [`reference/body.md`](reference/body.md)'s
   order, and a title. Then `bun "$R2PR/scripts/body.ts" preview <pr.md> <owner/repo>` renders it on this
   machine and opens it; the draft goes nowhere. `--github` renders it with GitHub's own renderer
   instead (exact, but it sends the draft to GitHub): only when the user asks.
   *Done when* the preview opens and every section is filled or deleted, with no placeholder left.

6. **Get the yes.** Give the user the draft's path, the preview, and the title. Their approval of
   this draft is the one gate. Edits → redraft → re-preview.
   *Done when* the user approves.

7. **Publish.** In order:
   1. Push the branch (a plain push; a force-push asks first, every time). When the force-push
      only rewrites history (squash, reword, reorder), the content must not move: compare
      `git rev-parse origin/<head>^{tree}` with `HEAD^{tree}`, and a difference stops the push
      until the user has seen what changed.
   2. If the title differs from pr-viz's `plan.json` `pr.title`, set it there and re-run pr-viz's
      `scripts/stills.ts` (the image's header shows it). Then upload the video and the image with
      `github-attach-media`; check the served bytes match.
   3. `bun "$R2PR/scripts/body.ts" finalize <pr.md> video=<url> image=<url> > final.md`.
   4. `gh pr create --draft --title "<title>" --body-file final.md` (ready instead, only when
      the user said so).
   5. Open the PR page: the video shows its hero, the note and both walkthroughs render, and a
      section link jumps. Chrome won't load video in a background tab; that isn't GitHub.

   *Done when* the draft PR is up, checked, and its URL is with the user. They mark it ready.

8. **Update** (an existing PR, after new commits). Re-pin pr-viz's plan to the new head. If the
   patch is unchanged (a rebase: compare `git diff <old-range>` with `git diff <new-range>`),
   re-pin only: the body names no commit, so nothing a reader sees changes. Otherwise rebuild, re-render, run stills and the walkthrough again, upload the new
   media, regenerate the `r2-pr:walkthrough` and `r2-pr:look` sections in `pr.md` (look: the
   new `lookHere` and a fresh size line), finalize, and
   `bun "$R2PR/scripts/body.ts" sync final.md <owner/repo> <number>`, which replaces only
   r2-pr's marked sections. A PR opened before the `r2-pr:look` section existed gets it added by
   hand once, under Why, with a yes from the user. Written sections belong to people once posted: when one is stale,
   say so and propose the edit; apply it only on a yes.
   *Done when* every marked section reflects the new head, and every stale written section is
   raised with the user.

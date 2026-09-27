# Research — everything the reviewer would read

The film has to answer any question a reviewer could ask, so read what they would read, and
further. Record the source of every fact you will put on screen.

## The change itself
- **PR description, every comment, every review thread** — resolved ones too; they hold the
  decisions. `gh pr view <n> --comments`, `gh api repos/<o>/<r>/pulls/<n>/comments` (inline
  review comments), `gh pr checks <n>`.
- **Linked issues and PRs, followed as far as they go** — "Closes #…", "Supersedes #…", links
  in comments. The *why* usually lives in the issue, not the PR.
- **Every hunk, with the code around it** — open each changed file at head, read the whole
  function and its callers, not just the lines in the diff. Who calls what changed?
- **The tests** — what each one gives, does, and asserts; which behavior each proves. A test
  that asserts less than its name claims is a finding (a `partial` behavior).
- **Fixtures and real runs** — test data files, and any before/after runs the author reports.

## The codebase
- `README`, `CONTRIBUTING`, `docs/`, ADRs, `CONTEXT.md` / glossary — the domain words to use
  on screen, and the conventions the change should follow (a copy that looks like
  duplication may be the repo's rule — say so).
- How it ships: CI config, deploy scripts, migrations, feature flags, reindex/backfill steps.

## Local-only (no PR)
The same, minus the GitHub parts: commit messages on the range are the description; the
linked issue is whatever the commits or branch name point at. Nothing here needs a network.

## What to come away with
For each behavior the change promises: before, after, and what proves it — a named test, a
real run, or nothing (say so). For each risk: how likely, how bad, how it is contained. For
the rollout: every step after merge, and what to watch. These become `behaviors`, the Proof
scenes, and the Risk scenes in `plan.json`.

Leave out what does not bear on the decision to approve — "not yet run" lists, process
trivia. A caveat earns screen time only if it would change the reviewer's mind.

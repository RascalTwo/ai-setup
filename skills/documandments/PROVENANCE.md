# documandments is VENDORED — do not edit SKILL.md

This skill is a skill-shaped rendering of a document we do not own: the Ten
Commandments of Documentation at <https://documandments.com> (Austin Grey).

**It lives in this repo, and it is still not ours to change.** Nothing in the
tooling will stop you — it is a symlinked "owned" skill, `install.ts` treats it
like any other, and the upstream-freshness check in `ai-setup-audit` does not
cover it because it did not come from `npx skills`. The constraint is intent,
not enforcement, which is exactly why it needs writing down.

**Why it matters:** when the site's argument changes, this skill should change
to match it. Any local edit becomes silent drift from a source that has no diff
to show you.

## What to do instead

- **Need to add a rule?** Put it in a file we own and *point here*. That is
  documandments' own Commandment: one home per fact, link don't copy.
- **Need to resolve a conflict with another skill?** Arbitrate in a file we own
  (`r2-sdlc-documentation-philosophy` is the natural home) rather than editing
  either side.
- **Upstream changed?** Re-render this skill from the site wholesale. Do not
  patch it.

## History

- 2026-08-30 — an `ai-setup-audit` run proposed folding
  `r2-sdlc-documentation-philosophy`'s overlapping ~60% into this file, on the
  reasoning that a symlink into our own repo means "editable". The user rejected
  it: "it's basically a skill version of that website — when the website
  updates, documandments should update." This file exists so that argument does
  not have to be made a third time.

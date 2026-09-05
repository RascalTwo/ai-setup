---
name: r2-sdlc-documentation-philosophy
description: The r2-sdlc pipeline's documentation contract, layered ON TOP of the `documandments` skill — load that first, it owns the general rules. This file covers only what r2-sdlc adds: the bar for doc strings on exported APIs, the export-specific anti-patterns, and the review checklists that `code-reviewer` and `docs-currency-reviewer` enforce. Use when writing or reviewing doc strings on exports, or running either of those reviewers.
---

# r2-sdlc documentation philosophy

**Load the `documandments` skill first — it owns the general rules and this file does not
repeat them.** documandments is the gate (should this doc exist at all?), the ladder (fix it
with a name, a type, a test, a comment — prose last), what belongs in prose ("only the why"),
where docs live, and the duty to update or delete prose in the same change as the code.

This file adds only what the r2-sdlc pipeline needs *on top* of that, because two reviewer
subagents cite it by name and neither can invoke a skill — they get what their `skills:`
frontmatter loads and nothing else. Both now load `documandments` alongside this file.

> Trimmed 2026-08-30. The removed sections ("Core principle: Goldilocks", "Inline comments",
> "Project-level documentation") restated documandments in a second vocabulary — ~51 lines of
> it. documandments is **vendored** from documandments.com and expected to change when the site
> does, and nothing checks that copy for drift, so a second copy was guaranteed to rot exactly
> when it mattered. See `skills/documandments/PROVENANCE.md`.

## Doc strings on exported API (JSDoc / docstring / equivalent)

**Treat exported/public API as a library.** If other code imports this function, class, or module, someone else has to understand how to call it. That deserves documentation.

What to document on exports:

- One-line summary of what it does (purpose, not mechanism)
- Non-obvious parameters (what valid values look like, units, edge cases)
- Return contract (especially error/null/empty behavior)
- Thrown errors or rejection modes
- Non-obvious usage constraints (e.g. "must be called after init", "not safe for concurrent use")

What NOT to document on exports:

- Anything already expressed clearly in the signature and types
- Implementation details (callers don't care how you do it)
- Obvious behavior (`getUser(id)` doesn't need "gets the user with the given id")

For **non-exported / internal** helpers, the inline-comments rule applies: default nothing, add only when WHY is non-obvious. Don't auto-doc-string everything just because it's a function.


## Anti-patterns specific to the export bar

documandments covers restated code, task-context rot, and stale references. These three are
about exports and are not in it:

- **Missing doc string on exported API.** New public function/class with no summary, or one
  that says nothing useful.
- **Doc strings that restate types.** `/** @param id The id */` when `id: UserId` is typed.
- **Redundant doc strings on trivial internal helpers** — internal code gets the
  inline-comment bar, not the export bar.

## Reviewer guidance

### `code-reviewer` perspective

When reviewing the diff, for every added/modified comment and doc string:

1. **Does it explain WHY the code is the way it is, or does it restate WHAT the code does?** If WHAT, flag to remove.
2. **Is it task-context ("added for X", "issue #123")?** Flag to remove.
3. **Is the length proportional to the subtlety?** Three-line comment on an obvious line → flag.

For every exported API:

1. **Does it have a doc string?** If no, flag as missing.
2. **Does the doc string convey the purpose and any non-obvious contract?** If it just restates the signature, flag as low-value.

### `docs-currency-reviewer` perspective

Given the diff, scan project markdown (READMEs at any depth, docs folders, inline `.md` next to code):

1. **Does any markdown reference something the diff renamed/removed?** Flag for update.
2. **Does any markdown describe behavior the diff changed?** Flag for update.
3. **Should new markdown be created for new user-facing features/setup/concepts?** Flag as missing.

Report findings with file path + line + specific change needed. Do not rewrite docs unprompted — surface the gap, let the main agent decide whether to fix in this pipeline run or spin off.


## When in doubt

Ask: *would a reader reasonably need this to understand or safely use the code?*

- Yes → write the doc, concisely, focused on WHY and contract.
- No → don't write anything.

If you're unsure, lean toward not writing. It's easier to add a doc when a reader later asks "why?" than to delete stale noise that's already calcified into the codebase.

---
name: documentation-philosophy
description: The opinionated documentation philosophy used by the r2-sdlc pipeline. Goldilocks rule — docs where they add signal, nothing where they don't. Covers inline comments, doc strings on exported APIs, and project-level docs (READMEs, markdown) currency. Use when writing or reviewing documentation of any kind. The code-reviewer and docs-currency-reviewer both enforce this.
---

# Documentation Philosophy

This is the opinionated documentation philosophy for r2-sdlc. It applies when **writing code** (implementation phase) and when **reviewing changes** (code-reviewer and docs-currency-reviewer). Writers follow these rules; reviewers enforce both failure modes — **missing docs where needed** AND **noise docs where unneeded**.

## Core principle: Goldilocks

Docs exist to add signal a reader can't get from the code itself. Every line of documentation is a line the reader has to process and a line someone has to keep accurate. If a doc doesn't earn its keep in comprehension, it's noise. If a reader would hit confusion without a doc, it's required.

The two failure modes are equally bad:

1. **Too little**: missing doc strings on exported APIs, complex logic with no explanation, hidden constraints not called out.
2. **Too much**: comments restating what the code obviously does, task-context references, multi-line explanations of one-line trivialities, stale docs still lingering.

The reviewer's job is to flag both. The writer's job is to hit the middle.

## Three kinds of documentation

### 1. Inline comments

**Default: don't write any.**

Only add a comment when the **WHY is non-obvious** — something a careful reader would still miss from the code alone. Valid cases:

- A hidden constraint (e.g. "this field is populated async by a downstream service")
- A subtle invariant that must be preserved
- A workaround for a specific bug or library quirk
- Behavior that would surprise a reader (counter-intuitive ordering, non-obvious side effects)

Never write a comment for:

- **What the code does** — well-named identifiers already do that
- **Task context** — don't reference the current fix, the ticket, the calling flow ("used by X", "added for Y feature", "handles issue #123"). These rot as the codebase evolves. That belongs in the PR description or commit message.
- **Obvious logic** — `if (!token) throw new UnauthorizedError()` does not need "if there is not a token, throw an error because sometimes users aren't authenticated."
- **Restating types or signatures** — the reader already sees them.

Rule of thumb: if you could delete the comment and a future reader wouldn't be confused, delete the comment.

### 2. Doc strings / JSDoc / equivalent on exported API

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

### 3. Project-level documentation (READMEs and other markdown)

**The number-one worst thing is outdated documentation.** Wrong docs are worse than no docs — they actively mislead.

Two questions to ask on every code change:

**a) Are any existing docs now wrong?**
- Did you touch something the README describes? Does the description still hold?
- Did you rename a file, module, command, config key, or endpoint? Every doc referencing the old name must update.
- Did you change setup steps, env vars, or defaults? Setup docs must match.
- Did you change a public API or output format? API docs and examples must match.

**b) Does anything you added need new documentation?**
- New public command, script, or endpoint?
- New configuration option a user would need to know about?
- Complex setup or gotcha that isn't self-evident?
- New architectural concept worth explaining?

New docs should be written when the answer is yes. Don't create docs "just in case" — only when a reader would reasonably need them.

## Anti-patterns to reject

Reviewers should flag:

- **Multi-line comment on one-line obvious code.** Three lines explaining `if (!token) throw err`.
- **Comment that restates code.** `// increment counter` above `counter++`.
- **Task-context rot.** `// added for the Stripe migration`, `// see JIRA-1234`, `// called by the auth flow`.
- **Missing doc string on exported API.** New public function/class with no summary, or one that says nothing useful.
- **Stale references after rename or removal.** README mentions `oldCommand`, code only has `newCommand`.
- **Wrong setup instructions.** Env var names changed but README didn't.
- **Example code that no longer runs.** Docs with snippets that reference removed APIs.
- **Doc strings that restate types.** `/** @param id The id */` when `id: UserId` is already typed.
- **New feature shipped with no user-facing doc** when users would reasonably need to know about it.
- **Redundant doc strings on trivial internal helpers** — internal code gets the inline-comment bar, not the export bar.

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

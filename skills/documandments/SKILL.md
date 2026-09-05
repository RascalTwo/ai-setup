---
name: documandments
description: >
  Documentation discipline enforced from the Ten Commandments of Documentation
  (documandments.com). Use on ANY change that adds, edits, reviews, or deletes
  prose about code — READMEs, docs/ pages, ADRs, CHANGELOGs, code comments, doc
  strings, PR/commit bodies, runbooks, onboarding guides, API docs, diagrams,
  CLAUDE.md/AGENTS.md. Also use whenever a task ends with "and document it",
  "write up how this works", "add comments", "update the README", "explain this
  for the next person", or when reviewing a diff that touches .md files. And use
  it BEFORE writing docs nobody asked for — the first job of this skill is to
  decide whether the doc should exist at all.
---

# Documandments

Documentation costs as much as code to write and maintain, and gets a fraction
of the scrutiny. These ten rules are the scrutiny. Source (read it if you need
the full argument, don't paste it here): https://documandments.com — Austin Grey
Lovelace, 2026.

Two modes: **writing** (you are about to produce docs) and **reviewing** (you
are checking a diff). Both run the same rules; the checklist at the bottom is
the review pass.

## First, the gate (I)

Before writing a single line of documentation, answer four questions out loud:

1. **What is this accomplishing?**
2. **Who is the audience?**
3. **How will they know it exists?** (the critical path — the file, review, or
   error message they are already looking at)
4. **Who keeps it true?**

If you can't answer all four, don't write it. You are not producing
documentation, you are producing a liability, and the user saves more time if
you write nothing. Say so plainly — "I'm not adding a doc for X because nobody
would find it and nothing keeps it true" — rather than writing it anyway. This
is the most important rule; the other nine only matter for docs that pass it.

## Then, the ladder (II, V)

Docs are the last resort, not the first. Climb down only when the rung above is
genuinely exhausted:

1. **Design** — a clearer name, a smaller function, a split module. Confusion
   you can delete beats confusion you can explain.
2. **Contract** — a stricter type, a schema, an enum, a signature, a validation
   error. Truth baked into a contract is enforced and cannot drift. Never write
   "may be null"; make it nullable. Never document a valid-values list you could
   have made an enum.
3. **Test** — an executable example that fails when it goes stale.
4. **Prose in the reader's path** — a comment on the confusing line, a
   description on the schema field, a note in the PR that reviews it.
5. **A standalone document** — only for things too big to inline, and only with
   a link from wherever the reader will actually be standing.

Subpar docs in the right place beat thorough docs in the wrong place. If it sits
somewhere the reader must first think to look, assume they never will.

## What goes in the prose (III, VI, VII)

**Only the why.** The code shows what; the tests show how. Write the things they
cannot show: why this trade-off, why this constraint, why the obvious approach
was rejected, what breaks if you "simplify" this. A comment that restates the
line below it is noise you are asking someone to maintain forever.

**Less detail, not more.** High-level intent survives change; the seven-step
walkthrough becomes a lie the moment the process grows an eighth step, and it
always does. When in doubt, cut. Silence is safer than a detail that will one
day mislead. Deciding what to leave out is the valuable part of this work.

**Plainly.** Write as you'd explain it to a capable colleague standing at your
desk, not as a spec to be notarized. Lead with the point. Short paragraphs,
lists over dense blocks, headings people can scan. No ceremony, no hand-holding,
no "it is important to note that".

**Especially when the prose is AI-generated — which here means yours.** The
default failure mode is verbose, over-structured, faintly corporate text with
three sentences where one would do. Reread your own draft as an editor and cut
it before it enters the codebase.

## Where it lives (IV, IX)

**One home per fact.** Never record the same fact twice; copies drift, disagree,
and teach the reader to trust neither. Link instead. Before writing anything,
check whether the fact already lives somewhere — then link to that.

- Facts you don't own (another tool's install steps, a vendor's API): link out,
  and document only where you differ.
- Big decisions: one ADR, linked from the code it constrains.
- Best of all, a source that *can't* drift — generated from the code (OpenAPI →
  reference docs) or authoritative over it (schema-first GraphQL, JSON Schema).
  Prefer generating over writing whenever the option exists.

**Flat, tagged, linked — not a folder tree.** A hierarchy taxes you twice: once
guessing the one true branch to file under, again guessing it to find. Keep
`docs/` shallow, give documents descriptive names and front-matter tags, and
link them to each other so any facet leads to the document. Don't invent a new
nesting level to hold two files.

## Diagrams (VIII)

Text-based and in the repo — Mermaid first, then a format that stays editable
next to the code (draw.io). Never a screenshot of a diagram, never a link into a
tool that demands an account: those are diagrams that will never be updated. If
a diagram is too dense to read at a glance, split it into several that each
answer one question.

## Distrust what's already there (X)

Documentation cannot be tested. Nothing goes red when it goes stale — it just
misleads quietly until someone acts on it. So:

- Treat every doc you read as an unversioned script running in production with
  no coverage. Verify against the code before you rely on it, and never trust it
  more than the code it claims to describe.
- When you change code, grep for prose that describes it — comments, README,
  docs/, ADRs, CLAUDE.md — and fix or delete what your change just falsified.
  Stale docs are a defect your change introduced.
- When you find a stale doc, deleting it is a legitimate fix and often the best
  one. Say what you deleted and why.

## Review checklist

When reviewing a diff (or your own work before you hand it over), walk this and
report only what fails, with file:line:

- [ ] **I** — Every new doc can name its purpose, audience, path, and owner.
- [ ] **II** — Nothing is explained in prose that a name, type, enum, or schema
      could have enforced.
- [ ] **III** — Comments carry why, not a restatement of the code.
- [ ] **IV** — No fact duplicated from elsewhere in the repo or from an external
      source; links used instead.
- [ ] **V** — Each doc sits where the question arises, or is linked from there.
- [ ] **VI** — No step-by-step procedure that will rot; intent over recipe.
- [ ] **VII** — Plain, scannable, no AI padding.
- [ ] **VIII** — Diagrams are text/editable and in-repo.
- [ ] **IX** — No new folder-tree nesting; flat, named, linked.
- [ ] **X** — Prose describing changed code was updated or deleted in the same
      diff.

Report as: rule number, file:line, what's wrong, and the fix — usually "cut it",
"link it", or "make it a type".

## Judgment

These rules serve the reader, not themselves. A generated API reference is
"detailed" and that's fine; a legally required runbook exists whether or not it
survives contact with entropy; a tutorial for newcomers is step-by-step on
purpose. When a rule and the reader conflict, the reader wins — say which rule
you're setting aside and why, so it's a decision instead of a slip.

And yes, this file will eventually be outdated too. Rule X applies to it.

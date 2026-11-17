---
name: r2-adr
description: "Architecture Decision Records the house way. Use when a change makes a decision another developer would question (write the ADR in that same change, without asking), before changing code an ADR governs, when superseding an ADR, when reviewing a change for a missing ADR, and when migrating old numbered ADRs. Replaces domain-modeling's ADR-FORMAT.md."
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires:
    commands: [bun, git]
---

# r2-adr

The format is Vercel's `adr-skill`, kept unedited in `upstream/` ([PROVENANCE.md](PROVENANCE.md)). Read [upstream/UPSTREAM-SKILL.md](upstream/UPSTREAM-SKILL.md), its [template](upstream/assets/templates/adr-simple.md) and its [review checklist](upstream/references/review-checklist.md) for how to write and review an ADR. Where upstream and this file differ, **this file wins**.

## Overrides

- **Folder:** `docs/adr/` at the repo root, or the folder the repo already keeps ADRs in. No index `README.md`; skip upstream's `new_adr.js`, `bootstrap_adr.js` and `--update-index`.
- **Filename:** `YYYY-MM-DD-verb-phrase.md`, dated the day it is written.
- **Status line** directly under the H1, one of:
  - `Status: Accepted, 2026-11-13`
  - `Status: Proposed, 2026-11-13` (only when the user asked to decide later)
  - `Status: Deprecated, 2026-11-13`
  - `Status: Superseded by [2027-01-05-new-title.md](2027-01-05-new-title.md), 2027-01-05`

  Upstream says merging the pull request accepts an ADR; most of this work is committed without one, so the record carries its own status.
- **Trigger:** any decision another developer would question ("why didn't you just…?"): a dependency, a pattern, a convention, a rejected obvious approach, a constraint the code can't show. Work that follows an existing pattern or ADR needs none.
- **No asking:** write the ADR in the same commit as the code that carries out the decision, then name it in the handover or PR body ("Recorded `docs/adr/2026-11-13-run-builds-in-worktrees.md`"). The user deletes a wrong one in review.

## Steps

1. **Consult.** Before changing how something works, list `docs/adr/` and read every ADR whose title touches it. Follow them. Going against one needs a new reason, recorded in an ADR that supersedes it.
2. **Decide.** Apply the trigger to what this change decides. None qualifies: stop here.
3. **Write.** Fill upstream's template, add the Status line, save under the filename rule.
4. **Supersede** when replacing a decision: the new ADR links the old one in More Information; the old one's Status becomes `Superseded by …`. Leave the old decision text as it was.
5. **Lint** from the repo root: `bun ~/.claude/skills/r2-adr/scripts/adr-lint.ts`. Done when it prints `ok`.
6. **Hand over** naming every ADR added or superseded.

## Reviewing a change

Warn (never block) when the change makes a decision the trigger covers and adds no ADR, or contradicts an accepted ADR without superseding it. Name the decision and the ADR it needs.

## Migrating numbered ADRs

For `NNNN-slug.md` files in a repo the user alone (or with their agents) commits to; a team or client repo migrates only after its team agrees.

1. **Date** each from the commit that added it: `git log --diff-filter=A --follow --format=%as -- <file> | tail -1` (an untracked file: its modified date). Rename to `<date>-<slug>.md` with `git mv`.
2. **Rewrite** it fully into the template, keeping the decision as decided. Status: `Accepted, <date>`, or `Superseded by`/`Deprecated` when the old record said so. Append to More Information: `Rewritten <today> from ADR NNNN; alternatives reconstructed from code and history where the original did not record them.`
3. **Relink**: grep the repo for the old filename and for `ADR NNNN` / `ADR-NNNN`, and point each at the new file.
4. **Lint**, then commit the whole repo's migration as one commit.

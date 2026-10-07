---
name: pr-split
description: "Split a branch into smaller PRs a reviewer can take one at a time: finds the atoms, proposes a finest and a balanced cut, and on a yes cuts one local branch per piece that sums back to the original. Use for \"split this PR\", \"is this too big\", \"break this branch up\", and from r2-pr's readiness check on every PR."
effort: high
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires: [git, bun]
---

# pr-split: one change per PR

A reviewer takes in one idea at a time. pr-split looks for the seams where a branch holds more
than one, and proposes cuts along them. No size threshold decides it: a 900-line rename is one
idea, a 60-line PR that also reformats a file is two. **"One PR is right"** is a full answer, said
in one line.

Evidence backs "smaller and focused", not "as many PRs as possible", and whether stacked PRs
beat separate ones is contested. So the default is the finest cut, the human merges pieces back
together, and pieces stack only where one needs the other.

`$SPLIT` is this skill's directory.

## Steps

1. **List the hunks.** `bun "$SPLIT/scripts/split.ts" hunks <repo> <base> <head>` prints every
   changed file with its kind (prod, test, lock, binary, docs) and every hunk by id (`path#n`).
   Read the diff itself too: the seams are in what the code does, not in the file list.
   *Done when* you know what every hunk is for.

2. **Find the atoms.** An atom is the smallest set of hunks that stands alone: it builds, its
   tests pass, and its PR description would be one sentence. The seams:
   - **separate mechanism or module**: two modules that each gain a feature are two atoms;
   - **interface apart from implementation** ([Palantir](https://blog.palantir.com/code-review-best-practices-19e02780015f):
     the API as interfaces plus docs first, the implementations second);
   - **refactor apart from behaviour** (Beck's *Tidy First?*;
     [Google](https://google.github.io/eng-practices/review/developer/small-cls.html): "refactorings
     in a separate CL"): a rename, a move or a reformat is an atom, and the behaviour that builds
     on it stacks on top;
   - **tests travel with the code they test**, inside that code's atom.

   A **shared** file belongs to no single atom: a lockfile, a shared config, a generated file.
   It goes with the first atom that needs it (the lockfile with the manifest change that moved
   it, the generated file with its source), and every atom that needs it too stacks on that one.
   A hunk that touches two atoms' code is a sign they are one atom.
   *Done when* every hunk is in exactly one atom and every dependency between atoms is named.

3. **Propose two cuts.** **Finest**: one piece per atom (the default). **Balanced**: neighbouring
   atoms merged where a reviewer would read them together anyway (same module, same reviewer,
   one small enough to be a footnote of the other). For each cut, a table: piece, one-line
   purpose, files, lines changed (from step 1's counts), and what it stacks on. Flag each shared file and where you
   put it. Ask which cut, and which pieces to merge further.
   *Done when* the user has picked a cut, merged what they want merged, or said one PR is right.

4. **Cut.** Write `cut.json` (format in `scripts/split.ts`'s header): per piece a branch name
   (`<head>-<piece>`, short), a title, its `files` (path prefixes) and `hunks` (ids), and
   `after` for a piece that stacks. Then `bun "$SPLIT/scripts/split.ts" cut cut.json`. It refuses
   a hunk in no piece or in two, builds each piece in a throwaway worktree, and creates the
   branches only once the pieces, applied in order, rebuild the head's tree exactly. Nothing is
   pushed; the user's checkout and the original branch stay as they were.
   *Done when* it prints `✓ the N pieces sum back to <head> exactly`.

5. **Check each piece stands alone.** In a worktree per piece, run the tests and linters it
   touches. A piece that fails needs something from another: fix the cut (move the hunk, or
   stack the piece), delete the branches it made (`git branch -D`), and cut again.
   *Done when* every piece passes on its own branch.

6. **Hand over.** The branches, in merge order, with what each stacks on. Each piece is now a
   change of its own: it goes through `r2-pr` from the start, readiness check included.
   *Done when* the user has the branch list and knows each piece starts its own r2-pr run.

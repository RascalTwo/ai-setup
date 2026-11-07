---
name: pr-shape
description: "Shapes a branch for review: finds its atoms, then rebuilds it as one reviewable commit per atom in dependency order, or cuts it into smaller PRs when the atoms don't belong together. Every shape sums back to the original exactly. Use for \"clean up my commits\", \"make this reviewable commit by commit\", \"split this PR\", \"is this too big\", and from r2-pr's readiness check on every PR."
effort: high
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires:
    skills: [pr-viz]
    commands: [git, bun]
---

# pr-shape: a branch a reviewer can read in order

A reviewer takes in one idea at a time, and many read a PR commit by commit. pr-shape finds the seams where a branch holds more than one idea and shapes the branch along them, in one of two ways:

- **Commits** (the default): one PR, rebuilt as one commit per atom, in the order a reviewer should read them. Each commit builds and passes on its own.
- **PRs**: one PR per piece, when the atoms are separate ideas a reviewer would approve separately.

No size threshold decides either. A 900-line rename is one idea; a 60-line PR that also reformats a file is two. **"Already shaped"** (the commits already are the atoms, in order) is a full answer, said in one line.

Evidence backs "smaller and focused", not "as many PRs as possible", and whether stacked PRs beat separate ones is contested. So the default is one PR with shaped commits, PRs are offered only where the atoms don't belong together, and pieces stack only where one needs the other.

`$SHAPE` is this skill's directory.

## Steps

1. **List the hunks.** `bun "$SHAPE/scripts/shape.ts" hunks <repo> <base> <head>` prints every changed file with its kind (prod, test, lock, binary, docs) and every hunk by id (`path#n`). Read the diff itself too, and the branch's existing commits (`git log --reverse <base>..<head>`): the seams are in what the code does, not in the file list.
   *Done when* you know what every hunk is for.

2. **Find the atoms, and order them.** An atom is the smallest set of hunks that stands alone: it builds, its tests pass, and its commit message would be one sentence. The seams:
   - **separate mechanism or module**: two modules that each gain a feature are two atoms;
   - **interface apart from implementation** ([Palantir](https://blog.palantir.com/code-review-best-practices-19e02780015f): the API as interfaces plus docs first, the implementations second);
   - **refactor apart from behaviour** (Beck's *Tidy First?*; [Google](https://google.github.io/eng-practices/review/developer/small-cls.html): "refactorings in a separate CL"): a rename, a move or a reformat is an atom, and the behaviour that builds on it stacks on top;
   - **tests travel with the code they test**, inside that code's atom. A fix ships with the test that goes red without it, and a test fake that the fix's new call would break travels with the fix too;
   - **cleanup the change unlocks** (a workaround it makes unnecessary, a flag it retires) is its own atom, after the change.

   A **shared** file belongs to no single atom: a lockfile, a shared config, a generated file. It goes with the first atom that needs it (the lockfile with the manifest change that moved it, the generated file with its source), and every atom that needs it stacks on that one. A hunk that touches two atoms' code is a sign they are one atom.

   Order them as a reviewer should read them: tidying first, then interfaces, then behaviour, then the cleanup it unlocks. An atom comes after every atom it needs.
   *Done when* every hunk is in exactly one atom, every dependency between atoms is named, and the atoms are in reading order.

3. **Propose the shape.** Compare the atoms with the existing commits. They match, in order → "already shaped", and stop. Otherwise show the **commits** shape: a table of commit, one-line message, files, lines changed (from step 1's counts). Merge neighbouring atoms into one commit where a reviewer would read them together anyway (one small enough to be a footnote of the other). When some atoms are separate ideas a reviewer would approve on their own, also show the **PRs** shape: piece, one-line purpose, files, lines, and what it stacks on. Flag each shared file and where you put it. Ask which shape, and what to merge.
   *Done when* the user has picked a shape and merged what they want merged, or said "already shaped" is right.

4. **Shape it.** Write `cut.json` (format in `scripts/shape.ts`'s header), then:
   - **Commits**: per commit a `title` (the message's first line, in the repo's commit style), an optional `body`, and its `files` (path prefixes) and `hunks` (ids), in reading order. Keep the trailers the original commits carried (`Co-Authored-By:`, `Closes #n`) in the right commit's body. `bun "$SHAPE/scripts/shape.ts" commits cut.json` builds them on a new branch, `<head>-shaped`.
   - **PRs**: per piece a branch name (`<head>-<piece>`, short), a title, its `files` and `hunks`, and `after` for a piece that stacks. `bun "$SHAPE/scripts/shape.ts" cut cut.json` makes one branch per piece.

   Both refuse a hunk in no piece or in two, build in throwaway worktrees, and create branches only once the result rebuilds the head's tree exactly. Nothing is pushed; the user's checkout and the original branch stay as they were.
   *Done when* it prints `✓ the N commits sum back to <head> exactly` (or `✓ the N pieces …`).

5. **Check each one stands alone.** In a worktree per commit (or per piece), run the tests and linters it touches. One that fails needs something from another: fix the cut (move the hunk, or reorder), delete the branches it made (`git branch -D`), and shape again.
   *Done when* every commit, or every piece, passes on its own.

6. **Hand over.**
   - **Commits**: show `git log --reverse --stat <base>..<head>-shaped`. On a yes, move the branch onto it (`git branch -f <head> <head>-shaped`, or `git reset --hard <head>-shaped` when it is checked out) and delete `<head>-shaped`. A branch already pushed then needs a force-push, which asks first, every time.
   - **PRs**: the branches, in merge order, with what each stacks on. Each piece is now a change of its own: it goes through `r2-pr` from the start, readiness check included.

   *Done when* the user has the shaped branch, or the branch list and knows each piece starts its own r2-pr run.

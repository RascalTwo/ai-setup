---
disable-model-invocation: true
name: dredge
description: "Looks back over a thing's history since the last dredge (sessions, commits, what you pushed back on), judges it with plus-ultra, and brings you every improvement worth proposing: bugs, debt, features, process. Never builds anything: you approve, reject or file each one. Kelpie runs it when a project has no work left."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    plus-ultra: the judging step, read by path (it is user-invoked)
    timeline-studio-tasks: files the proposals the human approves
    recall: finds past sessions that worked on the target
---

# Dredge: new work, pulled up from what already happened

plus-ultra judges work that was just finished, using the current session. Dredge does the same judging over a stretch of time: every session, run and commit since it last looked. Everything that went well or badly in that stretch is a **lesson**, and the proposals come from the lessons. A cold brainstorm only finds what is interesting. Lessons find what is actually missing, and only after that do you invent.

**You propose; the human decides.** Dredge writes no code and changes nothing in the target. Each proposal is approved, rejected or left alone by the human, and only on their word does an approved one get filed as a task.

## 1. The target and its ledger

The target is whatever you were pointed at: a repo, a directory, a skill, a tool, a process. Name it with a short slug (a Kelpie run gives you its project id). Its state lives in `~/.agents/state/dredge/<slug>/`:

- `watermark`: the ISO time the last dredge began. Missing means this is the first dredge, so look over the whole history, weighted toward the recent.
- `ledger.md`: every proposal ever made, one line each: `- <date> · <verdict> · <title> · <why, in the human's words where they gave any>`. The verdict is `approved`, `rejected` or `undecided`.

Read both before anything else, and note the time now: it becomes the next watermark.

## 2. Gather the lessons

Collect everything since the watermark. You are done when each source below has been checked, or noted as absent for this target:

- **Commits** on the target's repos (`git log --since=<watermark>`), and the diffs of the larger ones: workarounds, `TODO`s, reverted changes, fixes on fixes.
- **Sessions** that worked on it: the `recall` skill, and Claude Code transcripts under `~/.claude/projects/` whose directory name encodes the target's path. Read for errors hit, retries, things done by hand that could have been automated, and steps that took far longer than they should have.
- **The human's pushback**: Changes requested, corrections, rejected approaches, frustration. These are the most valuable lessons, because they show where the work missed what the human wanted.
- **What went well**: anything that worked smoothly enough to extend or repeat.
- **The target as it stands now**: read it, so every proposal is grounded in the current code and not a past version.

Each lesson cites its source (a commit, a session, a comment), so the human can check it.

## 3. Judge with plus-ultra

Read `~/.agents/skills/plus-ultra/SKILL.md` and apply it, treating the lessons as the work under review. Its rules hold (debts before ideas, a price on every line, the three buckets, the verdict) with these changes:

- **No cap.** Propose everything that earns its place. A thousand proposals that each cite a lesson or carry a price are welcome. Filler is not: "nothing new" is still a valid answer.
- **Lessons go first.** A Debt or Beyond item backed by a lesson outranks an invented one of the same value.
- **The ledger decides what repeats.** A `rejected` proposal comes back only if new evidence has appeared since; then say what changed. An `undecided` proposal comes back with its earlier date. An `approved` one is already work; leave it.
- **Tag each proposal with its kind**: bug, debt, feature, tech debt or process.

## 4. Present

Present the proposals in this conversation as one numbered list grouped by plus-ultra's buckets. Each entry gives its kind, what to change, the lesson behind it, its price and what it buys. Close on plus-ultra's single verdict. The list goes nowhere else: no tasks, no files beyond the ledger.

Then write the ledger: append every new proposal as `undecided`, and set `watermark` to the time you noted in step 1. Do this as soon as the list is shown, so a session that ends early still leaves a record.

## 5. Take verdicts

The human answers in whatever shape suits them ("reject 3, it's churn", "file 1 and 4 for an agent under viz"). For each one:

- **Approved and filed**: create the task with the `timeline-studio-tasks` skill, as that skill says and as the human said (project colour, who it's for). Write the description so another agent could pick it up cold: what, why, and the lesson behind it. Mark it `approved` in the ledger.
- **Rejected**: mark it `rejected` in the ledger, with their reason in their words. This is what stops it from being proposed again.
- **No answer**: it stays `undecided`.

Repeat until the human is done.

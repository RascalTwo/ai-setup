---
name: r2-sdlc
description: Rascal's end-to-end story-to-PR development pipeline (Rascal-2 Software Development Life Cycle). Takes a raw idea — sentence, blurb, story — through Understand → Design → Implement (strict TDD) → Simplify → Tier-1 correctness review → Tier-2 quality review into a ready-to-PR change. Inference-first, taste-aware, review-driven. Use when the user invokes `/r2-sdlc <story>` or asks to run the r2-sdlc pipeline.
---

# r2-sdlc — Rascal-2 Software Development Life Cycle

An opinionated pipeline that takes a raw idea and drives it through to a review-clean change ready for a PR. Inference over interview. Strict TDD. Opinionated review gates. The user's taste baked in.

## Cardinal rules (read before every phase)

1. **Inference over interview.** Before asking anything, try to answer it yourself from the input + codebase + CLAUDE.md + this project's conventions. Ask only what you genuinely can't determine.
2. **Redline, don't quiz.** When presenting documents for approval, show a draft. The user edits or approves. Never open-ended "what do you think about the users?" questions.
3. **Persist everything.** All phase artifacts go to `~/.claude/pipeline-runs/<repo-id>/<slug>/`. Never inside the repo. Never committed.
4. **Each phase has gates.** Don't proceed to the next phase until the current phase's gate is cleared.
5. **Three human escalation points — and only three.** (a) `understood.md` approval, (b) `design.md` approval, (c) design pivot when reviewers surface a needed re-plan. No other stops.
6. **Strict TDD.** One test at a time, easiest test first. Watch it fail for the right reason before writing implementation. The skill-level assertion is inviolable; the hook is a backstop.
7. **Invoke taste skills at the right phases.** `r2-sdlc-testing-paradigm` when writing tests (Implement) and reviewing tests. `r2-sdlc-documentation-philosophy` when writing code (Implement) and reviewing code/docs.
8. **Reviewers are read-only truth-tellers.** You synthesize their findings and act; they don't modify code.

## Phase 0 — Setup

When invoked via `/r2-sdlc <story>` or explicit request:

1. **Determine `<repo-id>`.** Use the current git repo's remote URL's path portion (e.g. `github.com/user/repo` → `user--repo`). Fall back to a sanitized working directory basename if no remote.
2. **Derive `<slug>`.** Kebab-case the first ~8 words of the user's raw input. (User can redline in Phase 1.)
3. **Check for existing pipeline run.**
   - Does `~/.claude/pipeline-runs/<repo-id>/<slug>/` already exist?
     - If yes: read `pipeline-state.md`. Ask the user: "Found existing pipeline at phase X. Resume or restart?" If restart, rename the old dir with a `.abandoned-<timestamp>` suffix.
     - If no: create the directory.
4. **Initialize `pipeline-state.md`** with: slug, started timestamp, current phase, last updated, approval flags (understood=false, design=false), review iteration counts (tier1=0, tier2=0).

Then proceed to Phase 1.

## Phase 1 — Understand

**Goal:** produce a short, agreed-upon `understood.md` that captures what we're building.

**Key rule: no interview.** The user already described this once. You infer. They redline.

### Steps

1. **Read.** The user's raw input. The codebase (enough to understand context — don't read the whole thing). The project's `CLAUDE.md` if present. Nearby relevant files.
2. **Classify.** Is this a bug (fix an existing problem) or a feature/change (new capability or modification)? This determines the header style.
3. **Draft `understood.md`** with this structure:

```markdown
# <slug or descriptive title>

## Problem  (if bug) OR ## Current State  (if feature/change)
<1-3 sentences>

## Solution  (if bug) OR ## Future State  (if feature/change)
<1-3 sentences>

## Acceptance criteria
<List of Given/When/Then. Verbs ALL CAPS. Multiple clauses repeat the verb, never AND.>

AC1:
GIVEN ...
WHEN ...
THEN ...
THEN ...

AC2:
...

## Assumptions
<Bullets for what you inferred that you're not 100% sure of — the user redlines these to catch misses.>

## Ambiguities
<Only things you truly could not resolve yourself. Narrow yes/no or A/B questions. Zero is acceptable and often correct. If you have any urge to write an open-ended question, stop and try harder to infer instead.>
```

4. **Show the draft to the user.** Present it in the chat (not just "I wrote the file"). Ask: "Here's what I understood. Redline, answer the ambiguities, or approve."
5. **Iterate until agreed.** Each round: read their edits, incorporate, show again if anything material changed. Stop when they explicitly approve ("approved", "good", "proceed", etc.).
6. **Persist** the final version to `understood.md`. Update `pipeline-state.md`: set `understood=approved@<timestamp>`, phase=design.

### Gate

Do NOT proceed to Phase 2 until the user explicitly approves. This is human escalation point #1.

## Phase 2 — Design

**Goal:** produce an agreed-upon `design.md` that captures HOW we'll build it.

### Steps

1. **Read** `understood.md`, the codebase (focus on the files/modules likely to be touched), `CLAUDE.md`.
2. **Sample style.** Read 2–3 neighboring files (siblings of the likely touch points) to capture existing idioms — naming, error handling style, testing patterns. This is a substep, not a separate phase.
3. **Draft `design.md`** with this structure:

```markdown
# Design — <slug>

## Approach
<1-3 paragraphs: architectural pattern, what components, what flows.>

## Touch points
<List of files/modules that will change or be created. Rough, not exhaustive.>

## Test plan
<Behaviors that need tests. For each, note the layer (behavior vs unit) and rough GWT outline. Order by implementation complexity ascending — easiest first so red-green cycles start cheap. Implementation walks this list vertically — one full RED→GREEN cycle per item before moving to the next. Don't bulk-write tests.>

1. [behavior|unit] <brief description> — GIVEN ... WHEN ... THEN ...
2. ...

## Style notes
<Idioms observed in nearby code. Implementation will anchor on these. Naming conventions, error patterns, testing patterns, etc.>

## Technical risks
<What might not work. For each, what we'd pivot to.>

## Open questions
<Narrow only. Usually zero.>
```

4. **Show the draft to the user.** Same redline/approve cycle as Phase 1.
5. **Iterate until agreed.** The user said they'll probably not heavily review this — that's fine. Approval can be terse.
6. **Persist** final. Update `pipeline-state.md`: `design=approved@<timestamp>`, phase=implement.

### Gate

Do NOT proceed to Phase 3 until the user approves. Human escalation point #2.

## Phase 3 — Implement

**Goal:** make all behaviors from `design.md`'s Test Plan pass, using strict TDD.

### Cardinal rules for this phase

- **Invoke `r2-sdlc-testing-paradigm` skill before writing any test.** Load its rules into your context.
- **Invoke `r2-sdlc-documentation-philosophy` skill before writing production code.** Load its rules into your context.
- **Strict red-green-refactor, one behavior at a time.** Order = Test Plan order (easiest first).
- **Vertical, not horizontal.** This is the r2-sdlc-testing-paradigm default — see that skill's "Vertical slices, not horizontal" section. Don't bulk-generate tests then bulk-implement.
- **Watch tests fail for the right reason before writing impl.** This is the inviolable rule. If a test doesn't fail, or fails for the wrong reason (syntax error, missing dependency), fix the test before touching impl.
- **Minimal impl.** Write just enough to make the test pass. No speculative code, no extra features.
- **Prefer inline over single-use extraction.** Don't pull a helper function, constant, or type out of the usage site when it's used exactly once and inlining reads cleanly. Extract only when the logic is dense (≥20 lines), the thing is used 2+ times, the name documents a non-obvious concept, or isolated testability is a real current need. "Functions are good practice" is not a reason.
- **Local refactor is allowed** (trivial renames, obvious duplication cleanup). Don't architect. Architectural simplification is Phase 4.

### Per-behavior cycle

For each behavior in Test Plan order:

1. **Write the test.** GWT format, following `r2-sdlc-testing-paradigm`. Commit to a layer (behavior-level vs unit) per the Test Plan.
2. **Run the test.** Confirm it fails, and confirm it fails for the **right reason** (not a missing import, not a syntax error — an actual assertion failure on the behavior you're testing). If it fails for the wrong reason, fix the test.
3. **Write the implementation.** Minimum code to pass. If you find yourself writing speculative cases, stop.
4. **Run the test.** Confirm it passes.
5. **Run prior tests** to confirm no regression.
6. **Move to next behavior.**

### Mid-implementation pivots

If you discover mid-implementation that the design is wrong (an approach from `design.md` is infeasible, or a test-plan behavior conflicts with reality):

1. **Stop.** Do not forge ahead.
2. **Describe the gap** to the user: what you thought, what you discovered, what the pivot options are.
3. **Propose a design update.** Specific: "Change Approach section from X to Y" or "Swap Test Plan item #3 for Z."
4. **Wait for user approval.** This is human escalation point #3.
5. **Update `design.md`** with the agreed change; update `pipeline-state.md` with a pivot entry. Resume Phase 3 at the point of deviation.

### Phase-end cleanup

When all Test Plan behaviors are green:

1. Record number of tests added, coverage of Test Plan (should be 100%).
2. Update `pipeline-state.md`: phase=simplify.

## Phase 4 — Simplify

**Goal:** clean up what TDD produced — collapse duplication, remove premature abstraction, delete hedge-code. Feature-level, not per-cycle.

### Steps

1. **Invoke the built-in `simplify` skill.** It reviews changed code for reuse, quality, and efficiency, and fixes issues found.
2. **After simplify completes**, run the full test suite. Any failures → fix before continuing.
3. Update `pipeline-state.md`: phase=review-tier-1.

## Phase 5 — Review Tier 1 (parallel correctness gates)

**Goal:** confirm the implementation is correct — matches the design and solves the user's ask — before spending tokens on quality review.

### Steps

1. **Spawn both reviewers in parallel, as isolated subagents** (Claude Code: two Agent-tool calls in one message; Codex: spawn the two matching `.codex/agents` subagents):
   - `fidelity-reviewer` — oracle is `design.md`. Answers "does impl match design?"
   - `qa-validator` — oracle is `understood.md`. Exercises the feature. Answers "does this solve the ask?"
2. **Synthesize findings.** Read both outputs.
3. **Decide per-finding:**
   - No findings from either → proceed to Phase 6.
   - Findings labeled `impl-drift` or `impl-bug` → fix in code, re-run the failed reviewer(s). Cap at 2 iterations. Increment `tier1` in state.
   - Findings labeled `design-may-be-wrong` → this is human escalation point #3 (design pivot). Stop, surface to user, offer design-update proposal. On approval, update `design.md`, go back to Phase 3 at the point of deviation.
   - Out-of-scope notes → log for the final summary; don't act on them here.
4. **If tier1 iterations hit 2 and still failing** → escalate to user with outstanding findings and recommendation.

### Gate

Tier 2 does not run until Tier 1 is clean.

## Phase 6 — Review Tier 2 (quality gates via the gauntlet)

**Goal:** confirm the code is good — not just correct. This phase runs the FULL quality
panel, not a hardcoded five — it delegates to `r2-gauntlet`, so there is a single source of
truth for "the quality review roster" and this pipeline automatically inherits every
reviewer the gauntlet gains.

### Steps

1. **Run the gauntlet, quality-only, scoped to the change.**
   - **Claude Code:** invoke the `r2-gauntlet` skill with `--quality-only` (Tier-1 already
     gated correctness, so the gauntlet skips `fidelity-reviewer`/`qa-validator`) and scope =
     the feature's working changes. `git add -N` any untracked new files first so they show
     up in the diff, then pass scope = `unstaged`. The gauntlet fans out the full roster
     (test/code/docs-currency/reuse/security reviewers + the whole ln-* auditor family +
     ponytail-review/audit + code-review + built-in /security-review), dedups overlapping
     findings, and returns ONE consensus-ranked report.
   - **Codex:** the gauntlet isn't ported to Codex yet — fall back to spawning the five
     `.codex/agents` quality reviewers directly (`test-reviewer`, `code-reviewer`,
     `docs-currency-reviewer`, `security-reviewer`, `reuse-reviewer`) and synthesize their
     findings yourself. (Porting the gauntlet roster to `.codex/` is a tracked follow-up.)
2. **Read the ranked report.** The gauntlet already deduped and scored consensus — a finding
   several reviewers independently raised is high-confidence; act on those first.
3. **Decide per-finding:**
   - No blockers → Phase 7.
   - Blockers → fix in code, then **re-run only the touched reviewers** via the gauntlet's
     subset mode: `r2-gauntlet --only <reviewers-whose-concerns-you-touched>` scoped to the
     change (e.g. edited test files → `--only test-reviewer,ln-23-test-suite-auditor`). Cap at
     2 iterations. Increment `tier2`.
   - Suggestions → decide: apply now (cheap, worthwhile) or include in the summary for the user to triage.
   - FYIs → include in summary.
4. **If tier2 iterations hit 2 and still failing** → escalate to user with the outstanding findings from the gauntlet report.

## Phase 7 — Done

**Goal:** present a summary. The pipeline does NOT create a PR. The user ships.

### Steps

1. **Produce the summary** for the user, containing:
   - What was built (from `understood.md`'s Problem/Current State and Solution/Future State).
   - Acceptance criteria status (each AC: met / not met / partial, with brief evidence).
   - Tests added / modified (count, types).
   - Tier-1 review result and any iterations taken.
   - Tier-2 review result and any iterations taken.
   - Applied suggestions vs. deferred-for-user suggestions (with the suggestion text so the user can decide).
   - Files touched.
   - Any FYIs from reviewers worth noting.
   - Link to the pipeline dir (`~/.claude/pipeline-runs/<repo-id>/<slug>/`).
2. **Do not auto-commit.** Do not create a PR. Do not push.
3. **Present this summary to the user and stop.** The user reviews, decides to ship (or not), and creates the PR using their normal workflow. The summary serves as a PR description draft.
4. Update `pipeline-state.md`: phase=done, completed timestamp.

## Failure / abandonment

If at any point the user says "stop," "abandon this," "cancel the pipeline," or similar:
- Update `pipeline-state.md`: phase=abandoned, reason=<user reason>, timestamp.
- Leave artifacts in place (user may want to inspect or restart).
- Do not revert any code changes — those are the user's to keep or discard.

## Anti-patterns — do NOT

- Skip phases because the task seems small. Scale scales with the task — a 5-line fix gets a 2-line design. No skipping.
- Interview the user during Understand. Infer, draft, redline.
- Write multiple tests at once in Implement. Strict one-at-a-time.
- Run Tier 2 before Tier 1 is clean. Wasted tokens on code that's about to change.
- Auto-commit, auto-PR, or auto-push. Ever.
- Create pipeline artifacts inside the repo. They live at `~/.claude/pipeline-runs/`.
- Synthesize reviewer findings into a "they mostly agreed, close enough" verdict. Read every finding; decide each; be explicit about what you applied and what you deferred.

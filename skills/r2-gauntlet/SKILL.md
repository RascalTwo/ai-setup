---
name: r2-gauntlet
description: Rascal's one-command mega-review — runs the ENTIRE review/audit panel on a code change at once (every r2-sdlc reviewer subagent, the whole ln-* auditor family, ponytail, code-review, and the built-in /review + /security-review), then synthesizes ONE deduped, consensus-ranked report instead of twenty overlapping ones. Use when the user says "run the gauntlet", "/r2-gauntlet", "mega review", "review this with everything", "throw all the reviewers at it", "full audit of my changes", "kitchen-sink review", or wants every code-quality reviewer on their machine run in a single pass. This is the "all of them at once" reviewer — for a single targeted review use /code-review instead.
---

# r2-gauntlet — run every reviewer, get one report

Your machine has ~20 review/audit reviewers that overlap heavily. Running them one at a
time is the chaos this skill replaces. The gauntlet fans out **every non-interactive
code reviewer in parallel**, then does the thing that actually makes that useful: a
**synthesis pass that dedups overlapping findings, counts consensus** (a bug five
reviewers independently flag ranks above one only ponytail noticed), and emits **one
ranked report**. The fan-out is the easy part; the synthesis is the product.

## Cardinal rules

1. **Scope is never assumed.** The gauntlet refuses to run until it has an explicit
   scope from the user (one of the four kinds below). If the invocation didn't carry
   one, ask — don't guess a default. Reviewing the wrong thing wastes ~16 agents.
2. **One scope artifact, shared by all.** Compute the diff/fileset ONCE, up front, and
   hand the *same* artifact to every reviewer. Reviewers must not each recompute scope —
   they'd diverge and the dedup would compare apples to oranges.
3. **Reviewers are read-only truth-tellers.** The gauntlet never edits code. It reports.
   The user (or a calling skill like r2-sdlc) decides what to act on.
4. **Overlap is a feature, not waste.** The roster is deliberately redundant. Don't prune
   it to "avoid duplicates" — the duplicates ARE the consensus signal. Dedup in synthesis,
   not by dropping reviewers.
5. **Probe conditional reviewers; never interview.** Two reviewers need extra inputs
   (a design doc, an original-ask doc). Look for those inputs; run the reviewer if found,
   skip-with-a-note if not. Do not turn the probe into a Q&A — that's the interactive
   behavior this skill deliberately excludes.

## Step 1 — Resolve scope (blocking)

The user must specify one of these four. If the invocation named one (`/r2-gauntlet staged`,
"run the gauntlet on my unstaged changes", "gauntlet the whole repo", "gauntlet since main"),
use it. Otherwise ask which one — offer these as the choices, assume nothing.

| Scope | Meaning | Resolves to |
|---|---|---|
| `repo` | The entire codebase as-is | the working tree file list (reviewers read files) |
| `unstaged` | Working-tree changes not yet staged | `git diff` |
| `staged` | Changes staged for commit | `git diff --cached` |
| `since <ref>` | Everything since a commit/branch/tag | `git diff <ref>...HEAD` |

Then compute the artifact once and persist it to the scratchpad:

- For diff scopes: write the unified diff to `$SCRATCH/gauntlet-scope.diff` and capture the
  changed-file list (`git diff --name-only …`). Both get passed to every reviewer.
- For `repo`: capture the tracked-file list (`git ls-files`) as the fileset. Note in the
  report that diff-native reviewers (code-reviewer, test-reviewer, ponytail-review) are
  reviewing the whole tree, and the auditor family (ln-22, ponytail-audit) is in its
  native habitat here.

## Step 2 — Probe the conditional lenses

Non-blocking. Look, decide, move on.

- **fidelity-reviewer** needs a design doc (oracle = "does impl match the design?"). Look for
  a `design.md` in, in order: any `.scratch/*/design.md` in the repo, then
  `~/.claude/pipeline-runs/<repo-id>/*/design.md` (most recent). If exactly one obvious
  candidate exists, include fidelity-reviewer and pass it that path. If none or ambiguously
  many, **skip it and record the reason** ("no design doc found — pass one to enable").
- **qa-validator** needs the original ask (oracle = "does this solve the user's problem?").
  Look for `understood.md` in the same locations, or an ask the user stated inline. Found →
  include and pass it. Not found → skip-with-note.
- **Deterministic floor** (conditional on what the diff touches). From the changed-file list,
  note which triggers are present: a dependency manifest (`package.json`,
  `requirements.txt`/`pyproject.toml`, `go.mod`, `pom.xml`/`build.gradle`, `Dockerfile`,
  `.github/workflows/*`) enables the dep-audit sub-check; JSX/TSX files enable the a11y
  sub-check; the DRY/circular/async sub-checks run on any code diff. Check the relevant tools
  are installed (`osv-scanner`/`trivy`, `jscpd`, `madge`, `eslint`); skip-with-note any that
  aren't. This lens runs in Step 3D.

Everything else in the roster always runs; the deterministic floor runs only the sub-checks
its triggers enable.

## Step 3 — Fan out the whole roster in parallel

**Select the lenses from the registry** (Roster projections table): every lens with
`change-review` = `✓`, plus the `✓*` conditionals that passed Step 2. Group them by the
registry's `Invoke via` column into the three mechanisms below, and spawn all of them **in a
single message** (multiple Agent-tool calls at once) so they run concurrently. As of now the
`change-review` projection resolves to:

**A. r2-sdlc reviewer subagents** — spawn directly via the Agent tool with the matching
`subagent_type`. Always: `code-reviewer`, `test-reviewer`, `docs-currency-reviewer`,
`reuse-reviewer`, `security-reviewer`. Conditionally (Step 2): `fidelity-reviewer`,
`qa-validator`.

**B. Skill-based reviewers** — these are Skill-tool skills, not subagents, so wrap each in a
`general-purpose` subagent whose whole job is: "Invoke the `<skill>` skill against the scope
at `$SCRATCH/gauntlet-scope.diff` (changed files: …), then return your findings in the
canonical schema below — nothing else." One wrapper per skill, all in the same parallel batch:
`ln-12-delivery-reviewer`, `ln-21-documentation-auditor`, `ln-22-codebase-auditor`,
`ln-23-test-suite-auditor`, `ln-24-architecture-auditor`, `ln-25-persistence-auditor`,
`ponytail-review`, `ponytail-audit`, `code-review`.

**C. Built-ins** — `security-review` always (reviews pending changes; wrap in a
`general-purpose` subagent the same way). `review` is the GitHub-PR reviewer — run it **only
if the current branch has an open PR** (`gh pr view --json number` succeeds); otherwise skip
with a note. It doesn't apply to local-only diffs.

**D. Deterministic floor** (conditional — only the sub-checks Step 2 enabled). One
`general-purpose` subagent runs these and returns findings in the canonical schema:
- **Dependencies** (a manifest changed): invoke the scanner's existing `dependency-audit`
  skill at `~/.claude/skills/repo-issue-scanner/skills/dependency-audit/SKILL.md` against the
  changed manifests — out-of-date, known-CVE, and license findings. **Reuse it; do not rebuild
  it** — it's the same skill the scanner uses, which is the whole point of the shared registry.
- **Accessibility** (JSX/TSX changed): run `eslint-plugin-jsx-a11y` over the changed UI files.
- **Mechanical** (any code diff): `jscpd` for copy-paste (flag 10+ duplicated lines, not 3),
  `madge --circular` for new import cycles (JS/TS), and an **async-correctness pass** —
  `forEach(async)` without error handling, a missing `await` on a promise-returning call,
  `async` with no `await`, fire-and-forget without error logging, `Promise.all` with no
  failure strategy. No other reviewer owns this one.
- Any tool not installed → skip that sub-check and add it to the report's skipped list.

Give every subagent the full context it needs up front — it can't ask you mid-run:
the scope artifact path, the changed-file list, and the canonical output schema. For the
r2-sdlc subagents, also remind them to load their paradigm skill
(`r2-sdlc-documentation-philosophy` / `r2-sdlc-testing-paradigm`) as they already expect.

### Canonical finding schema (every reviewer returns a list of these)

Tell each reviewer to return findings as a flat list in exactly this shape, so synthesis can
merge them mechanically:

```
- source:   <reviewer name, e.g. "ponytail-review">
- file:     <path, or "repo-wide">
- line:     <line or range, or "—">
- severity: blocker | high | medium | low | nit
- category: <one slug: security | correctness | over-engineering | reuse | test-gap | docs | data | architecture | style>
- title:    <one sentence — the finding>
- detail:   <why it matters>
- fix:      <concrete suggested fix>
```

Reviewers use different severity words (blocker/suggestion/fyi, critical/high/med/low). Tell
them to map onto the five-level scale above; synthesis normalizes any stragglers.

## Step 4 — Synthesize the one report (the point of the whole skill)

Collect every reviewer's findings, then:

1. **Normalize severity** onto the five-level scale.
2. **Dedup by (file, overlapping line range, same essential issue).** Two findings that name
   the same problem at the same place are one finding — merge them, and **collect the set of
   sources** that raised it. Judge by meaning, not string match (ponytail-review's
   "premature `BaseProcessor` abstraction" and code-reviewer's "single-impl interface, inline
   it" are the same finding).
3. **Score consensus** = number of distinct reviewers that independently raised the merged
   finding. This is your confidence signal.
4. **Rank** by severity first, then consensus count, then file. A high-severity finding with
   consensus ×5 sits at the very top.
5. **Emit the report** in this structure:

```markdown
# 🥊 r2-gauntlet — <scope description>

**Scope:** <repo | unstaged | staged | since <ref>> · <N files>
**Reviewers run:** <count> · **skipped:** <count>
**Raw findings:** <n> → **after dedup:** <m>

## 🔴 Blockers
### [src/foo.ts:12-40] <title>  ·  flagged by code-reviewer, ponytail-review, ln-24 (consensus ×3)  ·  over-engineering
<detail> — **Fix:** <fix>

## 🟠 High
…

## 🟡 Medium
…

## ⚪ Low / Nits
<compact one-line list — file:line · title · source>

## 🤝 Consensus highlights
<Findings flagged by 3+ independent reviewers — highest confidence, act on these first.>

## ⏭️ Skipped reviewers
- fidelity-reviewer — no design doc found (pass one to enable)
- review (PR) — no open PR for this branch
```

Present the report in chat AND save a copy to `$SCRATCH/gauntlet-report.md`. Mention the path.

Do not end with "they mostly agreed, looks fine." Read every finding, decide its place in the
ranking, and let the consensus counts speak. A flat digest with no dedup and no ranking is just
the old chaos with one keystroke — the ranking is the deliverable.

## Called by another skill (sub-mode)

r2-sdlc invokes the gauntlet as its Tier-2 quality wave. When called programmatically, honor
two optional inputs so the caller doesn't double-run reviewers it already gated:

- **`--quality-only`** — skip the correctness reviewers (`fidelity-reviewer`, `qa-validator`).
  Use when the caller already ran a correctness gate (r2-sdlc's Tier-1). Everything else runs.
- **`--only <list>` / `--skip <list>`** — run/omit a named subset of the roster.

The gauntlet is always report-only regardless of caller. It returns the ranked report; the
caller owns any fix-and-re-run loop.

## The roster (source of truth = the shared registry)

The canonical roster lives in ONE place — the **shared registry** at
`~/.claude/skills/repo-issue-scanner/docs/audit-skills.md` → "Roster projections". Both this
skill and repo-issue-scanner read it; add or change a lens THERE, not here, so the two can't
drift. **Run every lens whose `change-review` column is `✓`.** The `✓*` ones are the
conditionals from Step 2 / Step 3C (`fidelity-reviewer`, `qa-validator`, `review`). The
registry's `Invoke via` column tells you the mechanism — `subagent` → Agent tool;
`skill`/`builtin` → general-purpose wrapper (Step 3B/C). The "Excluded from BOTH projections"
list there is authoritative for what the gauntlet deliberately skips.

**repo-issue-scanner is a SIBLING that shares this registry, not a member of the roster** — a
whole-repo → board mini-gauntlet running in a sandbox that can't spawn subagents. Don't call
it, and don't let it call you.

The gauntlet's conditional **deterministic floor** (Step 2 / Step 3D) covers the dep-audit,
a11y, and mechanical lenses the registry marks `✓*` for change-review — reusing the scanner's
`dependency-audit` skill rather than copying it. `improve-codebase-architecture` stays a
deliberate `◇` skip here: `ln-24-architecture-auditor` already covers that dimension for a
change review.

## Anti-patterns — do NOT

- Assume a scope. The one thing this skill refuses to do.
- Run reviewers sequentially in the main context — it blows the context window. Fan out as
  parallel subagents; that's the entire mechanism.
- Dump all findings ungrouped and undeduped. That reproduces the chaos.
- Prune the roster to "reduce redundancy." Redundancy = consensus; keep it, dedup after.
- Turn the conditional-reviewer probe into an interview. Look, decide, note, move on.
- Edit code. The gauntlet reports; it never fixes.

# Review roster — shared source of truth

> 2026-10-18: `repo-issue-scanner` is abandoned (kept on a local branch), so its `repo-audit` projection below has no consumer. r2-gauntlet is the only reader of this file.

This is the **single roster registry** for every "make-the-code-better" reviewer in the
setup. TWO engines consume it as two *projections* — they share this list, NOT their
machinery:

- **`r2-gauntlet`** — the `change-review` projection. Live subagents in an interactive
  session, one working copy, → one ranked chat report.
- **`repo-issue-scanner`** — the `repo-audit` projection. Deterministic Workflow-sandbox
  lenses, N cold-cloned repos, → verified draft board items behind human gates.

They are **siblings that share this roster, not caller/callee** — the scanner's sandbox
can't spawn the gauntlet's subagents, and the gauntlet has no business cold-cloning repos
or filing to a board. Add a new lens HERE once; each engine picks it up per its projection.
Redundancy across lenses is deliberate — multiple auditors flagging the same thing is the
consensus signal; dedup handles it downstream.

## Contents
- Roster projections
- Tier 1 — active now, no setup
- Run prerequisites
- Tier 2 — R2SDLC reviewer agents
- Tier 3 — BUILD: one custom `dependency-audit` skill wrapping deterministic tools
- Tier 4 — accessibility = deterministic linter, NOT a third-party skill
- Tier 5 — ADOPT: levnikolaevich `codebase-audit-suite` (safe, redundancy OK)
- Covered by open-ended prompt (no good dedicated skill exists)
- jeremylongshore mega-repo — REJECTED as a marketplace; prompts mined, done

## Roster projections

`Invoke via`: **subagent** = r2-sdlc reviewer via Agent tool · **skill** = Skill-tool skill
(gauntlet wraps in a general-purpose subagent; scanner reads its rubric on-disk) · **builtin**
= Claude Code built-in · **det. tool** = deterministic CLI · **plugin** = codebase-audit-suite.

| Lens / tool | Dimension | Invoke via | change-review | repo-audit |
|---|---|---|:---:|:---:|
| `ponytail-review` | reinvented stdlib, needless deps, speculative abstraction | skill | ✓ | ✓ |
| `ponytail-audit` | over-engineering / what-to-delete / bloat (whole-repo) | skill | ✓ | ✓ |
| `code-reviewer` | code quality + Goldilocks docs (`r2-sdlc-documentation-philosophy`) | subagent | ✓ | ✓ |
| `test-reviewer` | test quality (`r2-sdlc-testing-paradigm`) | subagent | ✓ | ✓ |
| `docs-currency-reviewer` | stale project markdown/docs | subagent | ✓ | ✓ |
| `reuse-reviewer` | reinvented-wheel vs stdlib / existing deps | subagent | ✓ | ✓ |
| `security-reviewer` | security issues | subagent | ✓ | ✓ |
| `security-review` | security smells | builtin | ✓ | ✓ |
| `code-review` | correctness + reuse/simplify/efficiency (Standards + Spec) | skill/builtin | ✓ | ✓ |
| `fidelity-reviewer` | impl matches the design doc | subagent | ✓\* | — *(no spec on a cold repo)* |
| `qa-validator` | does it solve the original ask | subagent | ✓\* | — *(no story on a cold repo)* |
| `review` | GitHub PR review | builtin | ✓\* *(open PR only)* | — |
| `ln-52-delivery-reviewer` | completed-delivery defects / readiness | skill | ✓ | ◇ candidate |
| `ln-53-documentation-auditor` | docs + comment trust / accuracy | skill | ✓ | ◇ *(partial via docs-currency)* |
| `ln-54-codebase-auditor` | cross-cutting code health | skill | ✓ | ◇ *(overlaps codebase-audit-suite)* |
| `ln-55-test-suite-auditor` | test-suite as a sustainable portfolio / lifecycle control | skill | ✓ ⚠ | ◇ *(overlaps test-reviewer)* |
| `ln-56-architecture-auditor` | architecture fitness / boundaries | skill | ✓ | via `improve-codebase-architecture` |
| `ln-57-persistence-auditor` | queries / transactions / data-path perf | skill | ✓ | via `codebase-audit-suite` (N+1) |
| `improve-codebase-architecture` | refactor / deepening / coupling / testability | skill | ◇ candidate | ✓ |
| `codebase-audit-suite` | dead-code, dep-risk, coverage-gap, arch, N+1/perf | plugin | — | ✓ |
| `dependency-audit` | out-of-date + known-CVE + license (osv/trivy) | det. tool | ✓\* *(manifest diffs; reuses this skill)* | ✓ |
| `eslint-plugin-jsx-a11y` | accessibility on UI repos | det. tool | ✓\* *(JSX diffs)* | ✓ |
| mechanical floor | DRY (`jscpd`), circular deps (`madge`), async-correctness | det. tool | ✓\* *(on the diff)* | ✓ |
| `diagnose` | disciplined bug / perf-regression diagnosis | skill | — | ✓ |

`✓` = in that projection's roster · `✓\*` = conditional (probe for the input first) ·
`⚠` = **upstream scoped itself away from this projection** — still wired, needs a decision ·
`◇` = **not wired yet, but a sensible candidate** — reconciliation opportunity, decide per lens ·
`—` = out of scope for that projection · `via X` = same dimension covered by a different tool there.

The change-review `✓*` deterministic lenses (dep-audit, a11y, mechanical floor) run as the
gauntlet's conditional **deterministic floor** — fired only when the diff touches the relevant
files and the tool is installed. dep-audit there is the *same* `dependency-audit` skill this
scanner uses, not a copy. `improve-codebase-architecture` stays `◇` for change-review because
`ln-56-architecture-auditor` already covers that dimension in the gauntlet.

`ln-55-test-suite-auditor` carries a `⚠`: upstream now describes it as auditing the suite as a
portfolio and says explicitly it is **not** for reviewing one delivery — yet it sits in the
change-review roster, where every other lens reads a diff. Either drop it to `◇` for
change-review and let `test-reviewer` own diffs, or keep it and accept it answers a
whole-suite question on a change-shaped input. Undecided; the `⚠` marks the open call.

The `ln-3x`/`ln-4x`/`ln-5x` skills and the `ln-6x`/`ln-7x` series added upstream in Aug 2026
(skill reviewer, repo/release publishers, community announcer, system-design baseline,
current-architecture documenter, design proposal, ADR recorder, diagram builder, migration
planner, surgical change implementer) are **builders, planners, and publishers — not review
lenses**, so none belongs in either projection. Recorded here so the next audit doesn't
re-litigate it.

**Excluded from BOTH projections** (interactive, or review a plan/session/config, not a code
change): `grilling`, `grill-with-docs`, `ln-33-plan-reviewer` (a grilling sibling), `retro`,
`ai-setup-audit`, and `repo-issue-scanner` itself.

---

The sections below are the **repo-audit projection's operational detail** (plugin token
hygiene, cold-repo constraints, deterministic-tool build notes, board mechanics). The
change-review projection ignores them; see `r2-gauntlet/SKILL.md` for its runtime.

## Tier 1 — active now, no setup

| Tool | Dimension | Invocation |
|---|---|---|
| `ponytail-audit` | over-engineering, what-to-delete, bloat (whole-repo) | plugin, active |
| `ponytail-review` | reinvented stdlib, needless deps, speculative abstraction | plugin, active |
| `improve-codebase-architecture` | refactor / deepening / coupling / testability | user-skill, active |
| `code-review` | correctness bugs + reuse/simplify/efficiency | built-in |
| `security-review` | security smells | built-in |
| `diagnose` | disciplined bug / perf-regression diagnosis | user-skill |

## Run prerequisites

Nothing to enable: the r2-sdlc reviewer agents live in `~/.claude/agents/`, and ponytail
and the ln-5x auditors are skills installed directly under `~/.agents/skills/`. The
lens agents read them as on-disk rubrics; `bin/check-lenses.mjs` (runbook step 2)
fails loudly if any path `scan.mjs` names is missing.

## Tier 2 — R2SDLC reviewer agents

Installed as plain agent files in `~/.claude/agents/`. Also the user's day-to-day
story→PR dev pipeline.

**In scope for the scanner** (deep-finding reviewers):
`code-reviewer`, `test-reviewer`, `docs-currency-reviewer`, `reuse-reviewer`,
`security-reviewer`, plus the `r2-sdlc-testing-paradigm` and `r2-sdlc-documentation-philosophy`
skills.

**Excluded:** `fidelity-reviewer` and `qa-validator` — they require spec/story
docs that a cold repo scan does not have. Not applicable here.

**TDD hook is safe.** The plugin's `PreToolUse(Write|Edit)` red-gate is gated on
a marker file (`~/.claude/pipeline-runs/.r2-sdlc-implement-active`) that only
exists during an active r2-sdlc Implement phase, and even then only injects a
reminder — never hard-blocks. Inert for our editing and for the scanner.

## Tier 3 — BUILD: one custom `dependency-audit` skill wrapping deterministic tools

Dependency/CVE/license findings must be precise — best good-first generators,
worst place for an AI guess or an unvetted third-party skill. So we build ONE
custom skill (not two — staleness + CVE share ecosystem detection and tools):

`dependency-audit` skill:
1. Detect ecosystems present in the repo (package.json, requirements.txt/pyproject,
   go.mod, pom.xml/build.gradle, .github/workflows/*, Dockerfile, etc.).
2. From an internal ecosystem→tool directory, run the right deterministic tool:
   - npm/yarn/pnpm → `npm outdated` + `osv-scanner` (or `npm audit`)
   - python → `pip-audit` / `osv-scanner`
   - go → `govulncheck` / `osv-scanner`
   - GitHub Actions → check action refs are current/pinned
   - containers / cross-ecosystem vuln + license → `trivy`
   - license compliance → `license-checker` / `trivy` / `scancode`
3. Emit two finding kinds: out-of-date (staleness) and known-CVE. Both are
   high-precision good-first material.

If existing dep tooling already runs in a repo (Dependabot/renovate), defer to it
and only flag its absence. Tools must exist on the machine running the scan
(build-time prereq check).

Forked into this skill's prompt from jeremylongshore `dependency-checker` (the
only bits deterministic scanners miss):
- **Abandonment heuristic** — flag deps with no release in 2+ years, archived
  upstream repos, or deprecation notices.
- **License policy** — flag copyleft (GPL/AGPL) in a proprietary project +
  unlicensed packages, beyond just emitting the license string.

## Tier 4 — accessibility = deterministic linter, NOT a third-party skill

Decided after a bake-off. axe-core is the engine under every option, so it's a
packaging question. For a batch scanner, runtime tools (axe/pa11y/Lighthouse)
need each repo to boot a dev server + headless browser — fragile across 40 repos.
`eslint-plugin-jsx-a11y` reads JSX statically (same rules, no boot, no MCP).

- **On UI repos, run `eslint-plugin-jsx-a11y` as part of the mechanical lint pass.**
  Optional `pa11y-ci` (axe engine) only where a dev server boots trivially.
- Import NO a11y skill — all importable ones bundle an MCP server or are
  unmaintained. Fallback IF a skill is ever mandated: `accesslint` (MIT, reputable;
  accepts `@accesslint/mcp` + CDP browser surface).

## Tier 5 — ADOPT: levnikolaevich `codebase-audit-suite` (safe, redundancy OK)

Cleared on safety: the bundled `hex-ssh` MCP is NOT auto-enabled — skills fall
back to native tools; the MCP only loads via a separate `claude mcp add`, which we
never run. Rich suite (dead-code, dependency-risk, coverage-gap, architecture,
N+1/perf). Overlaps R2SDLC — fine, user accepts redundancy.

**Status: superseded by the ln-5x auditor skills** installed directly under
`~/.agents/skills/ln-5*` (no plugin to enable). The scanner's correctness, tests and
architecture lenses read `ln-54`/`ln-57`, `ln-55` and `ln-56`. **Gate:** spot-check
output quality on 2 real repos before fleet-wide trust.

## Covered by open-ended prompt (no good dedicated skill exists)

- Performance, documentation completeness — plain audit prompts; R2SDLC's
  docs-currency-reviewer partially covers docs.

## jeremylongshore mega-repo — REJECTED as a marketplace; prompts mined, done

`jeremylongshore/claude-code-plugins-plus-skills` (2.4k★) = aggregator marketplace
(425 plugins / 2,810 mostly Forge-AUTO-GENERATED skills), gated only on structural
conformance, not defect-finding quality. NOT wired in; `ccpi` CLI avoided. Its two
useful skills were read and the additive bits forked (rest is redundant with
ponytail-audit + codebase-audit-suite):

- → `dependency-checker`: abandonment + copyleft nuggets folded into
  `dependency-audit` (above).
- → `code-cleanup`: fork these three, the only real coverage gaps —
  - **Async-correctness checklist** (NO current auditor owns this): `forEach(async)`
    w/o error handling, missing `await` on promise-returning calls, `async` with no
    `await`, fire-and-forget w/o error logging, `Promise.all` w/o failure strategy.
    → add to the mechanical floor (partly ESLint-enforceable) + an AI correctness pass.
  - **DRY threshold**: 10+ identical lines warrants refactor (3 similar don't);
    tool `jscpd`.
  - **Circular-dep tooling**: `madge --circular`, `dependency-cruiser` as
    deterministic steps.

Nothing else from these repos. Avoid one-off `dependency-auditor` skills /
`/code-audit` gists — unvetted.

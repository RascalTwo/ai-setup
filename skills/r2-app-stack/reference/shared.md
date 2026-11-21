# Shared TypeScript standards

Applies to every TypeScript program: apps, servers, CLIs, libraries, scripts. Python has its own page ([`kinds/python.md`](kinds/python.md)) with the same shape. Tests are in [`test-stack.md`](test-stack.md).

## Contents

- Language and runtime
- Types
- Lint
- Format
- The check command
- Hooks and CI
- Dependencies

## Language and runtime

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| TypeScript, ESM (`"type": "module"`) for every JS-runtime program | one module system, types everywhere | Timeline Studio, Wizard Studio, Airtable Post Planner, Loan Bank, viz | not enforced yet |
| Node 24, TypeScript run directly (Node type stripping); a bundler only where the target needs one (browser, Lambda) | no build step to drift; same runtime in dev, test and prod | Wizard Studio (`node >=24.2`), Airtable, Loan Bank `ops/` | `engines` field |
| No Bun | Joseph is moving off it; one runtime | Joseph's decision, 2026-11-07 | adopt step flags it |
| Validate data at every trust boundary with zod (HTTP bodies, files, env, third-party responses) | a type is only a promise inside the program | Wizard Studio connectors, mailroom `contracts/`, viz kit | not enforced yet |

## Types

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| TypeScript 7 (native `tsc`) | newest wins; much faster checks | Wizard Studio 7.0.2, Airtable 7.0.2, viz ^7.0.2 | exact pin |
| The strict flag set: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `erasableSyntaxOnly`, `moduleDetection: "force"`, `noUncheckedSideEffectImports` | catch problems at the earliest point | viz `STRICT`; Timeline Studio, Wizard Studio, Airtable; records-easy | a test |
| A test pins the flag set (fails if a flag is dropped or loosened) | strictness can't erode silently | Timeline Studio `sync-server/test/tsconfig-strict.test.ts`, Wizard Studio `tests/types.test.ts`, viz `tests/skill-types.test.ts` | the test itself |
| A `typecheck` script runs `tsc -p` once per program (app, server, scripts, tests) | every tsconfig is checked, not just the root | Timeline Studio, Wizard Studio (3 programs), Airtable (3), viz | check command |

## Lint

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| oxlint with oxlint-tsgolint (type-aware); every category on at `error` except `style`; plugins typescript, unicorn, oxc, import, plus react and jsx-a11y for UI code | catch the most, as early as possible | viz `lib/lint/config.ts`; Timeline Studio, Wizard Studio, Airtable (copied from viz) | check command |
| Every rule turned off has a written, repo-specific reason, in a `rule → reason` map that generates the config | "taste" is not a reason; reviewers see every exception | viz `OFF_RULES`, Timeline Studio, Wizard Studio | meta-test |
| A meta-test keeps the reasons non-empty, the config in step with its generator, and proves the type-aware engine actually ran | a skipped engine reads as a clean pass otherwise | viz `tests/lint.test.ts`, Timeline Studio `lint-engine.test.ts`, Wizard Studio | the test itself |
| Inline disables carry ` -- why`; stale disables fail (`--report-unused-disable-directives`) | an exception explains itself and dies with its cause | viz, Timeline Studio, Wizard Studio, Airtable | lint wrapper |
| A skipped check never reads as a pass: a missing tool or engine is SKIP or FAIL, never PASS | silence must not look like success | viz, Wizard Studio, ai-setup `scripts/check.ts` | check command |

## Format

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| oxfmt with defaults, no config file; check mode in the gate (`--list-different`) | nothing to argue about | viz, Timeline Studio, Wizard Studio, Airtable | check command |
| A format ignore has a reason on the line above | same rule as lint exceptions | viz, Wizard Studio, Airtable | format wrapper |

The old way: eslint and prettier (Loan Bank, sai-github-automations) are superseded by oxlint and oxfmt; move when the adopt step reaches them.

## The check command

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| One command runs every check, cheapest first: format, lint, types, tests, build, merged results and coverage | one thing to run locally and in CI | ai-setup `scripts/check.ts`, Timeline Studio `npm run check`, Wizard Studio, Airtable, Loan Bank | the command itself |
| A fast mode for the pre-commit hook (only what the change touches) and a full mode for CI | commits stay quick; CI is complete | ai-setup `--staged`/`--all`, Wizard Studio `check:fast`, Airtable `check:fast`/`check:ci` | the command itself |
| Gates are tested both ways: a meta-test feeds each gate a known-bad and a known-good input | a gate that can't fail is theatre | Timeline Studio, Wizard Studio, viz | the tests themselves |

## Hooks and CI

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| A versioned pre-commit hook runs the fast mode; markdown-only commits skip it (unless markdown is the product, as on a content site); installed by a script (`core.hooksPath`) | problems stop before they're committed | ai-setup `.githooks/pre-commit`, Wizard Studio `scripts/hooks`, Airtable | the hook |
| CI runs the same full check command as its first job; build and deploy jobs run only after it passes | CI and local can't disagree; nothing ships red | Timeline Studio `ci.yml`, Wizard Studio, Airtable, Loan Bank, pairwise-sorter | CI config |

## Dependencies

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| Exact version pins for the toolchain (compiler, linter, formatter, test runners, coverage, Playwright) | an upgrade is a deliberate, reviewed change, never a surprise | Timeline Studio, Wizard Studio, Airtable, viz | not enforced yet |
| Prefer an existing, maintained open-source package to custom code; check last release and real usage before adopting | less to own | Joseph's decision | review |

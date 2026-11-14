# Test stack

The tools that carry out `r2-testing-paradigm`. The paradigm says how to test (scope, stand-ins, what a test must prove); this page says what runs it. Python's tools are in [`kinds/python.md`](kinds/python.md); the shape below (one result list, one coverage report, per-test coverage, step helpers) applies there too.

## Contents

- Runners
- One result list, one coverage report
- Coverage: Istanbul everywhere
- Per-test coverage, both ways
- Given / When / Then steps
- Screenshots and approval
- Mutation testing

## Runners

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| **vitest** runs logic tests and component tests | the runtime's own runner fits; one config with `projects` (a `node` project, a `component` project in jsdom) | Wizard Studio, Airtable, Loan Bank, records-easy | check command |
| **Playwright Test** (its own runner) runs browser tests (journeys) | its UI mode and trace viewer are the most mature debugging tools; `toHaveScreenshot` is stable; role and state locators and re-checking expectations are built in | Airtable (newest web app, the only role-first suite); Joseph's decision 2026-11-07 after a side-by-side with vitest browser mode | check command |
| Browser tests use Playwright's bundled headless shell (`playwright install chromium --only-shell`), not the system Chrome | closing system Chrome took 10 s per run (measured 2026-11-07) | browser-driver research | not enforced yet |
| A failed browser test keeps its trace (`trace: 'retain-on-failure'`) | open it in the trace viewer instead of rerunning to guess | Playwright docs; scratch app | config |
| Component tests use Testing Library, found by role ([`testable-apps.md`](testable-apps.md)) | journeys stay the default scope; a component with behaviour of its own gets its own test | Airtable `web/src/App.test.tsx` (getByRole 63, testid 0), Loan Bank, records-easy | lint (locator rule) |
| puppeteer is not used for new suites; existing ones move to Playwright | puppeteer's ARIA selector matches role and exact name only, no state (`checked`, `expanded`), no re-checking expectations (measured) | browser-driver research 2026-11-07 | adopt step |

Exception: a performance harness that drives Chrome's DevTools protocol directly (Timeline Studio `scripts/playback-harness.ts`) isn't a journey suite and keeps its driver.

## One result list, one coverage report

**Rule:** one command runs both runners and ends in one list of every test, one coverage report, and one exit code. **Why:** two runners must never mean two answers. **Sources:** Joseph's decision; proven in the scratch app 2026-11-07. **Enforced:** the check command.

- **Results:** each runner writes JUnit XML; **Allure 3** (`allure`) reads both, prints one list, writes one HTML report and fails the run through its quality gate. No Allure adapters are needed.
- **Order:** `run-s --continue-on-error` (`npm-run-all2`) runs format, lint, types, vitest, Playwright, then the coverage merge and the results merge, so one failure doesn't hide the rest.
- **Coverage:** see below; merged and reported with `monocart-coverage-reports`, with the floor checked on the merged result.
- **A missing or empty coverage input fails the check.** The merge tool only logs a missing folder, so the merge script checks that every expected input exists and has data. Its path filters are functions, not globs: globs fail silently under a dot-folder.

## Coverage: Istanbul everywhere

**Rule:** count coverage with Istanbul in every runner. A 14-line Vite plugin on `istanbul-lib-instrument` instruments the original `.ts`/`.tsx` before any transform (`enforce: "pre"`); vitest uses it for logic and component tests, and the browser-test build uses it so the page fills `window.__coverage__`.

**Why:** one format, so unit, component and browser coverage merge exactly, branches included; works in any browser; public APIs only. Measured against V8 (Chrome's built-in counter) on a 342-test suite: V8 over-credited per-test coverage (functions a test never called counted as run), depended on vitest's undocumented module wrapper, and was slowest; mixing V8 for browsers with Istanbul for vitest can't merge branches. Instrumenting after the TypeScript transform dropped a JSX `&&` branch, hence `enforce: "pre"`.

**Cost, accepted by Joseph:** browser tests run an instrumented bundle (about 1.8× the size) and take about 55% longer; the whole check about 39% longer.

**Sources:** coverage research and scratch apps, 2026-11-07. Coverage rules themselves (floor that only rises, 100% on the pure core, a reason on every exclusion) are in `r2-testing-paradigm` `reference/coverage-and-mutation.md`; the exclusion comment is `/* istanbul ignore next -- <reason> */`.

**Other bundlers:** the plugin above is for Vite. A program built by another tool (Next.js, a bare esbuild bundle) uses that tool's Istanbul plugin (for example `babel-plugin-istanbul`) feeding the same merge; not built yet.

**Enforced:** the merge script (floor, missing input). **To be packaged.**

Not used: `vite-plugin-istanbul` (skips the server-side transform vitest uses, and seeks maintainers); `@vitest/coverage-istanbul` (its data sits in an internal global). `oxc-coverage-instrument` gave identical output much faster; it's a one-line swap if instrumenting ever shows up in a profile (it was 0.x with one maintainer in November 2026).

## Per-test coverage, both ways

**Rule:** every run records coverage per test, and a query answers both ways: a test's lines, functions and branches; a line's or branch's tests. **Why:** a line only one test reaches is fragile; a test that reaches nothing unique may be redundant; when a line breaks, you know which tests to run. **Sources:** viz (`coverage.json`, line ↔ tests, ADR 0022); Joseph calls it core. **Enforced:** the check command builds the map.

- **vitest:** a setup file copies the counters in `globalThis.__coverage__` before each test and subtracts them after; what ran before any test (imports) goes to a separate `(load)` entry so it doesn't credit every test.
- **Playwright:** an auto fixture reads `window.__coverage__` from each page at the end of each test, including pages left by navigation.
- **Query:** `cov-map --test "<name>"` and `cov-map --line src/file.ts:12` (branch arms as `12.b0.1`).
- Proven 2026-11-07: identical maps with tests in parallel or one at a time, in every vitest pool tried. **To be packaged.**

## Given / When / Then steps

**Rule:** every test is written as `given` / `when` / `then` step calls, each with a sentence and a function; lint fails a test without them. A living spec (readable HTML and markdown of every test's sentences) is generated from the recorded steps on each run. **Why:** a test reads as the behaviour it proves, and the spec can't drift from the tests. **Sources:** viz (every test, enforced by lint, living spec ADR 0027), Wizard Studio, Timeline Studio (comments plus a lint check). **Enforced:** lint.

- In Playwright the helpers wrap `test.step`, so each step shows in UI mode, the trace and the report: `await given("a signed-in planner", async () => { … })`.
- In vitest the helpers run the function and record the sentence for the spec.
- The capitalised-verb and one-clause rules are in `r2-testing-paradigm` (Given / When / Then). **To be packaged.**

## Screenshots and approval

The rules (a person approves every baseline, mask what isn't under test, few tight baselines) are in `r2-testing-paradigm` `reference/visual.md`. The tools:

- **Compare** with Playwright `toHaveScreenshot`, cropped to an element found by role, with `mask` for anything that changes on its own.
- **Never write baselines during a normal run:** `updateSnapshots: 'none'`. A changed screenshot fails and leaves expected, actual and diff images.
- **Collect** with a second pass over only the failed tests: `PW_PENDING=1 playwright test --last-failed`, where `snapshotPathTemplate` points at `__pending__/` and `updateSnapshots` is `all`. New and changed pictures land in pending; baselines are untouched.
- **Review** each pending picture against its baseline on viz shots' review page (side by side, swipe at any angle, blend, flicker, diff), approve or reject one at a time. Approved pictures move into the baselines; rejected ones are deleted and the test keeps failing.
- **Make and approve baselines only inside Playwright's Docker image** (`mcr.microsoft.com/playwright:v<same version>-noble`). A heading screenshot differed in 145 pixels between macOS and that image.

**Why the custom step:** Playwright accepts screenshots only in bulk (`--update-snapshots`), and with `none` a brand-new screenshot saves no image to review; requests for a per-image accept were closed unmerged (#42421, #43835). No open-source tool adds per-image approval without replacing `toHaveScreenshot` (reg-cli has no approve; Visual Regression Tracker needs Docker and a database; Argos isn't self-hostable; Lost Pixel is archived). **Sources:** viz ADR 0022 (`viz shots`); visual research 2026-11-07. **Enforced:** `updateSnapshots: 'none'` in config. About 80 new lines plus viz's review page. **To be packaged.**

Not verified yet: whether a baseline made in the arm64 image on a Mac matches an amd64 CI machine. Check on the first real CI run.

## Mutation testing

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| Stryker (command runner) on the pure core; survivors killed or `// Stryker disable` with a reason | coverage proves code ran, not that a test would notice it breaking | Wizard Studio `stryker.config.json`, Airtable | candidate placement: weekly CI (Wizard) or inside check (Airtable) |
| fast-check property tests on the pure core | candidate | Wizard Studio `engine/test/properties.test.ts` | — |

Candidate: a **red-on-purpose ledger**, a committed list of tests expected to fail; the gate fails on a red test not listed and on a listed test that turns green (Timeline Studio `scripts/known-red.txt`, one repo). Adopt it in a repo that needs known-failing tests, or drop it.

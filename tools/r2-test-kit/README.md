---
rascaltwo-ai-setup:
  kind: tool
  state: false
  integrates:
    vite: istanbul() plugin
    vitest: setup file
    playwright: test fixture
    allure: allurerc preset
  requires:
    commands: [node, npm]
---
# r2-test-kit

One check command for a Vite app that ends in one list of every test, one coverage report across logic, component and browser tests, and one exit code. Coverage is counted by Istanbul in every runner and recorded per test, so you can ask both ways: what one test ran, and which tests ran a line or one side of a condition. This is the glue `r2-app-stack` (`reference/test-stack.md`) calls for. No package did this, so it is written once here.

`example/` is a working app wired with it. Its configs are the lines you copy, and its `npm run check` is the kit's end-to-end test.

## Install

Node 24, vitest and Playwright are yours (peer dependencies; `example/package.json` pins the versions tested: vitest 5.1.0, Vite 8.3.8, Playwright 1.65.1, Allure 3.33.0). The kit isn't published yet, so install it from this folder:

```sh
npm install -D --install-links ~/path/to/ai-setup/tools/r2-test-kit
npx playwright install chromium --only-shell
```

`--install-links` (or `install-links=true` in the app's `.npmrc`, as the example has) copies the kit in instead of symlinking it. A symlinked kit imports its own vitest, not yours, and its hooks never run. After changing the kit, run the install again.

## The four lines an app adds

```ts
// vite.config.ts: instrument in mode "test" (vitest, and the journeys' build)
plugins: [react(), mode === "test" && istanbul()],          // import { istanbul } from "@rascaltwo/r2-test-kit/vite"
// vite.config.ts, test: per-test counters for vitest
setupFiles: ["@rascaltwo/r2-test-kit/vitest"],
// journeys/*.ts: per-test counters for Playwright
import { expect, test } from "@rascaltwo/r2-test-kit/playwright";
// allurerc.mjs: one list, failing on any failure or too few tests
export default allure({ name: "my app", minTestsCount: 5 }); // import { allure } from "@rascaltwo/r2-test-kit/allurerc"
```

Each runner also writes JUnit to `out/results/` (`vitest.xml`, `playwright.xml`), and Playwright's web server builds with `vite build --mode test` so the page is instrumented. Copy `example/vite.config.ts` and `example/playwright.config.ts`.

A runner the kit has no fixture for (puppeteer, say) writes its own per-test records with `writeRecord`, `diff` and `add` from `@rascaltwo/r2-test-kit/record`, into `out/coverage/e2e`; pairwise-sorter's `test/element/harness.ts` is the example.

## The check script

```json
"check": "run-s --continue-on-error clean format lint types test:unit test:e2e coverage cov-map results",
"clean": "node -e \"fs.rmSync('out', { recursive: true, force: true })\"",
"coverage": "r2-test-kit merge",
"cov-map": "r2-test-kit cov-map --build",
"results": "allure generate out/results"
```

`clean` comes first: records from an earlier run (a renamed test, say) would otherwise count again. `--continue-on-error` (`npm-run-all2`) runs every step even after one fails, so one failure doesn't hide the rest. The exit code is non-zero if any step failed.

## Commands

| Command | Does |
|---|---|
| `r2-test-kit merge` | every record from `out/coverage/unit` and `out/coverage/e2e` → one report in `out/coverage/merged` (`lcov.info`, HTML under `lcov-report/`, `coverage-final.json`), a text table, then the floor |
| `r2-test-kit cov-map --build` | writes `out/pertest/map.json` from the same records |
| `r2-test-kit cov-map --test "<substring>"` | each matching test and what it ran, per file: lines `N`, functions `N#name`, branch arms `N.bBLOCK.ARM` |
| `r2-test-kit cov-map --line src/App.tsx:21` | every line, function and branch arm counted on that line, and the tests that ran it (`(no test ran it)` when none) |

```
$ npx r2-test-kit cov-map --line src/App.tsx:21
src/App.tsx:21.b0.0 <- journeys/checkout.ts > buyer checks out with free shipping, src/App.test.tsx > adding a mug shows its total
src/App.tsx:21.b0.1 <- journeys/checkout.ts > buyer checks out with free shipping
```

## Failure messages

Each prints one line and exits 1:

| Line | Means |
|---|---|
| `COVERAGE FLOOR: lines 80% < 90%` | a total fell below `coverage-floor.json` (one line per measure below) |
| `coverage input missing: out/coverage/e2e` | a runner's folder is absent, so a runner didn't run or wrote elsewhere |
| `coverage input empty: out/coverage/e2e has no test record with coverage` | the runner ran but saved nothing; usually its build isn't instrumented (`--mode test` missing) |
| Allure's `⨯ maxFailures` / `⨯ minTestsCount` | a test failed (Allure names it in the list above), or fewer tests ran than `minTestsCount` |
| `r2-test-kit: a page's coverage did not fit in sessionStorage…` | a browser test's page was too big to hand over across a navigation (see Limits) |

Passing lines: `COVERAGE FLOOR: met (…)`; `COVERAGE FLOOR: raised lines 90% → 91%; commit coverage-floor.json`; on the first run, `COVERAGE FLOOR: created coverage-floor.json at …; commit it`.

## Words used here

- **record**: one JSON file per test (`out/coverage/<runner>/`) holding only the counters that test moved, plus the id of each file's static map (`out/coverage/meta/`).
- **load record**: `(load) <test file>`, what ran in a vitest file outside any test (imports, hooks around the file). It counts in the report and is credited to no test in the map.
- **floor**: `coverage-floor.json` in the app, the totals for lines, statements, functions and branches. Below fails; a gain of a whole point or more rewrites it to the new numbers rounded down, 0.1 short of the measured total so a total of 28.02 stays at 27 (commit that); anything less leaves it untouched, so a total that wobbles by 0.05 on unchanged code neither fails nor dirties the file. It is checked on totals, not per file.

## Settings

All optional, in `r2-test-kit.config.mjs` at the app root, read by the plugin and the commands alike:

```js
export default {
  include: (path) => path.startsWith("src/") && !path.includes(".test."), // relative to the app root
  inputs: ["out/coverage/unit", "out/coverage/e2e"],
  floorFile: "coverage-floor.json",
  reportDir: "out/coverage/merged",
};
```

The default `include` counts `src/**` scripts, minus tests, `.d.ts` and any `main.*` entry file. Filters are functions, not globs: a glob matches nothing under a dot-folder, without telling you.

## How it works

- **`istanbul()`** (Vite plugin, `enforce: "pre"`) instruments the original `.ts`/`.tsx` with `istanbul-lib-instrument` before TypeScript and JSX are compiled, so counters are in source coordinates (no source-map step) and a JSX `&&` arm is a branch. It runs for SSR transforms too, which is how vitest loads modules.
- **vitest setup file**: before each test it snapshots `globalThis.__coverage__`; after it, the difference is that test's record. Anything between tests goes into the load record.
- **Playwright fixture**: on `pagehide` each page stashes its counters in `sessionStorage`. That write is synchronous and survives a same-origin navigation. When the test ends, the last page returns its own counters plus every stash. Two other ways were tried and measured: a call from the page back to Playwright on `pagehide` never arrives, and reading the page while its navigation request is held hangs.
- **merge** checks every input, rebuilds full Istanbul file coverage from each record and its static map, adds every included `src/` file nothing loaded (at 0%), and reports with `istanbul-lib-coverage`, `istanbul-lib-report` and `istanbul-reports`.
- **cov-map** keys a record's non-zero counters by line, function and branch arm. A function no test called has a zero counter in every test's record, so nobody gets credit for it. That over-credit is what ruled out V8.

## Limits

- Vite only. Another bundler needs its own Istanbul plugin (`babel-plugin-istanbul`) feeding the same records; not built.
- Tests in one vitest file must run one at a time: `test.concurrent` would mix their counters.
- Playwright: only the `page` fixture is read, not pages a test opens itself; a page left for another origin keeps its stash there; a page's counters must fit in `sessionStorage` (about 5 MB), and the test fails loudly if they don't.
- A browser test has no load record: each test loads the page fresh, so the page's start-up code is credited to every browser test, because each one really ran it.
- Only files under `src/` are found when nothing loaded them.

## Tests

```sh
npm install && npx vitest run --coverage        # the kit's own tests, 100% lines, branches, functions, statements
cd example && npm ci && npm run check            # end to end
```

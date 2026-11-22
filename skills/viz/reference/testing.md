# Testing a viz

`viz verify` is the test runner. Every viz gets its smoke run (it loads, no console errors, a
clean layout audit). A viz that **computes what it shows** gets more: verify requires its own
tests, runs them, compares its screenshots and holds its coverage.

**How to write the tests — scope, stand-ins, GWT, flaky and slow, coverage, baselines — is the
`r2-testing-paradigm` skill.** This file is only how verify runs them.

## Contents
- Does this viz need its own tests?
- Writing the tests
- Screenshots
- Coverage
- When a test fails
- Exit code

## Does this viz need its own tests?

> **If it computes what it shows from the user's input or from a live system, it needs journey
> tests. If it only reveals content fixed when it was written, the smoke run is enough.**

Verify decides this for you from what the page does:

| Signal | Example |
|---|---|
| an `api.ts` beside `index.html` | a dashboard over live data |
| calls its own `api/` or `_log/` routes, or another host, while loading (the feedback widget's `/_log/feedback` doesn't count) | a status page |
| real form controls, hidden ones included (not code samples, not disabled) | a generator, a calculator, a filter |

Navigation isn't input: steps, tabs, expand/collapse and hover don't count, and don't show up
as form controls anyway. When the detector is wrong, say so in `index.html`, and say why:

```html
<meta name="viz:tests" content="smoke: the slider only scrubs a fixed timeline">  <!-- not an app -->
<meta name="viz:tests" content="app">                                               <!-- an app the detector missed -->
```

An opt-out without a reason fails. A **mirror** (a copy of a viz kept in another container,
ADR 0006) is never asked for tests: its source container owns them.

## Writing the tests

`tests/*.test.ts` (or `.js`/`.mjs`) beside `index.html`, run by vitest on Node inside verify.
Each file gets a `viz` global, and `describe`, `it`, `expect` and the hooks are globals too; importing them from `vitest` is fine (a viz has no `node_modules`, so verify resolves `vitest` to the skill's copy):

```ts
import { describe, it, expect } from "vitest";

describe("the greeting", () => {
  it("should greet the user by the name they type", async () => {
    const page = await viz.given("the page", () => viz.open());   // viz.open({ type: "wifi" }) → #<JSON> hash, as kit links are

    await viz.when("the user types their name", () => page.type("#name", "Ada"));

    await viz.then("the page greets them by it", async () => {
      expect(await page.$eval("#out", (e) => e.textContent)).toBe("Hello, Ada!");
    });
    await viz.then("it looks as approved", () => viz.screenshot(page, "greeting", { selector: "#out" }));
  });
});
```

- **Every test is GIVEN, then WHEN, then THEN, written as steps.** `viz.given`, `viz.when` and `viz.then` take the
  sentence and a function. Each runs the function, hands back what it returned (that is how a value reaches the next
  step) and, if it throws, starts the failure message with `GIVEN|WHEN|THEN <sentence> —`, which verify prints. A step
  with no function is only its sentence. A second clause is a second step of the same kind. Give an assertion step a
  block body: a one-line `() => expect(…)` drops its own line from the failure's excerpt. Never `await viz` itself
  (it throws: `viz.then` is a step, not a promise). Every step's time (wall-clock, including waiting on tests running
  beside it) is recorded against its own test, even in a loop of `it.concurrent`, and shows in the verify report (a
  timing line and the five slowest scenarios; `--json`: `tests.timing`) and in the living spec (`viz spec`), with
  each scenario's, feature's and the run's GIVEN / WHEN / THEN totals. `viz lint` fails a test that lacks one of the three or has them out of order.
  Keep the steps in the test itself: a step inside a helper it calls is not seen.
- Tests are **type-checked** like the page (vitest only strips types, so nothing else would): strict,
  with `vitest`, puppeteer and the DOM in scope. `expect(x).toStartWith(prefix)` is added (bun's `expect` had it). The `viz` global is typed in `lib/testing/global.d.ts`;
  a helper must not redeclare it. Code in a `page.$eval`/`evaluate` callback runs in the page, so it is
  typed with the DOM; the Cytoscape-style page globals a test reaches need a small `declare global` of their own.
- A journey test drives the page through `viz.open()`; a function-scope test imports the module
  directly, no browser — the QR generator's `content.ts` is the example.
- `viz.open(hash, { before: (page) => … })` runs `before` ahead of the page loading — for
  request interception. `{ width, height }` sets the viewport (default 1280×800). `page.errors`
  holds uncaught page errors; `viz.url` and `viz.dir` are the served page and the viz's folder.
- Waiting on the page: `page.locator(sel)` and `waitForFunction` (the QR generator marks
  `#frame[data-film="done"]`).
- Every test runs on every verify. Mark independent tests `it.concurrent`: verify runs one page per
  CPU core at once, each in its own browser context (its own storage, and never a background tab,
  which gets no animation frames).
- A page closes when the test that opened it ends; no `page.close()` needed. One opened in `beforeAll` lives to the end of its file. This holds for every kind of test, concurrent or not.
- Motion off, for the end state: `page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }])`
  (if the page honours reduced motion).
- Anything else in `tests/` (helpers) is yours; only `*.test.*` files run.

## Screenshots

`viz.screenshot(page, name, { selector, mask, maxDiffPixels = 0, threshold = 0.2 })` compares with
`tests/__screenshots__/<name>.png`. A **new** or **changed** picture waits in
`tests/__screenshots__/.pending/` and the test fails until a person has looked at it.

```
viz shots <viz>                  # what's waiting
viz shots <viz> --open           # look: side by side (left|right or top/bottom), swipe at any
                                 # angle, blend, flicker, and a diff that's redder the more a pixel
                                 # changed (or black-and-white). A approves, R rejects.
viz shots <viz> --approve <name|all>
viz shots <viz> --reject <name|all>
```

`viz verify --update-snapshots` skips the diff and overwrites every baseline with what the tests
shoot on that run — changed or not — so look at `viz shots --open` first. Don't commit `.pending/`.

`mask: ["#clock"]` covers each selector with a solid magenta box before the picture is taken, in
the baseline and every run.

## Coverage

Verify measures the viz's own scripts — what the page ran in Chrome, plus what the tests imported
directly — as **lines and branches**, and holds both with a floor in `.verify/floor.json`:

- either more than 0.3 points below its floor → verify fails (browser-measured coverage wobbles by ~0.2 on unchanged code, so a run just under is not a loss);
- either above it → the floor rises to meet it. Lowering it is an edit to that file.

The first run creates the file, so commit it (the rest of `.verify/` is git-ignored; a floor still at the old `tests/coverage-floor.json` is moved there on the next run). Coverage is only measured after a green test run,
so a failing run leaves no fresh report. A page script written in TypeScript must be a module (any `import` or `export`; `export {};` will do) and loaded with `<script type="module">`, or it can't be measured and verify fails. Code with no branches scores 100% on branches.

**`.verify/tests/coverage.txt`** lists, per file, every line no test ran (with its code) and
every line with a way through it no test took — that's the to-do list.

**`.verify/tests/coverage.html`** is the same, to click through: pick a line to see which tests ran it, pick a
test to light up everything it ran. It flags lines only one test runs (remove that test and they're
uncovered) and tests with no line of their own (every line they run, another test runs too). `coverage.json` is the data.
A test is found from the call stack of `viz.open()`, so it works with `it.concurrent`; a test written
in a loop is one test (`should scan: ${id}`), and a page opened in a `beforeAll` is credited to its
`describe`. Code the tests import directly is credited to "the unit tests" as a whole — Istanbul counts it once per test file, not per test.

An exclusion without a reason fails verify:

```js
/* c8 ignore next -- only runs in browsers without a built-in QR decoder */
/* c8 ignore next 3 -- <why> */
/* c8 ignore start -- <why> */ … /* c8 ignore stop */
```

The report prints every exclusion with its reason.

Only lines with code count — not blank lines, comments or lines of only closing brackets. Not measured: inline `<script>`s, `vendor/`, `tests/`. What the page loads in Chrome is measured by V8 (lines and branches, per test); what the tests import directly is instrumented by Istanbul (the kit's Vite plugin, `lib/testing/vitest.config.ts`), also lines and branches. A file both load keeps Chrome's branches, so a pure module the page also loads and a unit test alone covers can report fewer branches than it really has covered. And Chrome only knows the branches of functions that ran, so the
branch total grows as tests reach more code.

## The living spec

Every verify test run also writes `.verify/tests/spec.html` (the page for people) and `spec.md` (the index agents
read before changing code) beside `coverage.html`. They are generated from the tests, so they cannot drift: each
`describe` is a feature, each `it` a scenario, the sentences of its `viz.given` / `viz.when` / `viz.then` calls its
steps (the sentence, not the code inside), with pass/fail from the run and the files each scenario ran, linked into
`coverage.html` with that test selected. `viz spec <viz>` prints `spec.md` (`--open` opens the html); a bare slug works
if only one viz has it. It adds no rule of its own: lint already fails a test without its three steps.

- **A looped test** (`` it(`should scan: ${id}`) ``) or `it.each` shows one scenario per iteration once a run exists,
  under its real name, all sharing the steps as written and the loop's coverage.
- **Times**: a scenario shows its total, a GIVEN / WHEN / THEN split bar and each step's time; each feature heading and
  the page headline show the totals per kind, and the headline both the wall-clock and all tests' time added up (more,
  because tests overlap). A failed step shows the time until it threw, a "not reached" one none. A run with no step
  records (`viz audit`, an old run), or two tests sharing a title in a file, shows no times and no error.
- **A failing scenario** shows how far it got. A step that throws starts its error `THEN <sentence> —`, so that step is
  ✗, those before it ✓, later ones "not reached". A failure outside any step (a timeout) marks only the scenario.
- **No results** (a verify that did not run the tests, e.g. `viz audit`, clears them) shows grey "not run", never green.
- **Coverage** is per scenario for browser tests. Unit tests (code the tests import directly) show a "unit tests
  together" chip: the counters are shared by the tests of a file. Coverage is only measured off a green run, so after a red run the
  spec has no coverage links.

Reading is `lib/testing/spec.ts`, which joins vitest's results file (`.verify/tests/results.json`, the json reporter: every test with its real name,
line, status, error and duration), the `steps-*.json` files preload.ts writes (each step's time, under the id of the test the runner's scope says it ran in) and `coverage.json`. See ADR 0027.

## When a test fails

The error names the test and why. A test that ran alone also leaves a **video** of its pages
(`.verify/tests/videos/…webm`, named in the error; needs ffmpeg on PATH). A test that ran beside others is not filmed (a
a screencast is an ffmpeg process per page; sixteen at once cost more than they show). Full output:
`.verify/tests/tests.txt`, in the viz's own folder.

## Exit code

A failing run — an error, a layout finding, a failed test, coverage below its floor — exits 1,
and `--commit` refuses it. A clean run exits 0.

## Moving a viz's tests from bun to vitest

A viz written for the old runner changes in these places:

1. `import … from "bun:test"` becomes `from "vitest"` (or drop the import: `describe`, `it`, `expect`, `beforeAll` … are globals). `expect(x).toStartWith(p)` still exists.
2. `Bun.sleep(ms)` becomes `await setTimeout(ms)` from `node:timers/promises`; `Bun.spawn(cmd)` becomes `run(cmd)` from the skill's `lib/proc.ts` or `node:child_process`; `import.meta.dir` becomes `import.meta.dirname`.
3. A test that spawns `bun` runs `process.execPath` (Node) instead. A child test run is `node <skill>/node_modules/vitest/vitest.mjs run --config <skill>/lib/testing/vitest.config.ts --root <viz> tests/<file>`, with `VIZ_URL`, `VIZ_DIR` and `VIZ_OUT` set.
4. Delete `bunfig.toml`, `bun.lock` and any `types: ["bun"]`: a viz is checked against Node's types (`@types/node`).

An unhandled promise rejection fails the run (exit 1) in vitest as it did in bun.
5. An `import()` inside a callback sent to the page (`page.evaluate(() => import(url))`) is rewritten by vitest to a loader the page does not have (`__vite_ssr_dynamic_import__ is not defined`). Write `new Function("u", "return import(u)")(url)` there.

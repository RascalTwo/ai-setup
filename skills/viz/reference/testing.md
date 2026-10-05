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

`tests/*.test.ts` (or `.js`/`.mjs`) beside `index.html`, run by `bun test` inside verify.
Each file gets a `viz` global:

```ts
import { describe, it, expect } from "bun:test";

describe("the greeting", () => {
  it("should greet the user by the name they type", async () => {
    // GIVEN the page
    const page = await viz.open();                 // viz.open({ type: "wifi" }) → #<JSON> hash, as kit links are

    // WHEN the user types their name
    await page.type("#name", "Ada");

    // THEN the page greets them by it
    expect(await page.$eval("#out", (e) => e.textContent)).toBe("Hello, Ada!");
    // THEN it looks as approved
    await viz.screenshot(page, "greeting", { selector: "#out" });
  });
});
```

- Tests are **type-checked** like the page (`bun test` only strips types, so nothing else would): strict,
  with `bun:test`, puppeteer and the DOM in scope. The `viz` global is typed in `lib/testing/global.d.ts`;
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

- either below its floor → verify fails;
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
`describe`. Code the tests import directly is credited to "the unit tests" as a whole — bun measures
coverage per run, not per test.

An exclusion without a reason fails verify:

```js
/* c8 ignore next -- only runs in browsers without a built-in QR decoder */
/* c8 ignore next 3 -- <why> */
/* c8 ignore start -- <why> */ … /* c8 ignore stop */
```

The report prints every exclusion with its reason.

Only lines with code count — not blank lines or comments. Not measured: inline `<script>`s, `vendor/`, `tests/`. Branches are only seen by Chrome — `bun test`
counts lines, not branches — so a pure module tested mostly by direct unit tests reports fewer
branches than it really has covered. And Chrome only knows the branches of functions that ran, so the
branch total grows as tests reach more code.

## When a test fails

The error names the test and why. A test that ran alone also leaves a **video** of its pages
(`.verify/tests/videos/…webm`, named in the error; needs ffmpeg on PATH). Concurrent tests get none: the
video is paired with its test by output order, and overlapping tests have no order. Full output:
`.verify/tests/tests.txt`, in the viz's own folder.

## Exit code

A failing run — an error, a layout finding, a failed test, coverage below its floor — exits 1,
and `--commit` refuses it. A clean run exits 0.

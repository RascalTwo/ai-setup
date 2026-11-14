# Testable apps

For anything a person or a browser uses. These rules make an app testable as its user sees it, which is what `r2-testing-paradigm` asks for ("Black box").

## Find things the way a user does

**The locator rule.** A test finds an element only by what a user can perceive: its **role and accessible name** (`getByRole('button', { name: 'Save' })`), its **label** (`getByLabel`), its **visible text** (`getByText`), its **alt text** (`getByAltText`), its **title** (`getByTitle`), or its **ARIA state** (`checked`, `expanded`, `selected`, `pressed`, `disabled`, `level`). Never by test id (`data-testid`), CSS selector, `id`, class name, XPath, DOM structure, or `data-state` and other private attributes.

**Why:** a user can't see a test id or a class. A test that finds a button by its role and name breaks only when a user would notice; a test that finds it by class breaks on a restyle and passes when the button loses its label. Finding by role also proves the element is exposed to screen readers.

**Sources:** Airtable Post Planner (19 `getByRole` in journeys, 63 in component tests, zero CSS or test ids), Joseph's decision (spec v2). Existing suites that break the rule (Wizard Studio, Timeline Studio, Loan Bank) are migrating.

**Enforced:** not enforced yet as a gate; the `test-reviewer` agent flags it (`skills/r2-testing-paradigm/reference/reviewing.md`). A lint rule banning `data-testid`, `locator('<css>')`, `$(`, `#id` and XPath in test files is the planned gate (`skills/r2-testing-paradigm/reference/enforcement.md`).

The rule is for tests. A script that drives a page for another purpose (generating images, scraping) may use any selector.

When a test can't find an element by any of these, the app is missing something a user also needs: give the element a real label, role or visible text. A `data-testid` is never the fix.

## Hooks the app provides

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| Every control has an accessible name: a `<label>`, visible text, or `aria-label` when there is no text | the locator rule needs it; so does a screen reader | Airtable; jsx-a11y in Timeline Studio, Wizard Studio, Airtable, Loan Bank, steno | jsx-a11y lint |
| Use native elements and roles (`<button>`, `<a href>`, `<input type=checkbox>`, headings in order) before ARIA | native roles come for free and are what `getByRole` sees | same | jsx-a11y lint |
| Results and messages go in a live region (`role="status"` or `role="alert"`); loading sets `aria-busy` | a test (and a screen-reader user) waits on what the page announces, not on a timer | Airtable, scratch app | not enforced yet |
| Accessibility is checked in browser tests with axe | regressions in names and roles fail a run | Loan Bank (every story), steno browser suite | candidate wiring per repo |

## Shapes that keep tests simple

| Rule | Why | Sources | Enforced |
|---|---|---|---|
| The server decides truth (permissions, totals, state); the UI shows what the API says | the UI has nothing to get wrong, so journeys test behaviour, not duplicated logic | Timeline Studio ADRs `2026-08-20-use-a-server-authoritative-command-log` and `2026-09-19-treat-the-api-as-the-product`, Loan Bank `canEdit/canDelete/canSubmit`, unified-graph-mcp | review |
| Components stay plain: props in, events out, no fetching inside leaf components | a component test needs no network stand-in | Wizard Studio, Airtable | review |
| Required config fails loudly at startup (a missing setting stops the app with its name) | a missing setting must never become a blank page or a wrong default | Timeline Studio `s3.ts`, sai-github-automations, steno, Python services | a test per app |
| One build, config read at runtime (written at deploy, not built in) | the bundle you test is the bundle you ship | Wizard Studio `/wizard-config.json`, Loan Bank `config.js` | not enforced yet |
| One set of fakes serves the dev server and the tests | dev and test can't drift apart | Wizard Studio `web/dev-fakes.ts`, Airtable `web/fake-api.ts` (mirrored by `page.route`), Loan Bank stories | review |
| Fakes are kept honest by a contract check against the API's schema | a fake that drifts from the real API makes tests lie | Wizard Studio `contracts.test.ts`, Timeline Studio `openapi.test.ts`, Loan Bank `api-types:drift`, steno `api-types.sh --check` | a test |
| Browser tests fail on any console error, page error or failed request | silent breakage shows up as a red test | Wizard Studio `journeys.test.ts`, viz `verify` | a fixture |

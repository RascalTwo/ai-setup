# Get an existing repo in line

For "get this in line with my stack". The output is a gap table Joseph approves before anything changes, then one piece at a time, each proven by a gate that fails.

1. **Name the kinds.** List each program in the repo (web app, server, CLI or script, Python, or something with no kind page) and its folder. A program built on another framework than the kind page names (a Next.js site, Express routes) keeps its kind; moving framework is a row of its own (step 3.7). **Done when** every program is named.
2. **Audit.** For each program, go down [`shared.md`](shared.md) (or [`kinds/python.md`](kinds/python.md)), [`test-stack.md`](test-stack.md), [`testable-apps.md`](testable-apps.md) if it has a UI, and its kind page. For each rule, record: meets it, partly, or missing, with the file that shows it. Programs that share one toolchain (one `package.json`, one `pyproject.toml`) are audited once for the shared rules. A rule about tests in a repo with no tests is "missing". Also list every `#!/usr/bin/env bun`, `bun` script and `puppeteer` import. List candidates and "not decided yet" items separately without pricing them. Read, change nothing. **Done when** every rule has a verdict and evidence.
3. **Write the gap table**, in this order, cheapest and most protective first:
   1. the check command, hook and CI (so every later piece is gated)
   2. format, lint, types, exact pins, ESM, Node version, zod at boundaries
   3. tests run by the right runner, one result list
   4. coverage (Istanbul, merged, floor) and per-test coverage
   5. the locator rule and Given / When / Then
   6. screenshots and approval
   7. runtime moves (Bun to Node, puppeteer to Playwright) and framework moves

   Gate meta-tests ("tested both ways", the strict-flag pin) land with the test runner in row 3. A framework move whose target isn't on a kind page (a Next.js site's future) is a question for Joseph, not a row to size. A move that blocks an earlier row (types can't go strict until the framework upgrade lands) goes first, as its own task.

   Each row: the rule, today's state with evidence, the change, its size (S: under an hour; M: up to half a day; L: more, or its own task), and what Joseph would notice ("nothing visible" is a fine answer). Show it to Joseph and wait. **Done when** he has approved the rows to do.
4. **Add one piece at a time.** For each approved row: make the change, then **plant a violation** (a `data-testid` locator, a lint error, a dropped strict flag, an uncovered line, a changed screenshot) and watch the check command fail on it, then remove it. A gate you haven't seen fail isn't a gate. **Done when** each piece has failed once on purpose and passes now.
5. **Record drift you didn't fix** (left on purpose, or out of scope) in the repo's notes so the next audit doesn't rediscover it.

Large moves (driver migration, Bun to Node, a framework change) become their own tasks rather than rows done in one sitting.

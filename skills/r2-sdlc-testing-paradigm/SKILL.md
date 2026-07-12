---
name: r2-sdlc-testing-paradigm
description: The opinionated testing philosophy used by the r2-sdlc pipeline. BDD-first (behavior over units), minimum mocks, fakes over mocks, Given/When/Then formatting. Use when writing new tests OR when reviewing tests for adherence to the paradigm. Covers the mock-vs-fake decision, unit-vs-behavior tradeoffs, and the black-box testing philosophy.
---

# Testing Paradigm

This is the opinionated testing philosophy for r2-sdlc. It applies both when **writing tests** (implementation phase) and when **reviewing tests** (test-reviewer subagent). Writers follow these rules; reviewers enforce them.

## Core philosophy: black box

Test as if you don't know how the code works. You are a **user** of the thing being tested. "User" is context-dependent:

- For a UI: a human clicking around.
- For an HTTP API: a consumer making requests.
- For a library function: a caller of the function.
- For a CLI: a shell invocation.

The test's job is to exercise the code the way a real user would and assert on observable outcomes — not on internal structure.

## The preference hierarchy

Tests fall on a spectrum from **most real** (expensive, highest confidence) to **most isolated** (cheap, lowest confidence). Always start at the most-real end and move down only when forced to.

1. **Real end-to-end against a real environment** — best when feasible.
2. **Behavior tests with locally emulated backends** (e.g. MSW for HTTP, an in-process DB, a local SQS emulator). The code under test doesn't know it's not real.
3. **Behavior tests with fakes** — working stand-in implementations of dependencies (in-memory repository, hand-written fake client). Not a mock: a fake has working logic that matches the real thing's contract.
4. **Unit tests for genuinely complex pure-ish functions** — only when the thing under test has enough input/output combinations (date math, parsing, state machines, scoring algorithms) that exercising them through higher layers would be tedious or miss coverage. Unit tests are a *legitimate and sometimes preferred* tool for this specific case.
5. **Traditional mocks (call-and-return stubs)** — last resort. If you find yourself writing `expect(fn).toHaveBeenCalledWith(...)` for its own sake, you're testing implementation, not behavior. Use a fake instead.

**The fake-vs-mock distinction matters.** A mock says "when called with X, return Y, and I'll assert you were called." A fake says "here's a working-enough version of the dependency that behaves like the real thing." Fakes let you write behavior tests; mocks force you to write structure tests.

## A test that cannot fail is a useless test

If you can delete the implementation and the test still passes, the test is not testing anything. Red-green-refactor prevents this by construction — you must watch the test fail for the right reason before writing the implementation. But it's worth stating standalone because it's the single most common way tests become theater.

Symptoms of can't-fail tests:
- Tautologies: `expect(x).toBe(x)`
- Missing or trivial assertions: test body runs code but never asserts anything meaningful
- Stubs that always return the expected value, then assertions against that value
- Tests that pass whether or not the code under test is invoked

If the red phase never actually fails for the right reason, the test has a bug. Fix the test before writing implementation.

## Vertical slices, not horizontal — default

**Default mode: write one test, make it pass, then write the next.** Don't bulk-generate a batch of tests up front and then bulk-implement against them. AI agents have a strong pull toward this — it feels productive — and it produces the worst kind of tests.

Why: tests written before the implementation exists are tests of *imagined* behavior. They tend to assert on the *shape* of things (data structures, function signatures) because that's all you have to go on. They become insensitive to real changes — passing when behavior breaks, failing when behavior is fine. The minute you discover something during implementation, every test ahead of you needs revising.

Tests written one-at-a-time, immediately after the implementation cycle that produced them, test what *actually* matters because you just learned what mattered.

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5

RIGHT (vertical):
  RED → GREEN: test1 → impl1
  RED → GREEN: test2 → impl2
  ...
```

**Override:** if the user explicitly asks for horizontal — e.g. "draft all the test cases up front so I can review them," or "I want a test scaffold for X before any impl" — do horizontal. The user's call wins. But never default to it on your own.

## Given / When / Then format

**Every behavior test follows Given/When/Then.** Verbs are ALL CAPS.

### Multiple clauses: repeat the verb, never use AND

Correct:
```
GIVEN a user with no session
WHEN they request the dashboard
THEN they are redirected to /login
THEN a login-required event is logged
```

Wrong:
```
GIVEN a user with no session
WHEN they request the dashboard
THEN they are redirected to /login AND a login-required event is logged
```

The same rule applies to GIVEN and WHEN if there are multiple.

### How GWT expresses in code

Two options — one rare, one common.

**Option A — Gherkin-style step helpers (preferred when the library supports it).**

If the testing stack provides `given()`/`when()`/`then()` helpers (cucumber-js, or a custom in-repo setup), use them. Each clause becomes a function call that takes the prose description:

```ts
it("should redirect an unauthenticated user to the login page and log the event", () => {
  given("a user with no session", () => { /* setup */ });
  when("they request the dashboard", () => { /* action */ });
  then("they are redirected to /login", () => { /* assert */ });
  then("a login-required event is logged", () => { /* assert */ });
});
```

This is rare — most projects don't emulate Gherkin in code. **Don't invent machinery just to get this form.** If the stack doesn't have helpers, use Option B.

**Option B — section-marker comments (the common case).**

Use comments to mark sections, **but the comment must contain the clause, not just the verb**. The comment is the rest of the sentence.

Correct:
```ts
it("should redirect an unauthenticated user to the login page and log the event", () => {
  // GIVEN a user with no session
  const app = buildTestApp({ session: null });

  // WHEN they request the dashboard
  const response = request(app).get("/dashboard");

  // THEN they are redirected to /login
  expect(response.status).toBe(302);
  expect(response.headers.location).toBe("/login");

  // THEN a login-required event is logged
  expect(logger.events).toContainEqual({ kind: "login-required" });
});
```

Wrong — bare markers with no clause:
```ts
// GIVEN
const app = buildTestApp({ session: null });
```

### Test naming: `test()` vs. `it()`

The function you call determines the grammar of the title.

**`test(...)`** takes a descriptive declarative:
```ts
test("unauthenticated user sees login redirect and logs the event", () => { ... });
```

**`it(...)`** reads as "it **should** ..." — the string is a grammatical continuation:
```ts
it("should redirect an unauthenticated user to the login page and log the event", () => { ... });
```

Don't mix these. If the file uses `it`, write "should ..." titles. If the file uses `test`, write declarative titles. The grammar has to match the caller.

## When unit tests are the right call

Don't apologize for unit tests on genuinely complex pure-ish logic. Legitimate cases:

- Date math (timezones, DST, fiscal-year rollovers)
- Parsers, formatters, tokenizers
- Pricing/tax/scoring calculations
- Any function with N×M input combinations where each matters

For these, a behavior test would need to synthesize dozens of scenarios through the full stack. Unit-test the function directly, exhaustively. These tests are **still GWT-formatted** and still test observable output — they just target a narrower "user" (the function's caller).

## Anti-patterns to reject

A test-reviewer should flag:

- **Mocks-in-place-of-fakes** when a fake would work. "I mocked `fetch` to return `{ok: true}`" → should be an MSW handler or a fake client.
- **Implementation-asserting mocks.** `expect(repo.save).toHaveBeenCalledWith(...)` without a behavioral outcome test. Tests the call, not the effect.
- **GWT missing or malformed.** No GWT, or uses AND for multiple clauses.
- **Leaky abstraction.** A behavior test reaches into internals (private methods, impl details) to assert.
- **Tests that can't fail.** Tautologies (`expect(x).toBe(x)`), missing assertions, or tests that pass whether or not the code runs.
- **Bulk-written tests (horizontal slicing).** A batch of tests written before any implementation. They smell of imagined behavior — assertions on shapes/signatures rather than real outcomes. See "Vertical slices, not horizontal — default" above.
- **Over-mocking destroying the test's value.** When 80% of a test is setup-and-mocks and 20% is assertion, the assertion is usually on mocks, not behavior.
- **Wrong layer of "user."** A test claiming to be behavior-level but actually testing a private helper.

## When finding vs. writing: reviewer guidance

When reviewing existing tests:

1. For each test, ask: **who's the user, and what behavior is this exercising?** If you can't answer in one sentence, the test is muddled.
2. Ask: **would this test catch the bug it was written to prevent?** If not, it's theater.
3. Ask: **is there a simpler version of this test that uses fewer mocks?** If yes, propose it.
4. Report findings as a prioritized list — severity (blocking / nit) + location + suggested fix.

## When in doubt

Default to the highest-real-ness tier the project can support. A behavior test with a fake is almost always better than a unit test with mocks, unless you're in the "complex pure-ish function" case above. When the choice is between more tests and more-real tests, choose more-real — one high-signal behavior test beats five implementation-asserting mocks every time.

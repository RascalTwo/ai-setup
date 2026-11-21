# Writing a test

## The loop

**red → green → refactor → break it → green**, one test at a time.

1. **Red** — write one test and watch it fail *for the reason you expect*. A test that fails on a
   typo or a missing import hasn't been red yet; fix the test.
2. **Green** — write only enough code to pass it.
3. **Refactor** — tidy the code and the test while green.
4. **Break it** — break the code the test covers (flip a condition, drop a line, return early) and
   watch the test go red. If it stays green, the test is checking something else; fix the test.
5. **Green** — restore the code.

Then the next test. When the whole change looks done, run the mutation sweep
([`coverage-and-mutation.md`](coverage-and-mutation.md)).

## Vertical slices

One test, its implementation, then the next. Tests written in a batch before the code exists are
tests of *imagined* behaviour: they assert on shapes and signatures because that is all there is
to go on, and every discovery during implementation invalidates the ones ahead.

```
horizontal:  RED test1..test5  →  GREEN impl1..impl5
vertical:    test1 → impl1,  test2 → impl2,  …
```

When the user asks for the test cases up front ("draft them so I can review", "scaffold first"),
write them up front.

## GWT in code

```
GIVEN a user with no session
WHEN they request the dashboard
THEN they are redirected to /login
THEN a login-required event is logged
```

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

**Step helpers** (`given("…", () => …)`, `when(…)`, `then(…)`) are fine where the stack already
has them. Adding them, or Gherkin/Cucumber, is not adopted yet: whether the extra machinery pays
for itself is unproven, and a trial (`viz-gwt-as-code`) is deciding. Until it reports, use
comments.

## Titles: `it` vs `test`

The function sets the grammar.

- `it("should redirect an unauthenticated user to the login page", …)` — reads as "it should …".
- `test("unauthenticated user is redirected to the login page", …)` — a declarative statement.

One style per file.

## Independent judges

The check must come from somewhere other than the code under test.

- **Expected values** come from a known-good literal, a worked example, or the spec.
  `expect(add(a, b)).toBe(a + b)` recomputes the answer the way the code does and can never
  disagree with it.
- **Outputs** are checked by something other than the system that produced them: decode a
  generated QR code with a separate decoder rather than trusting the page's own check; read the
  database, the file or the rendered page rather than the code's return value about it.

# Coverage and mutation testing

Three signals, three different questions. None answers the others.

| Signal | Question | Role |
|---|---|---|
| Journey coverage | Does every user workflow have a test? | the quality signal |
| Line + branch coverage | Is there code no test runs? | a gate |
| Break-it / mutation | Would the tests notice if the code were wrong? | proof the tests can fail |

## Journey coverage

List the workflows users actually perform and check each has a test at journey scope. This is
the primary measure of whether the suite protects anything.

## Line + branch coverage — a gate, not quality

Covered means a test *ran* the line, not that anything *checked* it. A suite can be 100% covered
by tests that assert nothing. So coverage is a gate against untested code, never evidence of good
tests.

- **Aim for 100% of lines and branches.**
- **Hold a floor that only rises.** Below the floor fails; above it, the floor rises to meet it.
  Lowering it is a deliberate, reviewable edit.
- **Test the gate both ways** ([`enforcement.md`](enforcement.md)): below the floor fails, at it passes.
- **Use attribution when the tool offers it** (which tests ran which lines): a line only one test
  reaches is fragile, and a test that runs nothing unique may be redundant — or may be the only
  one asserting on it, which coverage can't see.

## Exclusions

Every exclusion carries its reason on the exclusion itself ([`enforcement.md`](enforcement.md)):

```js
/* c8 ignore next -- only runs in browsers without a built-in QR decoder */
```

Reports list every exclusion with its reason, so a reviewer sees them together.

## Mutation testing

A **mutant** is the changed code broken on purpose: a flipped condition, a dropped line, an early
return, a changed constant. Every mutant must turn at least one test red. A mutant that survives
is a behaviour no test would catch.

**When:** once the change looks done — after the last red → green → refactor → break-it cycle,
before review. Break-it is the same check per test while writing; the sweep covers the whole
change.

**Who makes the mutants**, first that applies:

1. The repo's mutation tool, if it has one.
2. The language's standard tool, brought in: Stryker (JS/TS), mutmut (Python), PIT (Java),
   cargo-mutants (Rust).
3. Agent-written mutants: 10–20, aimed at the lines the change touched, each applied, tested and
   reverted one at a time.

**Report** each surviving mutant with a verdict: killed by a new or sharper test, or explained
(equivalent mutant — no observable behaviour changed). Reviewers read the report; they don't run
the sweep.

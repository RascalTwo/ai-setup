# Reviewing tests

The rubric for added or modified tests, used by the `test-reviewer` agent and by hand. Each row
names where the skill explains it.

## For each test, ask

1. **Who is the user, and what behaviour is this exercising?** If it can't be said in one
   sentence, the test is muddled.
2. **Would it catch the bug it was written to prevent?** If not, it's theatre.
3. **Is there a more real version?** A wider scope, or a more real stand-in, at similar cost.

## Checks

| # | Check | Explained in |
|---|---|---|
| 1 | **Black box** — asserts on what the test's user observes; no private helpers, internal calls or data-structure shapes | `SKILL.md` Black box |
| 2 | **Scope fits** — journey by default; a narrower scope only when the subject is narrower; function scope only for many-combination logic | `SKILL.md` Two axes (Scope) |
| 3 | **Most real stand-in** — a mock where an emulator or fake would work is a finding (`fetch` mocked to `{ok: true}` → MSW handler or fake client) | `SKILL.md` Two axes (Stand-in) |
| 4 | **Asserts effects, not calls** — `toHaveBeenCalledWith(...)` with no behavioural assertion tests the call, not the effect | `SKILL.md` Two axes (Mock) |
| 5 | **Can fail** — no tautologies, no missing or trivial assertions, no stub returning the expected value then asserting it, no test that passes whether or not the code runs | `SKILL.md` A test must be able to fail |
| 6 | **Mutation report** — present for the change; every surviving mutant killed or explained | `coverage-and-mutation.md` |
| 7 | **GWT** — every clause present, verbs in capitals, repeated rather than joined with AND; comments carry the clause, not a bare `// GIVEN` | `SKILL.md` Given / When / Then |
| 8 | **Titles** — `it("should …")` or declarative `test(…)`, one style per file | `writing.md` |
| 9 | **Vertical slices** — a batch of tests asserting on shapes and signatures smells of being written before the code | `writing.md` |
| 10 | **No sleeps, no order** — waits on signals; independent enough to run concurrently | `flaky-and-slow.md` |
| 11 | **No retries or quarantine** papering over a flaky test | `flaky-and-slow.md` |
| 12 | **Coverage** — floor not lowered without reason; every exclusion carries one | `coverage-and-mutation.md` |
| 13 | **Baselines** — new or changed screenshots approved by a person; volatile regions masked | `visual.md` |
| 14 | **Strictness follows control** — exact values only on data the test controls | `scope-and-stand-ins.md` Environments |
| 15 | **Escape hatches** — every mock, opt-out or exclusion carries its reason | `enforcement.md` Escape hatches |
| 16 | **Setup-to-assertion ratio** — when most of a test is mock setup, the assertion is about the mocks | `SKILL.md` Two axes (Mock) |
| 17 | **Independent judges** — expected values from a literal, worked example or spec, never recomputed like the code; outputs checked by something other than the system that made them | `writing.md` Independent judges |
| 18 | **Silent failures covered hardest** — the change's quiet ways to be wrong (wrong number, dropped record) have tests | `SKILL.md` Black box |
| 19 | **Journeys covered** — every user workflow the change touches has a journey test | `coverage-and-mutation.md` Journey coverage |
| 20 | **Fan-out proven** — each path of a fanned-out request is exercised | `scope-and-stand-ins.md` Prove the paths run |
| 21 | **Auth through code** — UI login only in the test of the login UI, or where no programmatic route exists | `scope-and-stand-ins.md` Auth in tests |

## Reporting

A prioritised list: severity (**blocker** / **suggestion** / **fyi**), `file:line`, the rule
from the table, and a concrete fix.

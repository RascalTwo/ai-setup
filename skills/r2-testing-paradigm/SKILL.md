---
name: r2-testing-paradigm
description: Testing philosophy. Use on ANY test work — planning, writing, reviewing, or fixing tests; a flaky or slow test; coverage gates and exclusions; mutation testing; screenshot baselines; choosing real vs emulated vs fake vs mock; deciding what scope to test at.
rascaltwo-ai-setup:
  kind: skill
  state: false
---

# Testing paradigm

## Black box

Test as a **user** of the thing, and assert on what that user can observe. The user depends on
the scope: a person clicking a UI, a consumer calling an HTTP API, a caller of a function, a
shell running a CLI. A test that reaches past that surface — private helpers, internal calls,
the shape of a data structure — tests the implementation, and breaks when it changes while
behaviour doesn't.

Test hardest where a failure would be **silent** — a wrong number, a dropped record, a stale
cache. A failure that is loud on its own (a crash, a blank page) needs less.

## Two axes: scope, then stand-ins

Every test makes two separate choices.

**Scope — what the test covers.** Journey (a user's workflow) → service or component (one
deployable, one UI component) → function. Pick it from what the test is *about*; journey is the
default, and a narrower scope needs a narrower subject. Function scope is for logic with many
input combinations (date math, parsers, pricing, state machines): call the real function with
inputs and check outputs, exhaustively.

**Stand-in — what replaces a dependency the test doesn't own.** Use the most real one you can
get at that scope:

1. **Real** — the actual service, a real database in a container.
2. **Emulated** — provided or generated for you: LocalStack, an SQS emulator, a server driven
   by an OpenAPI spec (Microcks, Prism).
3. **Fake** — hand-written but *working*: MSW handlers, an in-memory repository, a fake client
   honouring the real contract.
4. **Mock** — call-and-return stubs (`vi.mock`, `jest.fn`). Last resort. A mock asserts that a
   call happened; a fake lets you assert on the effect. When most of a test is mock setup, its
   assertion is about the mocks.

## A test must be able to fail

A test that passes with the code broken is theatre. Every test goes **red → green → refactor →
break it → green**: break the code it covers and watch it go red before restoring. When the
change looks done, a **mutation sweep** does the same across everything it touched.

A zero-cost check before any of that: **would this still pass if every import returned
`undefined`?** If so it can't fail. The usual shapes: a weak assertion (`toBeDefined`, truthy), a
test that only checks its own mocks were called, a self-referential one (expected value computed
by the code under test), a constant pinned to itself, a fixture asserting the fixture.

## Given / When / Then

Every test reads as GIVEN / WHEN / THEN, verbs in capitals, one clause per verb; a second clause
repeats its verb. In code, a comment carries the whole clause: `// GIVEN a user with no session`.

## Where to go next

| When you are… | Read |
|---|---|
| writing a test: the loop, vertical slices, GWT in code, titles, where expected values come from | [`reference/writing.md`](reference/writing.md) |
| choosing scope or a stand-in; shared environments; auth in tests; fan-out | [`reference/scope-and-stand-ins.md`](reference/scope-and-stand-ins.md) |
| facing a flaky or slow test, or a failure you can't diagnose | [`reference/flaky-and-slow.md`](reference/flaky-and-slow.md) |
| setting or defending coverage; excluding code; mutation testing | [`reference/coverage-and-mutation.md`](reference/coverage-and-mutation.md) |
| comparing screenshots or approving a baseline | [`reference/visual.md`](reference/visual.md) |
| reviewing tests (the `test-reviewer` agent's rubric) | [`reference/reviewing.md`](reference/reviewing.md) |
| adding a gate, lint rule, escape hatch or new kind of test; choosing test tooling | [`reference/enforcement.md`](reference/enforcement.md) |

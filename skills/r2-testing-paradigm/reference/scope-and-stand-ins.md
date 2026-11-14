# Scope and stand-ins

## Why scope is the axis

Authors already think in scope ("am I testing the checkout journey, or this parser?"), and how
real the dependencies are follows from it. Scopes don't compete — a function test can't crowd out
a journey test — so the only place bad tests drive out good is *within* a scope, and that is
closed mechanically ([`enforcement.md`](enforcement.md)).

## Why stand-ins rank the way they do

A mock returning `{ ok: true }` for any request passes whatever the code sends. A fake or an
emulator rejects what the real thing would reject, so the test catches contract drift.

## Environments

**A shared, changing environment is the disease; an ephemeral environment per run or per PR is
the cure.** Other people's data, half-finished migrations and leftover rows make tests fail for
reasons unrelated to the change. Where an ephemeral environment isn't available yet, these
disciplines bridge the gap:

1. **Reference records are read-only.** Anchored records exist for tests to read; tests leave
   them as they found them.
2. **Unique names per run** (`e2e-disposable-{runId}`), so runs never collide.
3. **Assert on what you created**, found by its unique id — immune to others' residue.
4. **Membership on aggregates.** "Acme is in the table", rather than "the table has 2 rows".

**Strictness follows control.** Assert exact values on data the test controls (anchored or
created). On data it doesn't control, assert on shape.

## Auth in tests

Log in through code — an API call, a token, a session fixture. One journey test covers the login
UI itself; use UI login elsewhere only when no programmatic route exists.

## Prove the paths run

When a request fans out (a frontend calling two services, a queue feeding several consumers),
prove each path is exercised — e.g. each service's coverage is non-zero after the journey run —
rather than trusting the architecture diagram.

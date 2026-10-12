# Enforcement and tooling

## Gates, not willpower

**Gresham's law of tests: bad tests drive out good.** The easiest test to write — mock everything —
proliferates because it's easiest, and the suite ends up green and lying. Make the lazy path
**unrepresentable or blocked**; reminders and good intentions don't hold it back.

- **Gates** that fail the build: coverage floors, lint rules, "every story has a baseline",
  "a viz that computes needs tests".
- **Test every gate both ways**: see it fail on a violation and pass without one. A gate never
  seen failing may not be wired up.
- **File shape enforces the tier.** A journey test *is* a file in the journey folder with the
  journey suffix. Keep exactly one folder per scope: an in-between folder is where a half-mocked
  journey hides.
- **Hooks and generators** make the right shape the default one to type.

## Escape hatches need a reason

Every exception — a coverage exclusion, a mock where the paradigm wants a fake, an opt-out from a
gate — carries a written reason on the exception itself, checked mechanically (a lint rule, a
minimum length, a required field). A bare exception fails. The reason is what the reviewer
judges, so it sits where they will see it.

## One artifact, several jobs

Before adding a new kind of test, see whether something already written can do the job. A
Storybook story written once can be the component catalogue, the interaction test and the
screenshot baseline, so a new component doesn't bring three artifacts or three tiers. It bends
single responsibility on purpose: fewer kinds of test means fewer places for bad ones to grow.

## Tool blind spots

Every tool and technique has things it can't see, however good the tests are. Cypress doesn't
enforce CORS the way a real browser on the real domain does, so a CORS bug passes every Cypress
test. Write down your tools' blind spots and make sure something else in the ecosystem covers
each one (here: a `curl` check against the deployed origin).

## Portable tooling

Prefer test tooling that runs on every platform the suite runs on. A macOS-only dependency (Apple
Vision for decoding) was replaced with ZXing/WASM so the same tests run in Linux CI.

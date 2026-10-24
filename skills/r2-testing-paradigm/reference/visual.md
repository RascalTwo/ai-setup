# Visual tests

## A person approves every baseline

Every new or changed picture waits for a person to look at it and say whether the change is a bug
or the point. Only then does it become the baseline.

## Mask what isn't under test

Anything that changes on its own — a clock, today's date, a random id, live data the test isn't
about — is covered with a solid box in both pictures before comparing. Unmasked, the test fails
every run for nothing and becomes a flaky test.

## Keep baselines few and tight

Screenshot a few stable states, clipped to the element that matters. Every baseline is a binary
to review and store, and a full-page one churns on unrelated edits.

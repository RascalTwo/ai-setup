# Flaky and slow tests

Both are bugs, in the test or in the code. Fix both at the root.

## Flaky tests

Find the root cause; retries, quarantine and "it passes on re-run" hide a real defect, sometimes
in the product. Reproduce first: force the rare condition (slow network, a failed load, a race)
until it fails every time, then fix what that exposes.

Example: a test hung about 1 run in 25. The cause was a third-party library waiting on `onload`
with no `onerror`; forcing the load to fail reproduced it on every run, and handling the error
fixed it.

## Slow tests

Every test runs on every run, so a slow test gets fixed.

- **Wait for a signal the system gives**: a DOM attribute set when work finishes
  (`data-state="done"`), a network-idle event, a log line, a queue drained. `waitForFunction`,
  locators and polling assertions wait exactly as long as needed; a fixed sleep waits too long or
  not long enough.
- **Make tests independent**, so they run concurrently: each test sets up what it reads, shares no
  mutable state, and runs in any order.
- **Split "is the end state right" from "does it move".** Test the finished state with motion off
  (`prefers-reduced-motion`) and the animation separately, from two early frames.

## Diagnose from artifacts

A failure should be diagnosable from what the run left behind: video, DOM snapshot, network log,
console output, and an error naming what was expected. A suite that needs a re-run "with logging
on" charges a re-run tax on every failure.

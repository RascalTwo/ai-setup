# viz kit — promotion candidates

A running log of patterns noticed while building vizzes that *might* belong in the
kit. The point is to capture in the moment (cheap) but promote deliberately (a
separate review), so the kit grows from real repeated use instead of churning on
one-offs.

## How this works

- **During a viz build:** if you hand-roll something that smells generic — a
  component, a helper, a color/spacing decision you'd want consistent next time —
  add a one-line entry below. Don't stop to refactor the kit mid-build.
- **During a kit review (periodic):** scan recent vizzes + this log, and decide
  what actually graduates into `viz.js` / `viz-kit.css`. Promote a pattern once
  it's shown up in ~3+ vizzes or is clearly error-prone. Delete entries that got
  promoted or rejected.

A pattern earns promotion when it's **repeated** (re-derived across multiple
vizzes) or **error-prone** (something that caused rework). A clever one-off does
not — it just lives in its own viz.

## Format

`- [YYYY-MM-DD] <slug>: <what you re-derived> — <why it might belong in the kit>`

## Candidates

<!-- add entries here -->

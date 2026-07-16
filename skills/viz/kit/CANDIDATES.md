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

- [2026-07-16] skill-* posters: **`--c1/--c2/--c3/--c6` are byte-identical to `--accent`/`--good`/`--warn`/`--danger`** (`#58a6ff`/`#3fb950`/`#d29922`/`#f85149`) — only `--c4` (purple) and `--c5` (teal) are unique to the categorical ramp. Any viz pairing a categorical series against semantic meaning silently collapses (series-2 reads as "success", series-6 as "error"). Already caused rework: a poster themed on `--c2` went monochrome against a `--good` meter and had to be re-themed to `--c5`. Error-prone by the stated bar. Fix candidates: distinct hues for the ramp, or document the aliasing loudly in README's token table.
- [2026-07-16] skill-delegate-to-codex (+5 sibling posters): **"poster + dive" variant of the `--poster` template** — the stock template locks the page (`html,body{overflow:hidden}` + fixed `#fit`), so a card with a scrollable deep-dive below it needs a fork. The trap: `transform:scale()` doesn't shrink the layout box, so naively unlocking scroll reserves the full 630px and leaves a dead gap. Working fix: `transform-origin:top center` + `#fit{height:calc(630px * var(--s))}` + fit on `min(innerWidth/1200, 1)` (keeps the `--og` clip pixel-native). Re-derived across 6 vizzes and error-prone — a strong candidate for a `--poster --dive` scaffold flag rather than a hand-copied fork.

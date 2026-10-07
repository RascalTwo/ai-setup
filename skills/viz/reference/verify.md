# Verify — reading the output

The core loop covers the part you always do: run `viz verify` before every commit, fix
reported errors, read `latest.png` once before you finish. This file is for when you
need more than that — inspecting a specific artifact or understanding a report line.

**A viz that computes what it shows** (input, live data, an `api.ts`) also needs its own tests —
verify detects it and says so. How to write them, screenshots and the coverage floor:
`reference/testing.md`.

## Contents
- The five jobs
- The four artifacts
- The layout report
- The visual-density line
- Verifying more than one state
- Backend vizzes

## The five jobs

`viz verify` runs all five and any finding fails it. Each also runs alone, without the rest (ADR 0024):

| job | verb | failure line | needs Chrome |
|-----|------|--------------|--------------|
| audit: console, network, layout | `viz audit` | `✗ N error(s)`, layout findings | yes |
| types: `tsc` over the page, `api.ts` and tests | `viz types` | `TYPES:` | no |
| tests and the coverage floor | `viz test` | `TESTS:` | only to see if tests are required |
| lint: Oxlint, type-aware | `viz lint` | `LINT:` | no |
| format: oxfmt over `.ts`, `.css`, `.html` | `viz format` | `FORMAT:` | no |

The target is a viz id (its path under `$HOME`) or its localhost URL. One that is not a viz (a typo, or an external URL for a job that reads source) exits 2 and names where it looked; it never prints a clean result.

Loop on the cheap one that failed. `viz types`, `lint` and `format` answer in seconds; run full `verify` once at the end.

- **`viz lint <viz> --fix`** moves inline `<script>` code into `<page>.<n>.ts` files and applies Oxlint's safe fixes. What is left is yours to fix.
- **`viz format <viz> --fix`** does all of that, then writes the formatting. Run it before `viz verify --commit`.
- **A disable comment needs a reason:** `// oxlint-disable-next-line rule -- why`. One without ` -- why` fails, and (with the type-aware engine) so does one whose finding is gone.
- **Hand-aligned code** (a table of numbers, say) takes `// prettier-ignore` on the line before the statement, with a comment above it saying why. A bare ignore fails.
- **`type-aware lint skipped (…)`** means the type-aware engine could not start (some locked-down Windows machines block its binary). The ordinary rules still ran, so a clean run there is a weaker pass.

## The four artifacts

Written to `<viz>/.verify/`, the viz's own folder (it ignores itself in git, apart from the coverage floor `floor.json`) —
so verifies of different vizzes never collide; overwritten every run. All `.png`s are wiped at the
*start* of each run, so anything you read is from this run, and costs no context unless opened.

| file | what | read it when |
|------|------|--------------|
| `latest.png` | screenshot | to judge how it **looks** — and always once before you finish |
| `console.txt` | console + uncaught errors + failed requests (not media the page aborts itself) + the layout report | the run reports `✗ N error(s)` |
| `network.txt` | full request + response (headers + bodies) | a fetch/CDN/api call looks wrong |
| `dom.html` | final DOM after load + interactions | you need to inspect rendered structure |

## The layout report

Printed on every run — no opt-in, nothing to import:

```
✓ 0 error(s) — <viz>/.verify/{console.txt, latest.png, network.txt, dom.html}
⚠ 3 layout finding(s) · rendered: 17 rect, 11 path, 40 text
  text-overflow: text.nsub "Claude Haiku 4.5 · cloud twin" spills 37px past its box
  clipped: div.vsvg-label "build/dependency-graph-data.json…" is cut off by 87px horizontally
  og-card-overflow: 1 element(s) escape the card frame — div.stat-row
```

It checks a few things eyes are bad at. **Read the scope before you trust a clean run** —
each check is narrower than its name, and a silent skip looks exactly like a pass:

| check | what it actually covers | where it goes quiet |
|---|---|---|
| `text-overflow` | SVG `<text>` past a `<rect>` **in the same `<g>`** | a label owned by a `circle`/`path`/`foreignObject`, or boxed in a different `<g>` — skipped, no note |
| `clipped` | content cut off by an `overflow:hidden` ancestor (a `labelBox()` truncating mid-word looks fine in a screenshot) | a box marked `data-verify-clip-ok` (clipped on purpose), or a 1×1 box (the screen-reader-only pattern) |
| `viewport-overflow` | the **document** scrolls horizontally | vertical overflow, and any case where an ancestor clips so the document never scrolls |
| `og-card-overflow` | children escaping an element **classed** `.og-card` | the 1200×630 is never asserted, so a card of any size passes; a poster frame without that class is invisible |
| `blank-render` | **zero** marks **and** under 10 words | a rendered header plus a dead chart. Marks count by `querySelectorAll`, so `opacity:0` and off-screen still count as rendered |

**Not covered at all**, so don't read a clean run as "it looks fine": overlap that doesn't
overflow (stacked nodes, an arrow crossing a label, a tooltip over its own datum), colour
and contrast, z-order, canvas/WebGL pixel content, interaction behaviour, and data
correctness — a chart renders perfectly from wrong numbers. There are no tests for these
checks; the table is what the code does, not a promise it does it well.

**Use it to change how you iterate.** Fix the named selectors straight from stdout —
that's free. Don't burn a screenshot read hunting for overflow; the audit already found
it. Spend the screenshot on what the audit *can't* measure: spacing rhythm, visual
hierarchy, whether the thing actually reads. `⚠ 0 layout finding(s)` means "nothing is
broken", not "it looks good".

## The visual-density line

The ambition bar, measured instead of asserted:

```
◐ visual density: 6 graphical mark(s) · 3410 text chars · 1.8 marks/1k chars → prose-shaped
```

Graphical marks are `rect`/`path`/`circle`/`line`/`canvas` — the ones that can encode a
variable in space. `<text>` and `<img>` are excluded: a label isn't an encoding.

This line is **informational and never blocks a commit**, because a deck and a force
graph have legitimately opposite ratios and only you can see which one you're building.
Treat `prose-shaped` as a prompt to re-read bar 1 of **Ambition**, not as an error — and
if the words genuinely are the deliverable, ignore it and move on. Band thresholds are a
first guess; the raw counts are printed so they can be retuned later.

## Verifying more than one state

A plain run only sees the opening frame. For a click, modal or step, drop a
`verify.interactions.ts` in the viz dir; the recipe is in `reference/verify-states.md`.

## Backend vizzes

Also hit the route(s) directly: confirm live data flows and that the cached fallback
still plays. A broken `api.ts` returns a clean `api.ts failed to load: …` 500 rather
than a blank hang.

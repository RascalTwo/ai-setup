# Verify — reading the output, and driving interactions

The spine covers the part you always do: run `verify.ts` before every commit, fix
reported errors, read `latest.png` once before you finish. This file is for when you
need more than that — inspecting a specific artifact, understanding a report line, or
verifying a viz that has more than one state.

## The four artifacts

Written to `$SKILL_DIR/.verify/`, overwritten every run. All `.png`s are wiped at the
*start* of each run, so anything you read is always from this run and they never go
stale or bloat context unless you actually open them.

| file | what | read it when |
|------|------|--------------|
| `latest.png` | screenshot | to judge how it **looks** — and always once before you finish |
| `console.txt` | console + uncaught errors + failed requests + the layout report | the run reports `✗ N error(s)` |
| `network.txt` | full request + response (headers + bodies) | a fetch/CDN/api call looks wrong |
| `dom.html` | final DOM after load + interactions | you need to inspect rendered structure |

## The layout report

Printed on every run — no opt-in, nothing to import:

```
✓ 0 error(s) — .verify/{console.txt, latest.png, network.txt, dom.html}
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
| `clipped` | content cut off by an `overflow:hidden` ancestor (a `labelBox()` truncating mid-word looks fine in a screenshot) | — |
| viewport | the **document** scrolls horizontally | vertical overflow, and any case where an ancestor clips so the document never scrolls |
| `og-card-overflow` | children escaping an element **classed** `.og-card` | the 1200×630 is never asserted, so a card of any size passes; a poster frame without that class is invisible |
| `blank-render` | **zero** marks **and** under 10 words | a rendered header plus a dead chart. Marks count by `querySelectorAll`, so `opacity:0` and off-screen still count as rendered |

The mark census (`rendered: 17 rect…`) separates "rendered nothing" from "rendered wrong".

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

A plain run only ever sees state 1, which is how nearly every interactive viz in the
corpus shipped unlooked-at past its opening frame. To drive a click/modal/step before
the shot, drop a file **in the viz dir** named `verify.interactions.ts`:

```ts
export default async (page, { shot }) => {
  await shot("closed");              // → read .verify/closed.png
  await page.click(".accordion");
  await shot("open");                // → read .verify/open.png
};
```

`verify.ts` auto-detects and runs it (no flag) after load, before the final screenshot.
It's per-viz and disposable — delete it when you're done, and **never edit `verify.ts`
itself**.

**The audit samples twice when an interactions file is present** — once on the opening frame
before your script runs, once on whatever state it left behind — labelling each finding
`[opening]` or `[after interactions]`. Without an interactions file there is one sample and
findings are unlabelled. Density/census numbers come from the final state, matching
`latest.png`.

**You are not limited to the one `latest.png`.** `page` is the raw Puppeteer page, and
`shot(name)` writes an extra `.verify/<name>.png` with the path resolved for you. Snap
before *and* after a click, snap each tab, snap each step of an animation — then read
those PNGs.

## Backend vizzes

Also hit the route(s) directly: confirm live data flows and that the cached fallback
still plays. A broken `api.ts` returns a clean `api.ts failed to load: …` 500 rather
than a blank hang.

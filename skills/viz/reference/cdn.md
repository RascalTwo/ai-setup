# CDN resources — what's reachable with no install

Every viz is a plain HTML file: no build step, no bundler, no `package.json` anywhere
in the corpus. That does **not** mean no dependencies. Anything on a CDN is one line
away, resolved by the browser at load.

Read this when you want a typeface, a vendor logo, syntax highlighting, or a library
whose maths you'd rather not hand-roll.

## The idiom

An ES module, version pinned, nothing installed:

```js
import * as d3 from "https://esm.sh/d3@7";
```

CSS and non-module scripts are an ordinary `<link>` / `<script src>`.

**Always pin the version.** `@latest` resolves to a different build on different days,
so a viz that rendered last month silently breaks — and it breaks as a blank page (see
*The failure mode*). Every pinned import in the corpus still resolves; that's why.

## Two axes, two different rules

The reflex "don't add dependencies" is right for one of these and wrong for the other.

### Assets — just use them

Fonts, logos, icons, syntax themes. These don't compete with hand-rolled SVG and don't
pull you toward a framework — they're pure capability. One file each in
`reference/assets/`:

- **`assets/fonts.md`** — the kit ships system stacks; how to swap in a webfont without
  fighting the kit
- **`assets/logos-icons.md`** — vendor/product logos and monochrome brand marks
- **`assets/code-highlighting.md`** — highlight.js, and when not to bother

### Compute — make it earn its place

Measured across 251 vizzes: **~16 library imports total**, and 95% of pages are
hand-rolled SVG + CSS grid with no import at all. That ratio is the house style, not an
accident.

The test: *is this maths I'd get wrong by hand?* Layout solvers and 3D projection are.
Bars, arrows, and boxes are not.

| earned it | why |
|---|---|
| `three@0.160.0` | 3D — nobody hand-rolls a WebGL scene graph |
| `elkjs@0.9.3` | graph layout past ~5 nodes (see `reference/diagrams.md`) |
| `d3@7`, `d3-geo@3` | layout maths, scales, geographic projection |
| `marked@12`, `js-yaml@4` | parsing a real grammar |
| `reveal.js@5.2.1` | the deck runtime — see below |

**`reveal.js` is the deck runtime.** Every copy of the `deck` template, and every deck on the shared
`/_kit/deck.js`, runs on it: `deck.js` imports `reveal.js@5.2.1` (esm + the notes plugin)
from jsdelivr and maps the kit's contract onto it — `#deck` is reveal's root, `.stage` its
`.slides`, `.frag` its fragments. Don't import reveal yourself in a deck; link the kit. What
it adds over the old hand-rolled runtime:

- **speaker view** (S) — a second window with notes (`<aside class="notes">` in a slide),
  a timer and the next slide, synced over `postMessage`.
- **PDF export** — open the deck with `?print-pdf`, print to PDF: one page per slide.
- **touch swipe**, **black-out** (B), and hash deep links that also carry the fragment
  step (`#/3/2`). The kit's old `#3` links still land.

Vertical slides, auto-animate and slide backgrounds are reveal features the kit does not
wire up; a deck that needs them should say so rather than hand-patch `deck.js`.
📎 [`revealjs.com`](https://revealjs.com/) 🟢

The class `reveal` is **reserved** in a deck — it is reveal's root. The kit's entrance
cascade is `.cascade` (it was `.reveal` until the move). Gotchas, all measured:

- **Reveal transforms `.slides`** (in overview, O). A transformed ancestor re-bases
  `position:fixed` descendants, so your own fixed overlays inside the deck land relative
  to the slide rather than the viewport. Append them to `<body>`. (The injected review
  layer is already a child of `<html>`, so it is unaffected.)
- **It brings its own CSS reset and scaling**, which fight the kit's `:where()` defaults —
  `reveal.css` styles `section`, `.slides`, `.fragment` at 0-2-1 and would restyle every
  slide. So `deck.css` does **not** load it or any reveal theme: layout stays the kit's
  (`disableLayout`), and `deck.css` carries only the rules reveal's modes need (overview,
  print, black-out). Don't add `reveal.css` to a deck.
- **Reveal copies each slide's classes onto a hidden background element**, so after it
  starts `querySelectorAll(".slide")` would find every slide twice. `deck.js` strips the
  copies and starts reveal after `DOMContentLoaded`; use `window.__deckSlides` rather than
  re-querying.
- **The deck needs network** for the CDN import, published or not. For a talk on a
  flaky venue network, open it once beforehand (the browser caches the pinned file) or
  print the PDF.

**Not earned:** a charting library (the kit + SVG covers it, and `dataviz` owns the
craft rules), any framework — React, Vue and Tailwind have never appeared in a single
viz.

**Avoid `dagre`** — unmaintained since 2019; `reference/diagrams.md` says so and elkjs
replaces it. Two vizzes still import it; they predate the advice and shouldn't be
copied.

## The failure mode

**A 404'd import renders a blank page with no visible error.** The module never
evaluates, so nothing downstream of it runs — no half-drawn page, no console-visible
stack in the viewport, just white. This has cost follow-up commits before.

`verify.ts` catches it: `console.txt` shows the failed fetch and `network.txt` the 404.
**Run the render check after adding any import** — this is the specific bug that check
exists for.

## Offline

A CDN import means the page needs network to render. If a viz has to survive offline,
outlive the CDN, or ship somewhere sealed, save the file next to `index.html` and
import it relatively instead.

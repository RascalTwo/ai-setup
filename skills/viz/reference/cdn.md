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

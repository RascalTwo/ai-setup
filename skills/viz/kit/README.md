# viz kit

Shared, versioned-with-the-skill assets that every `/viz` page can load from one
source of truth. The viz server exposes this directory at `/_kit/`, so any viz
references them with absolute URLs regardless of its slug:

```html
<link rel="stylesheet" href="/_kit/viz-kit.css" />
<script type="module">
  import { arrowMarkers, connect, side, labelBox, vizAudit, $, $$, esc, saveHash, loadHash } from "/_kit/viz.js";
</script>
```

The kit is **opt-in and additive** — a viz that doesn't load it still works. Use it
so you stop re-deriving the same palette, components, and SVG math every time.

## The kit is re-themeable — read this before you decide it doesn't fit

Every color lives in one `:root` block and **every rule reads it through `var()`** —
there is not a single hardcoded hex in any component rule. So a page that needs a
brand palette, a lighter surface, or a moody one-off does **not** need to rebuild
from scratch. Override the tokens and keep everything else:

```html
<link rel="stylesheet" href="/_kit/viz-kit.css" />
<style>
  :root { --bg: #081428; --panel: #0e1c33; --accent: #37d9a0; --text: #e8f0ff; }
</style>
```

`.panel`, `.legend`, `.drawer`, `.flow`, `.viz-header`, `labelBox()` and the SVG
helpers all follow. "Dark-only" describes the **default values**, not a constraint.

Two corollaries:

- **`var()` is valid in SVG presentation attributes** — write `fill="var(--accent)"`
  and `stroke="var(--c4)"`, not `fill="#58a6ff"`. Hardcoded hexes silently opt a
  mark out of any re-theme. This works inside `<defs>`/`<marker>` too (verified by
  pixel-comparing a `var()` arrowhead against a hex one — identical).
  **The one place it breaks:** serializing an SVG *out* of the page (a data-URI
  `<img>`, a standalone `.svg` export) detaches it from `:root`, so every `var()`
  falls back to black. Inline SVG in the document — which is what every viz and the
  OG/hero pipeline actually use — is unaffected.
- **Re-theme, don't fork.** Copying the kit's rules into your page to change three
  colors is the thing this section exists to prevent.

## `viz-kit.css` — the default house style (dark)

Design tokens with **fixed names** (use these instead of re-picking hexes):

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0d1117` | page background |
| `--panel` | `#161b22` | cards / panels |
| `--panel-2` | `#21262d` | nested surface |
| `--border` | `#30363d` | hairlines |
| `--text` | `#e6edf3` | body text |
| `--muted` | `#8b949e` | secondary text |
| `--accent` | `#58a6ff` | primary / links / selection |
| `--good` / `--warn` / `--danger` | `#3fb950` / `#d29922` / `#f85149` | meaning |
| `--c1`…`--c6` | blue/green/amber/purple/teal/red | categorical series |
| `--sans` / `--mono` | system stacks | type |

Ready-made classes: `.viz-header` (`h1` + `.sub`), `.panel`/`.card`, `.drawer`
(toggle `.open`), `.legend`/`.legend-item`/`.swatch` (add `.line` for an edge
swatch, `.dot` for a round one), `.pill` (uppercase status badge; `.pill.good` /
`.warn` / `.danger` / `.accent` tint text + border together), `.flow` (animated
dashed edge), `.vsvg-label` (used by `labelBox()`).

**Three text tiers**, not two: `--text` → `--muted` → `--faint` (de-emphasized
chrome: axis ticks, units, footnotes, counters).

**⚠ The categorical ramp aliases the intent colors — by declaration, so you can see it.**
`--c1`/`--c2`/`--c3`/`--c6` are literally defined as `var(--accent)`/`var(--good)`/
`var(--warn)`/`var(--danger)`. A series drawn in `--c2` *is* the success green, so it
reads as "success" beside anything using `--good`.

The **meaning-free** slots are `--c4` (purple), `--c5` (teal), `--c7` (indigo) and
`--c8` (magenta) — each validated ≥ ΔE 15 from every intent color under
protanopia/deuteranopia simulation. **Reach for those four first** whenever a viz
mixes categorical series with semantic color; use the aliased four knowingly, or when
there's no status color on the page at all.

There is deliberately **no orange slot**: every orange sits between `--danger` (hue
27°) and `--warn` (80°) and none clears the bar — the obvious `#f0883e` is ΔE 1.5
from `--warn` to a protanope, i.e. the same color.

*Known issue, not yet fixed:* `--warn` and `--good` are themselves only ΔE 5.1 apart
under protanopia. Status colors should never be the sole signal — always pair them
with an icon or label.

## `viz.js` — helpers (ES module)

**SVG geometry (define nodes once, derive the rest):**
- `arrowMarkers(palette?)` → `<defs>` string of stable-id arrowheads (`#ah`,
  `#ah-accent`, `#ah-good`, `#ah-warn`, `#ah-danger`). Drop once per `<svg>`.
- `center(node)`, `side(node, "top"|"bottom"|"left"|"right")` → connection points
  from a `{x,y,w,h}` node.
- `connect(a, b)` → SVG path `d` between two nodes, auto-picking facing sides.
- `labelBox(node, html, cls?)` → a `<foreignObject>` label that **cannot overflow**
  (browser wraps/ellipsizes). Prefer this over raw `<text>` for multi-word labels.
- `vizAudit(root?)` → verification backstop: red-outlines any `<text>` that spills
  past the `<rect>` in its `<g>`, shows a banner, returns offenders. Call after
  render if you hand-rolled `<text>`.

**Interaction (the difference between a picture and an explorable):**
- `stepper({n, onStep, autoplayMs?, hashKey?})` → `{go, next, prev, play, pause,
  current}`. Arrow-key/Space/PageUp-Down/Home-End walkthrough driver. Clamps at both
  ends, calls `preventDefault` so the page doesn't also scroll, ignores keys typed
  into inputs, pauses autoplay on any manual nav, and round-trips the step through
  the URL hash so it survives hot-reload. ~20 vizzes hand-rolled this and each got a
  different subset right.
- `twoAxis(el, {x, y, start?, onChange, speed?})` → `{set, value}`. **Drag the
  artwork, not a slider.** One pointer drag on the figure drives two clamped
  parameters at once (pointer events, so mouse/touch/pen all work). The best
  interactive explainers on the web contain almost no `<input type="range">` — a
  slider puts UI chrome between the reader and the phenomenon; dragging the thing
  itself removes it. Deltas are normalized by element size, so sensitivity doesn't
  change with render scale.
- `figureLifecycle(figures, {root?})` → `{active, destroy}`. Each figure is
  `{el, setVisible, setActive}`. `setVisible` tracks on-screen-ness (stop drawing
  what nobody can see — many live figures will otherwise melt a laptop);
  `setActive` marks the **single most-centered** figure, which is a narrative
  device as much as a perf one — use it to run the hero animation or reveal
  controls, so the page tells the reader where to look. Also pauses everything on
  tab-hide, since background tabs throttle `requestAnimationFrame` to ~1fps and
  silently stall animation loops.

**Utilities:**
- `$`, `$$` → `querySelector` / `querySelectorAll` (array).
- `esc(s)` → HTML-escape before `innerHTML`.
- `saveHash(obj)` / `loadHash()` → persist state to the URL hash so it survives the
  hot-reload full-page refresh (and becomes deep-linkable).

## `viz-og.css` — the 1200×630 hero / OG card

Load it **after** `viz-kit.css`, in a `hero.html` beside the viz:

```html
<link rel="stylesheet" href="/_kit/viz-kit.css" />
<link rel="stylesheet" href="/_kit/viz-og.css" />
```

`bun bootstrap.ts <slug> --hero` scaffolds a `hero.html` that already does this —
start there rather than copying a sibling card.

The anatomy (what ~50 of the 94 hand-authored heroes converged on):

```
.og-card                    1200×630 — verify.ts --og CLIPS to this element
  .frame                    inset hairline border
  .left                     .eyebrow (+.dot) · .title (+.hl) · .essence · .sub · .chips>.chip (+.tk)
  .right                    .panel > .panel-cap (.t/.s) · your figure · .foot > .stat (.n/.l/.d)
```

Both columns are optional — drop `.right` for a full-bleed title card, `.left` for a
figure-only one. `.stat` takes `.good`/`.warn`/`.danger`/`.accent` to tint its number.

- **Keep the `.og-card` class.** It's a contract, not a convention: `verify.ts --og`
  clips the screenshot to that element and errors without it.
- **Safe zone.** Slack/X/Teams/WebEx/Discord centre-crop link cards, so keep anything
  that must survive inside the middle ~1080×565. `class="show-safe"` on `.og-card`
  draws the guide — remove it before shooting, it renders into the shot.
- **It re-themes with the viz.** Everything is in kit tokens, so the same `:root`
  override you put in `index.html` gives the card a matching palette. (The 94
  pre-kit heroes each declared a *parallel* palette — `--fg`/`--line` at different
  hexes from `--text`/`--border` — so a viz and its own card disagreed about what
  the background colour was.)

## Growing the kit

`CANDIDATES.md` is the running log of things noticed during viz generation that
might belong here. Add to it in the moment; promotion into the kit is a separate,
deliberate review pass (see `CANDIDATES.md`).

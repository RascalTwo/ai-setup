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

## `viz-kit.css` — the house style (dark-only, on purpose)

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
swatch), `.flow` (animated dashed edge), `.vsvg-label` (used by `labelBox()`).

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

**Utilities:**
- `$`, `$$` → `querySelector` / `querySelectorAll` (array).
- `esc(s)` → HTML-escape before `innerHTML`.
- `saveHash(obj)` / `loadHash()` → persist state to the URL hash so it survives the
  hot-reload full-page refresh (and becomes deep-linkable).

## Growing the kit

`CANDIDATES.md` is the running log of things noticed during viz generation that
might belong here. Add to it in the moment; promotion into the kit is a separate,
deliberate review pass (see `CANDIDATES.md`).

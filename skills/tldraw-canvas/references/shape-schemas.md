# tldraw shape schemas

All enums empirically derived from live tldraw.com validator responses. If tldraw ships a new version with new colors/shapes, the validator will still tell you exactly what's valid — call a helper with an intentionally-bad value and read the error message.

## Enums

```js
color:     ['black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue',
            'yellow', 'orange', 'green', 'light-green', 'light-red', 'red', 'white']
size:      ['s', 'm', 'l', 'xl']
geo:       ['cloud', 'rectangle', 'ellipse', 'triangle', 'diamond', 'pentagon',
            'hexagon', 'octagon', 'star', 'rhombus', 'rhombus-2', 'oval',
            'trapezoid', 'arrow-right', 'arrow-left', 'arrow-up', 'arrow-down',
            'x-box', 'check-box', 'heart']
font:      ['draw', 'sans', 'serif', 'mono']
dash:      ['draw', 'solid', 'dashed', 'dotted', 'none']
fill:      ['none', 'semi', 'solid', 'pattern', 'fill', 'lined-fill']
align:     ['start', 'middle', 'end']
arrowhead: ['arrow', 'triangle', 'square', 'dot', 'pipe', 'diamond',
            'inverted', 'bar', 'none']
arrowKind: ['arc', 'elbow']
```

## Registered shape types

```
group, text, bookmark, draw, geo, note, line, frame, arrow, highlight,
embed, image, video
```

This skill's helpers cover: `geo`, `note`, `text`, `frame`, `arrow`. The others (`draw`, `line`, `bookmark`, `image`, `video`, `embed`, `highlight`) are not wrapped — use the escape hatch (`window.__td.editor.createShape(...)`) if you need them.

## Per-type prop reference

### `geo` (rectangles, ellipses, diamonds, etc.)

```js
{
  w: number,                   // width
  h: number,                   // height
  geo: 'rectangle',            // shape kind (see enum above)
  color: 'black',
  fill: 'none',
  dash: 'draw',
  size: 'm',
  font: 'draw',
  align: 'middle',             // horizontal text alignment
  verticalAlign: 'middle',
  labelColor: 'black',
  richText: { type: 'doc', content: [...] },  // REQUIRED — even if empty
  growY: 0,
  url: '',
  scale: 1,
}
```

The `geo` prop is what makes it a rectangle vs. a diamond vs. a star. Text inside a geo is a label (uses `richText`). The shape renders at `x, y` with width/height set by `w, h`.

### `note` (sticky notes)

```js
{
  color: 'yellow',
  size: 'm',
  font: 'draw',
  align: 'middle',
  verticalAlign: 'middle',
  labelColor: 'black',
  richText: { type: 'doc', content: [...] },   // REQUIRED
  growY: 0,
  fontSizeAdjustment: 1,
  url: '',
  scale: 1,
  textFirstEditedBy: null,
}
```

Notes don't take `w`/`h` — tldraw sizes them automatically based on content.

### `text` (plain canvas text, no container)

```js
{
  color: 'black',
  size: 'm',
  w: 100,                     // text wrapping width when autoSize is false
  font: 'draw',
  textAlign: 'start',         // 'start' | 'middle' | 'end'
  autoSize: true,             // leave true for most cases
  scale: 1,
  richText: { type: 'doc', content: [...] },   // REQUIRED
}
```

### `frame` (visual grouping container)

```js
{
  w: 320,
  h: 180,
  name: 'Pipeline',           // plain string (NOT richText)
  color: 'black',
}
```

Frames are *not* parents of the shapes they contain. Shapes on top of a frame are just shapes on top of a frame. For logical grouping, use frames for visual affordance.

### `arrow` (arrows between shapes or points)

```js
{
  kind: 'arc',                // 'arc' (curved) or 'elbow' (right-angle)
  color: 'black',
  size: 'm',
  fill: 'none',
  labelColor: 'black',
  bend: 0,                    // how curved; 0 = straight
  start: { x: 0, y: 0 },      // initial endpoint (overridden by bindings)
  end:   { x: 2, y: 0 },
  arrowheadStart: 'none',
  arrowheadEnd: 'arrow',
  labelPosition: 0.5,         // 0..1 along the arrow
  font: 'draw',
  scale: 1,
  richText: { type: 'doc', content: [...] },  // arrow label
  elbowMidPoint: 0.5,         // for kind='elbow'
}
```

Arrows use the `bindings` system to stay attached to shapes. When you create an arrow and want it bound, create bindings via `editor.createBindings([...])` — the helper does this automatically when you pass shape IDs to `createArrow`.

## `meta` — your custom metadata

Every shape record has a `meta` object (default `{}`). You can stash arbitrary JSON-serializable data here without affecting validation. For example:

```js
td.editor.updateShape({
  id: boxId,
  type: 'geo',
  meta: { createdByPrompt: 'the user asked for a pipeline diagram' }
})
```

This is a safe channel for the skill to tag Claude-created shapes with context (provenance, intent, source prompt, etc.) without touching props. Currently the skill doesn't use `meta` — add it if the user wants traceability beyond the `shape:ai-` prefix.

## Discovering the current schema at runtime

If you're unsure whether a prop/enum exists on the current tldraw version:

```js
// Ask a shape util for its defaults
td.editor.shapeUtils.arrow.getDefaultProps()

// Force a validator error to reveal the enum
try {
  td.editor.createShape({ id: 'shape:probe'+Math.random(), type: 'geo', x: 0, y: 0, props: { color: '__bad__' } });
} catch (e) { console.log(e.message); }
```

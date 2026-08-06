# `window.__td` API reference

Exposed by `scripts/bootstrap.js`. Every function returns the shape ID (or an array of IDs) where applicable, so you can chain.

## Create

### `createBox({x, y, w, h, text, color, geo, fill, dash, size, font}) → id`

A geo shape (rectangle by default) with optional label. `geo` can be any of the values in `ENUMS.geo` — `'rectangle'`, `'ellipse'`, `'diamond'`, `'cloud'`, `'hexagon'`, `'star'`, etc.

```js
td.createBox({ x: 100, y: 100, w: 200, h: 100, text: 'Ingest', color: 'blue', fill: 'semi' })
td.createBox({ x: 400, y: 100, w: 150, h: 150, geo: 'diamond', color: 'red' })
```

Defaults: `w=200, h=100, geo='rectangle', color='black', fill='none', dash='draw', size='m', font='draw'`.

### `createSticky({x, y, text, color, size}) → id`

A sticky note. Narrower color palette is fine, but common ones are `'yellow'`, `'orange'`, `'light-green'`, `'light-blue'`, `'violet'`.

```js
td.createSticky({ x: 100, y: 300, text: 'Remember:\nidempotent writes', color: 'yellow' })
```

Defaults: `color='yellow', size='m'`. Default sticky dimensions come from tldraw itself (~200x200).

### `createText({x, y, text, color, size, font, textAlign}) → id`

Plain text without a shape container. `autoSize` is always true.

```js
td.createText({ x: 50, y: 50, text: 'ETL Pipeline', size: 'xl' })
```

### `createFrame({x, y, w, h, name, color}) → id`

A frame for visual grouping. Shapes inside a frame aren't re-parented automatically — the frame is a rectangular container but shapes live on the same page. Useful for "this section is the backend services" annotations.

```js
td.createFrame({ x: 0, y: 0, w: 900, h: 500, name: 'Pipeline' })
```

### `createArrow({from, to, text, color, size, kind, arrowheadEnd, arrowheadStart}) → id`

An arrow. `from` and `to` can be:
- **Shape IDs** (strings): the arrow gets bound to those shapes' centers and follows them when moved.
- **Points** (`{x, y}` objects): free-floating endpoints.

```js
td.createArrow({ from: boxAId, to: boxBId, text: 'calls' })
td.createArrow({ from: { x: 100, y: 100 }, to: { x: 300, y: 100 }, arrowheadEnd: 'triangle' })
```

Defaults: `kind='arc', arrowheadEnd='arrow', arrowheadStart='none', color='black', size='m'`. Use `kind: 'elbow'` for right-angle connectors.

### `richText(str) → ProseMirror doc`

Convert a plain string to a valid richText JSON doc. Preserves `\n` as separate paragraphs. You rarely call this directly — the create/update helpers call it for you when you pass `text: '...'`.

## Update

### `updateShape(id, patch) → id`

Patch takes the same shape-update format as the SDK, with one shorthand: `patch.props.text` is auto-converted to `richText`.

```js
td.updateShape(boxId, { x: 500 })                                 // move
td.updateShape(boxId, { props: { color: 'red' } })                // recolor
td.updateShape(boxId, { props: { text: 'New label' } })           // relabel (shorthand)
td.updateShape(boxId, { props: { richText: td.richText('...') } }) // long form
```

## Delete

### `deleteShapes(ids) → ids`

Delete one or more shapes by ID. Accepts a single ID or array.

```js
td.deleteShapes(boxId)
td.deleteShapes([boxId, arrowId])
```

### `cleanup() → {deleted, ids}`

Deletes **only** shapes with the `shape:ai-` prefix. Safe to run on any doc — never touches user content. Returns count + ids deleted.

```js
td.cleanup()  // → {deleted: 8, ids: [...]}
```

## Read

### `probe() → {ok, url, pageId, shapeCount, aiShapeCount, registeredTypes}`

Health check. Call after injection to confirm everything wired up.

### `readCanvas({full}) → {pageId, totalShapes, shapes}`

LLM-friendly canvas summary. Each shape has `id, type, x, y, w, h, color, text` (text is plain — richText flattened). Pass `{full: true}` to also include the raw shape object.

```js
td.readCanvas()           // summary only
td.readCanvas({full: true}) // includes raw shape JSON
```

### `plainText(richTextDoc) → string`

Extract plain text from a ProseMirror doc. Useful when reading `shape.props.richText` yourself.

## Camera + Selection

- `zoomToFit()` — fit entire page in viewport.
- `zoomToShapes(ids)` — select and zoom to specific shapes.
- `selectShapes(ids)` — select without zooming.
- `clearSelection()` — deselect all.

## Data

- `ENUMS` — the full enum dictionary (colors, sizes, geos, fonts, dashes, fills, aligns, arrowheads, arrowKinds). Use this at runtime to validate before calling helpers.
- `AI_PREFIX` — the string `'shape:ai-'` used for all created shape IDs.

## Escape hatch

- `editor` — the raw `window.editor` instance. Use for anything not covered by helpers (pages, assets, bindings, complex operations). Falling back to this is fine — the helpers aren't trying to wrap the whole SDK.

## Common recipes

**Three-box horizontal flow with labels:**

```js
const a = td.createBox({ x: 50,  y: 100, text: 'A', color: 'blue' });
const b = td.createBox({ x: 300, y: 100, text: 'B', color: 'violet' });
const c = td.createBox({ x: 550, y: 100, text: 'C', color: 'green' });
td.createArrow({ from: a, to: b, text: 'step 1' });
td.createArrow({ from: b, to: c, text: 'step 2' });
td.zoomToFit();
```

**Add a sticky note near a selected shape:**

```js
const selected = td.editor.getSelectedShapes()[0];
if (selected) {
  const { x, y } = selected;
  td.createSticky({ x: x + 300, y, text: 'TODO: review' });
}
```

**Find and recolor all boxes matching text:**

```js
const canvas = td.readCanvas();
const targets = canvas.shapes.filter(s => s.type === 'geo' && /\bold\b/i.test(s.text || ''));
targets.forEach(s => td.updateShape(s.id, { props: { color: 'red' } }));
```

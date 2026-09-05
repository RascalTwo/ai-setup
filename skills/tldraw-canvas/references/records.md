# Record construction

The shape types, props, and enums here are the same on both transports — this is
the tldraw data model, not an API. Every template was read back out of a real room,
not guessed.

**How much of each template you actually write depends on the transport:**

- **HTTP** (`transport-http.md`) — write the record **in full**. There is no
  `Editor` server-side to fill in defaults, so every envelope field and every prop
  must be present. The templates below are written for this case.
- **Browser** (`transport-browser.md`) — write a **partial**.
  `editor.createShape()` supplies `index`, `isLocked`, `opacity`, `meta`, and prop
  defaults, and the `window.__td` helpers go further still
  (`td.createBox({x, y, text})` is a complete call). Use these templates as the
  reference for *what a prop is called and what it accepts*, not as the literal
  payload.

Bindings differ the same way: over HTTP you write the binding records below by
hand; in the browser `td.createArrow({from, to})` builds them for you.

## The envelope every shape needs

```json
{
  "id": "shape:ai-box1",
  "typeName": "shape",
  "type": "geo",
  "x": 100, "y": 100,
  "rotation": 0,
  "index": "a1",
  "parentId": "page:page",
  "isLocked": false,
  "opacity": 1,
  "meta": {},
  "props": { }
}
```

- **`id` must start with `shape:`**, and everything this skill creates uses the
  `shape:ai-` prefix so cleanup can delete only its own work.
- **`parentId`** is the page id (read it from `GET /agent/room/:roomId` → `pages`)
  or another shape's id to nest inside a frame/group.
- **`index`** is a fractional-index string controlling z-order. `a1`, `a2`, `a3`…
  in creation order is fine; later letters sort above earlier ones.
- **`meta`** must be present, even empty.

## richText

Labels are a ProseMirror doc, never a string. Malformed rich text crashes the
renderer, not just the validator — see `rich-text.md`. The only form you need:

```json
{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Label"}]}]}
```

An empty label is `{"type":"doc","content":[{"type":"paragraph"}]}` — a paragraph
with no `content` key at all. A `text` node with `"text": ""` is invalid.

Reads come back with `richText` already flattened to `props.text`. That is a
*read-side convenience only* — you still send `richText` on writes.

## geo (box, ellipse, diamond, …)

```json
"props": {
  "w": 300, "h": 200,
  "geo": "rectangle",
  "dash": "draw", "growY": 0, "url": "", "scale": 1,
  "color": "blue", "labelColor": "black", "fill": "semi",
  "size": "m", "font": "draw",
  "align": "middle", "verticalAlign": "middle",
  "richText": {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Label"}]}]}
}
```

## note (sticky)

No `w`/`h` — a note self-sizes. `growY` grows it for overflowing text.

`textFirstEditedBy` is **required** and is the easiest prop to forget; omitting it
fails with `Expected string, got undefined`. Empty string is accepted.

```json
"props": {
  "color": "yellow", "labelColor": "black",
  "size": "m", "font": "draw",
  "align": "middle", "verticalAlign": "middle",
  "growY": 0, "fontSizeAdjustment": 1, "url": "", "scale": 1,
  "textFirstEditedBy": "",
  "richText": {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Sticky"}]}]}
}
```

## text (standalone label)

`autoSize: false` + explicit `w` is the predictable option — `autoSize: true`
needs text measurement, which only a real browser Editor can do.

```json
"props": {
  "color": "black", "size": "xl", "font": "draw",
  "w": 400, "textAlign": "start", "autoSize": false, "scale": 1,
  "richText": {"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Heading"}]}]}
}
```

## frame

```json
"props": { "w": 1200, "h": 800, "name": "Section", "color": "black" }
```

Shapes go inside a frame by setting their `parentId` to the frame's id. Their
`x`/`y` then become **frame-local**, not page coordinates.

## arrow + bindings — the one worth reading twice

An arrow that merely *looks* connected is a raw arrow with hardcoded endpoints; it
detaches the moment anyone drags a shape. A real connection is **three records**:
the arrow, plus one `binding` per end.

```json
{"put": [
  {
    "id": "shape:ai-arrow1", "typeName": "shape", "type": "arrow",
    "x": 0, "y": 0, "rotation": 0, "index": "a9", "parentId": "page:page",
    "isLocked": false, "opacity": 1, "meta": {},
    "props": {
      "kind": "arc", "elbowMidPoint": 0.5, "bend": 0,
      "start": {"x": 0, "y": 0}, "end": {"x": 2, "y": 0},
      "arrowheadStart": "none", "arrowheadEnd": "arrow",
      "dash": "draw", "size": "m", "fill": "none",
      "color": "black", "labelColor": "black",
      "font": "draw", "labelPosition": 0.5, "scale": 1,
      "richText": {"type":"doc","content":[{"type":"paragraph"}]}
    }
  },
  {
    "id": "binding:ai-arrow1-start", "typeName": "binding", "type": "arrow",
    "fromId": "shape:ai-arrow1", "toId": "shape:ai-box1", "meta": {},
    "props": {"terminal": "start", "normalizedAnchor": {"x": 0.5, "y": 0.5},
              "isPrecise": false, "isExact": false, "snap": "none"}
  },
  {
    "id": "binding:ai-arrow1-end", "typeName": "binding", "type": "arrow",
    "fromId": "shape:ai-arrow1", "toId": "shape:ai-box2", "meta": {},
    "props": {"terminal": "end", "normalizedAnchor": {"x": 0.5, "y": 0.5},
              "isPrecise": false, "isExact": false, "snap": "none"}
  }
]}
```

- `fromId` is always the **arrow**; `toId` is the shape it attaches to.
- `props.start` / `props.end` on the arrow are ignored once both ends are bound,
  but the schema still requires them. `{"x":0,"y":0}` / `{"x":2,"y":0}` is the
  inert filler real arrows in the corpus use.
- **`isPrecise: false` + a centre `normalizedAnchor` is what you want** — tldraw
  then routes to whichever edge faces the other end and re-routes on drag.
  `isPrecise: true` pins the arrow to that exact fractional point on the shape.
- `kind` is `"arc"` (curved, routes independently) or `"elbow"` (rectilinear).
  Two elbow arrows leaving one shape toward targets at the same `x` overlap —
  spread the targets horizontally, or make one `"arc"`.

## logic-gate (this deployment's custom shape)

```json
{"type": "logic-gate",
 "props": {"kind": "and", "w": 145, "h": 167,
           "color": "black", "size": "m", "fill": "none", "dash": "draw", "font": "draw"}}
```

The server validates these (its schema includes the custom shape), so they can be
created headlessly. Their *interactive* behaviour — port snapping, geometry — is
client-side and only comes alive in a browser.

## Deleting

`{"delete": ["shape:ai-box1", "binding:ai-arrow1-start"]}`

Deleting a shape leaves its bindings orphaned — delete the bindings too, or delete
the arrow, which takes its bindings with it.

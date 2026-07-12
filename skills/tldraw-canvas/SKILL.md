---
name: tldraw-canvas
description: Drive tldraw.com via the Chrome browser MCP — read the user's canvas, create shapes (boxes, sticky notes, arrows, frames, text), edit, and clean up. Use WHENEVER the user wants to draw, diagram, sketch, or whiteboard on tldraw — draw X on tldraw, add a box labeled Y, tldraw this out. Also modify, re-color, re-label, or clean up shapes. Homophones teal draw, tealdraw, tl draw, td draw all mean tldraw.
---

# tldraw-canvas

Drive tldraw.com via the Chrome browser MCP. Real-time shape creation, editing, reading, and cleanup — all on the user's live tldraw canvas.

## When to use this skill

Trigger on any request to *make*, *modify*, or *read* something on tldraw. The user may or may not say the word "draw" — if a tldraw tab is open and they ask you to diagram, sketch, or annotate something visual, use this skill.

Homophone note: users often dictate "teal draw" / "tealdraw" / "tl draw" — all mean **tldraw**.

## How this works (the short version)

tldraw.com exposes `window.editor` — the full tldraw SDK editor instance. This skill ships a helper library (`scripts/bootstrap.js`) that gets injected into the page via the Chrome MCP, exposing a tiny safe API at `window.__td`. From then on, creating a shape is a one-liner like `window.__td.createBox({x, y, text: 'hi'})`.

Two non-obvious things to know:

1. **Rich text is a ProseMirror JSON doc, not a string.** Malformed rich text *crashes the renderer* (not just the validator). Always use `window.__td.richText(str)` or the helpers that wrap it — never hand-roll rich text.
2. **Shape props are strictly validated.** Every enum is empirically known — see `references/shape-schemas.md`. Making up color names or geo types will throw.

## Workflow

Run these steps in order. Don't skip steps.

### 1. Load Chrome MCP tools

If `mcp__claude-in-chrome__*` tools aren't loaded, fetch them in bulk with `ToolSearch` query `claude-in-chrome`.

### 2. Target the right doc

Call `mcp__claude-in-chrome__tabs_context_mcp` to see current tabs.

- **Is there an open `tldraw.com` tab?** Use it by default.
- **Are there multiple open tldraw tabs?** Ask the user which one.
- **No tldraw tab open?** Create one with `tabs_create_mcp` and navigate to `https://www.tldraw.com/new` for a blank doc.
- **User explicitly says "make a new doc" / "fresh canvas"?** Navigate to `/new` regardless of what's open.
- **User names a specific doc** ("use my FHLB doc", "the retro one")? Click it from the sidebar or ask them to bring it to the foreground, then confirm the URL.

### 3. Check what's in the doc — confirm before writing to populated docs

After targeting, run `window.__td?.probe() ?? 'not-loaded'` to check state. If the doc has existing shapes that this skill didn't create (`shapeCount > aiShapeCount`), **tell the user what's in the doc and confirm before adding/modifying content.** Example:

> "This doc has 47 existing shapes (a retro board by the looks of it). Should I add to this doc or switch to a new one?"

For a doc with 0 shapes or only AI-created shapes, skip the confirmation — just proceed.

### 4. Inject the bootstrap (once per tab)

Check `typeof window.__td` first. If it's already `'object'`, skip — the bootstrap is already loaded.

Otherwise, Read `scripts/bootstrap.js` from this skill directory, then pass its full contents as `text` to `mcp__claude-in-chrome__javascript_tool`. The bootstrap is idempotent — re-injecting is safe.

Verify injection succeeded by calling `window.__td.probe()` — it returns `{ok: true, url, pageId, shapeCount, aiShapeCount, registeredTypes}`.

### 5. Read the canvas if you need context

Before editing existing content or referring to existing shapes, call:

```js
window.__td.readCanvas()
```

Returns a summary: `{pageId, totalShapes, shapes: [{id, type, x, y, w, h, color, text, ...}]}`. This is the LLM-friendly view — richText is flattened to plain strings, coordinates are rounded.

For full shape data (including raw richText JSON), pass `{full: true}`.

### 5.5. Plan the layout before placing a single shape (required for multi-shape builds)

For any build that creates more than ~5 shapes, write down the layout plan *in the response* before calling `createBox`/`createSticky`/`createArrow`. The plan must include:

1. **Grid coordinates** for every shape you intend to create. Name each (e.g., `p1Header: (0, 80), w=560 h=70`). List them.
2. **Arrow routes** as source/target pairs, with a one-line check per arrow: "does this path cross any other shape's bounding box?" If yes, move a shape before building.
3. **Whitespace budget**: shapes don't touch each other; arrow-carrying lanes have at least one shape-width of free space.

Writing this out forces a spatial simulation in your head before you pay the cost of building. Do NOT skip this step and "figure out spacing as you go" — that's the failure mode.

### 6. Execute the edit

Compose one or more helper calls. The full API is in `references/api.md`. Quick reference:

```js
const td = window.__td;

td.createBox({x, y, w, h, text, color, geo, fill})  // rectangle or any geo shape
td.createSticky({x, y, text, color})                 // sticky note
td.createText({x, y, text, size, color})             // standalone text
td.createFrame({x, y, w, h, name})                   // frame (visual grouping)
td.createArrow({from, to, text})                     // from/to: shape id OR {x, y}
td.updateShape(id, {x, y, props: {color, text}})    // text auto-converts to richText
td.deleteShapes([id1, id2])
td.zoomToFit()
td.zoomToShapes([id1, id2])
td.cleanup()                                         // deletes only shape:ai-* shapes
```

Tips:
- **Arrows with shape endpoints bind** — the arrow stays attached when shapes move.
- **All created shape IDs start with `shape:ai-`** so cleanup is safe.
- **Schema details live in `references/shape-schemas.md`** — valid colors, geos, sizes, etc.

### 7. Verify visually after **every write batch** (not just at the end)

This is a required gate, not an optional sanity check. After any batch that creates, updates, moves, resizes, or reparents shapes:

1. Call `window.__td.zoomToFit()` (or `zoomToShapes([...ids])` for a targeted view of what you just changed).
2. Take a screenshot via `mcp__claude-in-chrome__computer` with `action: 'screenshot'`.
3. **Mandatory self-QA before reporting.** Before any text response summarizing the build, run this checklist against the screenshot:

   - [ ] No arrow crosses a card's bounding box (other than the two cards it connects).
   - [ ] No card overlaps another card or any text label.
   - [ ] Every shape has a visual reason to be where it is (column alignment, flow ordering).
   - [ ] Arrow labels don't sit on top of other content.
   - [ ] Text fits inside its card without awkward wrapping.

   If any checkbox fails, fix it (via `updateShape`, reroute arrow, move shape) **before** writing the user-facing summary. Reporting "done" while visual bugs exist makes the user do QA Claude should have done.

If the canvas crashed with "Something went wrong", you probably passed malformed rich text — refresh the tab, re-inject bootstrap, and retry using the `richText()` helper.

**When the user says "I can't see it"**, before hypothesizing browser/profile mismatches:
1. Read the tab URL's `?d=` viewport (format: `v{x}.{y}.{w}.{h}.page`).
2. Compare against the bounds of your AI shapes (`readCanvas()` → min/max x, y).
3. If the viewport doesn't intersect the shape bounds, the user is just panned away — run `zoomToFit`.
4. Only after ruling that out, consider browser/profile issues.

### 8. Report back

Tell the user what you did, ideally with shape counts or IDs. If you created a named group of shapes, mention they can say "undo that last change" (tldraw's built-in undo works) or "clean up" (runs `window.__td.cleanup()`).

## Safety rules

- **Never delete a non-AI shape** (`id` not starting with `shape:ai-`) without explicit confirmation from the user. That's their work.
- **Don't navigate away from a doc with unsaved user intent** — if the user has selected shapes or typed something, ask before navigating to `/new` or another doc.
- **Destructive ops Claude introduced in this session** (deleting shapes Claude just made) don't need confirmation — Claude is correcting its own output.
- **Every shape Claude creates gets `shape:ai-` prefix** via `newId()`. Don't bypass this.

## Failure modes to watch for

| Symptom | Cause | Fix |
|---|---|---|
| "Something went wrong" screen | Malformed rich text or invalid shape record | Refresh the tab; re-inject bootstrap; use `td.richText()` |
| `ValidationError: Unexpected property` | Using non-existent prop on a shape | Check `references/shape-schemas.md` for the real schema |
| `ValidationError: Expected "black" or ...` | Bad enum value | Check `td.ENUMS` at runtime or `shape-schemas.md` |
| Arrow endpoint free-floats instead of binding | Binding API not available on this version | Pass shape ids — skill tries to bind; falls back to free-floating if not supported |
| `window.editor` is undefined | Page isn't tldraw.com, or hasn't finished loading | Wait 2-3 seconds after navigating to tldraw |
| **Shapes vanish after `updateShape` moves them** | Shape got auto-adopted as a child of a frame it overlapped. `x`/`y` are now frame-local, not page-space — values that used to be correct may now place the shape outside the frame's clip region. | Check `shape.parentId`. If it's a frame, call `td.editor.reparentShapes([ids], td.editor.getCurrentPageId())` then re-apply the intended absolute coords. |
| **Two arrows from same source overlap / one cuts through a target** | Elbow arrows from one shape to two targets at the same `x` (stacked) pick overlapping rectilinear paths. | Either (a) spread the targets horizontally so the two arrows have different destination x's, or (b) switch one arrow to `kind: 'arc'` so it curves independently of the other's route. |
| **Text wraps awkwardly inside a box, diamond, or on an arrow label** | Default box sizes assume short labels. Multi-line text and long arrow labels need wider shapes and longer arrows. | Size heuristics: 260×110 for 2-line rectangles, 320×200 for diamonds with 2+ lines, arrows carrying 2-word labels need ≥300px of free path. |

## Layout heuristics (quick reference)

- **Don't place new shapes inside existing frames** unless you want them parented. Create shapes first in free space, then reparent explicitly via `td.editor.reparentShapes([ids], frameId)` — or leave them on the page and rely on the frame as a visual guide only.
- **For branching flowcharts (IF → two targets):** offset the targets on **different x** coordinates, not just different y, so arrow routing disambiguates naturally.
- **When in doubt on spacing, zoom in to 100% in your head** — if text would wrap at reading size, the shape is too small.

## References

- **`references/api.md`** — Full API reference for `window.__td`.
- **`references/shape-schemas.md`** — Every shape type's props, with valid enums.
- **`references/rich-text.md`** — ProseMirror doc format and why you should always use `td.richText()`.

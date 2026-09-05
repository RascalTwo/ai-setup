# Transport: Chrome MCP (fallback)

For any tldraw board **without** the agent API — `tldraw.com`, or a self-hosted
deployment that hasn't added those routes. Drives the page's live `window.editor`
through the browser.

Slower and more fragile than `transport-http.md`: every operation is a round trip
through tab targeting and script injection, and it only works on a board someone
has open in Chrome. Prefer HTTP whenever it's available.

## Trade-off vs HTTP

This transport can do things HTTP structurally can't, because there's a real
`Editor` with a DOM:

- **Text auto-sizing** — `autoSize: true` measures actual rendered text.
- **Camera** — `zoomToFit()` / `zoomToShapes()` genuinely move the view.
- **Image export.**
- **Custom shape interactivity** — client-side behaviour actually runs.

And it can't do the things HTTP gives you for free:

- **No `viewers` count** — you can't tell who else is looking at the board.
- **No writing to a board nobody has open** — HTTP loads the room from storage on
  demand; here, a tab must exist.
- **Writes are local-first** — they sync outward, but you're editing through one
  participant's client rather than the server.

## 1. Load Chrome MCP tools

If `mcp__claude-in-chrome__*` aren't loaded, fetch them in one batched `ToolSearch`
call with query `claude-in-chrome`.

## 2. Target the right board

`mcp__claude-in-chrome__tabs_context_mcp` to list tabs.

- **One tldraw tab open** → use it.
- **Several** → ask which.
- **None** → create one and navigate. For tldraw.com, `https://www.tldraw.com/new`
  gives a blank doc. For a self-hosted board, ask for the URL.
- **User said "new doc" / "fresh canvas"** → navigate to a new board regardless of
  what's open.
- **User named a board** ("the retro one") → ask them to bring it to the
  foreground, then confirm the URL before writing.

## 3. Check what's already there

```js
window.__td?.probe() ?? 'not-loaded'
```

If the board has shapes this skill didn't create (`shapeCount > aiShapeCount`),
say what's in it and confirm before adding. Empty, or only `shape:ai-` shapes →
proceed.

## 4. Inject the bootstrap (once per tab)

Check `typeof window.__td` first — if it's `'object'`, skip.

Otherwise Read `scripts/bootstrap.js` from this skill and pass its full contents as
`text` to `mcp__claude-in-chrome__javascript_tool`. It's idempotent, so
re-injecting is harmless.

Confirm with `window.__td.probe()` → `{ok: true, url, pageId, shapeCount, aiShapeCount, registeredTypes}`.

If `window.editor` is undefined, the page either isn't a tldraw board or hasn't
finished loading — wait a few seconds after navigating.

## 5. Read the board

```js
window.__td.readCanvas()
```

Returns `{pageId, totalShapes, shapes: [...]}` with richText flattened and
coordinates rounded. Pass `{full: true}` for raw records including richText JSON.

## 6. Build

**Records here are partials, not full records.** `editor.createShape()` fills in
`index`, `isLocked`, `opacity`, `meta`, and prop defaults — so you write far less
than the HTTP templates in `records.md` show. The helpers go further still:

```js
const td = window.__td;
td.createBox({x, y, w, h, text, color, geo, fill})
td.createSticky({x, y, text, color})
td.createText({x, y, text, size, color})
td.createFrame({x, y, w, h, name})
td.createArrow({from, to, text})          // from/to: shape id OR {x, y}
td.updateShape(id, {x, y, props: {color, text}})
td.deleteShapes([id1, id2])
td.zoomToFit(); td.zoomToShapes([ids])
td.cleanup()                               // deletes only shape:ai-* shapes
```

Full reference: **`td-api.md`**. Valid enums: **`shape-schemas.md`**.

- **Arrows with shape-id endpoints bind** — they stay attached when shapes move.
  The helper builds the binding records for you; you don't hand-write them here.
- **Never hand-roll rich text** — pass `text:` and let the helper call
  `td.richText()`. Malformed rich text crashes the renderer, not just the
  validator. See `rich-text.md`.

## 7. Verify visually after every write batch

Unlike HTTP, there's no authoritative read endpoint, so the screenshot **is** part
of verification here:

1. `window.__td.zoomToFit()` (or `zoomToShapes([...ids])`). To frame one region of
   a large board, `window.editor.zoomToBounds({x, y, w, h}, {inset: 20})` — that
   one is plain `editor`, so it works before the bootstrap is injected.
2. **Foreground the tab** —
   `sh ~/.agents/skills/browser-capture/scripts/raise-chrome.sh tldraw`. A
   background or occluded tab is throttled and doesn't paint; the screenshot comes
   back blank even though the shapes are in the DOM. Check
   `document.visibilityState` before believing an empty canvas. (How reliably this
   bites is in question — see the blank-screenshot row under Failure modes.)
3. Screenshot via `mcp__claude-in-chrome__computer`.
4. Run the layout checklist in `SKILL.md` against what you see, and fix problems
   **before** writing the summary.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| "Something went wrong" screen | Malformed rich text or invalid record | Refresh, re-inject bootstrap, use `td.richText()` |
| `ValidationError: Unexpected property` | Prop that doesn't exist on that shape | Check `shape-schemas.md` |
| `ValidationError: Expected "black" or …` | Bad enum value | Check `td.ENUMS` at runtime |
| `window.editor` is undefined | Not a tldraw page, or still loading | Wait 2–3s after navigating |
| Shapes vanish after `updateShape` moves them | Auto-adopted as a frame's child, so `x`/`y` became frame-local | Check `parentId`; `td.editor.reparentShapes([ids], td.editor.getCurrentPageId())`, then re-apply absolute coords |
| Two arrows from one source overlap | Elbow arrows to targets at the same `x` pick overlapping routes | Spread targets horizontally, or make one `kind: 'arc'` |
| Stale reads after an external change | Hidden tab defers incoming sync messages | Foreground the tab, then re-read |
| Blank screenshot | Throttled background tab — but **verify before believing this**: seen once (2026-08-12) with `visibilityState: "hidden"` and the screenshot painting fine anyway, because `computer` activates the tab itself. In the same run `raise-chrome.sh tldraw` reported success while the tab stayed hidden, so it had missed the MCP group's window | Check `document.visibilityState`, then just take the screenshot and look |

**"I can't see it"** — before blaming the browser: read the tab URL's `?d=`
viewport (`v{x}.{y}.{w}.{h}.page`), compare against your shapes' bounds from
`readCanvas()`, and if they don't intersect the user is just panned away. Run
`zoomToFit`.

# Transport: browser (fallback)

For any tldraw board **without** the agent API: `tldraw.com`, or a self-hosted deployment that hasn't added those routes. Drives the page's live `window.editor` through the browser.

Slower and more fragile than `transport-http.md`: every operation is a round trip through script injection, and it only works on a board someone has open in a browser tab. Prefer HTTP whenever it's available.

Tool choice and the browse basics (sessions, `execute`, per-action timeouts, `handoff()`, screenshots) live in the **`browser`** skill. This file adds only what tldraw needs.

## Contents
- Trade-off vs HTTP
- 1. Main world, not page.evaluate
- 2. Open the board
- 3. Check what's already there
- 4. Inject the bootstrap (once per page load)
- 5. Read the board
- 6. Build
- 7. Verify visually after every write batch
- Failure modes

## Trade-off vs HTTP

This transport can do things HTTP structurally can't, because there's a real `Editor` with a DOM:

- **Text auto-sizing** — `autoSize: true` measures actual rendered text.
- **Camera** — `zoomToFit()` / `zoomToShapes()` genuinely move the view.
- **Image export.**
- **Custom shape interactivity** — client-side behaviour actually runs.

And it can't do the things HTTP gives you for free:

- **No `viewers` count** — you can't tell who else is looking at the board.
- **No writing to a board nobody has open** — HTTP loads the room from storage on demand; here, a page must be open.
- **Writes are local-first** — they sync outward, but you're editing through one participant's client rather than the server.

## 1. Main world, not page.evaluate

`window.editor` and `window.__td` live in the page's **main world**. browse's `page.evaluate` runs in an isolated world: it sees the DOM but not page globals, so `typeof window.editor` is `'undefined'` there even on a loaded board (measured on tldraw.com, 2026-11-13; React's `__reactFiber$…` expandos are missing in that world too). A raw CDP `Runtime.evaluate` reaches the main world, and inline `<script>` injection is blocked by tldraw.com's CSP, so CDP is the way in.

`scripts/main.sh` wraps it:

```sh
sh scripts/main.sh <session> <file.js>     # run a file in the main world
sh scripts/main.sh <session> -e '<js>'     # run an expression; top-level await works
```

It prints the last expression's value as browse prints any return value. Inside a hand-written `browse execute` script the same thing is:

```js
const c = await context.newCDPSession(page);
const r = await c.send("Runtime.evaluate", { expression: "window.__td.probe()", returnByValue: true, awaitPromise: true, replMode: true });
await c.detach();
return r.result.value;
```

Everything below that touches `window.editor` or `window.__td` goes through this. Screenshots, navigation and locators stay plain Playwright.

## 2. Open the board

`browse session new tld`, then `browse execute -s tld 'await page.goto("https://www.tldraw.com/new", { timeout: 30000 }); await page.waitForTimeout(4000); return page.url()'`.

- **User said "new doc" / "fresh canvas"** → `https://www.tldraw.com/new` gives a blank local board (it lands on `/`, anonymous, nothing shared). Navigate there regardless of what else is open.
- **User named a board** → ask for its URL and confirm it before writing.
- **Self-hosted board** → ask for the URL.
- A board the user already has open: `browse session list` / `browse status` show attached targets; use `--target-url <substring>` on `execute` to act on that one instead of opening your own. Several candidates → ask which.
- Confirm the editor mounted: `sh scripts/main.sh tld -e 'typeof window.editor'` returns `object`. `undefined` means not a tldraw page or still loading; wait 2–3 s and retry.

Logins, share dialogs and "Sign in to share" prompts are the user's: call `handoff()` rather than guessing.

## 3. Check what's already there

```sh
sh scripts/main.sh tld -e 'window.__td?.probe() ?? "not-loaded"'
```

If the board has shapes this skill didn't create (`shapeCount > aiShapeCount`), say what's in it and confirm before adding. Empty, or only `shape:ai-` shapes → proceed.

## 4. Inject the bootstrap (once per page load)

If step 3 printed `not-loaded`: `sh scripts/main.sh tld scripts/bootstrap.js`. It's idempotent, so re-injecting is harmless, and it returns the probe: `{ok: true, url, pageId, shapeCount, aiShapeCount, registeredTypes}`. A reload clears it.

## 5. Read the board

```sh
sh scripts/main.sh tld -e 'window.__td.readCanvas()'
```

Returns `{pageId, totalShapes, shapes: [...]}` with richText flattened and coordinates rounded. Pass `{full: true}` for raw records including richText JSON.

## 6. Build

**Records here are partials, not full records.** `editor.createShape()` fills in `index`, `isLocked`, `opacity`, `meta`, and prop defaults, so you write far less than the HTTP templates in `records.md` show. The helpers go further still. Put a whole batch in one file and run it once:

```js
const td = window.__td;
const a = td.createBox({x, y, w, h, text, color, geo, fill});   // returns the shape id
const b = td.createBox({...});
td.createArrow({from: a, to: b, text});     // from/to: shape id OR {x, y}
td.createSticky({x, y, text, color});
td.createText({x, y, text, size, color});
td.createFrame({x, y, w, h, name});
td.updateShape(id, {x, y, props: {color, text}});
td.deleteShapes([id1, id2]);
td.zoomToFit(); td.zoomToShapes([ids]);
td.cleanup();                               // deletes only shape:ai-* shapes
```

Full reference: **`td-api.md`**. Valid enums: **`shape-schemas.md`**.

- **Arrows with shape-id endpoints bind** — they stay attached when shapes move. The helper builds the binding records for you; you don't hand-write them here.
- **Never hand-roll rich text** — pass `text:` and let the helper call `td.richText()`. Malformed rich text crashes the renderer, not just the validator. See `rich-text.md`.

## 7. Verify visually after every write batch

Unlike HTTP, there's no authoritative read endpoint, so the screenshot **is** part of verification here:

1. `sh scripts/main.sh tld -e 'window.__td.zoomToFit()'` (or `zoomToShapes([...ids])`). To frame one region of a large board, `window.editor.zoomToBounds({x, y, w, h}, {inset: 20})` — plain `editor`, so it works before the bootstrap is injected.
2. Screenshot: `browse execute -s tld 'const p = files.path("board.png"); await page.screenshot({ path: p }); return p'`, then `cp` the printed path into `~/.agents/state/browser/tldraw-canvas/` and look at it. browse tabs open in the background of the user's Chrome and still paint; `document.visibilityState` was `visible` in testing, so no foregrounding step is needed.
3. Run the layout checklist in `SKILL.md` against what you see, and fix problems **before** writing the summary.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `typeof window.editor` is `undefined` from `page.evaluate` | Isolated world | Use `scripts/main.sh` (CDP main world) |
| "Something went wrong" screen | Malformed rich text or invalid record | Reload the page (`page.reload()`), re-inject bootstrap, use `td.richText()` |
| `ValidationError: Unexpected property` | Prop that doesn't exist on that shape | Check `shape-schemas.md` |
| `ValidationError: Expected "black" or …` | Bad enum value | Check `td.ENUMS` at runtime |
| `window.editor` is undefined from `main.sh` | Not a tldraw page, or still loading | Wait 2–3 s after navigating |
| Shapes vanish after `updateShape` moves them | Auto-adopted as a frame's child, so `x`/`y` became frame-local | Check `parentId`; `td.editor.reparentShapes([ids], td.editor.getCurrentPageId())`, then re-apply absolute coords |
| Two arrows from one source overlap | Elbow arrows to targets at the same `x` pick overlapping routes | Spread targets horizontally, or make one `kind: 'arc'` |
| Stale reads after an external change | Hidden tab defers incoming sync messages | Check `document.visibilityState` via `page.evaluate`; bring the tab forward or reload, then re-read |
| Blank screenshot | Throttled background tab (not seen with browse) | Check `document.visibilityState`, then re-take the screenshot |

**"I can't see it"** — before blaming the browser: read the page URL's `?d=` viewport (`v{x}.{y}.{w}.{h}.page`), compare against your shapes' bounds from `readCanvas()`, and if they don't intersect the user is just panned away. Run `zoomToFit`.

When browse is down, the `browser` skill lists the fallbacks (agent-browser through the cdp-relay, then claude-in-chrome); `window.editor` is reachable the same way through whichever page-JS tool they give you.

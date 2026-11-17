# The overlay page contract

What a page shown by `viz-overlay show` gets, may call, and must do. The host injects all of it before the page's own scripts run (`helper/bridge.js`); a page written to this contract also renders standalone in a browser from a snapshot. Nothing here is macOS-specific: another host may implement it.

## Coordinates

Every rect the host gives the page is `{x, y, width, height}` in the page's CSS px, top-left origin. On the main display and on any display right of or below it, CSS px are global screen points (origin = the main display's top-left), so Accessibility rects (`viz-overlay elements`) go in as-is. On a display left of or above the main one, the web view cannot reach negative coordinates: `overlay.origin` is then that display's top-left in global points, and a global rect from elsewhere needs `x - origin.x, y - origin.y`. Rects from the host are already converted, so a page that only draws what the host hands it never cares.

The overlay covers one display: the one holding most of the primary target (the main display without one). When the target moves to another display the panel moves with it and the page gets a `display` event. One page, one state, wherever it is.

## `window.overlay`

| Member | What |
|---|---|
| `title` | the overlay's title (`--title`, or the page's name) |
| `origin` | `{x, y}`: global screen point at CSS (0, 0); `{0, 0}` except on displays left of or above the main one |
| `display` | the overlay's display, as a CSS rect |
| `visible` | the display minus the menu bar and Dock, as a CSS rect |
| `target` | the primary target's latest state (below), `null` until known or without `--target` |
| `shown` | whether the overlay is showing (`null` until decided) |
| `data` | the latest value the agent sent with `viz-overlay update <id> <json>`, `null` until one arrives; a page that loads or reloads later gets the latest |
| `track(spec, cb)` | follow another target; `cb(state)` on every change; returns a function that stops it |
| `elements(app, {match?, role?, web?})` | Promise of `[{role, label, rect, web}]`: the app's visible labelled elements (can take seconds) |
| `send(text)` | message the agent: typed into its session as `[viz-overlay · title] text`, and logged |
| `close()` | end the overlay |
| `on(event, cb)` | `"target"` (primary target state), `"visibility"` (`{visible, reason}`), `"display"` (the overlay object, after `origin`/`display`/`visible` changed), `"data"` (each value from `viz-overlay update`, any JSON); calls `cb` at once with the current value when there is one; returns an unsubscribe function |

`<html>` carries `data-overlay` while hosted, so CSS can style the overlay case (`:root[data-overlay] …`). `html` and `body` backgrounds are forced transparent.

### A target spec

```js
{
  app: "Google Chrome",                 // name or bundle id: exact, then prefix, then substring
  window: "Inbox",                      // optional title substring; else the app's frontmost window
  element: { label: "Save", role: "button" },  // optional: an Accessibility element, anywhere in the window
  web: { label: "Sign in", role: "link" },     // optional: only inside the window's web page content
  rect: { x, y, width, height },        // optional, global points: rides on the window at its first offset
}
```

One of `element`, `web`, `rect` at most; none means the window itself. Labels match title, description, value or identifier, case-insensitive: exact, then prefix, then substring, visible before hidden, enabled before disabled. Roles take `AXButton`, `button` or `Button`.

### A target state

```js
{ rect, window, shown, covered, gone, error }
```

- `rect`: the element (or rect, or window) in CSS px; `window`: its window. Absent when gone.
- `gone`: no such app, window or element right now (`error` says which). It may come back: the host keeps looking.
- `covered`: another app's window is over the rect's centre, or the centre is scrolled out of its window.
- `shown`: on screen and not covered.

States are pushed when they change, up to 4 times a second.

## Clicks and keys

- Clicks fall through to the apps below everywhere except over elements carrying `data-overlay-hit` (visible ones, by their bounding box). Mark every button, link, input or draggable the page wants clicked; leave decoration unmarked so the user can keep working through it.
- A click on a hit region does not activate the overlay: the app the user was in stays frontmost.
- A text field (`input`, `textarea`, `select`, `contenteditable`) focused by a click inside a hit region takes the keyboard; clicking elsewhere gives it back. A field the page focuses by itself does not: the overlay never takes the keyboard without a click.
- A click on an iframe inside a hit region (or carrying `data-overlay-hit`) takes the keyboard too: focus inside another origin can't be seen, so the host assumes the click may be into a field.
- The host draws the ✕ pill at the bottom-right of `visible`; it calls `close()`. Keep that corner free. `show --no-close` drops it, for a page with its own way out.

## Lifecycle

1. The page loads; `overlay` already exists and `on("display")` has values.
2. The page calls `track(...)` and `on("target")`. A reload (the viz server's live reload) clears tracks: track from startup code, not from a one-off action.
3. The host decides visibility each tick (`on("visibility")`); a hidden overlay keeps running.
4. It ends by `close()`, the ✕, `viz-overlay stop`, `--duration`, or the agent session exiting. Nothing is sent to the page first.

## Standalone (a browser, viz verify, a review)

Every overlay page must render without the host. `show --save-snapshot FILE` writes, 2 s after the overlay is ready and again whenever any of it changes (a slow target resolving, a late `elements()` answer), everything the page had been given: `{title, origin, display, visible, target, tracks: [{spec, state}], elements: [{app, match, role, web, result}], data, savedAt}`. Save it outside the viz folder (a write inside it makes the viz server reload the page), stop the overlay, then copy it beside the page as `snapshot.json` and start with:

```js
import { fromSnapshot } from "./standalone.js"; // copy of this skill's page/standalone.js
const overlay = window.overlay ?? fromSnapshot(await (await fetch("snapshot.json")).json());
```

`fromSnapshot` answers `track` with the recorded state of the same spec (key order doesn't matter), `elements` with the recorded answer to the same call, `on` with the recorded values (`data` with the latest), `send` with a console line, and sets `overlay.standalone = true`. Draw the snapshot's targets over a screenshot (`screencapture -x`) if the page needs the real screen behind it to make sense.

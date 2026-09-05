---
name: ui-narration
description: Make a browser interaction legible on screen — a synthetic cursor that glides to what is about to be clicked, a highlight box that frames the target, and a pulse ring on the click itself. Inject it into any page you are driving (Chrome MCP `javascript_tool`, Puppeteer `page.evaluate`, or a pasted DevTools snippet) and call `__narrate.*`. Use when a viewer or a recording needs to be able to tell WHAT was clicked and WHEN — walkthroughs, demos, bug reproductions, guided tours, or any capture where "things randomly happen" is the failure. `browser-capture` injects this for its recordings; you can also drive it live with nothing recording.
---

# ui-narration — make an interaction legible

A browser shows you the *result* of a click, never the click. Watch a capture without
annotation and you see panels changing with no visible cause. **The cursor, the highlight box
and the pulse ARE the narration** — they are what turns a sequence of state changes into
something a person can follow.

This skill is one file: `ui-narration.js`. It defines `window.__narrate` and does nothing on its
own. You drive it.


## Install it into a page

```js
// Chrome MCP (a page you are already driving)
javascript_tool: <paste the contents of ui-narration.js>

// Puppeteer / Playwright
await page.evaluate(fs.readFileSync(
  `${process.env.HOME}/.agents/skills/ui-narration/ui-narration.js`, 'utf8'));

// By hand: paste it into a DevTools console
```

The overlay builds **lazily on first use**, so injecting it costs nothing until you call
something. It survives navigation only if you re-inject — a fresh document has no `__narrate`.

## The API

| Call | Does |
|---|---|
| `__narrate.focusAndClick(hlEl, clickEl?)` | frame `hlEl`, glide to `clickEl` (defaults to `hlEl`), pulse, click. **The one you want 90% of the time.** |
| `__narrate.highlight(el)` / `__narrate.hideBox()` | frame an element / drop the frame |
| `__narrate.moveTo(x, y, dur)` | glide the cursor to a point |
| `__narrate.realClick(el)` | framework-safe click at the element's centre, via `elementFromPoint` |
| `__narrate.waitFor(fn, timeout?)` | poll until `fn()` returns truthy, return it |
| `__narrate.sleep(ms)` | pause |
| `__narrate.smoothScrollTo(y, dur?)` | eased scroll — *"the thing a GIF recorder can never capture, and the cheapest way to make a recording feel like a video rather than a slideshow"* |
| `__narrate.typeInto(el, text, per?)` | type character by character, via the **right** prototype setter |
| `__narrate.drag(el, dx, dy, opts?)` | drag with intermediate move events, so a framework sees a real drag |
| `__narrate.ready(timeout?)` | wait for the overlay to be live |
| `__narrate.clickPulse(x, y)` | a pulse ring at a point, without moving the cursor or clicking |
| `__narrate.clap()` | two white sync frames, for aligning a recording's clock |
| `__narrate.CFG` | timings: `{ glide: 950, hold: 550, afterClick: 1300 }` |
| `__narrate.say(text, {at, hold})` | show a caption. `at` = element to anchor above (default: subtitle band). `hold` = await this long, else returns immediately |
| `__narrate.captions(bool)` | show/hide the caption band. **Cues keep logging while hidden** |
| `__narrate.captionsT0(ms?)` | zero the caption clock — call it when recording starts |
| `__narrate.vtt()` | all cues as WebVTT text |
| `__narrate.cues` | the raw cue log |

Two of these encode bugs that cost real time:

- **`realClick`** — dispatching a synthetic event on an element a framework re-rendered hits a
  detached node. It resolves the element at the coordinates instead, so React and friends see a
  click where a user would have made one.
- **`typeInto`** — the value setter has to come from the *right* prototype. An `<input>` setter
  applied to a `<textarea>` is **silently ignored**, the text snaps back on the next render, and
  nothing errors anywhere.

## Timings are the product

`glide: 950, hold: 550, afterClick: 1300` are not arbitrary. Faster and the eye cannot track
the cursor to its target; slower and the capture drags. The highlight box also reads the
target's computed `borderTopLeftRadius`, so the frame matches the element's corners instead of
sitting around it as a rectangle — the detail nobody gets right first try.

**Change them deliberately.** If a walkthrough feels wrong, adjust `__narrate.CFG` for that run
rather than editing the defaults.

## Who uses this

- **`browser-capture`** injects it for recorded walkthroughs. It is a hard dependency: without
  this skill installed, `record-flow.js --kit` has nothing to inject.
`clap()` is the one recorder-aware call: it pairs with a recorder's own clock (`__cap.t0`).
Everything else is free-standing.

- **Live, nothing recording.** Drive it through Chrome MCP while a human watches — the same
  choreography, no file at the end.

## Textual narration

A caption is an **independent primitive**, deliberately not an argument to `focusAndClick`. An
agent composes: cursor only, caption only, or both.

```js
await __narrate.say('Click Save');                      // returns immediately
await __narrate.say('Click Save', { hold: 1200 });      // ...or paces itself
await __narrate.say('Look here', { at: theButton });    // anchored above an element
await __narrate.say(null);                              // clear
__narrate.captions(false);                              // hide the band
```

`say()` is **non-blocking by default** so it layers over the existing 950/550/1300 pacing
instead of fighting it. Pass `hold` when the caption *is* the beat.

**Cues are logged even when captions are hidden.** That is the point: one run ships either
burned-in captions or a clean capture plus a `.vtt` sidecar, and the sidecar is complete either
way. `browser-capture` writes `<name>.vtt` beside the video automatically when a flow captioned
— the same format `extract-video-subtitles` already reads.

A cue runs until the next one starts (capped at 6s); the last gets a length based on its text.
Cues never overlap.

## Roadmap — auditory narration

The name is aspirational on purpose, and half-earned now. Spatial narration (pointer, frame,
pulse) and textual narration both work. Still to come: **spoken** narration over a recording,
driven off the same cue log so the `.vtt` becomes the script rather than a second source of
truth.

The intent throughout is a **toolbox an agent composes from**, not a fixed pipeline.

## Changing the overlay — load-bearing details

- **Step tweens with `setTimeout(~16ms)`, never `requestAnimationFrame`.** rAF is throttled
  or paused in headless and background tabs, so an rAF tween silently stalls. And don't use a
  CSS transition: it lags behind what it's chasing, so the cursor and its ring drift apart.
- **Hide the highlight box *before* the click, with no fade**, or it ghosts onto the next page.
- **Click via the full pointer-event sequence at `elementFromPoint`**, not a bare `el.click()` —
  component libraries nest the real interactive node inside the wrapper.
- **`drag()` rides the dragged element's live rect**, not the straight line between endpoints,
  because a rotate handle travels an arc and interpolation detaches the cursor from it.
  And aim along `handleCentre − elementCentre`: a handle named *"right edge"* is named in its
  element's **own frame**, so on a turned element it points down the screen and a screen-right
  drag resizes by exactly zero pixels.
- **`typeInto()` takes the native value setter from the matching prototype.** An
  `HTMLInputElement` setter applied to a `<textarea>` is ignored silently and React snaps the
  text back on the next render, with no error anywhere.

---
name: browser-capture
description: >-
  Get screenshots, animated GIFs, and smooth VIDEO out of a browser and onto disk, so they
  can be embedded in a doc, guide, PR, report, or artifact. Use this WHENEVER you need to
  save a shot of a web page or app to an image file, produce a click-by-click walkthrough or
  how-to of a web UI, record a GIF of a browser flow, record a demo of an app, or turn what
  you see in the browser into files inside Markdown/a PR/a report — even when the user only
  says "add screenshots of the steps", "show how to do X in the UI", "record a walkthrough",
  or "make a video of this". Especially reach for it when the app needs the user's real
  LOGIN/SSO session, or when a GIF came out choppy, jumpy or slideshow-like and someone
  wants real smooth video: both are solved here (record the user's own Chrome tab via the
  claude-in-chrome MCP at full frame rate, no human camera work), but every obvious path
  fails silently — the computer tool's save_to_disk writes no file, "more screenshots" adds
  zero GIF frames, and getDisplayMedia dies with InvalidStateError unless the tab is visible.
---

# browser-capture

Turn a browser flow into image or video files you can embed. Three routes, in strict order
of preference. Each obvious shortcut here fails *silently*, which is how this costs hours
instead of minutes — so pick the route first.

Dependencies: **ffmpeg** on PATH. Route 2 also needs **puppeteer-core** (the viz skill ships
one at `~/.claude/skills/viz/node_modules/puppeteer-core`; `record-flow.js` finds it).

## Pick the route

| | Route | Real login/SSO? | Human? | Use when |
|---|---|---|---|---|
| **1** | **MCP capture — the user's own Chrome** | ✅ **yes** | ~1s, no clicks | **Default. Prefer always.** |
| **2** | Spawned browser (`record-flow.js`) | ❌ no session | none | Route 1 impossible: no GUI, screen must not be touched, CI/background, or deterministic scripted choreography |
| **3** | GIF recorder (`gif_creator`) | ✅ yes | none | You specifically want a click-annotated how-to GIF and don't need smooth motion |

**Prefer Route 1 by default.** It records the user's *actual* browser — their real session,
their SSO, their data, at their real device pixel ratio (Retina). Nothing else can do that.
Route 2 is a capable fallback that never touches the screen. Route 3 is only for annotated
click-by-click GIFs — and note you can always convert a Route 1/2 video to GIF with ffmpeg,
which usually looks better than the GIF recorder anyway.

**The GIF trap:** `gif_creator` yields a **slideshow**, always — one frame per *action*, and
extra `screenshot` calls add **zero** frames. If a GIF looks "janky" or "choppy", that isn't
a quality bug to iterate on; it's Route 3 working as designed. Switch routes, don't try harder.

---

# Route 1 — record the user's real Chrome (default)

Records the tab the MCP is already driving, via `getDisplayMedia({preferCurrentTab})` +
`MediaRecorder`, downloading through a real `<a download>` click. Full frame rate, real
device pixel ratio, real session. **No picker appears and the user clicks nothing.**

### The one constraint

All three must hold **at the instant capture starts** — and only then:

1. the target tab is the **selected** tab in its window
2. its window is **frontmost / not occluded by another app**
3. a **trusted click** lands within ~5s (the MCP `computer` tool's clicks *are* trusted)

Miss any one → `InvalidStateError: Invalid state`. That error means **"tab not visible"** —
it does *not* mean capture is impossible. macOS marks a Chrome page `hidden` when its window
is **occluded by another app**, so an editor sitting on top is enough to break it.

**Once capture is live, Chrome pins the tab visible and none of it matters any more.**
Verified: with a recording running, burying Chrome behind another app kept
`visibilityState: "visible"` with `hasFocus: false` and the counter advancing exactly in real
time (50 ticks / 5.0s). The user can switch apps, cover the window and keep working.

> **Unverified:** switching to a *different Chrome tab* mid-capture. Occlusion is proven safe;
> tab-switching is probably fine (it's how Meet tab-sharing behaves) but has not been tested.
> Until it is, tell the user to avoid switching tabs while recording.

### The procedure

```
1. javascript_tool : inject assets/mcp-recorder.js         -> window.__cap
   (optional)      : inject assets/walkthrough-kit.js      -> window.__wt (cursor/highlight)
2. javascript_tool : window.__cap.armButton()              -> full-viewport click target
3. bash            : scripts/raise-chrome.sh <url-substring>
4. computer        : SCREENSHOT, then click the target's centre in THAT screenshot's coords
5. javascript_tool : window.__cap.state === 'RECORDING'    (else window.__cap.diagnose())
6. drive the flow  : javascript_tool / computer
7. javascript_tool : await window.__cap.stop()             -> ~/Downloads/<filename>
8. bash            : verify + convert (below)
```

**Step 4 is where this actually goes wrong.** Screenshot dimensions change between calls
(observed 1456×840 then 1502×818 for the same 1728px viewport), so a scale factor computed
earlier silently misses. **Always screenshot immediately before clicking and use that image's
coordinates.** `armButton()` covers the whole viewport for exactly this reason. If a click
seems to do nothing, verify events are landing at all:

```js
window.__clicks = [];
document.addEventListener('click', e => window.__clicks.push([e.clientX, e.clientY, e.isTrusted]), true);
```

If `__cap.state` stays `idle` with `__clicks` empty, the click isn't reaching the page —
re-screenshot and re-click; don't keep changing the JS.

### Verify + convert

```bash
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames,width,height -of default=nw=1 ~/Downloads/capture.webm
ffmpeg -y -loglevel error -i ~/Downloads/capture.webm -movflags faststart -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" ~/Downloads/capture.mp4
```

Hundreds of frames = real video. `yuv420p` + even dimensions are required for QuickTime/Slack
to play it at all. **MediaRecorder webm is variable-frame-rate**, so `-vf select='eq(n,N)'`
frame-index extraction is unreliable — **seek by time** (`-ss 7` / `-sseof -2.5`) instead.

### Authentication — the whole reason this route wins

The MCP is the user's real browser, so their sessions are already there. A protected app
typically shows an account picker listing accounts already marked **"Signed in"** — one
click and you're in, **no password**.

**Never type the user's credentials.** If a real password field appears, stop and hand back
to the human. That's a hard line, not a difficulty.

---

# Route 2 — spawned browser (fallback)

`scripts/record-flow.js` records **headless** Chrome at real frame rates via puppeteer's
`page.screencast()`. No session, but it never touches the screen — right for CI, background
work, or when the user must not be interrupted at all.

```bash
node scripts/record-flow.js --url http://localhost:5173 --out /tmp/out.webm --gif
node scripts/record-flow.js --url http://localhost:5173 --out /tmp/out.webm \
  --flow ./my-flow.js --fps 30 --viewport 1280x800 --mp4
```

Options: `--fps` (30), `--viewport WxH` (1280x800), `--scale` (1; 2 = retina), `--flow`,
`--gif`, `--mp4`, `--headful`, `--no-kit`, `--chrome <path>`.

A `--flow` module exports `async (page, wt, nav) => {}`:

```js
module.exports = async (page, wt, nav) => {
  await wt(async () => {                              // same-document steps
    const card = await window.__wt.waitFor(() => document.querySelector('.card'));
    await window.__wt.focusAndClick(card, card.querySelector('h2'));
    await window.__wt.smoothScrollTo(1400, 1800);
  });
  await nav(async () => {                             // a step that LEAVES the document
    const link = await window.__wt.waitFor(() => document.querySelector('a.next'));
    await window.__wt.focusAndClick(link);
  });
};
```

### Multi-page apps (the sharp edge)

A recorder that only works on an SPA is a toy. Three things break the moment a real hyperlink
swaps the document — all handled, but don't undo them:

- **Inject the kit with `evaluateOnNewDocument`, not `evaluate`.** `evaluate` injects once
  into the *current* document; a navigation destroys that context and `window.__wt` with it.
- **`evaluateOnNewDocument` runs at document-start, when `document.body` is null** — so the
  kit builds its overlay **lazily**. A top-level `document.body.append(...)` throws there and
  `window.__wt` then never exists *on any page*.
- **A navigating click can't be a normal awaited call** — the context is torn down mid-
  `evaluate` and puppeteer rejects with *"Execution context was destroyed"*. That's the
  expected outcome of a successful click. `wt()` swallows it; **`nav()`** pairs it with
  `waitForNavigation`.

Verified against a real cross-origin hyperlink (`example.com` → `iana.org`): cursor and
highlight survive the jump and keep working, in one continuous recording.

### Getting into an authenticated app

Route 2's only real weakness — and the reason Route 1 is the default.

- **Copying the user's Chrome cookies does NOT ride an Entra/Azure AD SSO session.** Tested:
  a profile copy carrying all 3750 cookies incl. 4 `ESTSAUTH*` still hit an interactive
  password prompt (`sso_reload=true` — Entra tried silent SSO and fell back). Enterprise
  sessions are device-bound. Don't spend an hour rediscovering this.
- In order: **use Route 1**; avoid auth (local dev server / mocked build); log in
  programmatically only where no human secret is involved; or do a **one-time headful login
  into a persistent `--user-data-dir`** and reuse it headlessly afterwards.

---

# Route 3 — GIF recorder (click-annotated how-tos)

```
gif_creator  action=start_recording
# ...drive with computer + navigate; each click/navigation = one frame...
gif_creator  action=export  download:true  filename="myflow.gif"   # -> ~/Downloads
```

| Goal | options |
|---|---|
| How-to (show where to click) | `showClickIndicators:true, showActionLabels:true, showWatermark:false, showProgressBar:false` |
| Cleaner / smaller | add `quality:8` (lower = better quality, larger file) |

Export **clears the recording** — record and export each phase separately. Then rip stills:

```bash
ffmpeg -loglevel error -i ~/Downloads/myflow.gif frames/f-%02d.png
ffmpeg -loglevel error -framerate 1 -pattern_type glob -i "frames/*.png" \
  -vf "scale=360:-1,tile=5x6" -frames:v 1 contact.png   # contact sheet
```

`Read` the contact sheet, copy out the meaningful frames with **descriptive names**
(`do-1-role-form.png`, not `f-08.png`), then clean `~/Downloads`.

---

## The visual layer — `assets/walkthrough-kit.js`

Works with **both** Route 1 and Route 2. A recording has no click annotations of its own, so
the cursor, highlight box and click pulse *are* the narration. Injecting it exposes
`window.__wt`: `focusAndClick(hlEl, clickEl?)` · `highlight(el)` / `hideBox()` ·
`moveTo(x,y,dur)` · `smoothScrollTo(y,dur)` · `waitFor(fn)` · `realClick(el)` · `sleep(ms)`.

Load-bearing details — know them before you change them:

- **Step tweens with `setTimeout(~16ms)`, never `requestAnimationFrame`.** rAF is throttled
  or paused in headless and background tabs, so an rAF tween silently stalls. And don't use a
  CSS transition: it lags behind what it's chasing, so the cursor and its ring drift apart.
- **Hide the highlight box *before* the click, with no fade**, or it ghosts onto the next page.
- **Click via the full pointer-event sequence at `elementFromPoint`**, not a bare `el.click()` —
  component libraries nest the real interactive node inside the wrapper.
- **Frame one element, click another** when a card's centre sits over some other control.
- **`waitFor` everything**; an early click is the most common way a take breaks.

---

## Dead ends and gotchas — verified, don't re-derive

- **`computer` + `save_to_disk:true` writes no findable file.** It returns an image ID. Both
  real routes use a genuine browser download instead, which does land in `~/Downloads`.
- **"Headless can't be recorded" is FALSE** — `page.screencast()` records headless Chrome fine
  (Route 2). Don't let this assumption kill an approach.
- **`InvalidStateError` from getDisplayMedia means the tab is hidden**, nothing more. Causes:
  not the selected tab, **or the window is occluded by another app**. Fix with
  `raise-chrome.sh`, don't abandon the route. (`window.focus()` does NOT fix it.)
- **A `computer` click IS a trusted event** and grants user activation — the gesture
  requirement is never the blocker.
- **Stray puppeteer Chromes poison AppleScript.** They're the same binary, so
  `tell application "Google Chrome"` can bind to a headless zombie and report a browser with
  one blank tab — making the real tabs look unreachable. Check and clean first:
  ```bash
  ps aux | grep -c "[p]uppeteer_dev_chrome_profile"
  pkill -f "puppeteer_dev_chrome_profile"; rm -rf /var/folders/*/*/T/puppeteer_dev_chrome_profile-*
  ```
  (14 leftovers were holding 1.87 GB once.) Route 2 leaks these if a run dies — sweep them.
- **Recording the desktop to capture a browser** (`ffmpeg -f avfoundation`) captures whatever
  is actually on screen — the editor, Slack — not the target. Never needed; both routes
  capture the browser's own frames.

## Tips

- **Before/after pairs**: `git stash` the fix → record BEFORE → `git stash pop` → record AFTER.
  With a dev server running, hot-reload swaps the code under an identical flow. Write the flow
  to tolerate both outcomes ("click Back until no Back button remains").
- **Privacy**: Route 1 records the user's real app with real data, and the file lands in
  `~/Downloads`. Say so, and clean up injected overlays from their tab when done.
- **sips vs ffmpeg** (macOS): `sips` for a quick single-image probe; `ffmpeg` for multi-frame.

## Concurrency

Route 1 drives the MCP, scoped to a **tab group** (`tabs_context_mcp`). Route 2 launches its
own browser and doesn't contend with the MCP at all — you can record with Route 2 while an MCP
session stays untouched. The residual caveat: `computer` mouse/keyboard actions contend on
foreground focus, so avoid heavy *simultaneous* `computer`-driving of the same browser.

## See Also

- **claude-in-chrome** skill — connecting to and driving the browser. This skill picks up
  where that leaves off: getting the visuals onto disk.
- **upload-image-to-github** skill — if the captured images need to render in a GitHub
  PR/issue on a private repo.

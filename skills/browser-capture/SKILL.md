---
name: browser-capture
description: >-
  Get screenshots, animated GIFs, and smooth VIDEO out of a browser and onto disk,
  so they can be embedded in a doc, guide, PR, report, or artifact. Use this
  WHENEVER you need to save a shot of a web page or app to an image file, produce
  a click-by-click walkthrough or how-to of a web UI, record a GIF of a browser
  flow, or turn what you see in the browser into files inside Markdown/a PR/a
  report — even when the user only says "add screenshots of the steps", "show how
  to do X in the UI", or "record a walkthrough". Reach for it especially when a
  GIF came out choppy, jumpy, or slideshow-like and someone wants real smooth
  video or a screen recording of a browser flow: that is a solved problem here
  (scripts/record-flow.js records headless Chrome at 30fps, no human needed), but
  the obvious paths all fail silently — the computer tool's save_to_disk flag
  writes no file, "take more screenshots to smooth out the GIF" adds zero frames,
  and getDisplayMedia is permanently blocked in claude-in-chrome MCP tabs.
---

# browser-capture

Turn a browser flow into image or video files you can embed. Three routes, and
picking the right one up front is most of the value — each obvious shortcut here
fails *silently*, which is how this ends up costing hours instead of minutes.

Dependencies: **ffmpeg** on PATH; **puppeteer-core** for Route B (the viz skill
ships a copy at `~/.claude/skills/viz/node_modules/puppeteer-core`, which
`record-flow.js` finds automatically). On macOS **sips** is handy for single images.

## Pick the route

| You need | Route | Human needed? |
|---|---|---|
| Stills / a click-by-click how-to, while already driving the MCP | **A — GIF recorder** | no |
| **Smooth video** of a flow | **B — `scripts/record-flow.js`** | **no** |
| Smooth video of a flow behind the user's own logged-in session | **C — human films it** | yes, last resort |

**The trap that costs hours:** Route A produces a **slideshow**, always. `gif_creator`
captures one frame per *action*, so a five-step flow yields ~five frames, and extra
`screenshot` calls add **zero** frames. Padding, re-recording and re-timing cannot
manufacture motion that was never captured. If a GIF looks "janky", "choppy" or
"like a slideshow", that is not a quality bug to iterate on — it's Route A working
as designed, and it's the signal to **switch to Route B**, not to try harder.

---

# Route A — the GIF recorder (click-by-click how-tos)

Record the session as a GIF, download it, then rip stills out with ffmpeg. One
recording gives you both an animated how-to and every still you need.

### 1. Record

```
gif_creator  action=start_recording
```

Drive the flow with `computer` (clicks, typing) and `navigate`. Each click and
navigation becomes one frame, and the recorder draws click-indicator circles +
action labels for free — which is exactly what makes a good how-to.

### 2. Export as a download

```
gif_creator  action=export  download:true  filename="myflow.gif"
```

`download:true` triggers a real browser download → lands in **`~/Downloads`**.

| Goal | options |
|---|---|
| How-to (show where to click) | `showClickIndicators:true, showActionLabels:true, showWatermark:false, showProgressBar:false` |
| Cleaner / smaller | add `quality:8` (lower = better quality, larger file) |

Export **clears the recording**, so record and export each phase separately.

**Don't trust `computer` + `save_to_disk:true`** — it often returns only an image
**ID and writes no findable file**. If you use it, `ls` the path and verify before
building on it. The download above is the reliable way to get bytes on disk.

### 3. Rip stills out

```bash
ffmpeg -loglevel error -i ~/Downloads/myflow.gif frames/f-%02d.png

# contact sheet, to see which frame is which
ffmpeg -loglevel error -framerate 1 -pattern_type glob -i "frames/*.png" \
  -vf "scale=360:-1,tile=5x6" -frames:v 1 contact.png
```

`Read` the contact sheet, pick the frames showing meaningful states, and copy them
out with **descriptive names** (`do-1-role-form.png`, not `f-08.png`). Then clean
the scratch copies out of `~/Downloads`.

---

# Route B — smooth video, fully automated

**`scripts/record-flow.js` records headless Chrome at real frame rates.** No human,
no screen recorder, no picker. It drives puppeteer's `page.screencast()` (CDP-backed),
injects the visual kit, verifies the frame count, and optionally converts to gif/mp4.

```bash
# simplest: scroll-through of a page
node scripts/record-flow.js --url http://localhost:5173 --out /tmp/out.webm --gif

# with your own choreography
node scripts/record-flow.js --url http://localhost:5173 --out /tmp/out.webm \
  --flow ./my-flow.js --fps 30 --viewport 1280x800 --mp4
```

Options: `--fps` (30), `--viewport WxH` (1280x800), `--scale` (1; use 2 for retina),
`--flow`, `--gif`, `--mp4`, `--headful`, `--no-kit`, `--chrome <path>`.

A `--flow` module exports `async (page, wt, nav) => {}` and drives the injected kit:

```js
module.exports = async (page, wt, nav) => {
  // same-document steps (SPA routing, scrolling) -> wt()
  await wt(async () => {
    const card = await window.__wt.waitFor(() => document.querySelector('.card'));
    await window.__wt.focusAndClick(card, card.querySelector('h2')); // frame card, click title
    await window.__wt.smoothScrollTo(1400, 1800);
  });

  // a step that leaves the document (real hyperlink, login redirect) -> nav()
  await nav(async () => {
    const link = await window.__wt.waitFor(() => document.querySelector('a.next'));
    await window.__wt.focusAndClick(link);
  });
  // ...kit is already alive on the new page; keep going with wt()
};
```

### Multi-page apps and navigation (this is the sharp edge)

A recorder that only works on a single-page app is a toy. Two separate things break the
moment a real hyperlink swaps the document — both are handled, but know they're there
if you change this code:

- **The kit must be injected with `page.evaluateOnNewDocument`, not `page.evaluate`.**
  `evaluate` injects once into the *current* document; a cross-document navigation
  destroys that context and `window.__wt` with it, so every step after the first
  navigation throws "undefined". `evaluateOnNewDocument` re-injects into *every*
  document — including cross-origin ones — before its own scripts run.
- **`evaluateOnNewDocument` runs at document-start, when `document.body` is still null.**
  So the kit builds its overlay **lazily** on first use rather than at top level — a
  top-level `document.body.append(...)` throws at document-start and then `window.__wt`
  is never defined *at all, on any page*. If you refactor the kit, keep it body-safe.
- **A navigating click can't be a normal awaited call.** The context is torn down while
  `page.evaluate` is still waiting, so puppeteer rejects with *"Execution context was
  destroyed"*. That's the expected outcome of a successful click, not an error. `wt()`
  swallows it and **`nav()`** pairs it with `waitForNavigation` — use `nav()` whenever a
  step leaves the page.

Verified end-to-end against a real cross-origin hyperlink (`example.com` → `iana.org`):
the cursor and highlight box survive the jump and keep working on the new origin, in one
continuous recording.

### The visual layer — `assets/walkthrough-kit.js`

A recording has **no click annotations of its own**, so the cursor, highlight box
and click pulse *are* the narration — without them a viewer can't tell what was
clicked or when, and the video reads as things randomly happening. `record-flow.js`
injects the kit automatically and exposes `window.__wt`:

`focusAndClick(hlEl, clickEl?)` · `highlight(el)` / `hideBox()` · `moveTo(x,y,dur)` ·
`smoothScrollTo(y,dur)` · `waitFor(fn)` · `realClick(el)` · `sleep(ms)` · `CFG`

Several things in it are load-bearing — worth knowing before you change them:

- **Step tweens with `setTimeout(~16ms)`, never `requestAnimationFrame`.** rAF is
  throttled or paused in headless and background tabs — exactly where this runs —
  so an rAF tween silently stalls. Don't use a CSS transition either: it lags behind
  what it's chasing, so the cursor and its ring visibly drift apart mid-glide.
- **Hide the highlight box *before* the click, with no fade**, or it ghosts onto the
  next page for a frame or two and looks like a rendering bug.
- **Click via the full pointer-event sequence at `elementFromPoint`**, not a bare
  `el.click()`. Component libraries nest the real interactive node inside the wrapper,
  so a naive click often does nothing.
- **Frame one element, click another** when a card's centre sits over some other
  control — highlight the card, click its title.
- **`waitFor` everything**; an early click is the most common way a take breaks.
- **Pause on purpose** — a beat before each click and after each navigation is what
  lets a viewer keep up.

### Always verify the output

`record-flow.js` prints the decoded frame count and warns below 10. Check it — this
is what catches a silent blank/1-frame failure before you hand it to anyone:

```bash
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames -of default=nw=1:nk=1 out.webm
```

Hundreds of frames = a real video. A handful = you're still looking at a slideshow.

### Getting into an authenticated app — the one real limitation

A fresh puppeteer browser has none of the user's session. This is the **only** thing
Route B can't do by itself, and it's worth being precise about, because the obvious
workaround has been tried and does not work:

- **Copying the user's Chrome cookies does NOT ride an Entra/Azure AD SSO session.**
  Tested: a surgical profile copy carrying all 3750 cookies including 4 `ESTSAUTH*`
  session cookies still landed on an interactive `login.microsoftonline.com` password
  prompt (note `sso_reload=true` in the authorize URL — Entra tried silent SSO and fell
  back). Enterprise sessions are typically device-bound (platform SSO / PRT lives
  outside Chrome's cookie jar), so cookies alone were never going to be enough. Don't
  spend an hour rediscovering this.
- **Never type the user's credentials** to get past it. If a password field appears,
  stop and hand back to the human — that's a hard line, not a difficulty.

What actually works, in order of preference:

1. **Avoid auth entirely** — point `--url` at a local dev server, a mocked build, or
   whatever pre-auth surface shows the thing you're demonstrating. Most of the time
   the recording doesn't actually need prod.
2. **Log in programmatically** *only* where the app supports it and no human secret is
   involved (a test account from a secret store, a dev-mode bypass, an injected token).
3. **One-time interactive login into a persistent profile.** Launch `--headful` with a
   dedicated `--user-data-dir` **once**, let the human sign in themselves, then reuse
   that directory for every subsequent run — headless and fully automated until the
   session expires. This reduces the human from "runs the camera on every take" to
   "signs in once a week", and is usually the right answer for a real app.
4. **Route C** — only if even that is impossible.

---

# Route C — the human films it (last resort)

Only when Route B genuinely can't reach the app — typically an SSO session that
can't be reproduced in an automated browser. **You still choreograph and verify;
the human only runs the camera.**

1. Write a self-contained script that runs the whole flow when pasted into a console.
   Start from `assets/walkthrough-kit.js` (paste it, then call `__wt.*` in a
   sequence) — it's the same kit Route B uses.
2. **Validate it end-to-end in a browser you drive first**, so you never spend the
   human's attention on an untested script.
3. Brief them concretely: which window to focus; how to record (macOS: **⌘⇧5** →
   "Record Selected Portion" → drag over the window, which also keeps the rest of
   their desktop private); and **a tell** — e.g. *"a white arrow appears top-left,
   then starts gliding"* — so a mis-focused window is obvious immediately instead of
   after a wasted take.
4. **Take the file back and finish it yourself** — convert, re-time, verify. Their
   job ends at "here's the recording".

---

## Dead ends — verified, don't re-derive these

- **`getDisplayMedia` inside a claude-in-chrome MCP tab: permanently blocked.** MCP
  tabs are always `document.visibilityState === "hidden"` (the extension runs its tab
  group backgrounded on purpose), and the Screen Capture spec rejects with
  `InvalidStateError` unless the document is visible. Neither `window.focus()` nor a
  synthetic click fixes it, and the tabs aren't reachable via AppleScript to
  foreground them. *(Interesting aside: a `computer` click **is** a trusted event and
  **does** grant user activation — so the gesture requirement isn't the blocker.
  Visibility is.)* Route B sidesteps this entirely by not using the MCP.
- **Recording the desktop to capture an automated browser** (`ffmpeg -f avfoundation`)
  captures whatever is actually on screen — Slack, your editor — not the automated
  browser. Route B records the browser's own frames, so this is never needed.
- **"Headless can't be recorded"** — false, and worth stating plainly because it's an
  easy and expensive assumption: `page.screencast()` records headless Chrome fine.
  Route B was verified headless at 30fps.

## Tips

- **Before/after pairs**: `git stash` the fix → record BEFORE → `git stash pop` →
  record AFTER. With a dev server running, hot-reload swaps the code under an
  identical flow, so both takes differ only in the thing you're demonstrating. Write
  the flow to tolerate both outcomes (e.g. "click Back until no Back button remains").
- **mp4 for sharing**: `--mp4` writes `yuv420p` + even dimensions, which QuickTime,
  Slack and browsers require to play it at all. `.webm` is the master; convert for humans.
- **sips vs ffmpeg** (macOS): `sips` for a quick single-image probe
  (`sips -g pixelWidth -g pixelHeight file.png`); `ffmpeg` for anything multi-frame.
- **Faithful capture of a live system**: if the UI mutates something and must be left
  untouched, snapshot state first and verify after via the app's API — capture the
  truth, don't assume it.

## Concurrency

MCP work is scoped to a **tab group** (`tabs_context_mcp`), and multiple browsers can
be targeted (`list_connected_browsers` / `select_browser`), so the old blanket "never
run browser tools in parallel" rule mostly doesn't apply. The residual caveat: the
`computer` tool's mouse/keyboard actions contend on **foreground focus**, so avoid
heavy *simultaneous* `computer`-driving of the same browser. Route B launches its own
browser, so it doesn't contend with the MCP at all — you can record while the MCP
session stays untouched.

## See Also

- **claude-in-chrome** skill — connecting to and driving the browser. This skill picks
  up where that leaves off: getting the visuals onto disk.
- **upload-image-to-github** skill — if the captured images need to render in a GitHub
  PR/issue on a private repo.

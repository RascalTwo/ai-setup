# Gotchas, dead ends and tips — verified, do not re-derive

Each of these cost real time at least once. `SKILL.md` keeps only the handful that stop a
wrong turn before you know to look here.

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
- **A hidden tab throttles `setTimeout` to roughly once a minute — while you REHEARSE.** This
  does not contradict "once capture is live none of it matters": during capture Chrome pins the
  tab visible, so it never bites *on a take*. It bites every time you drive the flow **without**
  recording, which is exactly when you are debugging and least expecting it. A four-second beat
  takes several minutes, nothing errors, and the only symptom is `Runtime.evaluate` calls timing
  out at 45s because the poll loop inside them is throttled too. **Check
  `document.visibilityState` before believing a hang**, and note that "hidden" includes *the
  window being fully occluded by another app*, not just being on another tab.
- **The captured video contains the real OS pointer.** `getDisplayMedia` grabs the system
  cursor, so wherever your last `computer` click left it, it sits in every frame — usually over
  the UI. No API hides it. Use `__cap.park()` (see the recorder asset) and gate the beats on
  `__cap.parked`.
- **`navigator.clipboard.writeText()` HANGS in a hidden tab — it does not reject.** The promise
  simply never settles, then resolves the instant the tab becomes visible. So a copy-button
  trick appears to do nothing and `pbpaste` silently returns the *previous* clipboard. Set a
  flag in the handler and check it (`__copied === true`) before trusting the paste.
- **A new tab has no `sessionStorage`, so an OIDC app lands on Login.** Session tokens are
  per-tab, so opening a fresh tab on an app you were already signed into shows the login screen.
  A *reload* keeps the session; only a new tab loses it. Usually one click through the account
  picker, no password — but budget for it, and prefer reloading an existing tab.
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


---

## Modifying `assets/walkthrough-kit.js` — load-bearing details

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

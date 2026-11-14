# Gotchas, dead ends and tips: verified, do not re-derive

Each of these cost real time at least once. `SKILL.md` keeps the capture recipes; this is what to read when something behaves strangely.

## Dead ends and gotchas

- **Output paths are restricted.** In `browse execute`, screenshots go to `files.path("x.png")` (a temp folder) and must be copied out; any other path is refused. `browse recording start <path>` and `flight-recorder save-last <path>` write straight to the path you give, and a recording also leaves `<file>.json` beside it.
- **`--mode tab-capture` needs a human click.** It fails with "Extension has not been invoked for the current page" until the user clicks the browse toolbar icon on that tab. It records WebM only. Leave the default `--mode auto` (CDP) for anything a session drives.
- **Video frame rate follows repaints, not the clock.** The file says 60 fps either way; `achievedSourceFrameRate` in `browse recording status --json` tells the truth. Keystroke-driven flows through browse recorded about 10 distinct frames per second.
- **`yuvj420p` output.** `browse recording` MP4s are full-range; convert for QuickTime, Slack and Confluence (command in `SKILL.md`).
- **`sips -c H W` crops from the centre**, so it silently eats the header and breadcrumb of a page screenshot. Use `ffmpeg -vf "crop=W:H:0:0"` for a top-left anchored crop.
- **"Headless can't be recorded" is false**: `page.screencast()` and `agent-browser record` record headless Chrome fine.
- **A new tab has no `sessionStorage`, so an OIDC app lands on Login.** Session tokens are per-tab; a reload keeps the session, a new tab loses it. Usually one click through the account picker, no password; budget for it and prefer reloading an existing tab.
- **A background tab may throttle timers and clipboard promises.** Observed under claude-in-chrome: a hidden tab ran `setTimeout` about once a minute and `navigator.clipboard.writeText()` never settled until the tab became visible. browse tabs also open in the background and recorded fine, but if a poll loop or copy-button trick hangs, check `document.visibilityState` before believing the page is slow.
- **Stray puppeteer Chromes poison AppleScript.** They are the same binary as Chrome, so `tell application "Google Chrome"` can bind to a headless zombie. `record-flow.js` leaks them if a run dies; sweep them:
  ```bash
  ps aux | grep -c "[p]uppeteer_dev_chrome_profile"
  pkill -f "puppeteer_dev_chrome_profile"; rm -rf /var/folders/*/*/T/puppeteer_dev_chrome_profile-*
  ```
- **Recording the desktop to capture a browser** (`ffmpeg -f avfoundation`) captures whatever is on screen (the editor, Slack), not the target. Never needed: `browse recording` captures the page's own frames.

## Tips

- **Before/after pairs**: `git stash` the fix, record BEFORE, `git stash pop`, record AFTER. With a dev server running, hot-reload swaps the code under an identical flow. Write the flow to tolerate both outcomes ("click Back until no Back button remains").
- **Privacy**: a browse recording or screenshot of the user's real app has real data in it. Say so, and write the file under `~/.agents/state/browser/<task>/`, not `~/Downloads`.
- **sips vs ffmpeg** (macOS): `sips` for a quick single-image probe (`sips -g pixelWidth -g pixelHeight`); `ffmpeg`/`ffprobe` for anything multi-frame.
- **Clean up after yourself**: `browse session delete <name>` when done (it should vanish from `browse session list`), and undo any state the flow left in the app, such as todos in an app's local storage.

## Concurrency

browse sessions are isolated by name, so a capture session does not disturb the user's other tabs or another agent's session; never reuse a session you did not create. A spawned `record-flow.js` browser does not contend with browse at all.

## Modifying the overlay

The cursor, highlight and pulse live in the [`ui-narration`](../../ui-narration/SKILL.md) skill, along with the reasoning behind each timing. Read it before changing the kit: several of those details are load-bearing and the failure modes are silent.

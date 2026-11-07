# Claude Code runtime: Horizon Web Client in Chrome

The preferred Claude Code route into the VDI. Everything in [`SKILL.md`](SKILL.md) applies; this file is how Claude Code drives the Horizon Web Client in a Chrome tab through the Claude in Chrome tools (`mcp__claude-in-chrome__*`). It runs in the **background**: the tab can be unselected, Chrome can sit behind other apps or be minimized, and the user keeps using the Mac (tested 2026-11-01 on the real web client with every Chrome window minimized: typing, paste, OCR and an OCR-located click all landed). The native client route in [`claude-code.md`](claude-code.md) takes over the screen; use it only when the web client is unavailable.

Inside the tab the desktop is still a picture on a canvas: `find`, `read_page` and the accessibility tree see only Omnissa's wrapper page. Captures of that canvas and OCR are the only view inside.

## Setup

1. Load the Chrome tools in one `ToolSearch` call, including `javascript_tool`, `browser_batch` and `tabs_close_mcp`.
2. `list_connected_browsers`: act in the **macOS** browser. If another is in use, `select_browser` the macOS one.
3. `tabs_create_mcp`, then `navigate` it to the site's web client URL (the site child skill names it). Connecting here likely takes the desktop session over from the native client or another web client tab.
4. **Login is the user's.** At a login form (username, passcode, password, MFA), stop and ask the user to log in in that tab, then continue from the launcher.
5. On the launcher, click the desktop tile. A **Fullscreen** permission dialog appears: click **Cancel**, so the tab never takes over the user's screen.
6. Inject the helpers: `javascript_tool` with the contents of [`web-client.js`](web-client.js), then confirm it returns `["type","combo","paste","shot","click","watch","unwatch"]`. Re-inject after any reload or reconnect; `typeof vdi` tells you whether it is still there.

Keep your own tab group alive: closing the group's last other tab dissolves the group and can eject the VDI tab from it.

## Typing, keys and paste: `vdi.*` from `web-client.js`

| Need | Call | Notes |
|---|---|---|
| ASCII text, including Enter (`\n`) | `await vdi.type(text)` | About 50 wpm with randomized gaps and pauses, explicit Shift for capitals and symbols. Throws on non-ASCII. |
| Shortcut | `await vdi.combo('ctrl+t')` | Modifiers `ctrl`, `shift`, `alt`; key is a letter or `enter`, `tab`, `escape`. Guest-OS modifiers, not the Mac's. |
| Long text, non-ASCII, a file's contents | `await vdi.paste(text)` | Feeds Horizon's clipboard sync with a synthetic paste event, then sends Ctrl+V. The Mac clipboard is never touched. |

All three send to Horizon's hidden `#clipboard-input` textarea, which forwards keys to the guest. Click the target field in the guest first so the keys land there.

The extension's own `computer` `type` action drops Shift and the first character into Horizon; use `vdi.type`. If `#clipboard-input` is missing (a new client version), `vdi.type` and `vdi.combo` fall back to the focused element and `vdi.paste` throws: re-test on a scratch Notepad tab before trusting either.

Tested 2026-11-01 on the real web client: 125 characters of every ASCII symbol plus Enter landed exactly (Notepad's character count and cursor column matched), as did a 250-character paste with accents, smart quotes and `✓`.

## Seeing and clicking: shot, OCR, click

The default loop costs no vision tokens: the page exports Horizon's canvas, OCR reads it on the Mac, and the click goes back in the same pixel space.

1. `const s = await vdi.shot()` saves the guest screen as a full-resolution PNG (`s.file`) to `~/Downloads` and returns `s.size`. The download lands a moment after the call returns: wait for that exact file name to exist before reading it.
2. OCR it (below) and pick the target's centre.
3. `await vdi.click(x, y, s.size)` clicks there.
4. Prove the click with a new `shot()` and OCR, then move the shots out: `mv ~/Downloads/vdi-shot-*.png ~/.agents/state/omnissa-horizon-vdi/shots/`.

Each tool call attaches the debugger, and Chrome's "started debugging this browser" bar comes and goes, so the page height changes and Horizon resizes the guest (3344×2072 ↔ 3344×1960 seen) and reflows its windows. `shot()` and `click()` wait for the size to hold still; `click()` throws `guest resized … take a new shot()` when the size differs from the shot's, which is the cue to go back to step 1. A click with no size skips the guard: always pass it.

The first `shot()` on a site makes Chrome ask "download multiple files?" in the address bar, and downloads stay silently blocked until the user clicks **Allow**. When a shot's file never appears, ask the user to check for that prompt.

The first click on an inactive guest window only activates it: click once to activate, then click the target.

For layout judgment, or when OCR can't name the target (an icon, a colour), take a `computer` `screenshot` and look. Its coordinates are in the frame the result reports (1432×840, 1400×868 seen), not canvas pixels, so click those with `computer` `left_click`, not `vdi.click`.

## Waiting for a screen state: `vdi.watch()` and `vdi-watch.sh`

To wait for something to appear in the guest (a build finishing, a dialog, an email, a page loading) without polling screenshots yourself, let the page export frames and let the Mac judge them, at no Claude tokens:

1. Start the Mac side first with Bash `run_in_background: true`, so it has cleared old shots before frames arrive:
   - Text the screen will show: `sh <skill dir>/vdi-watch.sh --timeout 600 --text 'Deployment succeeded|failed'`. OCR plus a case-insensitive extended regex, under a second per frame. Prefer this whenever the state has words.
   - A visual state with no reliable words: `sh <skill dir>/vdi-watch.sh --timeout 600 '"a red error dialog" or "a spinner"'`, any [`watch-for`](../watch-for/SKILL.md) expression (local d1 model, ~3 s per full frame, confirms over 2 frames).
   Put the failure outcome in the same pattern or expression so a failure ends the wait too.
2. `javascript_tool`: `vdi.watch()` downloads a shot every 3 s (`vdi.watch({ every: 5000, max: 600000 })` to change the pace or the 30-minute self-stop).
3. You are notified when the script exits: 0 prints the matched OCR line or watch-for's JSON plus a `frame` path, 1 is a timeout or shots that stopped coming for `--stale` seconds (30 by default: the page reloaded, the session dropped, or downloads are blocked), 2 is an error.
4. `vdi.unwatch()`, then look at the frame once yourself before acting on it, as with any watch-for match.

The script deletes the shots it judged and keeps only the matched frame. It also deletes any `vdi-shot-*.png` already in `~/Downloads` when it starts, so don't run it while a manual `shot()` file is still unread.

Why the worker: Chrome slows a hidden tab's own timers to about one tick a minute after the tab has been hidden 5 minutes (measured 2026-11-01: a 3 s `setInterval` stretched to gaps of 11–60 s), but not a Web Worker's timers (steady 3 s over the same 9 minutes). `vdi.watch()` takes its tick from a worker and skips `shot()`'s settle wait, whose page timers would stall the same way.

Not yet run on the real web client (tested 2026-11-01 with simulated downloads and the throttling measured on the Guacamole sandbox). On the first real use, confirm the frames stay fresh while the tab has been hidden over 5 minutes, for example by OCR of the guest taskbar clock changing minutes: if Horizon stops drawing to its canvas in a hidden tab, every frame is stale and the wait never matches.

A session drop needs no image at all: the page URL ends in `#/home` at the login page or launcher and `#/desktop` while connected.

## OCR

[`ocr.swift`](ocr.swift) runs Apple Vision OCR on an image and prints each text box with its centre in that image's pixels: canvas pixels for a `vdi.shot()`, the screenshot frame for a `computer` screenshot saved with `save_to_disk: true` and no `scale` (the saved file is exactly the returned image; a half-scale one is too small to read). Build it once to a fixed path and reuse it:

```sh
B=~/.agents/state/omnissa-horizon-vdi/ocr; [ "$B" -nt <skill dir>/ocr.swift ] || swiftc -O -o "$B" <skill dir>/ocr.swift
"$B" <image>
```

A new binary pays a one-time ~40–60 s model load on its first run (even a plain copy of a warm one); after that a run takes under a second. OCR finds text and targets well but misreads symbols (`{` as `(`, `|` as `[`), so prove exact text another way: the app's own counters (Notepad's status bar shows characters and cursor column), or a `zoom`.

## Keeping the session

- Chrome's Memory Saver can discard an idle tab and drop the session: the site should be on Settings → Performance → "Always keep these sites active". Only the user can change it; the extension cannot open `chrome://` pages.
- When a screenshot shows the Horizon login page or the launcher instead of the desktop, the session dropped: tell the user and wait for them to log in.

## Handing back

Nothing to hand back: the tab never takes focus. Leave fullscreen off and any guest dialog you opened cancelled.

## Sandbox

[`sandbox/`](sandbox/) runs a throwaway browser-based remote desktop on the Mac (Guacamole in front of a Linux XFCE desktop over RDP) for testing input and background mechanics without the real VDI: `sh <skill dir>/sandbox/up.sh` prints the URL; log in as `claude` with the password in `~/.agents/state/vdi-sandbox/guac-pass`. `docker exec vdi-sandbox-desktop-1 cat /config/<file>` reads back what an editor saved, an exact check. Anything specific to Horizon (`#clipboard-input`, `vdi.paste`, `vdi.shot` and `vdi.click` on `#mainCanvas`, Horizon policies) still needs one confirming run on the real web client.

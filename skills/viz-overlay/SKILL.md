---
name: viz-overlay
description: "Draws a viz (any HTML/CSS/JS page) over the real macOS screen: transparent, click-through except where the page asks for clicks, always on top, aligned to real app windows, UI elements and elements inside browser pages, following them as they move. Use to annotate, tour or explain a running app in place, to point at several things at once with rich graphics, or when a viz should sit on top of the thing it is about instead of in a tab or panel. Also for showing the user where to click or putting a cue card on screen."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: delete
  integrates:
    viz: a viz id or URL is the page; the page contract lets it target real windows
    herdr: what the page sends is typed into the session's pane; --when pane follows the pane's focus
    ghostty: --when pane shows only while Ghostty is frontmost
  requires:
    commands: [herdr]
    manual:
      - "macOS + Xcode command line tools to build the host (helper/build)"
      - "Accessibility for the terminal app, for element targets, window titles and raising"
---

# viz-overlay: vizzes drawn over the real screen

`viz-overlay show` puts a web page in a transparent, borderless, never-activating panel above every window on one display. Clicks pass through to the apps below except over the page's `[data-overlay-hit]` elements; the app the user is in stays active. The host follows a target (an app window, an Accessibility element, an element inside a web page, or a rect riding on a window), hands its live rect to the page, and shows or hides the overlay by a rule. A ✕ pill (bottom-right of the screen) always closes it.

Building the page is the `viz` skill's job (worked example: the viz `.agents/state/viz/finder-overlay-tour`, a spotlight tour that tracks Finder's window and toolbar live and replays a snapshot in a browser); this skill is how it gets onto the screen and what the page may call. The page API (`window.overlay`), coordinates, snapshots and the standalone mode are in [reference/contract.md](reference/contract.md): read it before writing or changing an overlay page.

## Setup (once per machine)

1. `helper/build` (Swift; macOS). Then `ln -s <this skill>/helper/viz-overlay ~/.local/bin/viz-overlay`.
2. Done when `viz-overlay doctor` shows ✓ for Accessibility and bridge.js; herdr, the pane and the viz server lines matter for messages and viz ids.

## Showing an overlay

1. Find the target. `viz-overlay elements --app Finder [--match back] [--role button] [--web]` lists visible labelled elements with their global rects (the same space `--rect` takes; `--web` = inside web pages only).
2. Show it:
   ```sh
   viz-overlay show <viz id | URL | file.html> --target "App[:window title]" [--element LABEL | --web LABEL] [--role ROLE] [--rect x,y,w,h] [--when target|pane|always] [--title TEXT] [--no-close]
   ```
   It raises the target once (`--no-raise` to skip), fails fast with exit 3 and the reason when the target isn't there, and returns once the page is up, printing its id and log path (`--json` for the record).
3. Done when the command exits 0. What the page sends arrives in the session as `[viz-overlay · <title>] <text>` and in the log (`~/.agents/state/viz-overlay/logs/<id>.jsonl`, one JSON event per line: shown/hidden with the reason, target changes, sends, the page's uncaught errors (`page-error`), closed).

**When it shows** (`--when`, one rule per overlay):

| Rule | Shown while | Default when |
|---|---|---|
| `target` | the target is on screen and not covered by another app's window (scrolled out of its window counts as covered) | `--target` is given |
| `pane` | Ghostty is frontmost and this session's herdr pane is focused | no `--target` |
| `always` | always | never |

**Talking to the page.** What the page sends comes to you (above); what you send it goes through `viz-overlay update <id> <json>` (or `-` to read the JSON from stdin), which the page gets as `overlay.on("data", cb)` and `overlay.data`. Use it for anything that changes while the overlay is up: a progress bar, the next step of a tour, an answer to what the user picked. Exit 2 for bad JSON, 3 for no such overlay.

**Lifetime.** An overlay lives until its session's agent process exits (`CLAUDE_PID`), the ✕ or the page's `overlay.close()`, or `viz-overlay stop <id> | --session | --all`. `--no-close` drops the ✕, for a page that brings its own way out (app-panel's card folds instead). No timer unless `--duration SECONDS`; prompts don't clear it. `viz-overlay list` shows live ones.

**Exit codes:** 0 ok, 1 failed (the page didn't load; the reason is in the log), 2 bad input, 3 target not found, 4 permission missing.

## Targets inside web pages

`--web LABEL` (or `web:` in `overlay.track`) searches only below the page's AXWebArea, so a toolbar button with the same label never wins. Chrome exposes page content to Accessibility only for some tabs (it did for one tab and not another in the same session, 2026-11; bigarrow found it needs `--force-renderer-accessibility` or VoiceOver). When it doesn't, the target comes back gone with that reason. Then measure the element with Claude in Chrome (`getBoundingClientRect()` in `javascript_tool`) and pass `--rect`, at 100% zoom:

```
--rect (screenX + r.x),(screenY + outerHeight - innerHeight + r.y),r.width,r.height
```

A rect rides on its window: when the window moves, the rect moves with it. A scroll inside the page does not move it; measure again.

## Gotchas

- Messages need herdr: outside a herdr pane they go only to the log. While a permission prompt is open herdr refuses to type, so delivery retries every 2 s for up to 10 minutes.
- A full `elements` listing walks the whole app and can take up to 6 s (bigarrow's budget; Finder's desktop is large). Targets stop at the first exact visible match and then re-read just that element 4×/s.
- A page reload (the viz server's live reload) clears the page's tracks; the page tracks again as it starts, so write tracking in the page's startup code.
- Typing: a click into a text field in a hit region, or into an iframe in one (focus inside another origin can't be seen, so any click there counts), takes the keyboard while the app below stays active; clicking anywhere else gives it back. A field the page focuses by itself (autofocus) never takes it. Esc should give it back too (a listen-only key watcher), but only real key presses can test that: synthetic Esc events never reached it.
- Displays left of or above the main one shift coordinates (see the contract); on the main display and any to its right or below, 1 CSS px = 1 global screen point.

Tests: `bun test` in this skill (pure logic plus the real binary on the real screen; the overlay flashes up for a few seconds). Ported code and its licence: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Why this is not part of app-panel (yet): [docs/adr/2026-11-11-keep-viz-overlay-beside-app-panel.md](../../docs/adr/2026-11-11-keep-viz-overlay-beside-app-panel.md).

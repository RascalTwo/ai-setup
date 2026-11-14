---
name: browser
description: Drives a web browser for the agent, signed in as the user or headless. Use whenever a task needs a browser, such as reading or acting on a web page or signed-in site, testing a web app, filling a form, or taking screenshots, recordings or PDFs of a page.
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: delete
  integrates:
    chrome: OpenCode Browse extension (default), cdp-relay (fallback)
  requires:
    tools: [cdp-relay]
    commands: [browse, agent-browser]
    manual: [Chrome, OpenCode Browse extension paired with `browse pair`]
---

# Browser

Pick the tool by the job, then follow its recipe. Measured head-to-head on 2026-11-13 (basic-memory note `agent-browser & agent-desktop vs claude-in-chrome & computer-use (2026-11)`): OpenCode Browse was fastest and cheapest and never took the user's focus; agent-browser is the headless and fallback path; claude-in-chrome is the last resort.

| The job | Tool |
|---|---|
| Anything in the user's Chrome: signed-in sites, their tabs, a local web app | **browse** (default) |
| A page that needs no login and should never touch the user's Chrome; isolated or parallel runs | **agent-browser, headless** |
| browse is down (`browse status` says the extension is disconnected and the user can't reconnect it now) | **agent-browser through the cdp-relay** |
| An older skill that names claude-in-chrome, a slideshow GIF (one frame per action), or both tools above failed | **claude-in-chrome** |

Every path works under `claude -p`. Artifacts you keep (screenshots, recordings, PDFs) go in `~/.agents/state/browser/<task>/`.

## browse (OpenCode Browse)

Agents run Playwright code against a named session's page. Agent tabs open in the background of the user's Chrome and never take focus.

1. `browse status`: shows `Extension: connected`. Disconnected means the user reopens Chrome or re-pairs (`browse pair`).
2. `browse session new <name>`, one per task.
3. `browse execute -s <name> --timeout-ms 60000 '<async Playwright code; return a value>'`. Write **whole sequences in one script** (fill, click, read, return): this is where browse's speed comes from. `snapshot()` returns an outline of the page with refs; return only what you need to see.
4. Give **every action its own timeout**: `locator.click({ timeout: 5000 })`. browse ignores `page.setDefaultTimeout` and `context.setDefaultTimeout`, so a selector that matches nothing otherwise waits the full 30 s.
5. Files: browse reads and writes only inside `files.dir`. Screenshots: `const p = files.path("name.png"); await page.screenshot({ path: p }); return p`, then `cp` the returned path into `~/.agents/state/browser/<task>/` (it is a temp folder). Uploads (`setInputFiles`) and `files.read` need the file copied into `files.dir` first.
6. Page globals: `page.evaluate` runs in an isolated world that shares the DOM and `localStorage` but not the page's own JS globals (an app's `window.editor`). To reach those, use a CDP session: `const c = await context.newCDPSession(page); await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })` (tldraw-canvas `scripts/main.sh` wraps it).
7. Logins, 2FA, payments: call `handoff()` in the script; the user finishes in the tab and clicks Continue.
8. `browse session delete <name>` when done. Done means the session is gone from `browse session list`.

`browse --help` and `browse execute --help` cover recording, network capture, site secrets and allowlists.

## agent-browser, headless

`agent-browser --session <name> open <url>`, then `snapshot -i` (refs like `@e3`), `click @e3`, `fill @e5 "text"`, `get text`, `screenshot <path> [--full]`, `record start <file.mp4>`. Chain several in one Bash call with `&&`. Finish with `agent-browser --session <name> close`. It runs its own Chrome for Testing: no logins, no effect on the user's screen.

## agent-browser through the cdp-relay

Same commands with `--cdp ws://127.0.0.1:9333/devtools/browser/relay`. Open your own tab with `tab new --label <name> <url>` and finish with `tab close <name>`. Check `curl -s 127.0.0.1:9333/stats` shows `"upstream":true` first. Attached any other way, agent-browser pulls Chrome to the front; the relay is what keeps it in the background (see `tools/cdp-relay`).

## claude-in-chrome

Its `mcp__claude-in-chrome__*` tools, loaded in one ToolSearch call. `find` sees only the accessibility tree: refs go stale, and hidden, off-screen or virtualized elements are missing, so query the DOM with `javascript_tool` or re-read the page right before acting. "Permission denied for this action on this domain" is final for that site: tell the user and use another path.

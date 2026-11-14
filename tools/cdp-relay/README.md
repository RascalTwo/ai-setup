---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    launchd: [com.rascaltwo.cdp-relay]
    agent-browser: --cdp ws://127.0.0.1:9333/devtools/browser/relay
  requires:
    commands: [node, npm, agent-browser]
  platforms: macOS (launchd, Chrome's DevToolsActivePort path)
---
# cdp-relay

Lets agent-browser drive your real, signed-in Chrome without taking your screen.

Attached straight to Chrome over CDP, agent-browser 0.41–0.43 pulls Chrome to the front and hides the tab you're on every time it opens a tab: it calls `Target.createTarget` without `background: true` and sends `Page.bringToFront` on tab switch. Upstream issue [#1247](https://github.com/vercel-labs/agent-browser/issues/1247) has been open since April 2026, and the fix PRs (#1880, #2292, #1427) are unmerged. Measured on 2026-11-13: attached directly, Chrome came to the front about 6 s into a run and the user's tab was hidden for 14–17 s. Through this relay, nothing moved. Every attach also costs an "allow remote debugging" click, which an unattended run can't give.

## What it does

agent-browser connects to `ws://127.0.0.1:9333/devtools/browser/relay` instead of to Chrome. The relay:

- holds **one** connection to Chrome and shares it, so you click Allow once per Chrome run, not once per agent session;
- adds `background: true` to every `Target.createTarget`;
- answers `Page.bringToFront`, `Target.activateTarget` and `Browser.close` itself; they never reach Chrome;
- turns on `Emulation.setFocusEmulationEnabled` for tabs it created, so a hidden tab still takes clicks ([#2146](https://github.com/vercel-labs/agent-browser/issues/2146));
- reconnects on its own when Chrome starts or restarts (it polls `DevToolsActivePort` every 5 s), so the Allow prompt shows up when you open Chrome, not in the middle of an unattended run.

`curl -s 127.0.0.1:9333/stats` shows the counters and whether it's connected.

## Limits

- **Anything local can drive your signed-in Chrome while it runs**, with no prompt. It binds 127.0.0.1 only. That's the accepted price of "one Allow".
- **Discarded tabs stay asleep.** agent-browser revives a Memory Saver tab with `Target.activateTarget`, which the relay swallows. The agent should open its own tab instead.
- **Chrome must have remote debugging on** (chrome://inspect/#remote-debugging, Chrome 144+). With it off, the relay waits and retries.
- It changes nothing about headless agent-browser, which needs no relay.

## Use

```sh
agent-browser --cdp ws://127.0.0.1:9333/devtools/browser/relay --session mine tab new --label work https://example.com
```

Always open your own tab (`tab new`) and close it when done. Never use `close` to mean "close my tab": it ends the agent-browser session (the relay keeps Chrome open either way). The `browser` skill covers when to use this and when to use headless instead.

## Install

launchd may not read scripts under `~/Desktop` (TCC: "Operation not permitted"), where this repo lives, so it runs an installed copy. Re-run after changing `cdp-relay.js`:

```sh
mkdir -p ~/.agents/state/cdp-relay
cp ~/.agents/ai-setup/tools/cdp-relay/{cdp-relay.js,package.json,package-lock.json} ~/.agents/state/cdp-relay/
(cd ~/.agents/state/cdp-relay && npm ci --omit=dev --no-audit --no-fund)
sed "s|/Users/YOUR-USER|$HOME|g" ~/.agents/ai-setup/tools/cdp-relay/launchd/com.rascaltwo.cdp-relay.plist > ~/Library/LaunchAgents/com.rascaltwo.cdp-relay.plist
launchctl bootout gui/$(id -u)/com.rascaltwo.cdp-relay 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rascaltwo.cdp-relay.plist
```

Then click Allow in Chrome once. Check: `curl -s 127.0.0.1:9333/stats` shows `"upstream":true`, and `~/.agents/state/cdp-relay/relay.log` ends with `upstream connected`. The state folder only holds the installed copy and its log, so it's safe to delete (reinstall to restore).

## Test

`cd tools/cdp-relay && npm test` runs the real relay against a fake Chrome (a `ws` server) and checks each rewrite: `background: true`, id mapping, focus emulation on attach, the three swallowed calls, and event routing between two clients.

---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: retain
  integrates:
    launchd: [com.rascaltwo.chrome-reaper]
  requires:
    commands: [sh]
  platforms: macOS (launchd, getconf DARWIN_USER_TEMP_DIR)
---
# chrome-reaper

Kills automation browsers whose parent died, every 60 seconds, and deletes the temp profiles they leave behind.

A test run (Puppeteer, Playwright, the viz suite, pr-viz stills, browser-capture) closes its browser when it ends normally. Killed instead (a closed herdr pane, a timeout, `kill -9`), it never gets the chance, and the browser keeps running under launchd with nothing to stop it. On 2026-10-13, 17 of them had grown to ~1,550 processes and filled 47 GB of swap. No fix inside each tool survives `kill -9`, so this sweeps from outside, for every tool at once.

**What it kills:** a process whose parent is PID 1 (orphaned) and that is an automation browser: run from Playwright's or Puppeteer's browser cache (`ms-playwright`, `~/.cache/puppeteer`), or a Chrome started `--headless` or on a Puppeteer/Playwright temp profile. Your own Chrome, including the one Claude in Chrome drives, is none of these. A browser whose test is still running has a live parent and is left alone.

**What it deletes:** Puppeteer/Playwright temp profiles in the user temp dir untouched for an hour that no running process names.

**One sweep at a time:** launchd never starts a run while the last one is going, and a lock (`.lock` beside the log, a symlink to the sweep's pid) makes a run by hand, `--dry-run` too, exit at once when it meets one. A lock left by a killed sweep is taken over.

Each kill is logged to `~/.agents/state/chrome-reaper/reap.log` with its profile path, which points at the tool that leaked it.

## Install

launchd may not read scripts under `~/Desktop` (TCC: "Operation not permitted"), where this repo lives, so it runs an installed copy. Re-run after changing `reap.sh`:

```sh
mkdir -p ~/.agents/state/chrome-reaper
cp ~/.agents/ai-setup/tools/chrome-reaper/reap.sh ~/.agents/state/chrome-reaper/
sed "s|/Users/YOUR-USER|$HOME|g" ~/.agents/ai-setup/tools/chrome-reaper/launchd/com.rascaltwo.chrome-reaper.plist > ~/Library/LaunchAgents/com.rascaltwo.chrome-reaper.plist
launchctl bootout gui/$(id -u)/com.rascaltwo.chrome-reaper 2>/dev/null
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rascaltwo.chrome-reaper.plist
```

Check: `launchctl list | grep chrome-reaper` shows exit status 0, and `launchd.err` beside the log stays empty.

## Test

`sh tools/chrome-reaper/reap.test.sh` (~10 s) starts real headless Chromes: an orphan is reaped, one with a live parent is kept, a stale profile is removed and one in use is kept. `sh reap.sh --dry-run` logs what it would do without doing it.

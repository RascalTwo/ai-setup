---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: retain
  integrates:
    claude-code-hooks: [PreToolUse .*]
    statusline: statusline-supervisor.sh
  requires:
    commands: [python3]
---
# supervisor

A PreToolUse hook that refuses a Claude Code tool call before it runs when the call does something that is wrong whoever asked for it. It runs on every call, in subagents and in Kelpie's `--dangerously-skip-permissions` runs too (a hook deny holds in bypass mode, and Kelpie's own `--settings` hooks add to the user hooks rather than replacing them; both tested on 2.1.319). No model and no network: about 36 ms a call.

Why it exists: anthropics/claude-code#107757, Claude putting the account email into User-Agent headers. The built-in `cc-plugin-privacy` mod (2.1.317) refuses only a shell call that holds the *logged-in* address and names a User-Agent. A past session here got past that: a subagent wrote a script whose User-Agent named the personal Gmail address, and ran it against Wikimedia by name.

## The rules

`check()` in [`supervisor.py`](supervisor.py) is the source of truth, and [`supervisor.test.py`](supervisor.test.py) pins what each rule refuses and the nearest thing it must let through.

- **my-email**: any of the user's addresses beside a User-Agent, anywhere (a file being written counts), or sent to a service that doesn't hold that account. The addresses are collected on every call from the google skill's `accounts.json`, `~/.gitconfig`, the Claude login, and `~/.config/supervisor/emails.txt` for any others.
- **secret-out**: a live-shaped token sent to a service that didn't issue it, or a key or credentials file uploaded.
- **remote-code**: a download piped into a shell.
- **destroy**: recursive delete of the home folder, a top-level or system folder; erasing a disk.
- **history**: force-push to main, master or trunk.

Two lessons from tuning, so nobody "simplifies" them away: an address or token going to its *own* service is normal (Atlassian basic auth, gws, the Timeline Studio token), and the command rules read only text the shell runs. A heredoc written to a file, or a string inside Python, is data.

Calls that are only wrong if the user didn't ask for them (`pkill`, `git branch -D`, cloud deletes, `npm publish`) are deliberately not rules: over 30 days every one of their 391 hits was intended work. They need a judge that reads the user's prompt, which is the follow-up Timeline Studio task.

## Fails open

A crash lets the call through and appends to `~/.agents/state/supervisor/errors.log`. The statusline shows a yellow 🛡⚠ while that log is under an hour old. A refusal stopping every call in every session would be worse than one unchecked call. Claude Code also lets the call through if the hook times out. Each refusal is logged to `~/.agents/state/supervisor/log`.

## Install

`settings/claude-code/settings.json` runs it as a `PreToolUse` hook on `.*`. To turn it off, remove that entry.

## Test

- `python3 tools/supervisor/supervisor.test.py`: every rule against the call it is for and its nearest innocent neighbour, plus the hook's deny shape and its fail-open path (under a second).
- `python3 tools/supervisor/replay.py [days]`: runs the rules over every tool call in your real transcripts and reports what they would have refused, writing each hit to `~/.agents/state/supervisor/replay-hits.jsonl`. Run it after changing a rule. On 2026-11-08 it read about 102,600 calls over 30 days and refused the Wikimedia leak, one fake token in test code, and otherwise only the deliberate probes and the incident write-ups from the session that built it.

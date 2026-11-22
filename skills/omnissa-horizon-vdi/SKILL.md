---
name: omnissa-horizon-vdi
description: Operates a remote desktop through Omnissa Horizon on macOS, via the Horizon Web Client in Chrome (Claude Code, background) or the native client (Claude Code computer-use, Codex node_repl). Use when the user asks you to work in their VDI, Horizon/Omnissa, a remote or virtual desktop, or a machine reached by hopping from one.
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    omnissa-horizon-client: remote desktop control
    chrome: Horizon Web Client
    deskpad: virtual display (Codex)
  requires:
    skills: [read-image-locally]
    manual: [Omnissa Horizon Client, computer-use, Chrome, claude-in-chrome]
---

# Omnissa Horizon VDI

Operate a remote desktop inside Omnissa Horizon. Horizon input routing is sensitive to macOS focus, fullscreen state, and which surface receives the first click: verify control before task work.

## Load what applies

Read these before the first action. Each covers one branch; skip the ones that don't apply.

- **Your runtime**, exactly one:
  - Claude Code → [`web-client.md`](web-client.md), the default: the Horizon Web Client in a Chrome tab, driven in the background with page-level typing and paste.
  - Claude Code with the native client, only when the web client is unavailable → [`claude-code.md`](claude-code.md): setup, typing, key names, focus.
  - Codex → [`codex.md`](codex.md): `node_repl` + `sky`, DeskPad virtual display.
- **The guest OS** you see in the first screenshot:
  - Windows → [`guest-windows.md`](guest-windows.md): chords, probes, popups, lock screen, Explorer/Notepad/Services habits.
- **The site**: if a child skill named `omnissa-horizon-vdi-<site>` is installed for the organisation whose VDI this is, load it too. It holds that site's recipes: its hosts, repos, pipelines and deploy layouts.

## Control Probe

Run a quiet, task-shaped probe before real work, and again after the user alt-tabs or changes display settings. Prefer probes that leave no artifact on the remote desktop.

1. Re-query Horizon state (screenshot).
2. Click well inside the remote content area, away from the macOS titlebar and Horizon toolbar.
3. Click a visible control that is already part of the task (a browser tab, a folder) and confirm the expected pane appears. The guest-OS file names a fallback probe.
4. If the UI did not change, recover before proceeding.

## Operating Pattern

- Prefer visible controls over global keyboard shortcuts.
- Keep batches small and predictable: click/paste/key, then one screenshot or zoom. Re-derive coordinates from the latest screenshot. Horizon's accessibility tree exposes only the Mac wrapper, so screenshots are the only view inside.
- A browser URL bar is the fastest navigation: paste a full URL rather than clicking through menus.
- A raw or plain-text view (raw file, `.diff` of a merge request, a job's config XML) is denser and safer to read than the page around it: no buttons to misclick. Zoom the browser out, then zoom-read each screen in two halves.
- Dismiss toast notifications when they cover a target; they swallow clicks.
- When checking read/unread state, prefer the app's own filters or counters over badges. Opening a message may mark it read, so capture the evidence first.

## Act like a person at the keyboard

Corporate desktops run endpoint security sensors that watch for automated behaviour. Type what a developer would: one short, readable command at a time, then look at the result before the next. A burst of requests in one long pasted one-liner, especially requests carrying made-up credentials against an auth endpoint, reads as an attack even against `localhost`. Ordinary commands (a `curl`, a file listing, starting the app) are fine.

On a hopped-to **server**, be stricter still: browse folders and open files in Explorer/Notepad like a person would. Do not run admin-shell reconnaissance (process lists with command lines, registry reads, ACL dumps, memory/disk inventories); those match what security monitoring alerts on. Ask the user before anything beyond reading the files you came for.

## Hopping

The VDI can be one hop in a chain: from it the user may remote into further machines, each shown as a window with its own connection bar. Before acting, confirm from that window's title which machine you are on, and say it when you report. Minimize or restore that window from its connection bar to step back a hop. Clipboard paste reaches the hopped-to machine too. Treat a hopped-to machine as more sensitive than the VDI: reading is the default; changes need the user's go-ahead.

## Screenshot Reading

To find text and click targets on a saved screenshot, run [`ocr.swift`](ocr.swift) (Apple Vision, no vision tokens; build and timing notes in [`web-client.md`](web-client.md)). Use the `read-image-locally` skill for structured extraction: exact fields, titles, counts, table rows, error text, with a crop when the target region is known. Read natively when local vision misses small or dense UI text, or when the task needs layout judgment.

## Failure Recovery

- **Input stops landing**: re-query state, click inside the remote content, rerun the probe. Runtime and guest-OS fixes live in their files.
- **Login, MFA, lock screen, or a password prompt**: stop and ask the user to handle it.

## Skill and Memory Updates

This skill is public. Record durable improvements to driving a VDI here, in the file whose branch it belongs to: shared behaviour in this file, agent mechanics in the runtime file, OS habits in the guest-OS file. A new guest OS gets its own file and a line under **Load what applies**.

Keep this skill generic: no hostnames, project names, people, or client-identifying details. Anything specific to one organisation's environment goes in its child skill. Keep VDI operating lessons out of Basic Memory when they can live here.

## Safety

Reading the VDI is allowed when the user asks. Sending messages, joining meetings, submitting forms, changing tickets, deleting data, re-running jobs, restarting services, or transmitting sensitive data each need the user's explicit go-ahead for that action.

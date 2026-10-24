---
name: omnissa-horizon-vdi
description: Operates a remote desktop through Omnissa Horizon Client on macOS, from Claude Code (computer-use MCP) or Codex (node_repl). Use when the user asks you to work in their VDI, Horizon/Omnissa, a remote or virtual desktop, or a machine reached by hopping from one.
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    omnissa-horizon-client: remote desktop control
    deskpad: virtual display (Codex)
  requires:
    skills: [read-image-locally]
    manual: [Omnissa Horizon Client, computer-use]
---

# Omnissa Horizon VDI

Operate a remote desktop inside Omnissa Horizon Client. Horizon input routing is sensitive to macOS focus, fullscreen state, and which surface receives the first click: verify control before task work.

## Load what applies

Read these before the first action. Each covers one branch; skip the ones that don't apply.

- **Your runtime**, exactly one:
  - Claude Code → [`claude-code.md`](claude-code.md): setup, typing by clipboard paste, key names, focus.
  - Codex → [`codex.md`](codex.md): `node_repl` + `sky`, DeskPad virtual display.
- **The guest OS** you see in the first screenshot:
  - Windows → [`guest-windows.md`](guest-windows.md): chords, probes, popups, lock screen, Explorer/Notepad/Services habits.
- **The task**, when it applies:
  - Reading a web app's data → [`web-app-apis.md`](web-app-apis.md), and its GitLab endpoints.
  - Finding which build a server runs, or what config it shipped with → [`deployed-builds.md`](deployed-builds.md).

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
- Dismiss toast notifications when they cover a target; they swallow clicks.
- When checking read/unread state, prefer the app's own filters or counters over badges. Opening a message may mark it read, so capture the evidence first.

## Hopping

The VDI can be one hop in a chain: from it the user may remote into further machines, each shown as a window with its own connection bar. Before acting, confirm from that window's title which machine you are on, and say it when you report. Minimize or restore that window from its connection bar to step back a hop. Treat a hopped-to machine as more sensitive than the VDI: reading is the default; changes need the user's go-ahead.

## Screenshot Reading

Use the `read-image-locally` skill for structured extraction: exact fields, titles, counts, table rows, error text, with a crop when the target region is known. Read natively when local vision misses small or dense UI text, or when the task needs layout judgment.

## Failure Recovery

- **Input stops landing**: re-query state, click inside the remote content, rerun the probe. Runtime and guest-OS fixes live in their files.
- **Login, MFA, lock screen, or a password prompt**: stop and ask the user to handle it.

## Skill and Memory Updates

Record durable improvements to this VDI workflow here, in the file whose branch it belongs to: shared behaviour in this file, agent mechanics in the runtime file, OS habits in the guest-OS file, task recipes in their own file. A new guest OS or task gets its own file and a line under **Load what applies**.

Keep notes generic: no hostnames, project names, people, or client-identifying details. Keep VDI operating lessons out of Basic Memory when they can live here.

## Safety

Reading the VDI is allowed when the user asks. Sending messages, joining meetings, submitting forms, changing tickets, deleting data, re-running jobs, restarting services, or transmitting sensitive data each need the user's explicit go-ahead for that action.

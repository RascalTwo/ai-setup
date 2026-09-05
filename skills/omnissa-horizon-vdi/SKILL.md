---
disable-model-invocation: true
name: omnissa-horizon-vdi
description: Control a remote Windows desktop through Omnissa Horizon Client on macOS using DeskPad as a virtual display. Use this whenever the user asks Codex to operate a VDI, a remote/virtual desktop, Omnissa/Horizon, or any app running inside one — mail, chat, calendar, a ticket queue, a line-of-business app — especially when they want the Mac screen to remain usable while the agent works.
---

# Omnissa Horizon VDI

Use this skill to operate a remote Windows desktop inside Omnissa Horizon Client without taking over the user's built-in Mac display.

This workflow is empirical. Horizon input routing is sensitive to macOS focus, fullscreen state, and which surface receives the first click. Verify control before doing task work.

## Tooling

- Use `node_repl` with the bundled `computer-use` runtime for all GUI actions.
- Follow the `computer-use` skill for current `sky` bootstrap instructions. Do not copy a stale plugin path into this skill.
- Target Horizon directly. Prefer the app name `Omnissa Horizon Client`; fall back to the macOS app path only if app-name targeting fails.
- Use DeskPad to provide the extra display.
- Use the `read-image-locally` skill first for structured screenshot extraction. Fall back to native image reading when local vision misses dense or small UI text.

## Preferred Display Setup

1. Launch DeskPad if it is not running.
2. Confirm macOS sees `DeskPad Display`:

   ```bash
   system_profiler SPDisplaysDataType | sed -n '1,260p'
   ```

3. Put Horizon in windowed mode if it is fullscreen.
4. In Horizon, use `Window > Move to DeskPad Display`.
5. Keep Horizon windowed/restored on DeskPad. True macOS fullscreen and `Window > Fill` were less reliable for input after focus changes.

### Known Good State

The best observed state is:

- DeskPad running.
- `DeskPad Display` active.
- Horizon windowed on `DeskPad Display`.
- Horizon targeted directly by Computer Use, not the DeskPad mirror.
- The first click lands well inside the remote Windows content, then the second click lands on a concrete Windows control.

Do not target the DeskPad mirror for Windows interaction; it shows the virtual display, but input did not reliably pass through to the remote desktop.

## Control Probe

Run a quiet, task-shaped probe before real work, especially after the user alt-tabs or changes display settings. Prefer probes that leave no arbitrary text or memorable artifact on the Windows desktop.

1. Re-query Horizon state.
2. Click well inside the remote Windows content area, away from the macOS titlebar and Horizon toolbar.
3. Use one of these probes, in order:
   - Click the Windows Start button, confirm Start opens, then press `Escape`.
   - Click a visible app navigation control that is already part of the task, then confirm the expected pane appears.
   - If launching an app, click the Windows taskbar Search box and type only the real app/query name you were going to type anyway.
4. Re-query state and confirm the expected UI response appears.
5. Press `Escape` or navigate back only if the probe opened a transient surface.

Example:

```js
await sky.get_app_state({ app: 'Finder', disableDiff: true });
await new Promise(r => setTimeout(r, 500));
await sky.click({ app: 'Omnissa Horizon Client', x: 760, y: 430 });
await new Promise(r => setTimeout(r, 500));
await sky.click({ app: 'Omnissa Horizon Client', x: 450, y: 750 });
await sky.press_key({ app: 'Omnissa Horizon Client', key: 'Escape' });
```

The exact coordinates depend on the current Horizon window. Use the latest screenshot, not stale coordinates.

If the visible UI changes as expected, input capture is good enough to continue. If it does not, recover before proceeding. Use arbitrary typed probe strings only as a last resort, and clear them immediately.

## Operating Pattern

- Prefer visible Windows controls over global keyboard shortcuts.
- Prefer direct clicks into known controls, then typing.
- Avoid relying on `Ctrl+Esc` after focus changes; it sometimes fails even when concrete clicks work.
- Use screenshots after each action batch. Horizon's accessibility tree usually exposes only the Mac wrapper, not the Windows app internals.
- Keep action batches small: click/type, then screenshot. Re-derive coordinates from the current screenshot.
- For app launch inside Windows, click the Windows taskbar Search box, type the app name, then press `Return` only after the search result is visible or strongly implied.
- When checking read/unread state, prefer app-owned filters or counters over visual badge interpretation — a chat client's own `Unread` filter view, a mail client's unread folder or search filter. Opening a conversation or message may mark it read, so capture the unread evidence before selecting deeper content.

## Screenshot Reading

Use the `read-image-locally` skill for structured extraction. Good prompts ask for exact fields, titles, counts, table rows, or error text. Crop first when the target region is known.

Fall back to native image reading when:

- local vision returns no data but the screenshot visibly contains small/dense UI text;
- the task needs layout judgment;
- calendar cards, dense tables, or message lists are too small or clipped.

For cropped fallback, use ImageMagick:

```bash
magick '<screenshot>' -crop WxH+X+Y /tmp/vdi-crop.png
```

## Skill and Memory Updates

Record durable improvements to this VDI workflow in this skill first. Do not put skill corrections, probe refinements, or Windows-machine operating lessons into Basic Memory when they can live here as executable guidance.

If Basic Memory is still the right place for a note because there is no better artifact, sanitize it:

- Remove customer names, message contents, ticket details, meeting titles, people names, and internal URLs unless they are essential.
- Prefer durable workflow facts over task outcomes. Good: "an app's own unread filter is stronger evidence than visual badges." Avoid: "Person X said Y in space Z."
- Do not duplicate a lesson in both memory and this skill. If the lesson changes how agents should operate the VDI, update this skill instead.

## Failure Recovery

### Snap Layout Popup

If a Windows snap-layout popup appears near the top-right maximize button, it can intercept input. Click well inside the remote desktop content area, then retry the concrete control click.

### Input Stops Landing

Use this order:

1. Re-query Horizon state.
2. Click inside the remote Windows content.
3. Run the quiet Start-menu probe or click a task-relevant visible control.
4. If text input must be verified, type only task-relevant text in the target control.
5. If it still fails, restore Horizon window size with `Window > Move & Resize > Return to Previous Size`.
6. Avoid true fullscreen and `Fill` while using DeskPad unless a fresh probe passes.

### Horizon Not On DeskPad

Use Horizon's `Window` menu. `Move to DeskPad Display` is enabled only when Horizon is in normal windowed state. If disabled, exit fullscreen or restore the window first.

## Safety

Reading the VDI is allowed when the user asks. Do not send messages, join meetings, submit forms, change tickets, delete data, or transmit sensitive data unless the user explicitly asks and the Computer Use confirmation policy allows the action.

Stop and ask the user if the VDI shows login, MFA, password, or permission prompts that require human approval.

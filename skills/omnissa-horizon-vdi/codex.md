# Codex runtime: node_repl + DeskPad

The Codex half of [`omnissa-horizon-vdi`](SKILL.md). Everything in `SKILL.md` applies; this file is only how Codex drives Horizon.

## Tooling

- Use `node_repl` with the bundled `computer-use` runtime for all GUI actions.
- Follow the `computer-use` skill for current `sky` bootstrap instructions. Do not copy a stale plugin path into this skill.
- Target Horizon directly. Prefer the app name `Omnissa Horizon Client`; fall back to the macOS app path only if app-name targeting fails.
- Use DeskPad to provide the extra display, so the user's built-in display stays usable.

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

- DeskPad running.
- `DeskPad Display` active.
- Horizon windowed on `DeskPad Display`.
- Horizon targeted directly by Computer Use, not the DeskPad mirror.
- The first click lands well inside the remote Windows content, then the second click lands on a concrete Windows control.

Target Horizon itself for Windows interaction: the DeskPad mirror shows the virtual display, but input did not reliably pass through it to the remote desktop.

### Horizon Not On DeskPad

Use Horizon's `Window` menu. `Move to DeskPad Display` is enabled only when Horizon is in normal windowed state. If disabled, exit fullscreen or restore the window first. If input stops landing on DeskPad, restore the window with `Window > Move & Resize > Return to Previous Size`, and stay out of fullscreen and `Fill` unless a fresh probe passes.

## Control Probe (code)

```js
await sky.get_app_state({ app: 'Finder', disableDiff: true });
await new Promise(r => setTimeout(r, 500));
await sky.click({ app: 'Omnissa Horizon Client', x: 760, y: 430 });
await new Promise(r => setTimeout(r, 500));
await sky.click({ app: 'Omnissa Horizon Client', x: 450, y: 750 });
await sky.press_key({ app: 'Omnissa Horizon Client', key: 'Escape' });
```

The exact coordinates depend on the current Horizon window. Use the latest screenshot, not stale coordinates.

## Screenshot crops

For a cropped native fallback, use ImageMagick:

```bash
magick '<screenshot>' -crop WxH+X+Y /tmp/vdi-crop.png
```

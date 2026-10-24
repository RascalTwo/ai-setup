# Claude Code runtime: computer-use MCP

The Claude Code half of [`omnissa-horizon-vdi`](SKILL.md). Everything in `SKILL.md` applies; this file is only how Claude Code drives Horizon through the `mcp__computer-use__*` tools.

## Setup

1. Load the whole toolkit in one call: `ToolSearch({ query: "computer-use", max_results: 30 })`.
2. `request_access` with `apps: ["Omnissa Horizon Client Next"]` and `clipboardWrite: true`. Use that exact name; `VMware Horizon Client` and `Omnissa Horizon Client` do not resolve. Horizon is granted at tier **full**. If the task ends by handing back to the user's terminal, add it to the same request (it is granted at tier **click**).
3. `open_application("Omnissa Horizon Client Next")`, then `screenshot`. This runs on the primary display and takes it over; the DeskPad virtual display from [`codex.md`](codex.md) is untried here.

## Typing: paste, never `type`

`type` into Horizon arrives garbled: a run of one repeated letter instead of the text. Send every string through the clipboard:

1. Bring Horizon to the front first (`open_application`). `write_clipboard` refuses while a click-tier app such as the terminal is frontmost.
2. `write_clipboard(text)`.
3. Batch: `wait` 1 s (Horizon syncs the Mac clipboard into the guest) → click the target field → select-all → paste, using the guest's chords.
4. `zoom` on the field to read back what landed, then `key Return`.

A paste sometimes lands the *previous* clipboard because the sync lagged. The read-back in step 4 catches it: wait 2 s and paste again.

## Keys

- Key names are lowercase single words: `pageup`, `pagedown`, `Home`, `End`, `Return`, `Escape`. `Page_Up` is rejected and stops the batch.
- `repeat` on `key` sends a chord N times (browser zoom-out × 4).
- Modifiers follow the guest OS, not the Mac; the guest-OS file names them.

## Focus

- Every action checks the frontmost app. A batch that starts while the terminal is in front fails at its first key or paste; open Horizon first, every time you come back to it.
- Non-allowlisted apps are hidden from screenshots, so an empty-looking desktop can just mean Horizon is behind them.

## Reading the screen

- `zoom` on a region beats a fresh full `screenshot` for reading text; split a dense page into 2–4 horizontal strips and zoom each.
- Zoom the guest's browser out 3–5 steps to fit a long page, then zoom regions. Reset browser zoom before handing back.
- `scroll` through Horizon is slow and imprecise. Click the page body, then use `End` / `pageup` / `pagedown`.

## Handing back

When done, `open_application` the user's terminal so they can see you have left the VDI. Leave the browser at 100% zoom and every dialog cancelled.

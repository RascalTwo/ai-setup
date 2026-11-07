# Claude Code runtime: computer-use MCP

The Claude Code half of [`omnissa-horizon-vdi`](SKILL.md). Everything in `SKILL.md` applies; this file is only how Claude Code drives Horizon through the `mcp__computer-use__*` tools.

## Setup

1. Load the whole toolkit in one call: `ToolSearch({ query: "computer-use", max_results: 30 })`.
2. `request_access` with `apps: ["Omnissa Horizon Client Next"]` and `clipboardWrite: true`. The installed name varies: if `Omnissa Horizon Client Next` comes back `notInstalled`, use `Omnissa Horizon Client`. `VMware Horizon Client` does not resolve. Horizon is granted at tier **full**. Always add the user's terminal, `Ghostty`, to the same request (it is granted at tier **click**) so you can hand back at the end.
3. Check `windowLocations` in the `request_access` result: when Horizon sits on a non-primary monitor, `switch_display` to it first. Then `open_application` with the granted name, then `screenshot`. This runs on the primary display and takes it over; the DeskPad virtual display from [`codex.md`](codex.md) is untried here.

## Typing: `vdi-type.swift` for short text, paste for long text, never `type`

`type` into Horizon arrives garbled as a run of one repeated letter (`abc123` → `aaaaaa`): it sends Unicode text on a blank key code, and Horizon forwards only key codes.

**Short ASCII text** (a URL, a search term, one command, a form field; under ~100 characters): bring Horizon to the front with `open_application`, then run `swift <this skill's dir>/vdi-type.swift "text"` in Bash. It sends real key codes at a human rhythm (about 6–8 characters per second, randomized), so it leaves both clipboards alone and can't land stale text. It refuses to run unless Horizon is frontmost, and refuses non-ASCII text (paste that). It assumes a US keyboard layout in the guest. Zoom to read back what landed, as with paste.

**Long text, non-ASCII, or file transfer**: paste through the clipboard:

1. Bring Horizon to the front first (`open_application`). `write_clipboard` refuses while a click-tier app such as the terminal is frontmost.
2. `write_clipboard(text)`.
3. Batch: `wait` 1 s (Horizon syncs the Mac clipboard into the guest) → click the target field → select-all → paste, using the guest's chords.
4. `zoom` on the field to read back what landed, then `key Return`.

A paste sometimes lands the *previous* clipboard because the sync lagged. The read-back in step 4 catches it: wait 2 s and paste again.

The clipboard can be one-way: Mac → guest works, but a guest copy may never reach the Mac (`read_clipboard` keeps returning the old Mac text), so read guest files from screenshots. To move a large file *into* the guest, `pbcopy < file` in Bash (no `write_clipboard` needed), paste it into a new editor tab, save, then prove it arrived intact by comparing a SHA-256 of the guest file (CRLF normalised to LF) with `shasum -a 256` on the Mac. Keep the file ASCII-only.

Horizon re-syncs the Mac clipboard into the guest after any `write_clipboard`/`pbcopy`, silently replacing whatever the guest copied (e.g. a token copied in a guest terminal). Copy in the guest and paste in the guest with no Mac clipboard write in between, and reveal masked fields before trusting a paste.

## Keys

- Key names are lowercase single words: `pageup`, `pagedown`, `Home`, `End`, `Return`, `Escape`. `Page_Up` is rejected and stops the batch.
- `repeat` on `key` sends a chord N times (browser zoom-out × 4).
- Modifiers follow the guest OS, not the Mac; the guest-OS file names them.

## Focus

- Horizon swallows the first click after it is brought to the front: the guest shows a hover but the click doesn't act. Send a throwaway click on empty guest space first, or expect to repeat the first real click.
- Horizon ignores clicks and keys posted to its process while another app is in front (`CGEventPostToPid`, tested 2026-11-01), so it can't be driven in the background on the same screen. Background window capture (`screencapture -l <windowid>`) does work, for reading the VDI without raising it.
- Every action checks the frontmost app. A batch that starts while the terminal is in front fails at its first key or paste; open Horizon first, every time you come back to it.
- Non-allowlisted apps are hidden from screenshots, so an empty-looking desktop can just mean Horizon is behind them.
- Taskbar icon positions shift as windows open and close (a remote-desktop window adds an icon), so a remembered x-coordinate can raise the wrong app. After any taskbar click, zoom on the window title or tab strip to confirm what's in front **before** pasting; a paste into the wrong window has landed in Notepad documents, PowerShell prompts and the browser address bar.
- Inside the guest, a maximized window (Notepad, the browser, Outlook) can cover the one you meant to type into, and a taskbar click sometimes raises a different app. After switching guest windows, take a screenshot before the first paste or key, so keystrokes never land in the user's documents.

## Copying text out

When text read off the guest screen ends up in a deliverable (log lines, IDs, a PR body), check the copy against its source in the guest itself, for example a PowerShell comparison of the document's lines against the log file. Zoomed screenshots misread long hex IDs.

## Reading the screen

- `zoom` on a region beats a fresh full `screenshot` for reading text; split a dense page into 2–4 horizontal strips and zoom each.
- Zoom the guest's browser out 3–5 steps to fit a long page, then zoom regions. Reset browser zoom before handing back.
- `scroll` through Horizon is slow and imprecise. Click the page body, then use `End` / `pageup` / `pagedown`.

## Handing back

**Always** hand back at the end of every VDI stretch, before replying: while Horizon is frontmost the user cannot use their Mac. The user's terminal is **Ghostty**: request it in the Setup `request_access` call, then `open_application("Ghostty")` as the last action. Leave the browser at 100% zoom and every dialog cancelled first.

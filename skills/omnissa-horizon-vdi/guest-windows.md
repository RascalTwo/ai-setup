# Guest OS: Windows

The Windows branch of [`omnissa-horizon-vdi`](SKILL.md): load it when the remote desktop (or a machine hopped to from it) runs Windows.

## Keys

- Chords use `ctrl`, never `cmd`: `ctrl+a`, `ctrl+v`, `ctrl+f`, browser zoom `ctrl+minus` / `ctrl+0`.
- `Ctrl+Esc` sometimes fails after focus changes even when concrete clicks work; click the Start button instead.

## Fallback probe

When no task control is visible: click the Start button, confirm Start opens, press `Escape`.

## Popups and interruptions

- **Snap-layout popup** near a window's top-right maximize button intercepts input: click well inside the content area, then retry.
- **Toast notifications** slide in bottom-right and cover targets there; close them first.
- **Lock screen** ("Press Ctrl+Alt+Delete to unlock"): stop and ask the user to unlock. It needs their password.

## Read-only habits

- **Opening an unfamiliar file type** raises "Select an app to open this file": choose Notepad, then **Just once**, so no file association changes on the machine.
- **Closing Notepad** with a "Save changes?" prompt: choose **Don't Save**. Stray keystrokes may have reached the buffer.
- **services.msc**: read status from the list; open a service's Properties only to read it, and close with **Cancel**.
- **Explorer's address bar**: press `alt+d` to edit it, then paste a full path. Clicking it often lands on a breadcrumb or the search box instead, especially in a nested remote-desktop window.
- **A huge log file** (100 MB+) hangs Notepad. Read its end in PowerShell with `Get-Content <file> -Tail 50`.
- **Explorer opens `.zip` natively**: browse into an archive and open a file inside it without extracting anything.
- **A folder with thousands of files** (crash dumps): sort by Date modified and press `Home` for the newest, or filter with the search box (`*.jar`), instead of scrolling.
- **Event Viewer** on a busy server loads slowly; use Filter Current Log → XML → "Edit query manually" with a `TimeCreated[@SystemTime>=… and <=…]` window in **UTC**, and `<Suppress>` noisy providers. Find (Actions pane) searches the filtered list.
- **Services console through Horizon**: typed letters don't jump to service names (they arrive mangled). Page with `pagedown` and read the list instead. Stopping or disabling a service is a change: only with the user's explicit go-ahead.
- **"Terminal" from the Start right-click menu** may still open as Administrator on servers. Keep it to read-only commands and close it after.

## Terminals

- **A tab keeps the PATH it was opened with.** After a PATH change, older tabs (and any `powershell` started inside them) still miss the new tool: open a new tab, or call the tool by full path (`& "C:\Program Files\Git\cmd\git.exe" ...`).
- **Stopping a `.bat` script** (`gradlew.bat`) with `ctrl+c` raises `Terminate batch job (Y/N)?`. Press `ctrl+c` again before pasting the next command; otherwise the paste lands in that prompt.

## IntelliJ in the guest

- **Use Replace (`ctrl+r`) for renames and Find (`ctrl+f`) to move.** Through Horizon, Rename (`shift+F6`) and Go to Line (`ctrl+g`) often don't open their popup, and a following `ctrl+a` then paste replaces the whole file (undo with `ctrl+z`).
- **`ctrl+y`** can open a "choose the action for Ctrl+Y" keymap dialog: cancel it, leaving the user's keymap unchanged.

- **Its terminal ignores the mouse wheel through Horizon.** To reach earlier output, press `ctrl+f` in the terminal and search for a marker (`Caused by`, `ERROR`, a timestamp); the match scrolls into view.
- **Find in Files (`ctrl+shift+f`)**: `Return` in the popup opens the highlighted result instead of searching. Use **Open in Find Window** for the full list. The file-mask checkbox persists between searches; check it when a search finds nothing. To scope a search to one repo in a multi-repo project, select that folder in the Project tree first.
- **Go to File (`ctrl+shift+n`)** is the fastest way to open a file by name; when several repos have the same file, read the path column before picking.
- **Clicking a terminal tab** sometimes misses; confirm with a screenshot which tab is active before pasting a command.

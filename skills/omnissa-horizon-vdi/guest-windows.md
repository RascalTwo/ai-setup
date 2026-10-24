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
- **Explorer opens `.zip` natively**: browse into an archive and open a file inside it without extracting anything.

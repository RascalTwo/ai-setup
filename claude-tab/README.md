# claude-tab

`prefix+a` in herdr → a new tab already running
`claude --dangerously-skip-permissions`.

Replaces the six-step version of the same thing: `prefix+c`, type a tab name,
Enter, `Ctrl-R`, `c`, Enter.

## How it works

Two calls against herdr's socket API:

1. `herdr tab create --focus` — no `--label`, so herdr auto-numbers the tab
   exactly as it would an unnamed `prefix+c` tab. The new tab inherits the
   focused pane's cwd on its own, because herdr's `[terminal] new_cwd` defaults
   to `"follow"`. The response carries the new pane at
   `.result.root_pane.pane_id`.
2. `herdr pane run "$pane" claude …` — makes claude the pane's **foreground**
   process, so the tab behaves as if you had typed the command yourself.

herdr's own agent detection picks claude up from there — the tab reports
`agent_status: idle` once it is ready for input, so the status dots and
notification routing work exactly as they do for a hand-started agent. No
`herdr agent start` call is needed (that one exists for when you want herdr to
*validate* agent identity before proceeding, which a keybinding does not).

## Files

| File | Installed to |
|---|---|
| `claude-tab` | `~/.claude/bin/claude-tab` (symlink) |
| `herdr-keybind.toml` | merged into `~/.config/herdr/config.toml` |

Requires `herdr` and `jq`. After install: `herdr server reload-config`.

## Gotchas

- **`~` is not expanded by herdr** in a `[[keys.command]]` `command` field —
  `install.ts` bakes in the absolute path at install time.
- **A direct chord works too** (`key = "ctrl+alt+a"` instead of `prefix+a`), but
  macOS Option is not Alt in Ghostty unless `macos-option-as-alt` is set, and a
  bespoke chord is one more undocumented thing to remember. `prefix+a` shows up
  in herdr's help with the `description` above; the chord is just muscle memory.

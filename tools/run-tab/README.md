---
rascaltwo-ai-setup:
  kind: tool
  state: false
  integrates:
    herdr: prefix+c, prefix+shift+c
  requires: [herdr, jq]
---

# run-tab

`prefix+c` in herdr pops up a `run>` prompt. Whatever you type runs in a new tab,
in the focused pane's cwd. Press Enter on an empty prompt for a plain tab. Ctrl-C cancels.

`prefix+shift+c` does the same, but the tab closes when the command exits and you
land back on the tab you started from. That only happens if you're still on the
command's tab. If you've moved to another tab, you stay there.

It works like [claude-tab](../claude-tab/README.md): `herdr tab create --focus`, then
`herdr pane run`. `pane run` types the command into the new tab's shell, so the
shell is still there afterwards and the command lands in your history. Close-on-exit
mode appends `; run-tab --back <origin>; exit`.

This replaces herdr's built-in `new_tab` on `prefix+c`, so the snippet unbinds it.
Nothing is lost, because an empty prompt gives the same plain tab.

After install: `herdr server reload-config`.

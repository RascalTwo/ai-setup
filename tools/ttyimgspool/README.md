---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: [PostToolUse, UserPromptSubmit]
    herdr: prefix+i
    statusline: image count and age
  requires: [herdr, chafa]
---

# ttyimgspool

Screenshots Claude Code takes or touches show up in a gallery you can open in the
terminal, next to the session that produced them. Press `prefix+i` in herdr.

Claude Code's TUI cannot render images inline — it never will, see [Limits](#limits) —
so the gallery opens in its own temporary pane and closes when you leave it.

## Use

`prefix+i` opens the gallery, scoped to the current session's images.

**Gallery** — newest first

| Key | |
| --- | --- |
| `1`…`9`, then `Enter` | open image N (type the whole number; nothing fires until Enter) |
| `Backspace` / `Esc` | correct or cancel the number |
| `]` `[` | next / previous page |
| `a` | toggle between this session and all sessions |
| `q` | quit |

**Single image**

| Key | |
| --- | --- |
| `n` `p` | older / newer |
| `g` | back to the gallery |
| `d` | delete this image |
| `C` | delete all (confirms) |
| `q` | quit |

Numbering is global: image 36 is `36)` on page 2, not `1)`.

## What gets captured

A `PostToolUse` hook runs on every tool call, plus `UserPromptSubmit`:

- images you paste into the prompt
- screenshots from computer-use and the Chrome extension
- any image you `Read`
- any image path a tool was *asked* to act on — `open shot.png`, `cp`, `ls`

Image paths appearing only in a tool's **output** are ignored on purpose: one
`ls ~/Pictures` would otherwise flood the gallery. Base64 images in tool output are
still captured, since those are images Claude actually looked at.

Same file mentioned twice is stored once — dedup is by basename plus byte size.

## Status line

`🖼 8 · 10m` — how many images this session has, and how long ago the newest arrived.
Turns yellow when something landed in the last two minutes, and disappears entirely
when the session has none. Widget:
[`statusline/statusline-ttyimgspool.sh`](../statusline/statusline-ttyimgspool.sh).

## Where things live

| | |
| --- | --- |
| Spool | `~/.agents/state/ttyimgspool/<session-id>/` |
| Viewer | `~/.agents/ai-setup/tools/ttyimgspool/ttyimgspool` |
| Hook | `~/.agents/ai-setup/tools/ttyimgspool/ttyimgspool-hook.py` |
| Hook registration | `settings/claude-code/settings.json` |
| Keybinding | `ttyimgspool/herdr-keybind.toml` |

`KEEP` only ever trims the session you are looking at, so without `DAYS` a session
you stop using keeps its images forever — which is how a spool reaches hundreds of
directories. A dir's mtime moves on write, not on read, so "nothing spooled in 30
days" is the honest proxy for "done with that session". The session currently open
is always excluded.

Sessions are scoped by herdr's `agent_session` for the pane, which both the hook and
the viewer resolve independently — so they agree without passing anything between them.
Claude Code's own `session_id` is *not* used: a session running as a background job
reports the job id instead, and the two would disagree.

If a session has no images of its own, the gallery falls back to showing every
session rather than an empty screen. `a` toggles back.

## Config

| Variable | Default | |
| --- | --- | --- |
| `TTYIMGSPOOL_DIR` | `~/.agents/state/ttyimgspool` | spool location |
| `TTYIMGSPOOL_KEEP` | `100` | images kept per session; older ones pruned when the gallery opens |
| `TTYIMGSPOOL_DAYS` | `30` | whole session dirs with nothing spooled into them for this long are swept when the gallery opens. `0` disables it |

## Install

```sh
bun install.ts     # symlinks both scripts, installs chafa, merges the keybinding
herdr server stop  # then reattach
```

The restart is not optional the first time: the gallery depends on herdr's
`experimental.kitty_graphics` (set by `settings/herdr/config-prefs.toml`), and that
setting only takes effect on a full server restart.

**Requires** herdr, `chafa`, and a terminal that speaks the kitty graphics protocol
(Ghostty, kitty, WezTerm). Without chafa the hook still spools images; only the
viewer goes blank.

## Limits

- **No inline images in Claude Code's transcript.** Not a missing feature — two
  processes cannot interleave writes to a tty owned by a full-screen TUI. A large
  image gets shredded mid-payload and lands as literal base64 text.
- **No click-to-open.** Terminals can't run a command from a click; an OSC 8
  `file://` link opens Finder, not the image.
- **herdr only** for the keybinding and session scoping. The viewer itself is plain
  bash plus chafa and runs anywhere — you just launch it yourself and lose scoping.

## Uninstall

```sh
rm -rf ~/.agents/state/ttyimgspool
```

Then drop the `PostToolUse`/`UserPromptSubmit` entries from
`settings/claude-code/settings.json` and the `[[keys.command]]` block from
`~/.config/herdr/config.toml`.

---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: [PostToolUse, UserPromptSubmit]
    herdr: prefix+i, Ctrl+click plugin
    statusline: image count and age
  requires: [herdr, chafa]
---

# ttyimgspool

Images Claude looks at appear **inline in the Claude Code transcript**, right under
the tool call. Ctrl+click one (or its caption) to see it full-pane; a click or any
key closes it. Everything Claude takes or touches also lands in a gallery next to
the session that produced it: press `prefix+i` in herdr.

## Use

`prefix+i` opens the gallery, scoped to the current session's images.

**Gallery** — newest first

| Key | |
| --- | --- |
| click a thumbnail | open it |
| `1`…`9`, then `Enter` | open image N (type the whole number; nothing fires until Enter) |
| `Backspace` / `Esc` | correct or cancel the number |
| `]` `[` | next / previous page |
| `a` | toggle between this session and all sessions |
| `q` | quit |

**Single image**

| Key | |
| --- | --- |
| `n` `p` | older / newer |
| `g` or click | back to the gallery |
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

## What shows inline

A subset of the above: what Claude actually saw. Screenshots, images it `Read`s, your
pastes, and anything passed to [`show-image`](show-image) (a path, URL or `clipboard`;
the [`render-image-in-terminal` skill](../../skills/render-image-in-terminal/SKILL.md) is how Claude reaches for it).
Paths a command merely mentions (`cp`, `open`, `ls`) stay gallery-only.

How it gets past the TUI: Claude Code passes a hook's `systemMessage` through with
its ANSI intact. The hook uploads the image straight to Claude Code's tty (small,
self-contained kitty APC chunks, `q=2` so no replies land in the prompt), then returns
rows of kitty **Unicode placeholder** cells whose 24-bit foreground colour *is* the
image id. The picture is bound to text cells, so it survives repaints and scrolling.

Click-to-enlarge: every image is an OSC 8 link, and the
[herdr plugin](herdr-plugin/herdr-plugin.toml) opens it on Ctrl+click. A plain click
belongs to Claude Code, which only opens a hard-coded allowlist of schemes (`https`,
`vscode`, `cursor`, `windsurf`, `zed`, `figma`, … see `CLAUDE_CODE_OPENS` in
[`ttyimgspool-link`](ttyimgspool-link)); `file://` becomes a Finder reveal
([anthropics/claude-code#95675](https://github.com/anthropics/claude-code/issues/95675)).

To make a plain click work too, borrow an allowlisted scheme you don't use. There is
no default: you name it, and a scheme Claude Code won't open is refused.

```sh
~/.agents/ai-setup/tools/ttyimgspool/ttyimgspool-link <scheme>  # images link as <scheme>://ttyimg/<path>; a helper app opens the viewer
~/.agents/ai-setup/tools/ttyimgspool/ttyimgspool-link off       # back to file:// (Ctrl+click only)
```

The helper (`~/Applications/TtyImgLink.app`) forwards any link *without* the `ttyimg`
marker to the scheme's real owner, so installing that app later still works. The
choice lives in the spool (`.link-scheme`) and `install.ts` re-applies it. Images
drawn before a switch keep their old links.

## Status line

`🖼 8` — how many images this session has. Turns yellow when something landed in the last two minutes, and disappears entirely
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
| Ctrl+click viewer | `ttyimgspool/herdr-plugin/` (linked by `install.ts`) |
| `show-image` | `~/.agents/ai-setup/tools/ttyimgspool/show-image` |
| Plain-click scheme | `ttyimgspool-link`; choice in `<spool>/.link-scheme`, helper in `~/Applications/TtyImgLink.app` |

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

## Implementation notes

- The hook substring-scans raw stdin and bails before `json.loads` when nothing looks
  image-shaped, so a non-image tool call costs ~35ms (measured 2026-08-08; nearly all
  interpreter startup). It never raises.
- Image paths are regex-scanned *within* strings, not whole-string matched — a path
  usually rides inside a larger value like `"open /tmp/shot.png"`.
- Pasted images: `UserPromptSubmit` carries no image data, but Claude Code already
  wrote them to disk: `/tmp/claude-<uid>/<launch dir>/<session-id>/images/N.png` by
  2.1.283, `~/.claude/image-cache/<session-id>/N.png` before that. The hook globs on
  the session id: the launch dir is not the payload's `cwd`, which follows `cd`. The hook copies them in as `paste-N.png` (deterministic
  name = free dedup).
- The gallery grid redraws only when page, scope or the list changes — re-rendering
  ~35 kitty images per keystroke is far too slow. `trap 'dirty=1' WINCH` handles resize.
- Clicks are SGR mouse reports (`?1000h` + `?1006h`), which herdr re-encodes per pane.
  bash 3.2 has no sub-second `read -t`, so a lone `Esc` is told apart from the start
  of a mouse sequence by 0.1s of silence (`stty time 1` + `dd`). Test:
  [`tests/ttyimgspool-click.sh`](../../tests/ttyimgspool-click.sh) drives the real gallery through a pty.
- The keybinding is `[[keys.command]] type = "pane"`: a temporary zoomed pane that
  closes when the command exits.
- Testing the hook: pipe fixtures with `printf '%s'`, not zsh `echo` — `echo`
  interprets `\n` inside the JSON and produced a false-passing test.

## Config

| Variable | Default | |
| --- | --- | --- |
| `TTYIMGSPOOL_DIR` | `~/.agents/state/ttyimgspool` | spool location |
| `TTYIMGSPOOL_KEEP` | `100` | images kept per session; older ones pruned when the gallery opens |
| `TTYIMGSPOOL_DAYS` | `30` | whole session dirs with nothing spooled into them for this long are swept when the gallery opens. `0` disables it |

## Install

```sh
bun install.ts     # installs chafa, merges the keybinding, links the herdr plugin
herdr server stop  # then reattach
```

The restart is not optional the first time: the gallery depends on herdr's
`experimental.kitty_graphics` (set by `settings/herdr/config-prefs.toml`), and that
setting only takes effect on a full server restart.

**Requires** herdr, `chafa`, and a terminal that speaks the kitty graphics protocol
(Ghostty, kitty, WezTerm). Without chafa the hook still spools images; only the
viewer goes blank.

## Limits

- **Inline needs a kitty-graphics terminal** (Ghostty, kitty, WezTerm; under herdr,
  `kitty_graphics = true`). Elsewhere the hook stays silent. A phone attached to the
  same herdr session can't be detected and shows the placeholders as junk.
- **Plain click needs a borrowed scheme** (`ttyimgspool-link`, macOS only); without
  one it's Ctrl+click. See [What shows inline](#what-shows-inline).
- **Inline images are thumbnails** (up to 40×12 cells). Ctrl+click opens the original
  file full-pane: the viewer sends it as-is and lets the terminal scale it (chafa's
  re-rasterised output was too blocky to read). It is only as sharp as the image
  Claude received; a screenshot taken at reduced scale stays soft.
- **herdr only** for the keybinding and session scoping. The viewer itself is plain
  bash plus chafa and runs anywhere — you just launch it yourself and lose scoping.

## Uninstall

```sh
rm -rf ~/.agents/state/ttyimgspool
herdr plugin unlink rascaltwo.ttyimgspool
~/.agents/ai-setup/tools/ttyimgspool/ttyimgspool-link off
```

Then drop the `PostToolUse`/`UserPromptSubmit` entries from
`settings/claude-code/settings.json` and the `[[keys.command]]` block from
`~/.config/herdr/config.toml`.

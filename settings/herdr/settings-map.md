# herdr settings map

Where herdr configuration lives, and why it is merged rather than symlinked.

## Why not a symlink

`~/.config/herdr/` is a live state directory, not a config directory — it holds
`herdr.sock`, `herdr-server.log` (hundreds of KB), `session.json`, `.plugins.lock`
and `release-notes.json` alongside `config.toml`. Linking the directory is out.

Linking `config.toml` alone is also wrong: herdr writes that file itself. It
migrates keybindings (leaving `config.toml.bak-keybind-v2-*` behind) and records
onboarding state. A write that replaces the file would leave a real file where
the symlink was, silently detaching the repo copy with no error.

So herdr follows the same pattern as Codex `config-prefs.toml`: the repo holds the
settings it owns, and `install.ts` merges them into the live file, guarded so
re-running changes nothing.

## What this repo owns

| Setting | File | Notes |
| --- | --- | --- |
| `experimental.kitty_graphics` | `config-prefs.toml` | Needs a full server restart, not `reload-config` |

## What this repo does NOT own

- **`onboarding`, `[ui]`, `[ui.toast]`** — herdr writes these from its own UI. Left alone.
- **`[[keys.command]]` for `prefix+i`** — belongs to ttyimgspool, ships in `tools/ttyimgspool/herdr-keybind.toml`.
- **`[[keys.command]]` for `prefix+a`** — belongs to claude-tab, ships in `tools/claude-tab/herdr-keybind.toml`.
- **`[[keys.command]]` for `prefix+c` / `prefix+shift+c`, and `keys.new_tab = ""`** — belong to run-tab,
  ships in `tools/run-tab/herdr-keybind.toml`; `install.ts` writes the unbind into any existing `[keys]` table.
- **`[[keys.command]]` for `prefix+j`** — the voicemode interject key, ships in
  `tools/voicemode-hold/herdr-keybind.toml` beside the two scripts it drives.
  It runs under voice-mode's own interpreter, not system python3, so the binding carries that path.
- **`~/.claude/hooks/herdr-agent-state.sh`** — generated and owned by herdr. Its own header says
  reinstalling overwrites it, so it is deliberately untracked; `install.ts` runs
  `herdr integration install claude` instead. Note that `settings/claude-code/settings.json`
  registers a `SessionStart` hook pointing at it, so that install step is what keeps
  the reference from dangling on a fresh machine.

## Applying changes

```sh
bun install.ts          # merges prefs, idempotent
herdr server stop       # then reattach — required for kitty_graphics
```

`herdr server stop` tears down every pane and running agent. There is no
`server restart`, and `herdr update --handoff` only does a live handoff as part of
installing an update.

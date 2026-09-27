---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  integrates:
    claude-code: [PreToolUse, PostToolUse]
    herdr: prefix+j
    voice-mode: control socket, event log
  requires: [voice-mode, herdr]
---

# voicemode

Two things on top of [voice-mode](https://github.com/mbailey/voicemode), neither of
them a patch to it: a pane that shows the agent's speech as it plays, highlighted
word by word, and a key that **holds** an utterance mid-word so you can say
something into the gap and let it carry on.

`prefix+m` already ends a turn outright (`voicemode control skip-forward`). This is
the other half — interrupt without ending anything.

## Use

| Key | |
| --- | --- |
| `prefix+j` | hold the utterance and open the mic; press again to close the mic and resume from the same word |

The pane opens itself when the agent first speaks. Nothing to launch.

Each interjection reaches the agent carrying a **run-up**: the last 18 words that
were actually spoken when you pressed the key. Without it "no, that's wrong" has no
referent — the agent never hears itself, so it cannot know which part you stopped.

A hold also does the reading-ahead job: it prints the whole utterance and stops the
world, where `prefix+m` would open the mic and demand a reply.

## How the pieces connect

`PreToolUse` on `mcp__voicemode__converse` primes the pane with the text about to be
spoken; `PostToolUse` records what you said back, and on the way out it drains any
interjections into the hook's `hookSpecificOutput.additionalContext`. That is the
only channel back to the agent — you speak long after the tool call went out, so
there is nothing else still listening.

Pause and resume go **straight down voicemode's control socket**
(`~/.voicemode/control.sock`, newline-delimited JSON). Not through the `voicemode`
CLI: that costs most of a second to start Python at each end of a hold, and the pane
measures hold length to shift its karaoke clock, so the CLI's startup showed up as
the highlight lagging the voice.

The socket is bound **only while the server is speaking**, and voicemode logs no
pause/resume event — `TTS_FIRST_AUDIO` / `TTS_PLAYBACK_END` under
`~/.voicemode/logs/events/` are the only clock available.

## The pane

One live repaint region, and it exists only while speech is actually moving.
Everything else is ordinary terminal scrollback.

A finished utterance is **released** — printed once unwindowed, then never
repainted, so it falls into scrollback where you can read back whatever `prefix+m`
cut off. The reply prints underneath the utterance it answers when it lands.

While an utterance is taller than the pane a window is unavoidable (a pane cannot
scroll its own viewport). It sits a quarter down rather than centred, because the
words worth showing are the ones still coming. The real fix for reading ahead is a
taller pane — the split ratio in `ensure_view()`.

## Where things live

| | |
| --- | --- |
| Pane | `~/.agents/ai-setup/tools/voicemode-hold/transcript.py` |
| Interject | `~/.agents/ai-setup/tools/voicemode-hold/interject.py` |
| Hook registration | `settings/claude-code/settings.json` |
| Keybinding | `voicemode/herdr-keybind.toml` |
| Our state | `~/.agents/state/voicemode-hold/` — `transcript.json`, `.transcript-pane`, `.interject.pid`, `.interject.hold`, `interjections.jsonl` |
| voice-mode's, that we only read | `~/.voicemode/control.sock` (written to, never created by us) and `~/.voicemode/logs/events/` |

Both scripts self-check: `python3 transcript.py demo`, same for the other.

The pane does **not** pick up an edit on its own — restart it:

```sh
herdr pane run "$(cat ~/.voicemode/.transcript-pane)" \
  'clear; python3 ~/.agents/ai-setup/tools/voicemode-hold/transcript.py view'
```

## Why our files are not in `~/.voicemode/`

They used to be, and the old name told the truth about the problem: this tool
was called `voicemode` too. Two owners writing into one directory means nobody
can say which files are safe to delete — so ours moved to
`~/.agents/state/voicemode-hold/` and voice-mode keeps its own directory.

`~/.voicemode` stays exactly where voice-mode puts it. `~/.agents/state/` is for
things this repo owns, and a third party's install is not one of them — the same
reason ollama's models and herdr's config are left alone.

> [!NOTE]
> If you ever do need to relocate voice-mode, **do not use `VOICEMODE_BASE_DIR`**.
> `config.py` reads `~/.voicemode/voicemode.env` from a hardcoded path that
> ignores it, and that file is where `VOICEMODE_CONTROL_CHANNEL_ENABLED=true`
> lives — the setting `prefix+j` depends on. You would move the data and
> silently lose the control socket. Symlinking the whole directory works, and
> was tested: both launchd services kept running on their original pids.

## Install

```sh
bun install.ts   # symlinks both scripts, merges the keybinding
```

**Requires** `voice-mode` (`uv tool install voice-mode`) and herdr for the keybinding
— tmux is the fallback for splitting the pane, but not for `prefix+j`. Nothing here
edits voicemode itself: it is a uv tool install at
`~/.local/share/uv/tools/voice-mode/`, so an upgrade would wipe any edit made there.

The keybinding runs the capture under **voice-mode's own interpreter**, not system
`python3` — it needs `sounddevice` and `numpy`, and that venv is the one place they
are guaranteed to be, because voicemode records with them.

## Limits

- **The committed-text problem is accepted, not solved.** The agent's speech is
  already-generated text. Interjecting cannot change what the rest of the utterance
  says — only what comes after it.
- **`prefix+j` then `prefix+m`** — holding something open across a turn boundary —
  is the case that breaks things. Worth re-running by hand after any change here.

## Uninstall

```sh
rm -rf ~/.voicemode/.transcript-pane ~/.voicemode/interjections.jsonl
```

Then drop the two `mcp__voicemode__converse` entries from
`settings/claude-code/settings.json` and the `prefix+j` `[[keys.command]]` block from
`~/.config/herdr/config.toml`.

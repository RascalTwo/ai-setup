---
rascaltwo-ai-setup:
  kind: tool
  state: false
  integrates:
    herdr: prefix+a
  requires:
    commands: [herdr, jq]
---

# claude-tab

`prefix+a` in herdr → a small popup: type the first prompt, pick the model and effort, Enter →
a new tab running `claude --dangerously-skip-permissions --model … --effort …` with that prompt.

| Key | Does |
|---|---|
| Tab | cycles the model: Sonnet 5.5 → Opus 5.5 → Haiku 4.5 |
| ↑ / ↓ | effort: low, medium, high, xhigh, max |
| Enter | launch (empty prompt = a bare session) |
| Esc / Ctrl-C | cancel |

Default is Sonnet 5.5, high: Sonnet matched Opus on every benchmark task at under half the cost, and
no classifier we tried (rules, local LLMs, Haiku/Sonnet/Opus as zero-shot routers) beat "always
Sonnet" at picking the exceptions from the first prompt. So the human picks, with one key.

## How it works

1. `vared` reads the prompt; `zle` widgets bound to Tab and the arrows change the model/effort and
   redraw the status line under it.
2. `herdr tab create --focus` — no `--label`, so herdr auto-numbers the tab. The new tab inherits
   the focused pane's cwd on its own (`[terminal] new_cwd = "follow"`). The response carries the
   new pane at `.result.root_pane.pane_id`.
3. `herdr pane run "$pane" claude …` makes claude the pane's **foreground** process. The prompt
   travels as a temp file the tab's own shell expands (`"$(cat …)"`), so quotes and newlines survive.

herdr's own agent detection picks claude up from there, so the status dots and notification routing
work as for a hand-started agent.

## Files

| File | Installed to |
|---|---|
| `claude-tab` | `~/.agents/ai-setup/tools/claude-tab/claude-tab` |
| `herdr-keybind.toml` | merged into `~/.config/herdr/config.toml` |

Requires `herdr` and `jq`. After install: `herdr server reload-config`.

## Gotchas

- **`~` is not expanded by herdr** in a `[[keys.command]]` `command` field —
  `install.ts` bakes in the absolute path at install time.
- **A direct chord works too** (`key = "ctrl+alt+a"` instead of `prefix+a`), but
  macOS Option is not Alt in Ghostty unless `macos-option-as-alt` is set, and a
  bespoke chord is one more undocumented thing to remember. `prefix+a` shows up
  in herdr's help with the `description` above; the chord is just muscle memory.

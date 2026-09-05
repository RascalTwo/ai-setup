# ai-setup

My personal AI coding-agent setup — global behavior rules, skills, MCP servers, and
a dev pipeline — shared across **Claude Code** and **OpenAI Codex**. One repo is the
source of truth; a deterministic installer symlinks it into place for both.

> [!TIP]
> 🧭 **[Take the interactive tour →](https://rascaltwo.github.io/ai-setup/rascal-ai-setup-tour/)** — a
> thirteen-stop map of how the installer wires this repo into both agents and where the leverage lives.
> (Built with this repo's own [`/viz`](skills/viz) skill.)

> [!NOTE]
> Personal config, published so others can borrow from it. Opinionated and
> macOS-flavored. Take what's useful.

**New here / just want the *why*?** Everything below is the machinery — the thinking behind it
lives in the explorables: **[How I Use AI](https://rascaltwo.github.io/ai-setup/how-i-use-ai/)**
(fifteen principles in three arcs), a poster per skill, and the setup tour. All of them are on the
**[explorables lobby →](https://rascaltwo.github.io/ai-setup/)**, which is the authoritative
view of the set.

I drive my agents largely by voice (not a built-in `/voice`), which is why `AGENTS.md` §1
leads with homophone/ambiguity guardrails. Specifically via
[my fork](https://github.com/RascalTwo/Handy) of
[handy.computer](https://handy.computer) — local speech-to-text, plus a third shortcut
that types each word into the focused app as the model commits it, instead of pasting the
whole transcription on release.

## Install

```bash
git clone https://github.com/RascalTwo/ai-setup
cd ai-setup
bun install.ts
```

Requires [Bun](https://bun.sh) + [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and/or [Codex](https://developers.openai.com/codex).

Optional, detected at install time and skipped when absent:
[herdr](https://herdr.dev) (agent multiplexer — also gates
[`ttyimgspool`](ttyimgspool/README.md)) and `chafa` (installed via brew).

The installer is **idempotent, deterministic, and safe to re-run** — it never
overwrites a real file, only manages its own symlinks, and self-heals if you move the
repo. It links the rules (`AGENTS.md`/`CLAUDE.md`), every skill (into both agents'
paths), the status line, and registers `basic-memory` with Codex.

- **Private overlays:** other repos whose skills layer on top of this core, so company/personal skills stay private. List them in `~/.agents/overlays.json` and plain `bun install.ts` picks them up; `--overlay <dir>` still works for a one-off. The list lives there rather than here because it is machine-local paths and this repo is public.
  ```json
  { "overlays": ["~/code/my-private-setup", "~/code/some-tool"] }
  ```
  An overlay is any repo with a `skills/` dir. A repo that is itself one skill puts it at `skills/<name>/` like everyone else — a `SKILL.md` at a repo root matches nothing here and has to be hand-linked, and a hand-linked skill is one the installer cannot restore.
- **What's installed, and from where:** `bun install.ts --list`. Prints every source and its skills, then any live skill belonging to no listed source — the ones a rebuild would silently lose.
- **Third-party skills:** `bun install.ts --externals` installs the `npx skills` packages in [`external-skills.json`](external-skills.json) (Matt-Pocock, etc.) — tracked by reference, not vendored.

## The bits an installer can't do (per agent)

Some capabilities need manual / OAuth setup. Here's the Claude Code ↔ Codex equivalence:

| Capability | Claude Code | Codex |
|---|---|---|
| Browser control | Claude-in-Chrome extension | `chrome` / `browser` bundled plugins |
| Desktop control | `computer-use` built-in MCP server — off by default, enable via `/mcp`, **per project** | `computer-use` bundled plugin |
| Google (Calendar/Drive/Gmail) | claude.ai connectors | ChatGPT connectors |
| Atlassian | claude.ai Atlassian connector | ChatGPT/Codex connector |

Google / Atlassian / browser are enabled by clicking through each agent's
**connector/plugin UI** (claude.ai or ChatGPT settings), not local config.

Desktop control is the one that bites: on Claude Code it is **not** a connector-UI toggle.
Run `/mcp` in an interactive session, enable `computer-use`, then grant macOS
**Accessibility** + **Screen Recording** when first prompted. The enable is remembered
**per project**, so repeat it in each repo where you want GUI control — and it needs
macOS, a Pro/Max plan, and an interactive session (not `-p`).

Two more prerequisites are **agent-agnostic** — same for both, not a per-agent difference:

- **Persistent memory** — `basic-memory`, an MCP server run via `uvx`. The installer registers it with both agents (Claude Code via `claude mcp add -s user`, Codex via `config.toml`). Both share the one note store.
- **Local models** — [Ollama](https://ollama.com) plus `gemma4:e4b` and `qwen2.5-coder:7b`, used by the `read-image-locally` and `graphify` skills. Pull once; both agents use the same daemon.

One thing is **optional but referenced by the settings**, so it's explained here rather than
leaving an unexplained hook in the tree:

- **Terminal workspace** — [herdr](https://herdr.dev), an agent multiplexer that lives in your
  terminal (panes, tabs, worktrees, several agents at once). `settings/claude-code/settings.json`
  registers its `SessionStart` integration hook at `~/.claude/hooks/herdr-agent-state.sh`. **That
  script is installed by herdr, not by this repo** — it is not tracked here, and the hook exits 0
  immediately when herdr isn't running, so the setup works fine without it. herdr *owns* that
  script and rewrites it on integration updates; it also writes the hook entry with an absolute
  home path, which this repo keeps as `"$HOME/..."` instead (hooks in shell form go through
  `sh -c`, which expands variables). Expect to re-fix that after a herdr update.

## Structure

- **`AGENTS.md`** — global behavior rules (evidence-based claims, plan verification, subagent delegation, tool hierarchy, memory); `CLAUDE.md` symlinks to it so both agents read the same file.
- **`skills/`** — general-purpose skills.
- **`subagents/`** — the r2-sdlc pipeline's reviewer subagents, authored once in `.ruler/agents/` and compiled to Claude + Codex native formats via [Ruler](https://github.com/intellectronica/ruler).
- **`ttyimgspool/`** — terminal screenshot gallery: a `PostToolUse` hook spools every image Claude Code touches, `prefix+i` browses them in a herdr pane. See [`ttyimgspool/README.md`](ttyimgspool/README.md).
- **`claude-tab/`** — `prefix+a` in herdr opens a new tab already running `claude --dangerously-skip-permissions`, in the current directory. See [`claude-tab/README.md`](claude-tab/README.md).
- **`herdr-autolabel/`** — a `Stop` hook that renames the herdr tab to a slug a local ollama model derives from the conversation, so tabs stop being `6 · 7 · 8 · 9`. No-op outside herdr. See [`herdr-autolabel/README.md`](herdr-autolabel/README.md).
- **`viz-pages/`** — the published explorables. `how-i-use-ai` is the working philosophy; `rascal-ai-setup-tour` is the guided tour; `skill-<name>/` and `tool-<name>/` are one-page posters for a single skill or a single owned tool. `index.html` and `_thumbs/` are generated by `/viz build.ts` on publish and are git-ignored — edit the vizzes, never the lobby.
- **`install.ts`** · **`external-skills.json`** · **`settings/`** (per-agent: `claude-code/`, `codex/`, `herdr/`).

## Sync model

Everything is a **symlink into this repo** — edit a live file and you've edited the
repo; `git status` here surfaces the drift to commit. No build step, no copy-back.

Two exceptions, both files their tool rewrites on its own: Codex `config.toml` and
herdr `config.toml`. A symlink there would eventually be replaced by a real file and
silently detach, so `install.ts` merges guarded blocks into them instead — see
[`settings/herdr/settings-map.md`](settings/herdr/settings-map.md).

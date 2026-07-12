# ai-setup

My personal AI coding-agent setup — global behavior rules, skills, MCP servers, and
a dev pipeline — shared across **Claude Code** and **OpenAI Codex**. One repo is the
source of truth; a deterministic installer symlinks it into place for both.

> [!NOTE]
> Personal config, published so others can borrow from it. Opinionated and
> macOS-flavored. Take what's useful.

I drive my agents largely by voice via [handy.computer](https://handy.computer) (not
a built-in `/voice`), which is why `AGENTS.md` §1 leads with homophone/ambiguity
guardrails.

## Install

```bash
git clone https://github.com/RascalTwo/ai-setup
cd ai-setup
bun install.ts
```

Requires [Bun](https://bun.sh) + [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and/or [Codex](https://developers.openai.com/codex).

The installer is **idempotent, deterministic, and safe to re-run** — it never
overwrites a real file, only manages its own symlinks, and self-heals if you move the
repo. It links the rules (`AGENTS.md`/`CLAUDE.md`), every skill (into both agents'
paths), the status line, and registers `basic-memory` with Codex.

- **Private overlays:** `bun install.ts --overlay <dir>` layers another repo's `skills/` on top — company/personal skills stay in a private repo. Repeatable.
- **Third-party skills:** `bun install.ts --externals` installs the `npx skills` packages in [`external-skills.json`](external-skills.json) (Matt-Pocock, etc.) — tracked by reference, not vendored.

## The bits an installer can't do (per agent)

Some capabilities need manual / OAuth setup. Here's the Claude Code ↔ Codex equivalence:

| Capability | Claude Code | Codex |
|---|---|---|
| Browser control | Claude-in-Chrome extension | `chrome` / `browser` bundled plugins |
| Desktop control | computer-use (enable in settings) | `computer-use` bundled plugin |
| Google (Calendar/Drive/Gmail) | claude.ai connectors | ChatGPT connectors |
| Atlassian | claude.ai Atlassian connector | ChatGPT/Codex connector |

Google / Atlassian / browser / desktop are enabled by clicking through each agent's
**connector/plugin UI** (claude.ai or ChatGPT settings), not local config.

Two more prerequisites are **agent-agnostic** — same for both, not a per-agent difference:

- **Persistent memory** — `basic-memory`, an MCP server run via `uvx`. The installer registers it with Codex; Claude Code already has it. Both agents share the one note store.
- **Local models** — [Ollama](https://ollama.com) plus `gemma4:e4b` and `qwen2.5-coder:7b`, used by the `read-image-locally` and `graphify` skills. Pull once; both agents use the same daemon.

## Structure

- **`AGENTS.md`** — global behavior rules (evidence-based claims, plan verification, subagent delegation, tool hierarchy, memory); `CLAUDE.md` symlinks to it so both agents read the same file.
- **`skills/`** — general-purpose skills.
- **`subagents/`** — the r2-sdlc pipeline's reviewer subagents, authored once in `.ruler/agents/` and compiled to Claude + Codex native formats via [Ruler](https://github.com/intellectronica/ruler).
- **`install.ts`** · **`external-skills.json`** · **`settings/`** (per-agent: `claude-code/`, `codex/`).

## Sync model

Everything is a **symlink into this repo** — edit a live file and you've edited the
repo; `git status` here surfaces the drift to commit. No build step, no copy-back.

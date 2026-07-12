# ai-setup

My personal AI coding-agent setup — global behavior rules, skills, MCP servers,
and plugins — shared across **Claude Code** and **OpenAI Codex**. One repo is the
source of truth; a deterministic installer symlinks it into place for both agents.

> [!NOTE]
> This is my personal config, published so others can borrow from it. It's
> opinionated and macOS-flavored. Take what's useful.

## Prerequisites

- [Bun](https://bun.sh) (runs the installer)
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and/or [Codex](https://developers.openai.com/codex) installed
- Optional per-skill: `uv`/`uvx` (basic-memory), Ollama (local-vision), Azure/AWS/Okta CLIs, etc.

## Install

```bash
git clone https://github.com/RascalTwo/ai-setup
cd ai-setup
bun install.ts
```

That's it. The installer is **idempotent, deterministic, and safe to re-run** — it
never overwrites a real file, only manages its own symlinks, and self-heals if you
move the repo (just re-run it). It:

- symlinks `CLAUDE.md`/`AGENTS.md` (the rules) into `~/.claude` and `~/.codex`
- symlinks every skill into `~/.claude/skills` **and** `~/.agents/skills` (Codex's path)
- links the status-line scripts, seeds `settings.json` on a fresh machine (never clobbers an existing one)
- registers the `basic-memory` MCP server with Codex

A few things genuinely need a human/AI and aren't scripted: the Chrome extension,
computer-use, Atlassian OAuth, and pulling Ollama models. See `integrations/` and
`setup-prompt.md` (an optional AI-assisted walkthrough for those bits).

## What's included

| Component | Description |
|---|---|
| **AGENTS.md** | Canonical global behavior rules (evidence-based claims, plan verification, subagent delegation, tool hierarchy, memory). `CLAUDE.md` is a symlink to it, so Claude Code and Codex read the same file. |
| **Skills** | 19 skills in [`skills/`](skills/) — e.g. `claude-audit`, `retro`/`retro-catchup`, `local-vision` (local-vision-first image reading, via AGENTS.md §9 prompting), `read-narrated-video`, `markdown-to-confluence`, `github-workflow-*`, `okta-api`, `ping-api`, `terraform-debug-unknown-error`, `tldraw-canvas`. Some depend on Claude-Code-only tools (Chrome/computer-use); those degrade to no-ops under other agents. |
| **r2-sdlc** | Story-to-PR dev pipeline, cross-agent: orchestrator + `testing-paradigm` + `documentation-philosophy` skills, 7 reviewer subagents (authored once in `.ruler/agents/` and compiled to Claude + Codex native formats via [Ruler](https://github.com/intellectronica/ruler)), and a dual-wired TDD red-gate hook. |
| **Integrations** | Setup guides for computer-use, Chrome, basic-memory, Atlassian Confluence. |
| **External Skills** | Recommended third-party skills + install commands ([external-skills.json](external-skills.json)). |

For the reasoning behind each piece, see [PHILOSOPHY.md](PHILOSOPHY.md).

## Memory

Persistent memory is [basic-memory](https://github.com/basicmachines-co/basic-memory)
— an MCP server storing plain Markdown in `~/basic-memory/`. Because it's MCP, it's
already agent-agnostic: the same notes are visible from Claude Code and Codex. The
installer registers it for Codex; Claude Code has it via `~/.claude.json`.

## Sync model (write-through)

Everything is a **symlink into this repo**, so editing a live file edits the repo
directly and `git status` here surfaces the drift to commit. The one exception is
`~/.claude/settings.json` (machine-specific absolute paths + per-machine plugins) —
it's seeded once and thereafter synced via the `claude-audit` skill, not symlinked.

## Public core + private overlay

This repo is the **public core**. Company/personal skills live in a separate private
overlay repo with its own `install.ts` that links only its skills on top of this core.
Full setup = run both installers (order doesn't matter). That keeps this repo clean
and shareable while private skills stay private.

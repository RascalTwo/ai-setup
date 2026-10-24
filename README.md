# ai-setup

My personal AI coding-agent setup — rules, skills, tools, MCP servers and a dev pipeline
— shared across **Claude Code** and **OpenAI Codex**. One repo is the source of truth; a
deterministic installer symlinks it into place for both. Published so others can borrow
from it; opinionated and macOS-flavored.

**This file is how to install it. Nothing else, on purpose** — the rest is explained
properly, with diagrams, in two explorables:

| | |
|---|---|
| 🧭 **[The AI setup tour →](https://rascaltwo.github.io/ai-setup/rascal-ai-setup-tour/)** | **What this is and how it works.** Sixteen stops through the machinery, then chapters on the rules file, the skills ecosystem, talking to it by voice, how every tool and skill declares itself, where state lives, and what the installer can't do. This is the real README. |
| 💭 **[How I Use AI →](https://rascaltwo.github.io/ai-setup/how-i-use-ai/)** | **Why it is shaped this way.** Fifteen principles in three arcs. The tour shows the machine; this says what the machine is for. |

## Install

```bash
git clone https://github.com/RascalTwo/ai-setup
cd ai-setup
bun install.ts
```

Requires [Bun](https://bun.sh) + [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
and/or [Codex](https://developers.openai.com/codex). Everything else is detected and skipped
when absent. Idempotent, deterministic and safe to re-run: it never overwrites a real file,
only manages its own symlinks, and self-heals if you move the repo.

| Command | |
|---|---|
| `bun install.ts` | the lot — rules, skills, tools, statusline, subagents, MCP |
| `bun install.ts --list` | every source and its skills, plus any live skill belonging to no source (what a rebuild would silently lose) |
| `bun install.ts --externals` | the `npx skills` packages in [`external-skills.json`](external-skills.json), tracked by reference rather than vendored (plus any overlay's own `external-skills.json`) |

Four capabilities the installer **cannot** set up — browser control, desktop control, Google
and Atlassian — are OAuth flows and per-app toggles behind somebody else's UI.
**[What the installer can't do →](https://rascaltwo.github.io/ai-setup/rascal-ai-setup-tour/#manualTitle)** walks through them, including the one
that bites: `computer-use` has to be enabled **per project**.

- **[How it gets installed →](https://rascaltwo.github.io/ai-setup/rascal-ai-setup-tour/#installTitle)** — what the installer actually does, in order.
- **[One pointer, and an empty `~/.claude` →](https://rascaltwo.github.io/ai-setup/rascal-ai-setup-tour/#pointerTitle)** — where everything lands and why.
- **[How a tool or skill declares itself →](https://rascaltwo.github.io/ai-setup/rascal-ai-setup-tour/#manifestTitle)** — the manifest, and where state lives.

Private skills layer on top via **overlays**: repos listed in `~/.agents/overlays.json`, picked
up automatically. That list is machine-local paths, which is why it lives there and not here.

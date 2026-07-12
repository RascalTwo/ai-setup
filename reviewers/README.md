# reviewers — cross-agent subagents (r2-sdlc)

**Source of truth:** `.ruler/agents/*.md` (one file per reviewer, Claude-style
frontmatter). Everything else here is **generated and committed**.

[Ruler](https://github.com/intellectronica/ruler) compiles each reviewer into
both native subagent formats:
- `.claude/agents/*.md` — Claude Code subagents (passthrough)
- `.codex/agents/*.toml` — Codex subagents (`developer_instructions` = body)

`../install.ts` symlinks the generated files into `~/.claude/agents` and
`~/.codex/agents`. **Installing needs only Bun — not Ruler.** Ruler is an
author-time tool: only needed when you *edit* a reviewer.

## After editing a reviewer

```bash
cd reviewers
bunx @intellectronica/ruler@latest apply --agents claude,codex --subagents --skills=false --with-mcp=false
```

Then re-run `../install.ts` (or just commit — the symlinks already point at the
regenerated files). Do **not** hand-edit `.claude/agents/` or `.codex/agents/` —
Ruler overwrites them on every apply.

Flags explained: `--skills=false` and `--with-mcp=false` keep Ruler from touching
skills/MCP (managed by symlink elsewhere); `--subagents` is required (it's
experimental/off by default).

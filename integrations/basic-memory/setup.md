# Basic Memory

A file-based persistent memory system for Claude Code. Notes are stored as plain markdown files in `~/basic-memory/`, searchable by Claude via MCP tools. Replaces Claude's built-in memory (which is limited and opaque) with something you own and control -- you can read, edit, and organize the files directly.

## Install

```bash
pipx install basic-memory
```

(`pip install basic-memory` also works if you prefer.)

## Configure MCP

Add to `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "basic-memory": {
      "command": "basic-memory",
      "args": ["mcp"]
    }
  }
}
```

Or use the CLI:

```bash
claude mcp add basic-memory -- basic-memory mcp
```

## Disable Built-in Memory

To avoid duplication between Claude's native memory and basic-memory, disable the built-in one. In `~/.claude/settings.json`:

```json
{
  "autoMemoryEnabled": false
}
```

## Key MCP Tools

| Tool | What it does |
|------|-------------|
| `write_note` | Create or update a note |
| `read_note` | Read a specific note by path |
| `search` | Semantic search across all notes |
| `search_notes` | Search notes by title or content |
| `build_context` | Gather related notes into a context bundle |
| `recent_activity` | Show recently created or modified notes |

## Working with Notes Directly

Notes live in `~/basic-memory/` as plain `.md` files. You can create, edit, move, or delete them with any text editor or file manager. Basic-memory indexes them automatically.

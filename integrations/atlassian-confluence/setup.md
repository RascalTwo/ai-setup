# Atlassian Confluence

Gives Claude read and write access to Confluence -- pages, spaces, comments, and search. Useful for documentation workflows, knowledge base lookups, and keeping Confluence in sync with code changes.

## Authentication

Uses **OAuth authentication** (not API token). You authenticate through the Atlassian OAuth flow, which grants scoped access to your Confluence instance.

## Install

Add to `~/.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "atlassian": {
      "command": "npx",
      "args": ["-y", "@anthropic/atlassian-mcp"]
    }
  }
}
```

Or use the CLI:

```bash
claude mcp add atlassian -- npx -y @anthropic/atlassian-mcp
```

On first use, the OAuth flow will open in your browser. Authorize the application to access your Atlassian site.

## Cloud ID

When using Atlassian MCP tools, specify `cloudId` as your site URL:

```
https://yoursite.atlassian.net
```

This is needed because OAuth auth doesn't auto-bind to a cloud instance.

## Key MCP Tools

| Tool | What it does |
|------|-------------|
| `getConfluencePage` | Fetch a page by ID |
| `searchConfluenceUsingCql` | Search pages using Confluence Query Language |
| `createConfluencePage` | Create a new page in a space |
| `updateConfluencePage` | Update an existing page's content |
| `getConfluenceSpaces` | List available spaces |

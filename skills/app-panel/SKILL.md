---
name: app-panel
description: "An MCP server (packaged as a skill) with a floating panel beside the Claude Code terminal for anything visual: the `show` tool puts your own HTML or a page by URL there, the `progress` tool and `app-panel-progress` command show a long task's progress, and MCP Apps (the interactive `ui://` views an MCP server's tools carry) open there too; what the user does in it comes back into the session. Use to add or remove a server whose tools have views, or when the panel or an MCP App doesn't show."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    herdr: the panel follows its pane, hidden while another pane is focused
    ghostty: the panel sits at the terminal window's corner
  requires:
    commands: [bun]
    manual:
      - "macOS + Xcode command line tools to build the floating panel (helper/build); elsewhere, views open in a browser tab"
      - "herdr, for a view's messages to reach the session (they are typed into the session's pane)"
---

# app-panel: a visual panel and MCP Apps host for Claude Code

Claude Code runs MCP tools but drops their `ui://` views. `host.ts` is one MCP server that fills the gap until Claude Code renders MCP Apps itself, at which point this skill is deleted:

- **show**: its own tool puts HTML the model writes (any library or site may load) or a page by URL in the panel. In that HTML, `panel.send(text)` messages the model;
- **progress**: its other tool shows a long task as one view updated in place (stages, a real count or a bar filling toward an estimate, then green or red). The `app-panel-progress` command (`progress.ts`) posts to the same function, finding the host through `~/.agents/state/app-panel/sessions/<pane>.json`; given `-- <command>` it wraps the command and finishes the bar by its exit code. The host's instructions tell every session to use one of them for work over a minute;
- **proxy**: it connects to the servers in `~/.config/app-panel/servers.json` and offers their tools as `<server>__<tool>`;
- **bridge**: every view goes in the one panel per session, newest on top and earlier ones in its list; a view's own tool calls reach its server through the official `AppBridge`;
- **deliver**: what a view sends the model (`ui/message`) is typed into the session's herdr pane as `[app-panel · <title>] <text>`, with the view's latest model context attached.

## Steps

1. **Register a server with views** in `~/.config/app-panel/servers.json`, not with `claude mcp add`: a server Claude Code connects to directly loses its views. The shape is Claude Code's own `mcpServers` (`command`/`args`/`env`, or `url`), so an entry moves over as is. A name must not contain `__`.
2. **Register the host once**: `claude mcp add -s user app-panel -- bun <this skill>/host.ts`. New sessions pick up servers.json changes; a running one needs `/mcp` reconnect.
3. **Put the command on PATH once**: `ln -s <this skill>/progress.ts ~/.local/bin/app-panel-progress`.
4. Done when `/mcp` shows app-panel connected with the `<server>__<tool>` tools listed, and calling one with a view opens the panel.

## Gotchas

- The panel needs the helper binary: `helper/build` once (macOS). Without it, views open in a browser tab.
- The panel shows only while Ghostty is frontmost and the session's herdr pane (`$HERDR_PANE_ID`) is focused. A view for a pane the user isn't looking at waits, hidden.
- Outside herdr (no `$HERDR_PANE_ID`) a view's messages have nowhere to go, and the view gets an error back. While a permission prompt is open herdr refuses to type, so the host retries every 2s for up to 10 minutes.
- Claude Code channels were the first delivery route; their dev flag stops every launch at a warning screen, so herdr typing replaced them. Switch back once channels accept a custom server without that flag.
- `app-panel-progress` outside a herdr session with app-panel (no session file) still runs its command, without a bar. A finished task given the same title again starts a new view; a successful one folds the panel 5s after it ends.
- A view opened again from the list starts fresh: its page reloads and gets its tool input and result again.
- A `show` by URL is framed at a fixed 640px height (another origin can't be measured), and `panel.send` isn't available inside it.
- Not yet bridged: view permissions (camera, mic), file downloads, display modes other than inline, and app-provided tools.
- The ext-apps example servers need `uv run --with 'mcp<2' …`: they import `FastMCP`, which mcp 2.x renamed.

Why MCP Apps and not another spec: [reference/research.md](reference/research.md).

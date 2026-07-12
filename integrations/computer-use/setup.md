# Computer Use MCP

Gives Claude the ability to see and interact with your desktop. Claude can take screenshots, move the mouse, click, type, and scroll -- effectively operating your computer the way you would.

## Enable It

Add `"computer-use"` to the `enabledMcpjsonServers` array in `~/.claude/settings.local.json`:

```json
{
  "enabledMcpjsonServers": ["computer-use"]
}
```

No separate install step. The MCP server ships with Claude Code.

## First Use

On first use, Claude will call `request_access` and prompt you to approve access to specific applications. You approve each application individually -- nothing runs without your explicit consent.

## Tiered Access Model

Not every application gets the same level of control. Access is tiered by application category:

| Tier | Applications | Allowed | Blocked |
|------|-------------|---------|---------|
| **read** | Browsers (Safari, Chrome, Firefox, Arc, etc.) | Screenshots | Clicks, typing, scrolling |
| **click** | Terminals and IDEs (Terminal, iTerm, VS Code, JetBrains, etc.) | Screenshots, left-click, scrolling | Typing, key presses, right-click, modifier-clicks, drag |
| **full** | Everything else | All actions | Nothing |

For browser interaction beyond screenshots, use the [Claude-in-Chrome extension](../chrome-claude/setup.md) instead. For shell commands in terminals, use Claude's built-in Bash tool.

## macOS Permissions

You may need to grant permissions in **System Settings > Privacy & Security**:

- **Accessibility** -- allows Claude to send clicks and keystrokes to applications
- **Screen Recording** -- allows Claude to capture screenshots of your desktop

macOS will prompt you when these are first needed. Grant them to the Claude Code application (or your terminal emulator if running Claude Code from the terminal).

# Claude-in-Chrome Extension

Gives Claude DOM-aware access to Chrome. Instead of pixel-level screenshots and mouse coordinates (computer-use), this extension understands the page structure directly -- reading text, filling forms, clicking elements, and navigating. Faster and more reliable than computer-use for anything in a browser.

## Install

1. Install the **Claude Code Computer Use** extension from the [Chrome Web Store](https://chromewebstore.google.com/).
2. That's it. The extension communicates with Claude Code via MCP automatically. No additional MCP configuration is needed beyond having the extension installed and running.

## Available Tools

| Tool | What it does |
|------|-------------|
| `navigate` | Go to a URL |
| `get_page_text` | Extract all text content from the current page |
| `read_page` | Read the page with DOM structure (more detail than get_page_text) |
| `form_input` | Fill in form fields |
| `find` | Search for elements on the page |
| `javascript_tool` | Execute JavaScript in the page context |
| `tabs_context_mcp` | Get info about open tabs |
| `tabs_create_mcp` | Open a new tab |
| `gif_creator` | Record a GIF of browser activity |
| `read_console_messages` | Read browser console output |
| `read_network_requests` | Inspect network traffic |

## When to Use This vs. Computer Use

Use Claude-in-Chrome for anything happening inside Chrome -- it's faster and more precise. Use computer-use for native desktop applications (Finder, System Settings, Notes, etc.) that aren't in the browser.

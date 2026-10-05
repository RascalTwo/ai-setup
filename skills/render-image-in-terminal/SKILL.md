---
name: render-image-in-terminal
description: Renders an image inline in the terminal, in the Claude Code transcript — a file, a URL, the clipboard, or one just generated. Use when the user says "show me" an image, logo, chart, diagram, screenshot or picture, or when an image you produced is the answer.
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    claude-code: ttyimgspool PostToolUse hook draws it
  requires: [ttyimgspool]
---

Run, as its own Bash call:

```bash
~/.agents/ai-setup/tools/ttyimgspool/show-image <source>
```

`<source>` is a local path, an `http(s)://` URL, or the word `clipboard` (an image on the clipboard; otherwise the clipboard's text is used as the source). It prints `show-image: <png>`, and the ttyimgspool hook draws that PNG inline under the call, captioned; Ctrl+click opens it full-pane.

To show something you create (a chart, a rendered page, a diagram): write it to a file first, then show that file.

Screenshots and images you `Read` already appear inline automatically. Run `show-image` for anything else the user should see.

Done when the command printed its `show-image:` line. A `show-image: <reason>` on stderr means nothing was shown: tell the user why.

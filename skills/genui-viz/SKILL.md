---
name: genui-viz
description: "Puts a generative UI card in front of the user mid-task (a floating panel glued to their terminal pane) and returns their answer as data: approve a risky step, review a diff, fill a few fields, pick rows, or just show a result. Use when a question or result reads better as UI than as terminal text, or the user says \"genui\", \"show me a card\", \"ask me with a panel\"."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    viz: cards and answers live in the central library's genui viz
    herdr: the panel follows its pane, hidden while another pane is focused
    ghostty: the panel sits at the terminal window's corner, stacked under any older card showing there
  requires:
    skills: [viz]
    commands: [bun]
    manual:
      - "macOS + Xcode command line tools to build the floating panel (helper/build); elsewhere, cards open in a browser tab"
---

# genui-viz: cards the user answers

A **card** is a small floating window built from one or more **components** (a confirm, a diff, a
form…). You write the card as ~300 bytes of JSON; `page/panel.ts` draws it; the user's answer comes
back on stdout. Every card stays in the `genui` viz with its answer, the user's look-back log.

## When a card beats text

Reach for a card when the answer is a **decision** (approve a deletion, apply a patch), a **shape**
the terminal mangles (a diff, a table, several fields at once), or a **result** worth a glance while
you keep working. Plain questions with a free-text answer stay in the chat.

## Steps

1. Write the spec (shapes below) to a file, or pass it inline as `'{...}'` or on stdin as `-`.
2. Run, from this skill's directory:
   `bun genui.ts show <spec.json | '{...}' | -> [--timeout <s>] [--json]`
   It waits for the answer (default 600 s) and prints one line: `✓ c-<id>: <what the user sent>`.
   `--json` adds the raw answer value. A card of only display components returns at once:
   `✓ c-<id>: shown`.
3. Act on the answer. `Cancelled` means the user pressed Escape: ask in chat, or drop it.

The answer line is the receipt the user sees in the terminal; don't repeat it back to them.

Long waits: `show --no-wait` returns the card id at once; `bun genui.ts wait <id>` collects the
answer later. `bun genui.ts ls [--pending]` lists cards.

## Components

Every card has a `title`. One component: put its fields beside `type`. Several: stack them under
`components`, each with an optional `title` (a sub-heading) and `id` (its key in the answer).

| type | shows | answer value |
|---|---|---|
| `confirm` | markdown `body`, `facts`, a note box, yes/no | `{decision: "yes"\|"no", note?}` |
| `diff` | a unified `patch`, syntax-highlighted per file, approve/reject | same as confirm |
| `form` | an MCP elicitation `schema`: text, number, boolean, enum, multi-select, date | the filled values |
| `choice` | `columns` + `rows`; Pick a row, or tick several with `multi: true` | `{index}` / `{indexes}` |
| `notice` | `status` badge, markdown `body`, `facts` | display |
| `table` | `columns` + `rows`, optional markdown `body` | display |
| `code` | highlighted `text` in `lang` (else the title's extension) | display |
| `html` | your own `html` + `css` + `js` in a sandboxed frame | whatever its JS sends |

```json
{"type": "confirm", "title": "Delete build/?", "body": "212 MB, **untracked**.",
 "facts": [["Files", "1,204"]], "yes": "Delete", "no": "Keep", "danger": true}

{"type": "diff", "title": "src/fetch.ts", "patch": "@@ -1 +1 @@\n-a()\n+b()\n", "yes": "Apply"}

{"type": "form", "title": "Deploy", "schema": {"required": ["env"], "properties": {
  "env": {"type": "string", "title": "Environment", "enum": ["stg", "prod"]},
  "replicas": {"type": "integer", "minimum": 1, "maximum": 10, "default": 2},
  "tags": {"type": "array", "items": {"enum": ["canary", "hotfix"]}},
  "dryRun": {"type": "boolean", "default": true}}}}

{"title": "Ship v2.3?", "components": [
  {"type": "notice", "status": "info", "body": "CI green, 3 commits."},
  {"type": "form", "title": "Options", "schema": {"properties": {"canary": {"type": "boolean"}}}},
  {"type": "confirm", "yes": "Ship", "no": "Hold"}]}
```

- `danger: true` turns the yes button red, and Enter alone won't press it (⌘⏎ does).
- In a stacked card, the component whose button is pressed answers for the whole card:
  `{form: {...}, confirm: {decision: "yes"}}`. Keys default to the type (`notice2` when repeated).
  A form or multi-pick sharing a card with a confirm, diff or one-pick choice loses its own Send
  and rides along; an invalid form blocks the send.
- Display components (`notice`, `table`, `code`, `html`) get one Done button. Set `wait: true` on
  the card or a component to keep `show` waiting until Done, or until the html answers.

### `html`: the escape hatch

For what no component covers (a chart with sliders, a colour picker, a custom layout). `js` runs as
a module, so `import * as d3 from "https://esm.sh/d3@7"` works. Call `genui.answer({...})` to send;
`genui.sent` holds the sent value when the card is redrawn later. The frame is sandboxed (no access
to the page or its logs) and grows to its content. Set `wait: true`, or `show` returns before the
user answers. Prefer a component when one fits: improving a component redraws every old card, but
html stays as it was written.

## Gotchas

- The panel needs the helper binary: `helper/build` once (macOS). Without it, cards open in a
  browser tab, which ignores the close after an answer.
- The panel shows only while Ghostty is frontmost and the card's herdr pane (`--pane`, default
  `$HERDR_PANE_ID`) is focused. A card for a pane the user isn't looking at waits, hidden.
- Highlighting and markdown load from a CDN on first use; offline, the card shows plain text.

Why these components and names: [reference/research.md](reference/research.md).

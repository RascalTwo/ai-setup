---
name: publish-markdown-to-confluence
description: Publish a local markdown file to a Confluence page, replacing the page body. Converts markdown → ADF (Atlassian Document Format), preserves tables/links/headings, renders date pills inside table cells, and supports dropping specific table rows (e.g. provenance rows that only matter locally). Use when the user asks to "push this markdown to Confluence", "publish X to Confluence", "sync this doc to the wiki page", or similar.
---

Publish a markdown file to a Confluence page by converting it to ADF JSON and calling the Atlassian MCP.

## Prerequisites

- `python3` on PATH.
- `mcp__claude_ai_Atlassian_Rovo__*` tools loaded (use `ToolSearch` if deferred).
- Edit access to the target page.

## Arguments

1. **Source file**: path to the markdown file to publish.
2. **Target page**: a Confluence page URL (e.g. `https://<site>.atlassian.net/wiki/spaces/FOO/pages/12345/My+Page`) or a raw numeric page ID.
3. **Optional — rows to drop**: if the source contains field-table rows that only make sense locally (provenance, debug metadata), list them so the skill strips them before publishing.

If the user doesn't name a page, ask. Don't guess.

## What the converter handles

The `md-to-adf.py` script in this skill directory converts:

- YAML frontmatter (stripped).
- `#`…`######` headings.
- Pipe tables (first row = header; separator row discarded).
- Single-line `> blockquote`.
- `---` horizontal rules.
- `[label](url)` links, `_italic_` emphasis.
- Bare `YYYY-MM-DD` tokens inside **table cells** become ADF `date` pills. Dates inside narrative paragraphs stay as plain text.

What it does **not** handle: bullet/numbered lists, fenced code blocks, multi-paragraph blockquotes, nested tables, `**bold**`. If the source uses any of those, extend the converter — don't hand-edit the ADF output.

## Workflow

### 1. Resolve `cloudId` + `pageId`

If the user gave a URL, extract the numeric page ID from `/pages/{id}/...` and use the site hostname as `cloudId` (e.g. `<site>.atlassian.net`). If only a page ID, ask which site.

### 2. Fetch the current page — and save it to disk

Call `mcp__claude_ai_Atlassian_Rovo__getConfluencePage` with `contentFormat: "adf"` to confirm access and capture the page title. If the call 404s or errors, stop and report — don't guess a different page.

**Save the response to `/tmp/current-page.json`.** You need it for the preserve-on-round-trip step (next). Overwriting the current body with a freshly-converted ADF wipes any Confluence-native elements the user added (ToC macro, info panels, Smart Links, Jira embeds) — those elements have no markdown equivalent, so the converter can't regenerate them. The preserve step lifts them off the current page and re-splices them into the new ADF.

### 3. Build full ADF

`preserve-extensions.py` extracts every top-level node whose type isn't emitted by `md-to-adf.py` (`extension`, `bodiedExtension`, `inlineCard`, `blockCard`, `embedCard`) from the current page, anchors each one to its nearest preceding heading, and re-inserts them at the same relative position in the new ADF. That keeps Confluence-native macros (ToC, info panels, Smart Links, Jira embeds, etc.) intact across republishes.

```bash
python3 <skill-dir>/md-to-adf.py <source> [--drop-row "ROW NAME" ...] > /tmp/adf-full-raw.json
python3 <skill-dir>/preserve-extensions.py /tmp/current-page.json /tmp/adf-full-raw.json > /tmp/adf-full.json
```

### 4. Push

**Always use the disk-based path (`mcp-http-call.py`)** — never inline the body via `mcp__claude_ai_Atlassian_Rovo__updateConfluencePage`. Inline tool-call args flow through the model's output tokens, which is fragile for any structured payload above a few KB (character-level corruption, escaping bugs, hard size limits all live there). The disk-based path reads the body from a file the model never had to type, so it's reliable at any size.

```bash
# Build the args file
python3 - <<'PY'
import json
adf = json.load(open('/tmp/adf-full.json'))
args = {
    "cloudId": "<site>.atlassian.net",
    "pageId": "<page-id>",
    "contentFormat": "adf",
    "title": "<page-title>",
    "body": json.dumps(adf, ensure_ascii=False, separators=(',',':')),
    "versionMessage": "<message>",
}
json.dump(args, open('/tmp/update-args.json', 'w'))
PY

# Push
python3 <skill-dir>/mcp-http-call.py updateConfluencePage /tmp/update-args.json
```

Keep the existing page title unless the user asks to change it.

### 5. Report

Print the final page URL and the version number.

## How `mcp-http-call.py` works

The Atlassian MCP server is exposed at `https://mcp.atlassian.com/v1/mcp`. Claude Code's OAuth token for that server is stored in the macOS keychain (`Claude Code-credentials`) and is accessible via the `security` CLI without a GUI prompt on most setups. The bundled `mcp-http-call.py`:

- Reads the Atlassian OAuth bearer token from the keychain.
- Runs the MCP `initialize` + `notifications/initialized` handshake.
- POSTs a `tools/call` for the named tool with arguments loaded from a file.
- Prints the server response on stdout.

Tested at ≥600KB of tool args. Practical ceiling is whatever the Atlassian MCP + Confluence API accept, which is well above any realistic page payload.

### Fallback — Confluence REST + PAT

If the keychain-based path isn't available (different OS, Claude Code not installed), fall back to a Personal Access Token from `https://id.atlassian.com/manage-profile/security/api-tokens`:

```bash
curl -u "<email>:<token>" \
  -X PUT "https://<site>.atlassian.net/wiki/api/v2/pages/<id>" \
  -H "Content-Type: application/json" \
  -d @<(jq -n --slurpfile body /tmp/adf-full.json \
              --arg id "<id>" --arg title "<title>" \
              --argjson version <next_version> \
              '{id:$id, status:"current", title:$title, body:{representation:"atlas_doc_format", value:($body[0]|tostring)}, version:{number:$version}}')
```

## File layout

- `SKILL.md` — this file.
- `md-to-adf.py` — markdown → ADF converter. Pure file-in / stdout. No network I/O. Extend here when new markdown shapes appear.
- `preserve-extensions.py` — round-trip preservation of Confluence-native nodes (ToC macros, info panels, Smart Links, Jira embeds). Takes the current page ADF + a freshly-converted ADF, splices preserved nodes into the new one anchored to their surrounding headings. Extend the `PRESERVE_TYPES` set if new macro types show up in pages you publish.
- `mcp-http-call.py` — direct Atlassian MCP HTTP client. Reads bearer token from keychain, runs the MCP handshake, calls the named tool with arguments loaded from a file. Use for payloads that exceed the inline tool-call size limit.

## Wrapping this skill

This skill is generic. Callers with domain conventions (e.g. a journal format that has provenance rows meant for local-only use) should not modify this skill — instead, wrap it in a thin caller (prompt or sibling skill) that supplies the right `--drop-row` flags and target page. Keep this skill content-agnostic.

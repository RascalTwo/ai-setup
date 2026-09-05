---
name: publish-markdown-to-confluence
description: Publish a local markdown file to a Confluence page, replacing the page body. Converts markdown → ADF (Atlassian Document Format), preserves tables/links/headings, renders date pills inside table cells, and supports dropping specific table rows (e.g. provenance rows that only matter locally). Use when the user asks to "push this markdown to Confluence", "publish X to Confluence", "sync this doc to the wiki page", or similar.
---

Publish a markdown file to a Confluence page by converting it to ADF JSON and calling the Atlassian MCP.

## Prerequisites

- `python3` on PATH.
- A **standalone** Atlassian MCP server registered and authenticated — this is what puts a
  usable bearer token in the keychain, and the push in step 4 does not work without it:
  ```
  claude mcp add -s user --transport http atlassian https://mcp.atlassian.com/v1/mcp
  ```
  then `/mcp` in Claude Code and authenticate `atlassian`. A **claude.ai-managed** Atlassian
  connector is NOT a substitute even though its tools work fine in-session — see
  "A claude.ai-managed Atlassian connector will NOT work here" below.
- Any Atlassian MCP tools you want for the *read* in step 2 (use `ToolSearch` if deferred) —
  or just do that read through `mcp-http-call.py` too, which needs no tools loaded.
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
- `[label](url)` links, `**bold**` and `_italic_` emphasis.
- Bare `YYYY-MM-DD` tokens inside **table cells** become ADF `date` pills. Dates inside narrative paragraphs stay as plain text.

What it does **not** handle: bullet/numbered lists, fenced code blocks, multi-paragraph blockquotes, nested tables. If the source uses any of those, extend the converter — don't hand-edit the ADF output. (A `- ` bullet survives as a plain paragraph with a literal leading `-`, so a short list publishes legibly but not as a real ADF list.)

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

The Atlassian MCP server is exposed at `https://mcp.atlassian.com/v1/mcp`. A **standalone**
MCP server registration for that URL stores its OAuth token in the macOS keychain
(`Claude Code-credentials`, under `mcpOAuth`, key prefix `atlassian|`), readable via the
`security` CLI without a GUI prompt. That registration is a **prerequisite** — see
"Prerequisites" above. The bundled `mcp-http-call.py`:

- Reads the Atlassian OAuth bearer token from the keychain.
- Runs the MCP `initialize` + `notifications/initialized` handshake.
- POSTs a `tools/call` for the named tool with arguments loaded from a file.
- Prints the server response on stdout.

Tested at ≥600KB of tool args. Practical ceiling is whatever the Atlassian MCP + Confluence API accept, which is well above any realistic page payload.

### A claude.ai-managed Atlassian connector will NOT work here

Having working `mcp__*Atlassian*__*` tools in your session does **not** mean this script can
publish. Atlassian access can come from either of two places, and only one of them works:

| | Standalone MCP server | claude.ai-managed connector |
|---|---|---|
| Registered by | `claude mcp add --transport http atlassian …` | claude.ai account settings |
| `serverUrl` in keychain | `https://mcp.atlassian.com/v1/mcp` | `https://api.anthropic.com/v2/ccr-sessions/…` |
| `accessToken` in keychain | the real bearer | **empty string** |
| Works for in-session tool calls | yes | yes |
| Works for `mcp-http-call.py` | **yes** | **no** |

The managed connector is proxied through `api.anthropic.com` and authenticates with your
`claudeAiOauth` session token, not a per-server one — so its `mcpOAuth` entry exists with an
**empty** `accessToken`, which is why `get_token()` raises rather than sending `Bearer `.

Substituting the `claudeAiOauth` token against the proxy URL **does not rescue it**. The
handshake succeeds (HTTP 200, session id returned) and then every `tools/call` fails with:

```
{"error": {"code": -32003, "message": "MCP tool call requires approval"}}
```

The proxy gates each call behind the interactive approval channel, which an out-of-band HTTP
client cannot satisfy. This is a dead end, not a misconfiguration — don't burn time on it.

Diagnose with:

```bash
security find-generic-password -s "Claude Code-credentials" -w \
  | python3 -c 'import json,sys; [print(k, "accessToken=" + ("SET" if v.get("accessToken") else "EMPTY"), v.get("serverUrl")) for k,v in json.load(sys.stdin).get("mcpOAuth",{}).items()]'
```

If the only Atlassian rows are `EMPTY` with `api.anthropic.com` URLs, register the standalone
server per "Prerequisites" and re-run. The token lands in the **shared** keychain entry, so it
becomes usable from **any** session immediately — including sessions that don't have the
`atlassian` MCP tools loaded, and without restarting Claude Code. Re-check the keychain before
concluding you need to hand the job to another session.

Scope matters: `claude mcp add` defaults to **local (per-project)** scope, so a server added
while cwd was project A is invisible from project B. Add `-s user` to make it available
everywhere, and check `claude mcp list` from the directory you'll actually publish from.

### Fallback — Confluence REST + PAT

If the keychain-based path isn't available (different OS, Claude Code not installed, or only a
claude.ai-managed connector is present and you can't register a standalone server), fall back to
a Personal Access Token from `https://id.atlassian.com/manage-profile/security/api-tokens`:

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

## See Also

- **confluence-editor** skill — the opposite case: surgical edits to a page a human owns
  (insert a section, add a screenshot, fix a paragraph), driven through the browser editor and
  left **unpublished** for them to review. Use that when the page is not generated from a local
  markdown file, or when the user wants to approve the change before it goes live.

---
name: slack-in-browser
description: Reads and reacts in Slack through the user's logged-in browser tab, by calling Slack's own web API from inside the page (no clicking, no Slack MCP). Use to watch a channel for a message, read recent messages or bot/email alerts, add a reaction, or reply when no Slack tool is connected.
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    chrome: browser automation
  requires:
    manual: [Chrome, claude-in-chrome]
---

# Slack through the browser's own session

**Call Slack's web API from inside the user's signed-in Slack tab.** Driving the page by clicking and typing through screenshots takes many steps and can type into the live message box by mistake; two `fetch` calls do the same work and can be checked by reading the result back. Needs a browser tool that runs JavaScript in the page and returns the value (for example a `javascript_tool`). If a proper Slack connector is available, use that instead.

## Steps

1. **Open the web client, not the archive link.** `https://<workspace>.slack.com/archives/<channel>` redirects to a "launching the desktop app" page. Use `https://app.slack.com/client/<TEAM>/<CHANNEL>`, or the page's "open this link in your browser" link (`/messages/<channel>`), which lands there. The `T…` id in that URL is `<TEAM>`.
2. **Confirm the session.** A tab that shows the Slack client is signed in. A login page means the user signs in; you cannot.
3. **Run the call in the page.** The token is read inside the expression and used there. Return only the results: some browser tools redact token-shaped values, but do not rely on that, and a token in the result is a leaked credential.

```js
const token = JSON.parse(localStorage.getItem('localConfig_v2')).teams['<TEAM>'].token;
const slack = async (method, params) =>
  (await fetch('/api/' + method, { method: 'POST', body: new URLSearchParams({ token, ...params }), credentials: 'include' })).json();
const h = await slack('conversations.history', { channel: '<CHANNEL>', limit: '5' });
JSON.stringify(h.messages.map(m => ({ ts: m.ts, reactions: (m.reactions || []).map(r => r.name + ':' + r.count) })));
```

   Tools differ on how they evaluate scripts. Where top-level `await` works, use the bare form above: an `async` IIFE may return `{}` instead of its result.
4. **Verify every write by reading it back** (`conversations.history` again) and say what you saw.

## Methods used

| To | Method | Params |
|---|---|---|
| Read recent messages | `conversations.history` | `channel`, `limit` |
| Read a thread | `conversations.replies` | `channel`, `ts` |
| React | `reactions.add` | `channel`, `timestamp` (the message's `ts`), `name` (e.g. `white_check_mark`) |

A message is identified by its `ts`.

## Reading bot and email alerts

Alerts posted by an email integration have an empty `text`. The words live in `files` (or `attachments`), so search `JSON.stringify(message)` for the phrase you want. The open tab can render a new message minutes late; the API is current, so poll the API and treat the tab as stale.

## Acting for the user

Reading, and reactions the user asked for, are yours to do. Posting a message (`chat.postMessage`) sends content as the user: show the draft and wait for a clear yes each time.

## Gotchas

- The user's own session means the user's identity on every write. A reaction shows as theirs.
- This is Slack's undocumented web API and the user's own token. It can change without notice, so treat a failure as "this method no longer works", not as a reason to retry harder.
- Typing into the Slack composer with a screenshot-and-click tool types into the live message box. If it happens, click the box, select all, delete, and confirm the placeholder is back before anything else.

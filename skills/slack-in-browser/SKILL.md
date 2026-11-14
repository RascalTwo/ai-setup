---
name: slack-in-browser
description: Reads and reacts in Slack through the user's logged-in browser tab, by calling Slack's own web API from inside the page (no clicking, no Slack MCP). Use to watch a channel for a message, read recent messages or bot/email alerts, add a reaction, or reply when no Slack tool is connected.
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    chrome: browser automation
  requires:
    skills: [browser]
    manual: [Chrome]
---

# Slack through the browser's own session

**Call Slack's web API from inside the user's signed-in Slack tab.** Driving the page by clicking and typing takes many steps and can type into the live message box by mistake; two `fetch` calls do the same work and can be checked by reading the result back. Use the `browser` skill for the tool (browse by default: its tabs carry the user's Slack login, open in the background and never take focus). If a proper Slack connector is available, use that instead.

## Steps

1. **Open a browse session on the web client, not the archive link.** `https://<workspace>.slack.com/archives/<channel>` redirects to a "launching the desktop app" page. Use `https://app.slack.com/client/<TEAM>/<CHANNEL>`, or the page's "open this link in your browser" link (`/messages/<channel>`), which lands there. The `T…` id in that URL is `<TEAM>`. With no team or channel known, `https://app.slack.com/client/` lands on the user's last channel and the final URL shows both ids.
2. **Confirm the session.** A URL that stays on `app.slack.com/client/…` and a title like `<channel> (Channel) - <workspace> - Slack` is signed in. A login page means the user signs in (`handoff()`); you cannot.
3. **Run the call in the page.** `page.evaluate` runs it, the token is read inside the function and used there, and only results are returned. A token in the result is a leaked credential, so return a mapped summary and never the raw response.

```bash
browse session new slack
browse execute -s slack --timeout-ms 60000 '
await page.goto("https://app.slack.com/client/<TEAM>/<CHANNEL>", { timeout: 20000 });
await page.waitForTimeout(3000);
return await page.evaluate(async () => {
  const token = JSON.parse(localStorage.getItem("localConfig_v2")).teams["<TEAM>"].token;
  const slack = async (method, params) =>
    (await fetch("/api/" + method, { method: "POST", body: new URLSearchParams({ token, ...params }), credentials: "include" })).json();
  const h = await slack("conversations.history", { channel: "<CHANNEL>", limit: "5" });
  return h.messages.map(m => ({ ts: m.ts, reactions: (m.reactions || []).map(r => r.name + ":" + r.count) }));
});'
```

4. **Verify every write by reading it back** (`conversations.history` again) and say what you saw.
5. `browse session delete slack` when done.

## Methods used

| To | Method | Params |
|---|---|---|
| Read recent messages | `conversations.history` | `channel`, `limit` |
| Read a thread | `conversations.replies` | `channel`, `ts` |
| React | `reactions.add` | `channel`, `timestamp` (the message's `ts`), `name` (e.g. `white_check_mark`) |

A message is identified by its `ts`.

## Reading bot and email alerts

Alerts posted by an email integration have an empty `text`. The words live in `files` (or `attachments`), so search `JSON.stringify(message)` for the phrase you want. The open tab can render a new message minutes late; the API is current, so poll the API (re-run `conversations.history` in the same session) and treat the rendered page as stale.

## Acting for the user

Reading, and reactions the user asked for, are yours to do. Posting a message (`chat.postMessage`) sends content as the user: show the draft and wait for a clear yes each time.

## Gotchas

- The user's own session means the user's identity on every write. A reaction shows as theirs.
- This is Slack's undocumented web API and the user's own token. It can change without notice, so treat a failure as "this method no longer works", not as a reason to retry harder.
- Never type into the Slack composer to send something: the API call is the write path, and a stray keystroke lands in the live message box.

---
name: sync-webex-to-google-calendar
description: Sync meetings from the Webex desktop app into Google Calendar as mirror events (create new, update changed, delete cancelled, skip what is already native). Use for "sync Webex to Google Calendar", "mirror my Webex meetings", "update my work calendar".
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    webex: desktop calendar read through the macOS accessibility API
    google-calendar: mirror events written through the gws CLI (google skill, work account)
  requires:
    commands: [swiftc, gws]
    skills: [google]
    manual: [Webex]
---

# Sync Webex to Google Calendar

One-way: the Webex desktop calendar (it shows every Outlook meeting, including Zoom and Meet ones) to the user's primary Google Calendar. Read-only on Webex. On Google, touch only events this skill created.

Needs macOS, the Webex desktop app, Accessibility permission for the terminal, and the `google` skill's `work` account (gws). Use gws, not the Google Calendar MCP: the MCP sees one account and may not be authenticated.

## 0. Config

`~/.config/sync-webex-to-google-calendar/config.json`, all keys optional:

| Key | Default | Meaning |
|---|---|---|
| `excludeTitles` | `[]` | Exact titles never mirrored (e.g. events the user copied into Webex by hand from Google) |
| `timeZone` | system zone | IANA zone for reads and writes |
| `titlePrefix` | `[Webex]` | Mirror title prefix |
| `colorId` | `"6"` | Google event color for mirrors |
| `days` | `30` | Window length; Webex's list reaches about a month ahead |

## 1. Extract (deterministic)

`scripts/run.sh --from <today> --days <days>` takes about 70-100 s. It takes Webex's focus, so tell the user to leave mouse and keyboard alone; it restores their previous app on exit. Output: `~/.local/share/webex-calendar/out/week.json` (`{extractedAt, listEnd, range, events[], errors[]}`; per event: title, date, allDay, start, end, organizer, rooms, inviteeCount, accepted, link, description). Exit codes 2/3 and `ERROR` log lines mean Webex is not running, not trusted for accessibility, the baseline failed, or the list never settled or ends before `--from` (a stale Webex calendar, which fills in over a minute or so): report and stop. On the stale/settle errors, offer one re-run.

Done when `errors` is empty and `events` is non-empty. Otherwise stop with no Google writes: a partial read would delete live mirrors.

Skip `allDay` events (banner rows, not meetings) and any title in `excludeTitles`. Webex titles can carry trailing whitespace: trim every title before comparing or writing, or every mirror reads as changed. Webex has no event ID, so identity = (`link`, `start`). A `link` can be a mail-gateway-rewritten URL when the invite came from a Zoom host; it is still the join link.

## 2. Read Google

Through the `google` skill, account `work`: `gws calendar events list --params '{"calendarId":"primary","timeMin":…,"timeMax":…,"singleEvents":true,"orderBy":"startTime","maxResults":250,"timeZone":…}'`, following `nextPageToken` to the end. Save each page to a file under `~/.agents/state/sync-webex-to-google-calendar/` (about 300 KB for a month) and read it with python or jq, not into chat. Events carry `description` and `location` when set. Mirrors = events whose description starts with `MIRRORED-FROM-WEBEX`; those are the only events this skill may update or delete.

## 3. Classify (judgment)

Walk every Webex event, then every mirror:

| Case | Action |
|---|---|
| A non-mirror Google event has the same start/end and the same title or the same join link | **native**: skip |
| A mirror matches on (`link`, `start`) and its title/end/location are unchanged | **unchanged**: skip |
| A mirror matches on (`link`, `start`) with a differing title, end or organizer | **update** |
| An unmatched mirror and an unmatched Webex event share a `link` (or title) on the same date | **moved**: update the mirror's times |
| A Webex event matches nothing | **create** |
| A mirror dated before `listEnd` matches no Webex event | **delete** (cancelled). Mirrors on or after `listEnd` stay: the list may simply end there |

Native duplicates beat mirrors: if an event is both native and mirrored, propose deleting the mirror. Overlaps with other events are normal: mirror them. Ambiguous matches go in the plan marked `?` for the user to decide.

## 4. Plan, then apply

Show one table: action, title, start, reason, and name the account (`work`). Apply only after the user approves. "Dry run" or no approval means the table is the end.

Mirror shape:
- `summary`: `<titlePrefix> <title>`
- `start`/`end`: `{dateTime, timeZone}` from the extract
- `location`: the join link
- `description`: first line `MIRRORED-FROM-WEBEX | <link> | <start ISO>`, then `Organizer: …` and `Rooms: …` (omit empty ones). The Webex description stays out because it can hold passwords.
- `transparency: opaque`, `colorId`, `reminders: {useDefault: true}`, no attendees

Write with `gws calendar events insert|patch|delete --params '{"calendarId":"primary","eventId":…,"sendUpdates":"none"}' --json '<body>'`; every write carries `sendUpdates: none`. Delete only events whose description starts with `MIRRORED-FROM-WEBEX`.

## 5. Report

Counts per action, anything skipped as `?`, and the extract's `extractedAt`.

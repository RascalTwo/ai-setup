---
name: sync-webex-to-google-calendar
description: Sync meetings from the Webex desktop app into Google Calendar as mirror events (create new, update changed, delete cancelled, skip what is already native). Use for "sync Webex to Google Calendar", "mirror my Webex meetings", "update my work calendar".
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    webex: through the usher retinue member
    google-calendar: through the usher retinue member
  requires:
    commands: [usher]
    manual: [Webex]
---

# Sync Webex to Google Calendar

The `usher` retinue member owns this sync: rules, guards and setup are in `~/retinue/members/usher/README.md`.

1. Tell the user it takes over the keyboard and mouse for about 3 minutes, so to leave them alone.
2. Run `usher webex`. Exit 0 means it finished; otherwise it prints what went wrong and wrote nothing, or names the writes that failed.
3. Report the counts it printed. Show anything listed in `~/.local/state/usher/ambiguous.json`: those meetings were skipped, and the user decides them.

"Dry run" or "what would change": `usher webex --dry-run` instead. It reads the last extract and writes nothing, so give the extract's time with the result.

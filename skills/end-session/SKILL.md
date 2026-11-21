---
name: end-session
description: Ends this session by closing its herdr pane, on the user's direct command ("end the session", "close it", "yo, end it").
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires:
    commands: [herdr]
---

# End session

Closes the herdr pane this session runs in. The user's direct command is the only trigger; a finished task, "thanks", or "bye" leaves the session open.

1. **Confirm the command is unambiguous.** Dictation can garble it ("and the session"): when the wording could be something else, ask once in a line and wait.
2. **Check you are in herdr:** `[ -n "$HERDR_PANE_ID" ]`. If not, say so, tell the user to type `/exit`, and stop.
3. **Say goodbye in one line**, naming anything left unfinished (uncommitted work, a running background task, an unanswered question). This is the last text you write.
4. **Close the pane:**

   ```sh
   nohup sh -c 'sleep 3; herdr pane close "$0"' "$HERDR_PANE_ID" >/dev/null 2>&1 &
   ```

   The delay lets the goodbye render before the pane, and this process, disappears. Send nothing after the command.

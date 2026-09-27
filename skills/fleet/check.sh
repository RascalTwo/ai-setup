#!/bin/bash
# Self-check for the fleet hook. Run it after touching session-state.sh.
#   ./check.sh   ->  prints PASS/FAIL per case, exits non-zero on any failure
#
# Uses a scratch HOME so it never touches the real ~/.agents/state/fleet/state.

set -u
HOOK="$(cd "$(dirname "$0")" && pwd)/hooks/session-state.sh"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
S="$TMP/.agents/state/fleet/state"
fails=0

fire() { # fire <pane_id> <json>
  printf '%s' "$2" | HOME="$TMP" HERDR_PANE_ID="$1" bash "$HOOK"
}
ok()   { printf 'PASS  %s\n' "$1"; }
bad()  { printf 'FAIL  %s\n' "$1"; fails=$((fails+1)); }

# 1. A Stop payload lands in <session>.Stop.json with the message intact.
fire w7:p1 '{"session_id":"abc-123","hook_event_name":"Stop","last_assistant_message":"hello there"}'
if [ "$(jq -r .last_assistant_message "$S/abc-123.Stop.json" 2>/dev/null)" = "hello there" ]
  then ok "Stop payload stored"; else bad "Stop payload stored"; fi

# 2. A Notification lands in its OWN file. This is the whole reason the event
#    name is in the filename: if these ever share a file, one clobbers the other.
fire w7:p1 '{"session_id":"abc-123","hook_event_name":"Notification","notification_type":"idle_prompt"}'
if [ "$(jq -r .notification_type "$S/abc-123.Notification.json" 2>/dev/null)" = "idle_prompt" ] \
   && [ "$(jq -r .last_assistant_message "$S/abc-123.Stop.json" 2>/dev/null)" = "hello there" ]
  then ok "Notification does not clobber Stop"; else bad "Notification does not clobber Stop"; fi

# 3. A session_id carrying a path escape writes nothing, anywhere.
fire w7:p1 '{"session_id":"../../../../etc/pwn","hook_event_name":"Stop","last_assistant_message":"x"}'
if [ -z "$(/usr/bin/find "$TMP" -name 'pwn*' 2>/dev/null)" ]
  then ok "path traversal rejected"; else bad "path traversal rejected"; fi

# 4. Outside a herdr pane there is no fleet, so nothing is recorded. `env -u` is
#    required: running this from inside a herdr pane inherits a real
#    HERDR_PANE_ID, and the case silently passes through instead of testing.
printf '%s' '{"session_id":"nopane","hook_event_name":"Stop"}' \
  | env -u HERDR_PANE_ID HOME="$TMP" bash "$HOOK"
if [ ! -f "$S/nopane.Stop.json" ]
  then ok "no-op outside a herdr pane"; else bad "no-op outside a herdr pane"; fi

[ "$fails" -eq 0 ] && echo "all good" || echo "$fails failed"
exit "$fails"

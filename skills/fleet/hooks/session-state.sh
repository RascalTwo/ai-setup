#!/bin/bash
# fleet: Claude Code `Notification` + `Stop` hook -- let each session report its
# own state, so the collector never has to screen-scrape a terminal to find out.
#
# Writes ONE file per (session, event):
#   ~/.agents/state/fleet/state/<session_id>.<hook_event_name>.json
# holding the raw hook payload. Because the event name is part of the filename,
# two events can never touch the same file: no read-modify-write, no locking,
# and ten concurrent sessions cannot race each other.
#
# Stop fires many times per session, so this is bash builtins plus one redirect
# -- zero forks after the first run. That constraint (and the quoted-pattern
# workaround below) comes from skills/dream/hooks/stop.sh, which measured this
# path and found bash startup ~3.4ms to be the floor.

# Not in a herdr pane means not in the fleet. Builtin test, no fork.
[ -n "$HERDR_PANE_ID" ] || exit 0

# Builtin read of the whole stdin blob. `-d ''` reads to EOF and returns
# non-zero because there is no NUL delimiter; that is expected.
IFS= read -r -d '' HOOK_JSON

# bash 3.2 (what macOS ships) treats quotes inside an inline =~ pattern as
# literal, so the patterns have to live in variables.
re_sid='"session_id":[[:space:]]*"([^"]*)"'
re_evt='"hook_event_name":[[:space:]]*"([^"]*)"'

[[ $HOOK_JSON =~ $re_sid ]] || exit 0
SID="${BASH_REMATCH[1]}"
[[ $HOOK_JSON =~ $re_evt ]] || exit 0
EVT="${BASH_REMATCH[1]}"

# Both values become part of a path, so they get checked before they are used.
# First-party values from Claude Code, but a `/` or `..` here would write
# outside the state dir, and the check is a builtin.
case "$SID" in ''|*[!a-zA-Z0-9-]*) exit 0 ;; esac
case "$EVT" in ''|*[!a-zA-Z]*) exit 0 ;; esac

STATE="$HOME/.agents/state/fleet/state"
[ -d "$STATE" ] || mkdir -p "$STATE" || exit 0

# ponytail: plain redirect, not write-temp-then-rename. A torn read can only
# happen if the collector reads mid-write, and it degrades to "no hook state
# this cycle" because the collector falls back to herdr. Switch to mv-rename if
# that ever shows up in practice.
printf '%s' "$HOOK_JSON" > "$STATE/$SID.$EVT.json"
exit 0

#!/usr/bin/env bash
# ccstatusline Custom Command widget that prints nothing: it feeds herdr's sidebar row 2 with when
# this session will next need you. Working with a progress bar up (app-panel's `progress`, whose
# latest running deadline the host writes to its session file): "⏳~6m" blue, "⏳+3m" orange once
# overdue. Working without one: "~3m?" gray, a guess from past turns (Claude Code's own
# turn_duration records): the median of the past turns that ran longer than this one has, minus
# what it has run; past almost all of them it stops guessing and shows the time run, "12m…".
# Blocked on a permission prompt or question: "🔔4m" magenta, how long it has waited. Idle or
# done: nothing (the cache countdown already says how long it has sat).
# Tokens are named by colour (herdr rules can't compare "6m"); see herdr-autolabel/herdr-sidebar.toml.
[ -n "${HERDR_PANE_ID:-}" ] || exit 0
input=$(cat)
H="${HERDR_BIN_PATH:-herdr}"
SESSIONS="${APP_PANEL_SESSIONS:-$HOME/.agents/state/app-panel/sessions}"
HIST="${ETA_HISTORY:-$HOME/.agents/state/statusline/turn-durations.txt}"
now=$(date +%s)
tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty')

# 90s -> "2m", 3900s -> "1h05m". Time left rounds up (a few seconds left still reads "1m"); time passed, given 0, rounds down.
fmt() { local m=$(( ($1 + ${2:-59}) / 60 )); [ "$m" -ge 60 ] && printf '%dh%02dm' $((m / 60)) $((m % 60)) || printf '%dm' "$m"; }
iso() { sed 's/\.[0-9]*Z$/Z/' | jq -Rr 'fromdateiso8601? // empty'; }

# Rebuilt at most daily, in the background (~25s); touched first so other sessions' ticks don't start one too.
# shortcut: the last 30 days of top-level sessions only, upgrade if the guess looks stale.
if [ ! -e "$HIST" ] || [ -n "$(/usr/bin/find "$HIST" -mtime +0 2>/dev/null)" ]; then
  mkdir -p "$(dirname "$HIST")" && touch "$HIST"
  ( /usr/bin/find "$HOME/.claude/projects" -name '*.jsonl' -mtime -30 -not -path '*/subagents/*' -print0 |
      xargs -0 grep -h '"subtype":"turn_duration"' | jq -r '.durationMs / 1000 | floor' | sort -n > "$HIST.tmp" &&
      mv "$HIST.tmp" "$HIST" ) >/dev/null 2>&1 &
fi

k=; t=
case "$("$H" pane get "$HERDR_PANE_ID" 2>/dev/null | jq -r '.result.pane.agent_status // empty')" in
  working)
    due=$(jq -r '.due // empty | . / 1000 | floor' "$SESSIONS/${HERDR_PANE_ID//[^A-Za-z0-9_.-]/_}.json" 2>/dev/null)
    if [ -n "$due" ]; then
      left=$((due - now))
      if [ "$left" -ge 0 ]; then k=due t="⏳~$(fmt "$left")"; else k=over t="⏳+$(fmt $((-left)) 0)"; fi
    elif [ -n "$tp" ] && [ -f "$tp" ]; then
      # This turn began at the first prompt after the last finished turn (a message sent mid-turn doesn't restart it).
      start=$(tail -n 3000 "$tp" | jq -Rrs '[split("\n")[] | fromjson? | select(.isSidechain != true)]
        | ([to_entries[] | select(.value.subtype == "turn_duration") | .key] | last // -1) as $i | .[$i + 1:]
        | map(select(.type == "user" and .isMeta != true and (.message.content | type) == "string")) | first | .timestamp // empty' | iso)
      if [ -n "$start" ] && [ -s "$HIST" ]; then
        ran=$((now - start))
        # Fewer than 30 turns is no basis for a guess; past the longest 5% is no basis either.
        read -r g <<<"$(awk -v ran="$ran" '{ n++ } $1 > ran { l[++m] = $1 }
          END { if (n < 30) print "none"; else if (m < n * 0.05) print "past"; else print l[int((m + 1) / 2)] - ran }' "$HIST")"
        case "$g" in
          none) ;;
          past) k=g t="$(fmt "$ran" 0)…" ;;
          *) k=g t="~$(fmt "$g")?" ;;
        esac
      fi
    fi ;;
  blocked)
    # The permission request or question is the last thing Claude wrote.
    since=$(tail -n 100 "$tp" 2>/dev/null | jq -Rr 'fromjson? | select(.type == "assistant") | .timestamp' | tail -1 | iso)
    [ -n "$since" ] && k=wait t="🔔$(fmt $((now - since)) 0)" ;;
esac

args=(); for o in due over g wait; do [ "$o" = "$k" ] && args+=(--token "eta_$o=$t") || args+=(--clear-token "eta_$o"); done
"$H" pane report-metadata "$HERDR_PANE_ID" --source user:eta --ttl-ms 90000 "${args[@]}" >/dev/null 2>&1 &
exit 0

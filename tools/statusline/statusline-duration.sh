#!/usr/bin/env bash
# ccstatusline Custom Command widget — this session's wall-clock duration.
# Prints "⏱ 1h05m", or nothing when absent. Reads cost.total_duration_ms from
# the statusline stdin JSON (total session time Claude Code tracks). Standalone —
# no shared lib, no network. Widget sets preserveColors:true so ANSI passes through.
C_GRAY=$'\033[38;5;245m'; C_RST=$'\033[0m'
ms=$(jq -r '.cost.total_duration_ms // empty')
[ -n "$ms" ] || exit 0
# ms -> compact: 45s | 12m | 1h05m | 1d03h  (mirrors statusline-lib hms(), sub-min shows secs)
t=$(awk -v ms="$ms" 'BEGIN{ s=int(ms/1000); if(s<0)s=0;
  if(s<60) printf "%ds",s;
  else if(s<3600) printf "%dm",s/60;
  else if(s<86400){h=int(s/3600); printf "%dh%02dm",h,(s-h*3600)/60}
  else {d=int(s/86400); printf "%dd%02dh",d,(s-d*86400)/3600} }')
printf '%s⏱ %s%s' "$C_GRAY" "$t" "$C_RST"

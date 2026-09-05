#!/usr/bin/env bash
# ccstatusline Custom Command widget — unviewed screenshots in the ttyimgspool
# spool for THIS session. Prints "🖼 12 · 4m" (count · age of the newest), or
# nothing when the session has no images. `prefix+i` opens them.
#
# Session id comes from herdr's agent_session for the pane, matching how the
# hook and the viewer resolve it — Claude Code's own session_id differs when the
# session runs as a background job, and would point at the wrong folder.
# ponytail: shells out to `herdr pane get` once per render (30s refresh).
# Color: gray normally, yellow when something arrived in the last 2 minutes.
# Standalone — no shared lib; widget sets preserveColors:true.
C_GRAY=$'\033[38;5;245m'; C_YELLOW=$'\033[38;5;220m'; C_RST=$'\033[0m'
root=${TTYIMGSPOOL_DIR:-$HOME/.claude/ttyimgspool}
input=$(cat)

session=""
if [ -n "$HERDR_PANE_ID" ]; then
  session=$(herdr pane get "$HERDR_PANE_ID" 2>/dev/null |
            sed -n 's/.*"agent_session":{[^}]*"value":"\([^"]*\)".*/\1/p')
fi
[ -n "$session" ] || session=$(printf '%s' "$input" | jq -r '.session_id // empty')
[ -n "$session" ] || exit 0

dir="$root/$session"
[ -d "$dir" ] || exit 0
count=$(ls -1 "$dir" 2>/dev/null | wc -l | tr -d ' ')
[ "$count" -gt 0 ] 2>/dev/null || exit 0

newest=$(ls -t "$dir"/* 2>/dev/null | head -1)
[ -n "$newest" ] || exit 0
mtime=$(stat -c %Y "$newest" 2>/dev/null || stat -f %m "$newest")  # GNU || BSD
age=$(( $(date +%s) - mtime ))

# same shape as hms() in statusline-lib.sh, plus a seconds tier for fresh grabs
ago=$(awk -v s="$age" 'BEGIN{ if(s<0)s=0;
  if(s<60) printf "%ds",s; else if(s<3600) printf "%dm",s/60;
  else if(s<86400){h=int(s/3600);printf "%dh%02dm",h,(s-h*3600)/60}
  else {d=int(s/86400);printf "%dd%02dh",d,(s-d*86400)/3600} }')

[ "$age" -lt 120 ] && c=$C_YELLOW || c=$C_GRAY
printf '%s🖼 %s · %s%s' "$c" "$count" "$ago" "$C_RST"

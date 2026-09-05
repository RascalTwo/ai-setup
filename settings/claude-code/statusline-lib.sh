#!/usr/bin/env bash
# Shared helpers for the usage-pacing statusline widgets. Source it next to the
# widget:  source "$(dirname "$0")/statusline-lib.sh"
# Only the windowed-usage widgets (statusline-5h.sh, statusline-wk.sh) need this;
# standalone widgets like statusline-cache.sh don't source it.

# ANSI 256-color codes. Widgets set preserveColors:true so ccstatusline passes
# these through instead of applying its own foreground color.
C_GRAY=$'\033[38;5;245m'; C_YELLOW=$'\033[38;5;220m'; C_RED=$'\033[38;5;196m'; C_RST=$'\033[0m'

# verdict(util%, elapsedSecs, windowSecs) -> "✓N%" | "⚠out~<t>"
# proj = util / (elapsed/window): >100% -> on pace to hit the cap before reset.
verdict() { awk -v u="$1" -v e="$2" -v w="$3" 'BEGIN{
  if(e<=0)e=1; proj=u/(e/w);
  if(proj>100){ m=((100-u)/(u/e))/60;                    # mins until cap at this pace
    if(m<90) printf "⚠out~%dm",m; else if(m<2880) printf "⚠out~%.0fh",m/60; else printf "⚠out~%.1fd",m/1440;
  } else { s=100-proj; if(s<0)s=0; printf "✓%d%%",s } }'; }

# hms(secs) -> "30m" | "4h31m" | "5d08h" — exact countdown to reset
hms() { awk -v s="$1" 'BEGIN{ if(s<0)s=0;
  if(s<3600) printf "%dm",s/60; else if(s<86400){h=int(s/3600);printf "%dh%02dm",h,(s-h*3600)/60}
  else {d=int(s/86400);printf "%dd%02dh",d,(s-d*86400)/3600} }'; }

# --- this session's share of the window ------------------------------------
# rate_limits says the window is 7% used; it never says who used it. The scanner
# reconstructs that split from the transcripts, and these two helpers read it.

SHARE_CACHE="$HOME/.claude/usage-share.json"
SHARE_LOCK="$HOME/.claude/usage-share.lock"   # a directory: mkdir is the atomic
SHARE_TTL=60                                  # test, and macOS has no flock

# refresh_share(5h_resets_at, 7d_resets_at) — kick off a rescan if the cache has
# gone stale, and return immediately either way. The widget must never wait on
# this: a cold scan is ~1.2s, which would stall every render.
#
# The lock is not paranoia. Several sessions render their statuslines at once,
# so without it each stale moment spawns one scan per live session. mkdir fails
# for every loser of that race, and the winner clears the lock when it exits.
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null; }  # GNU || BSD

refresh_share() {
  local now age lock_age
  now=$(date +%s)
  age=$(( now - $(mtime "$SHARE_CACHE" || echo 0) ))
  [ "$age" -ge "$SHARE_TTL" ] || return 0
  # A lock older than 5 minutes outlived its scan (killed process, reboot).
  # Leaving it would freeze the number forever, so treat it as abandoned.
  lock_age=$(( now - $(mtime "$SHARE_LOCK" || echo "$now") ))
  if [ -d "$SHARE_LOCK" ] && [ "$lock_age" -gt 300 ]; then
    rmdir "$SHARE_LOCK" 2>/dev/null
  fi
  mkdir "$SHARE_LOCK" 2>/dev/null || return 0
  ( "$(dirname "${BASH_SOURCE[0]}")/statusline-usage-scan.py" "$1" "$2"
    rmdir "$SHARE_LOCK" 2>/dev/null ) >/dev/null 2>&1 &
  disown 2>/dev/null
}

# share(window_key, session_id, account_pct) -> "3.3/" | ".02/" | ""
# Prints the numerator of the "3.3/7%" fraction, trailing slash included, so the
# caller can drop it in front of the account percentage. Empty when this session
# isn't in the cache yet — the widget then renders exactly as it always did.
#
# The cache holds fractions of local burn rather than percentages, so the live
# account_pct scales them on every render. A stale cache blurs the attribution
# but never the headline number.
#
# Decimals are adaptive: a session is a big slice of five hours but a rounding
# error against a week, and a permanent "0.0" would be worse than useless. Show
# one decimal down to 1%, then keep adding places until a significant digit
# appears. The leading zero is stripped — ".02/" not "0.02/" — to buy a column
# back on an already crowded line.
share() {
  local frac
  frac=$(jq -r --arg k "$1" --arg s "$2" '.[$k].shares[$s] // empty' "$SHARE_CACHE" 2>/dev/null)
  [ -n "$frac" ] || return 0
  awk -v f="$frac" -v p="$3" 'BEGIN{
    v = f * p;
    if (v <= 0) { printf "0/"; exit }
    d = 1;
    while (d < 5 && v * (10 ^ d) < 1) d++;     # first place that shows something
    s = sprintf("%.*f", d, v);
    sub(/^0/, "", s);                          # ".02", not "0.02"
    printf "%s/", s }'
}

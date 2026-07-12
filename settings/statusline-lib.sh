#!/usr/bin/env bash
# Shared helpers for the usage-pacing statusline widgets. Source it next to the
# widget:  source "$(dirname "$0")/statusline-lib.sh"
# Only the windowed-usage widgets (statusline-5h.sh, statusline-wk.sh) need this;
# standalone widgets like statusline-cache.sh don't source it.

# ANSI 256-color codes. Widgets set preserveColors:true so ccstatusline passes
# these through instead of applying its own foreground color.
C_GRAY=$'\033[38;5;245m'; C_YELLOW=$'\033[38;5;220m'; C_RED=$'\033[38;5;196m'; C_RST=$'\033[0m'

# verdict(util%, elapsedSecs, windowSecs) -> "✓N%spare" | "⚠out~<t>"
# proj = util / (elapsed/window): >100% -> on pace to hit the cap before reset.
verdict() { awk -v u="$1" -v e="$2" -v w="$3" 'BEGIN{
  if(e<=0)e=1; proj=u/(e/w);
  if(proj>100){ m=((100-u)/(u/e))/60;                    # mins until cap at this pace
    if(m<90) printf "⚠out~%dm",m; else if(m<2880) printf "⚠out~%.0fh",m/60; else printf "⚠out~%.1fd",m/1440;
  } else { s=100-proj; if(s<0)s=0; printf "✓%d%%spare",s } }'; }

# hms(secs) -> "30m" | "4h31m" | "5d08h" — exact countdown to reset
hms() { awk -v s="$1" 'BEGIN{ if(s<0)s=0;
  if(s<3600) printf "%dm",s/60; else if(s<86400){h=int(s/3600);printf "%dh%02dm",h,(s-h*3600)/60}
  else {d=int(s/86400);printf "%dd%02dh",d,(s-d*86400)/3600} }'; }

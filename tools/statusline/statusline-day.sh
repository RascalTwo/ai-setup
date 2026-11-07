#!/usr/bin/env bash
# ccstatusline Custom Command widget — today's slice of the weekly budget + pacing.
# Prints "☀️8.0/15.5% ⚠out~4h", or nothing when rate_limits is absent.
# Gray on pace, yellow when today's pace runs out before the day ends, red once over.
source "$(dirname "$0")/statusline-lib.sh"   # verdict(), today(), fresh()
input=$(cat); now=$(date +%s)
IFS='|' read -r util reset <<<"$(printf '%s' "$input" | jq -r \
  '[.rate_limits.seven_day.used_percentage, .rate_limits.seven_day.resets_at] | map(. // "") | join("|")')"
[ -n "$util$reset" ] || exit 0
read -r util reset <<<"$(fresh seven_day "$util" "$reset")"
[ "${reset:-0}" -gt "$now" ] || exit 0       # unknown or lapsed window
t=$(today "$util" "$reset" "$now")
IFS=/ read -r used budget <<<"$t"
if awk -v u="$used" -v b="$budget" 'BEGIN{exit !(u > b)}'; then c=$C_RED; v=""
else
  # verdict() on today's budget as a 1-day window: % of budget used, secs into today.
  v=" $(verdict "$(awk -v u="$used" -v b="$budget" 'BEGIN{print 100*u/b}')" \
    "$(( (now - (reset - 604800)) % 86400 ))" 86400)"
  case "$v" in *out*) c=$C_YELLOW ;; *) c=$C_GRAY ;; esac
fi
printf '%s☀️%s%%%s%s' "$c" "$t" "$v" "$C_RST"

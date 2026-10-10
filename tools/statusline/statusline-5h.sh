#!/usr/bin/env bash
# ccstatusline Custom Command widget — 5-hour usage window + pacing verdict.
# Prints "⏳5h 43% 1h59m ⚠out~40m" only when on pace to hit the cap before the reset; on pace,
# lapsed, or with no rate_limits it prints nothing and takes no room on the line.
# rate_limits (used_percentage + resets_at epoch) is the SUPPORTED statusline
# interface — no network call, no OAuth token, no ToS risk.
source "$(dirname "$0")/statusline-lib.sh"   # verdict(), hms()
input=$(cat); now=$(date +%s); len=18000     # 5h window in seconds
# '|' not whitespace: read collapses runs of whitespace IFS, so an absent field
# (an expired window is dropped from the payload) shifted every later one left.
IFS='|' read -r util reset wkreset sid <<<"$(printf '%s' "$input" | jq -r \
  '[.rate_limits.five_hour.used_percentage, .rate_limits.five_hour.resets_at, .rate_limits.seven_day.resets_at, .session_id] | map(. // "") | join("|")')"
[ -n "$util$reset$wkreset" ] || exit 0       # payload has no rate_limits at all (e.g. API-key auth)
read -r util reset <<<"$(fresh five_hour "$util" "$reset")"
[ "${reset:-0}" -gt 0 ] || exit 0            # no window known anywhere (e.g. API-key auth)
[ "$reset" -gt "$now" ] || exit 0         # window lapsed, nobody has spent since
refresh_share "$reset" "$wkreset"            # non-blocking; serves both widgets
v=$(verdict "$util" "$((now-(reset-len)))" "$len")
case "$v" in *out*) c=$C_RED ;; *) c=$C_GRAY ;; esac   # ⚠out~ -> red (on pace to hit the cap)
[ "$c" = "$C_RED" ] || exit 0                # on pace: nothing to act on
# "⏳5h 3.3/7%" — this session's share, then the account's. Same unit, so one %.
printf '%s⏳5h %s%s%% %s %s%s' "$c" "$(share five_hour "$sid" "$util")" "$util" "$(hms "$((reset-now))")" "$v" "$C_RST"

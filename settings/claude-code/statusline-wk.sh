#!/usr/bin/env bash
# ccstatusline Custom Command widget — 7-day (weekly) usage window + pacing verdict.
# Prints "📅wk 18% 3d11h ✓64%", or nothing when rate_limits is absent.
# rate_limits (used_percentage + resets_at epoch) is the SUPPORTED statusline
# interface — no network call, no OAuth token, no ToS risk.
source "$(dirname "$0")/statusline-lib.sh"   # verdict(), hms()
input=$(cat); now=$(date +%s); len=604800    # 7d window in seconds
read -r util reset sid <<<"$(printf '%s' "$input" | jq -r \
  '"\(.rate_limits.seven_day.used_percentage // "" | if .=="" then "" else round end) \(.rate_limits.seven_day.resets_at // "") \(.session_id // "")"')"
[ -n "$util" ] && [ "$util" != null ] && [ -n "$reset" ] && [ "$reset" != null ] || exit 0
v=$(verdict "$util" "$((now-(reset-len)))" "$len")
case "$v" in *out*) c=$C_RED ;; *) c=$C_GRAY ;; esac   # ⚠out~ -> red (on pace to hit the cap)
# No refresh_share here — statusline-5h.sh already kicked off the scan that
# feeds both windows, and a second caller would only lose the mkdir race.
printf '%s📅wk %s%s%% %s %s%s' "$c" "$(share seven_day "$sid" "$util")" "$util" "$(hms "$((reset-now))")" "$v" "$C_RST"

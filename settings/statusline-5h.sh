#!/usr/bin/env bash
# ccstatusline Custom Command widget — 5-hour usage window + pacing verdict.
# Prints "⏳5h 43% ⟳1h59m ✓28%spare", or nothing when rate_limits is absent.
# rate_limits (used_percentage + resets_at epoch) is the SUPPORTED statusline
# interface — no network call, no OAuth token, no ToS risk.
source "$(dirname "$0")/statusline-lib.sh"   # verdict(), hms()
input=$(cat); now=$(date +%s); len=18000     # 5h window in seconds
read -r util reset <<<"$(printf '%s' "$input" | jq -r \
  '.rate_limits.five_hour // {} | "\(.used_percentage // "" | if .=="" then "" else round end) \(.resets_at // "")"')"
[ -n "$util" ] && [ "$util" != null ] && [ -n "$reset" ] && [ "$reset" != null ] || exit 0
v=$(verdict "$util" "$((now-(reset-len)))" "$len")
case "$v" in *out*) c=$C_RED ;; *) c=$C_GRAY ;; esac   # ⚠out~ -> red (on pace to hit the cap)
printf '%s⏳5h %s%% ⟳%s %s%s' "$c" "$util" "$(hms "$((reset-now))")" "$v" "$C_RST"

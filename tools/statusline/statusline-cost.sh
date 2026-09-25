#!/usr/bin/env bash
# ccstatusline Custom Command widget — this session's API-equivalent cost.
# Prints "💵 $0.12", or nothing when cost is absent. On a subscription plan
# you don't pay this; it's what the session WOULD cost at pay-as-you-go API
# rates. The number is Claude Code's own token×model-price calc, handed to the
# statusline on stdin as cost.total_cost_usd — no ccusage, no network, no OAuth.
# Standalone — no shared lib. Widget sets preserveColors:true so ANSI passes through.
C_GRAY=$'\033[38;5;245m'; C_YELLOW=$'\033[38;5;220m'; C_RED=$'\033[38;5;196m'; C_RST=$'\033[0m'
usd=$(jq -r '.cost.total_cost_usd // empty')
[ -n "$usd" ] || exit 0
# Color by magnitude for a single session: gray < $5, yellow $5–20, red > $20.
c=$(awk -v u="$usd" -v g="$C_GRAY" -v y="$C_YELLOW" -v r="$C_RED" \
  'BEGIN{ printf "%s", (u>20?r:(u>=5?y:g)) }')
printf '%s💵 $%.2f%s' "$c" "$usd" "$C_RST"

#!/usr/bin/env bash
# ccstatusline Custom Command widget — prompt-cache TTL countdown + rewarm price.
# Prints "🧊 42m $8.27 5h:.42% wk:.14%", or nothing when there's no transcript
# yet: minutes of cache left, then what rebuilding this session's cache costs in
# API-equivalent dollars and as a slice of each rate-limit window. Reads Claude
# Code's stdin JSON (forwarded by ccstatusline) and uses the transcript file's
# mtime as the cache age. Once the TTL lapses the countdown goes NEGATIVE
# ("🧊 -3m" = cache expired 3m ago) instead of resetting — it only jumps
# back to ~60 on genuine new activity, which really does mint a fresh cache.
# ponytail: cache age = now - transcript mtime; 60 = subscription cache TTL (min).
# Color: gray normally, orange inside the last 15m, red once the cache is gone.
# Red starts at 0 rather than 5m because that is where the meaning changes — above
# zero the next message is cheap, at or below it the whole context gets rewritten.
# Standalone — no shared lib; widget sets preserveColors:true so ANSI passes through.
C_GRAY=$'\033[38;5;245m'; C_ORANGE=$'\033[38;5;214m'; C_RED=$'\033[38;5;196m'; C_RST=$'\033[0m'
input=$(cat)
tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
[ -n "$tp" ] && [ -f "$tp" ] || exit 0
mtime=$(stat -c %Y "$tp" 2>/dev/null || stat -f %m "$tp")   # GNU (Linux/WSL/Git-Bash) || BSD (macOS)
left=$(( 60 - ($(date +%s) - mtime) / 60 ))
if   [ "$left" -le 0 ];  then c=$C_RED      # expired (0 or negative)
elif [ "$left" -le 15 ]; then c=$C_ORANGE
else                          c=$C_GRAY; fi
printf '%s🧊 %dm' "$c" "$left"

# --- what this session costs to rewarm --------------------------------------
# Rewarming rewrites the ENTIRE context at the 1h cache-write rate instead of
# reading it back at a tenth of base input, so the price scales with how big the
# session already is. Shown always, not just once expired: while the cache is
# warm this is the STAKE (what you lose by letting this session go cold), which
# is what tells you which of several open sessions to feed first. Once the
# countdown goes red the same number becomes the BILL for the next message.
# The color carries that distinction, so the figure needs no label either way.

# context_window.total_input_tokens is the live context size — it equals the sum
# of current_usage's input + cache_read + cache_creation, so no transcript math.
read -r ctx model p5 pwk <<<"$(printf '%s' "$input" | jq -r \
  '"\(.context_window.total_input_tokens // 0) \(.model.id // "") \(.rate_limits.five_hour.used_percentage // 0) \(.rate_limits.seven_day.used_percentage // 0)"')"
[ "${ctx:-0}" -gt 0 ] 2>/dev/null || { printf '%s' "$C_RST"; exit 0; }

# 1h cache write = 2x base input. Model ids carry suffixes like "[1m]", so match
# loosely and fall back to Opus rates rather than under-quoting an unknown model.
case "$model" in
  *fable-5*|*mythos-5*) rate=20 ;;
  *sonnet-5*)           rate=4  ;;
  *sonnet-4-6*|*sonnet-4-5*) rate=6 ;;
  *haiku-4-5*)          rate=2  ;;
  *)                    rate=10 ;;   # Opus tier
esac

# Dollars per percentage point, derived from the same scan the 5h/wk widgets use:
# local burn in the window divided by the account percentage that burn produced.
read -r t5 twk <<<"$(jq -r '"\(.five_hour.total // 0) \(.seven_day.total // 0)"' \
  "$HOME/.claude/usage-share.json" 2>/dev/null || echo "0 0")"

awk -v ctx="$ctx" -v rate="$rate" -v t5="$t5" -v twk="$twk" -v p5="$p5" -v pwk="$pwk" 'BEGIN{
  cost = ctx * rate / 1000000;
  printf " $%.2f", cost;
  # The window limit is inferred as burn/percentage, so it is only as precise as
  # that percentage — which arrives quantized to about a whole point. Under 3%
  # the rounding alone can move the answer several fold, so show dollars only
  # rather than a confident-looking figure that is 3x wrong for the first slice
  # of every window.
  if (t5  > 0 && p5  >= 3) printf " 5h:%s", pct(cost / (t5  / p5));
  if (twk > 0 && pwk >= 3) printf " wk:%s", pct(cost / (twk / pwk));
}
function pct(v,  s) { s = sprintf("%.2f", v); sub(/^0/, "", s); return s "%" }'
printf '%s' "$C_RST"

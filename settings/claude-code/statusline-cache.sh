#!/usr/bin/env bash
# ccstatusline Custom Command widget — prompt-cache TTL countdown.
# Prints "🧊 42m cache", or nothing when there's no transcript yet. Reads Claude
# Code's stdin JSON (forwarded by ccstatusline) and uses the transcript file's
# mtime as the cache age. Once the TTL lapses the countdown goes NEGATIVE
# ("🧊 -3m cache" = cache expired 3m ago) instead of resetting — it only jumps
# back to ~60 on genuine new activity, which really does mint a fresh cache.
# ponytail: cache age = now - transcript mtime; 60 = subscription cache TTL (min).
# Color: gray normally, yellow at ≤15m left, red at ≤5m or once expired.
# Standalone — no shared lib; widget sets preserveColors:true so ANSI passes through.
C_GRAY=$'\033[38;5;245m'; C_YELLOW=$'\033[38;5;220m'; C_RED=$'\033[38;5;196m'; C_RST=$'\033[0m'
input=$(cat)
tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
[ -n "$tp" ] && [ -f "$tp" ] || exit 0
mtime=$(stat -c %Y "$tp" 2>/dev/null || stat -f %m "$tp")   # GNU (Linux/WSL/Git-Bash) || BSD (macOS)
left=$(( 60 - ($(date +%s) - mtime) / 60 ))
if   [ "$left" -le 5 ];  then c=$C_RED      # ≤5m left, or expired (negative)
elif [ "$left" -le 15 ]; then c=$C_YELLOW
else                          c=$C_GRAY; fi
printf '%s🧊 %dm cache%s' "$c" "$left" "$C_RST"

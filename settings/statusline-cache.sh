#!/usr/bin/env bash
# ccstatusline Custom Command widget — prompt-cache TTL countdown.
# Prints "🧊 42m cache" (or "🧊 cache cold"), or nothing when there's no
# transcript yet. Reads Claude Code's stdin JSON (forwarded by ccstatusline) and
# uses the transcript file's mtime as the cache age. Standalone — no shared lib.
# ponytail: cache age = now - transcript mtime; 60 = subscription cache TTL (min).
# Color: gray normally, yellow at ≤15m left, red at ≤5m or cold. (Standalone —
# widget sets preserveColors:true so these ANSI codes pass through.)
C_GRAY=$'\033[38;5;245m'; C_YELLOW=$'\033[38;5;220m'; C_RED=$'\033[38;5;196m'; C_RST=$'\033[0m'
input=$(cat)
tp=$(printf '%s' "$input" | jq -r '.transcript_path // empty')
[ -n "$tp" ] && [ -f "$tp" ] || exit 0
mtime=$(stat -c %Y "$tp" 2>/dev/null || stat -f %m "$tp")   # GNU (Linux/WSL/Git-Bash) || BSD (macOS)
left=$(( 60 - ($(date +%s) - mtime) / 60 ))
if [ "$left" -le 0 ]; then printf '%s🧊 cache cold%s' "$C_RED" "$C_RST"; exit 0; fi
if   [ "$left" -le 5 ];  then c=$C_RED
elif [ "$left" -le 15 ]; then c=$C_YELLOW
else                          c=$C_GRAY; fi
printf '%s🧊 %dm cache%s' "$c" "$left" "$C_RST"

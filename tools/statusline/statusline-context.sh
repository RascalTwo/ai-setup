#!/usr/bin/env bash
# ccstatusline Custom Command widget — context used / window size, color-banded.
# Prints "142k/1M", or nothing at 0 tokens (a fresh session says nothing).
# Bands (256-color, all legible on a dark non-black bg): <100k green, <250k yellow,
# <500k orange, >=500k magenta, >=80% of the window red (wins over the absolute bands,
# so a 200k window still goes red at 160k).
ctx_c=$'\033[38;5;114m'; C_RST=$'\033[0m'
read -r used size <<<"$(jq -r '"\(.context_window.total_input_tokens // 0) \(.context_window.context_window_size // 0)"')"
[ "${used:-0}" -gt 0 ] 2>/dev/null || exit 0
c=$(awk -v u="$used" -v s="$size" 'BEGIN{
  n = (s>0 && u>=0.8*s) ? 196 : u>=500000 ? 207 : u>=250000 ? 208 : u>=100000 ? 227 : 114
  printf "\033[38;5;%dm", n }')
# 1000k and up reads as M ("1M", "1.2M"); below that, whole k.
fmt() { awk -v n="$1" 'BEGIN{ if (n>=1000000) printf "%gM", int(n/10000)/100; else printf "%dk", n/1000 }'; }
printf '%s%s/%s%s' "$c" "$(fmt "$used")" "$(fmt "$size")" "$C_RST"

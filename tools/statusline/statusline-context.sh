#!/usr/bin/env bash
# ccstatusline Custom Command widget — context used / window size, color-banded.
# Prints "142k/1M", or nothing at 0 tokens (a fresh session says nothing).
# Bands (256-color, legible on a dark non-black bg) follow the auto-handoff thresholds from the
# 2026-10-03 usage analysis: <250k green, >=250k yellow (handoff due: savings peak at 200-300k),
# >=500k red (overdue: each request now re-reads 4x+ a fresh session's context). >=80% of the
# window is also red, so a 200k window still warns at 160k.
ctx_c=$'\033[38;5;114m'; C_RST=$'\033[0m'
input=$(cat)
read -r used size <<<"$(jq -r '"\(.context_window.total_input_tokens // 0) \(.context_window.context_window_size // 0)"' <<<"$input")"
[ "${used:-0}" -gt 0 ] 2>/dev/null || exit 0
n=$(awk -v u="$used" -v s="$size" 'BEGIN{
  n = (s>0 && u>=0.8*s) || u>=500000 ? 196 : u>=250000 ? 227 : 114
  print n }')
c=$'\033[38;5;'"${n}m"
# 1000k and up reads as M ("1M", "1.2M"); below that, whole k.
fmt() { awk -v n="$1" 'BEGIN{ if (n>=1000000) printf "%gM", int(n/10000)/100; else printf "%dk", n/1000 }'; }
printf '%s%s/%s%s' "$c" "$(fmt "$used")" "$(fmt "$size")" "$C_RST"
# Mirror the used count ("142k", no window size) into herdr's sidebar row 2. Colour is picked by
# token NAME (ctx_g/y/o/m/r = the bands above; styled in herdr-sidebar.toml), others cleared.
# TTL > the 30s statusline refresh. No-op outside herdr.
if [ -n "${HERDR_PANE_ID:-}" ]; then
  case $n in 196) k=r;; 227) k=y;; *) k=g;; esac
  clear=(); for o in g y o m r; do [ "$o" = "$k" ] || clear+=(--clear-token "ctx_$o"); done
  "${HERDR_BIN_PATH:-herdr}" pane report-metadata "$HERDR_PANE_ID" --source user:ctx --token "ctx_$k=$(fmt "$used")" --ttl-ms 90000 "${clear[@]}" >/dev/null 2>&1 &
fi
# Auto handoff's idle trigger: a big session about to lose its prompt cache hands off while it is
# still warm. The cheap token gate keeps python off the 30s path for small sessions.
if [ -n "${HERDR_PANE_ID:-}" ] && [ "$used" -ge "${AUTO_HANDOFF_IDLE_TOKENS:-150000}" ]; then
  printf '%s' "$input" | "$HOME/.agents/ai-setup/tools/auto-handoff/auto-handoff" idle >/dev/null 2>&1 &
fi

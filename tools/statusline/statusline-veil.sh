#!/usr/bin/env bash
# ccstatusline Custom Command widget — whether veil is hiding private content from this session.
# 👁 veil is on (watching) · grey 🙈 veil is off (the default) · yellow 👁⚠ the local model is failing, so veil
# is withholding every tool output. Standalone — no shared lib; widget sets preserveColors:true.
C_GREY=$'\033[38;5;245m'; C_YELLOW=$'\033[38;5;220m'; C_RST=$'\033[0m'
case "$("$HOME/.agents/ai-setup/tools/veil/veil" status 2>/dev/null)" in
  on)   printf '👁' ;;
  off)  printf '%s🙈%s' "$C_GREY" "$C_RST" ;;
  down) printf '%s👁⚠%s' "$C_YELLOW" "$C_RST" ;;
esac

#!/usr/bin/env bash
# ccstatusline Custom Command widget — whether auto-handoff is armed for this herdr pane.
# 🤝 on (the default) · grey 🤝✗ off (prefix+shift+a or `auto-handoff on` turns it back on) · yellow 🤝… a handoff is
# being written or continued. Nothing outside herdr, where auto-handoff does nothing. Standalone; preserveColors:true.
C_GREY=$'\033[38;5;245m'; C_YELLOW=$'\033[38;5;220m'; C_RST=$'\033[0m'
case "$("$HOME/.agents/ai-setup/tools/auto-handoff/auto-handoff" state 2>/dev/null)" in
  on)      printf ' 🤝' ;;
  off)     printf ' %s🤝✗%s' "$C_GREY" "$C_RST" ;;
  handing) printf ' %s🤝…%s' "$C_YELLOW" "$C_RST" ;;
esac
exit 0

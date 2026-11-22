#!/usr/bin/env bash
# ccstatusline Custom Command widget: what this session costs the Mac, and how strained the Mac is.
#   ⚡2.4c 3.1G          this session's whole process tree (speedbump/sessions.sh): cores busy, memory
#                       (shared pages counted per process, so an upper bound). Shown from half a core or
#                       1 GB; orange from 2 cores or 4 GB, where speedbump starts holding the session.
#   🔥4.7× · top: Hydra demos 3.1c   the Mac: 1-min load per core, shown once load passes the cores
#                       (or memory pressure is critical), with the heaviest session by its herdr title.
#                       Red when speedbump counts the Mac as strained, yellow before that.
# Also mirrors the ⚡ value into this pane's herdr sidebar (tokens load_n / load_h) and records this
# session's pane, so other sessions can name it. Prints nothing while the session is light and the Mac fine.
sb="${SPEEDBUMP_DIR:-$HOME/.agents/ai-setup/tools/speedbump}"
state="${SPEEDBUMP_STATE:-$HOME/.agents/state/speedbump}"
cat >/dev/null # the widget's JSON input isn't needed
read -r me cpu rss _ <<<"$(sh "$sb/sessions.sh" "${SPEEDBUMP_PID:-$$}")"
[ -n "${me:-}" ] && [ -n "${HERDR_PANE_ID:-}" ] && { mkdir -p "$state/panes"; printf '%s' "$HERDR_PANE_ID" >"$state/panes/$me"; }

heavy=0 own=""
[ -n "${me:-}" ] && read -r heavy own <<<"$(awk -v c="$cpu" -v m="$rss" 'BEGIN {
  if (c >= 50 || m >= 1048576) printf "%d ⚡%.1fc %.1fG", (c >= 200 || m >= 4194304), c / 100, m / 1048576 }')"
c_own=$'\033[38;5;245m'; [ "$heavy" = 1 ] && c_own=$'\033[38;5;208m'
[ -n "$own" ] && printf '%s%s\033[0m' "$c_own" "${own}"

if [ -n "${HERDR_PANE_ID:-}" ]; then
  k=n; o=h; [ "$heavy" = 1 ] && { k=h; o=n; }
  if [ -n "$own" ]; then set -- --token "load_$k=$own" --clear-token "load_$o"; else set -- --clear-token load_n --clear-token load_h; fi
  "${HERDR_BIN_PATH:-herdr}" pane report-metadata "$HERDR_PANE_ID" --source user:load --ttl-ms 90000 "$@" >/dev/null 2>&1 &
fi

# The Mac. Same strain rule as speedbump.sh: 1-min load over 1.5x the cores with the 5-min over the cores, or critical memory pressure.
set -- ${SPEEDBUMP_SIGNALS:-$(/usr/sbin/sysctl -n hw.ncpu kern.memorystatus_vm_pressure_level vm.loadavg)}
cores=$1 pressure=$2 l1=$4 l5=$5
level=$(awk -v c="$cores" -v p="$pressure" -v a="$l1" -v b="$l5" 'BEGIN { print ((p >= 4 || (a > 1.5 * c && b > c)) ? 2 : (a > c) ? 1 : 0) }')
[ "$level" = 0 ] && exit 0
read -r top tcpu _ <<<"$(sh "$sb/sessions.sh" | head -1)"
who=""
if [ -n "${top:-}" ]; then
  if [ "$top" = "${me:-}" ]; then who="this session"
  elif [ -f "$state/panes/$top" ]; then
    who=$("${HERDR_BIN_PATH:-herdr}" pane list 2>/dev/null | jq -r --arg p "$(cat "$state/panes/$top")" '.result.panes[] | select(.pane_id == $p) | .terminal_title_stripped' | cut -c1-24 | sed 's/ *$//')
  fi
  who="${who:-claude $top}"
fi
c_mac=$'\033[38;5;220m'; [ "$level" = 2 ] && c_mac=$'\033[38;5;196m'
mem=""; [ "$pressure" -ge 4 ] && mem=" mem!"
printf '%s%s🔥%s×%s%s\033[0m' "${own:+ }" "$c_mac" "$(awk -v a="$l1" -v c="$cores" 'BEGIN { printf "%.1f", a / c }')" "$mem" \
  "${who:+ · top: $who $(awk -v c="$tcpu" 'BEGIN { printf "%.1fc", c / 100 }')}"
exit 0

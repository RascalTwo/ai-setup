#!/bin/sh
# speedbump: Claude Code PreToolUse hook (Bash). When the Mac is strained, it blocks a session's command
# once and names what is hogging the machine; the same session's next commands go through for 10 minutes.
# Silent, and nearly free, when the Mac is fine.
#
# Strained: kernel memory pressure critical (warning fired while nothing felt slow), 1-min load above
# 1.5x the cores while the 5-min load is above the cores (sustained, not a spike), or under 10 GB of
# disk free (a fixed floor: builds and swap need gigabytes, whatever the disk size). Swap used is
# ignored: it lingers long after. State and log: ~/.agents/state/speedbump/
# Test: sh tools/speedbump/speedbump.test.sh

dir="${SPEEDBUMP_STATE:-$HOME/.agents/state/speedbump}"
input=$(cat)

# "cores pressure { 1m 5m 15m } free-KB"; SPEEDBUMP_SIGNALS fakes it for the test.
set -- ${SPEEDBUMP_SIGNALS:-$(/usr/sbin/sysctl -n hw.ncpu kern.memorystatus_vm_pressure_level vm.loadavg; /bin/df -k "$HOME" | awk 'NR == 2 { print $4 }')}
cores=$1 pressure=$2 l1=$4 l5=$5 free=${8:-99999999} # a failed disk read must not block every command
why=$(awk -v c="$cores" -v p="$pressure" -v a="$l1" -v b="$l5" -v f="$free" 'BEGIN {
  if (p >= 4) r = "memory pressure is critical"
  if (a > 1.5 * c && b > c) r = r (r ? "; " : "") "load is " a " on " c " cores"
  if (f < 10485760) r = r (r ? "; " : "") sprintf("only %.1f GB of disk free", f / 1048576)
  print r }')
[ -n "$why" ] || exit 0

# Warned within 10 minutes: let it through. This is what makes a retry push past the bump.
sid=$(printf '%s' "$input" | jq -r '.session_id // "unknown"')
mark="$dir/sessions/$sid"
mkdir -p "$dir/sessions"
[ -n "$(/usr/bin/find "$mark" -mmin -10 2>/dev/null)" ] && exit 0
touch "$mark"
/usr/bin/find "$dir/sessions" -type f -mmin +60 -delete 2>/dev/null

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' | tr '\n' ' ' | cut -c1-120)
echo "$(date '+%F %T') session=$sid cores=$cores pressure=$pressure load=$l1/$l5 free-kb=$free cmd=$cmd" >> "$dir/log"

# Disk space is the only problem: no process to name, just say what not to start.
case "$why" in
  *memory*|*load*) ;;
  *) cat >&2 <<EOF
Speed bump, not a wall: this Mac is low on disk ($why). If this command is light or needed, run the exact same command again: it will go through, and this session won't be stopped again for 10 minutes. If it writes a lot (builds, installs, docker pulls, downloads), free up space first or tell the user.
EOF
     exit 2 ;;
esac

# Top 3 by memory when memory is the problem, else by CPU, each tagged with the Claude session above it.
busiest=$(/bin/ps -Ao pid=,ppid=,pcpu=,rss=,etime=,args= | awk -v me=$$ -v key=$([ "$pressure" -ge 4 ] && echo 4 || echo 3) '
  { p = $1; pp[p] = $2; cpu[p] = $3; rss[p] = $4; age[p] = $5; v[p] = $key
    a = $0; sub(/^ *([^ ]+ +){5}/, "", a); cmd[p] = a }
  function claude(p) { while (p > 1) { if (cmd[p] ~ /^claude( |$)/) return p; p = pp[p] } return 0 }
  END {
    mine = claude(me)
    for (i = 0; i < 3; i++) {
      best = ""; for (p in v) if (!(p in done) && (best == "" || v[p] + 0 > v[best] + 0)) best = p
      done[best] = 1; s = claude(best)
      who = s == 0 ? "" : s == mine ? " (this session)" : " (another Claude session, pid " s ")"
      printf "- %s%% CPU, %.1f GB, up %s: %s%s\n", cpu[best], rss[best] / 1048576, age[best], substr(cmd[best], 1, 100), who
    }
  }')

cat >&2 <<EOF
Speed bump, not a wall: this Mac is strained ($why). Busiest right now:
$busiest
If this command is light or needed, run the exact same command again: it will go through, and this session won't be stopped again for 10 minutes. If it is heavy (tests, builds, browsers, containers) and something above is already doing that work, wait for it instead of piling on.
EOF
exit 2

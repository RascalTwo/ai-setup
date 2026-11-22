#!/bin/sh
# What each Claude session costs the Mac right now: one line per session, busiest first,
#   <claude pid> <% CPU> <RSS KB> <process count>
# summed over every process the session started (its whole process tree). A session is the topmost
# `claude` ancestor, so a `claude -p` a session runs is charged to that session. Processes that left
# the tree (re-parented to launchd: Colima, daemons) are in no session.
# `sessions.sh <pid>` prints only the line of the session <pid> belongs to (nothing if none).
# %CPU is ps's own decaying average (about the last minute), so a one-second spike barely moves it.
# SESSIONS_PS fakes the `ps` output for the test: "pid ppid %cpu rss args...".
{ if [ -n "${SESSIONS_PS:-}" ]; then cat "$SESSIONS_PS"; else /bin/ps -Ao pid=,ppid=,pcpu=,rss=,args=; fi; } |
  awk -v want="${1:-}" '
  { p = $1; pp[p] = $2; cpu[p] = $3; rss[p] = $4
    a = $0; sub(/^ *([^ ]+ +){4}/, "", a)
    if (a ~ /^claude( |$)/ && a !~ /--chrome-native-host/) isc[p] = 1 }
  function root(p,   r) { r = 0; while (p > 1 && (p in pp)) { if (p in isc) r = p; p = pp[p] } return r }
  END {
    for (p in pp) { r = root(p); if (r) { c[r] += cpu[p]; m[r] += rss[p]; n[r]++ } }
    if (want != "") { r = root(want); if (r) printf "%s %.1f %d %d\n", r, c[r], m[r], n[r]; exit }
    for (r in c) printf "%s %.1f %d %d\n", r, c[r], m[r], n[r]
  }' | sort -k2,2nr

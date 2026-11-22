#!/bin/sh
# speedbump.sh with faked signals: silent when fine; when strained, holds a heavy session's command (SPEEDBUMP_WAIT),
# then allows it with a note for the agent, once per session; light sessions pass; low disk blocks once. Also
# sessions.sh on a faked process table. ~2 s. Run: sh tools/speedbump/speedbump.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); export SPEEDBUMP_STATE="$t" SPEEDBUMP_WAIT=0
# pid ppid %cpu rss args: session 100 runs a test with a 250% browser and a nested `claude -p` (charged to 100);
# session 200 is light; 300 is Chrome's native host, not a session; 400 left its tree (launchd's), in none.
cat > "$t/ps" <<'EOF'
1 0 0.0 1000 launchd
100 50 5.0 300000 claude --model opus
101 100 20.0 100000 npm test
102 101 250.0 5000000 Google Chrome Helper
103 100 1.0 200000 claude -p summarize
104 103 3.0 10000 python3 x.py
200 60 2.0 300000 claude --resume abc
201 200 1.0 10000 zsh -c ls
300 70 0.0 2000 /Users/me/.local/bin/claude --chrome-native-host
400 1 90.0 9000000 colima
EOF
export SESSIONS_PS="$t/ps" SPEEDBUMP_PID=101
fail=0; ok() { echo "ok - $1"; }; no() { echo "FAIL - $1"; fail=1; }
run() { printf '{"session_id":"%s","tool_input":{"command":"npm test"}}' "$1" | SPEEDBUMP_SIGNALS="$2" sh "$here/speedbump.sh" >"$t/out" 2>"$t/err"; }
ctx() { jq -r '.hookSpecificOutput.additionalContext' "$t/out"; }

run a "12 1 { 4.0 3.0 2.0 } 99999999" && [ ! -s "$t/err" ] && [ ! -s "$t/out" ] && ok "fine: silent, allowed" || no "fine: silent, allowed"
run a "12 1 { 20.0 9.0 8.0 } 99999999" && [ ! -s "$t/out" ] && ok "load spike without a sustained 5-min load: allowed" || no "load spike without a sustained 5-min load: allowed"

run a "12 1 { 20.0 14.0 10.0 } 99999999" && [ ! -s "$t/err" ] && ok "high load: allowed, no error" || no "high load: allowed, no error"
ctx | grep -q "Not an error" && ctx | grep -q "load is 20.0 on 12 cores" && ctx | grep -q "2.8 cores and 5.4 GB" && ok "tells the agent why, as context" || no "tells the agent why, as context"
[ "$(ctx | grep -c '^- ')" = 3 ] && ok "names the 3 busiest processes" || no "names the 3 busiest processes"
run a "12 1 { 20.0 14.0 10.0 } 99999999" && [ ! -s "$t/out" ] && ok "same session within 10 min: silent, not held" || no "same session within 10 min: silent, not held"

start=$(date +%s); SPEEDBUMP_WAIT=2 run w "12 1 { 20.0 14.0 10.0 } 99999999"; took=$(( $(date +%s) - start ))
[ "$took" -ge 2 ] && ctx | grep -q "held 2s" && ok "still strained: holds the full wait" || no "still strained: holds the full wait (took ${took}s)"

(SPEEDBUMP_PID=201; run e "12 1 { 20.0 14.0 10.0 } 99999999") && [ ! -s "$t/out" ] && ok "strained, light session: silent, not held" || no "strained, light session: silent, not held"

run b "12 2 { 1.0 1.0 1.0 } 99999999" && [ ! -s "$t/out" ] && ok "memory pressure warning: allowed" || no "memory pressure warning: allowed"
run b "12 4 { 1.0 1.0 1.0 } 99999999" && ctx | grep -q "memory pressure is critical" && ok "memory pressure critical, another session: held, told" || no "memory pressure critical, another session: held, told"
run c "12 1 { 1.0 1.0 1.0 } 5242880"; [ $? = 2 ] && grep -q "low on disk (only 5.0 GB of disk free)" "$t/err" && grep -q "run the exact same command again" "$t/err" && ok "under 10 GB free: blocked, says how to push through" || no "under 10 GB free: blocked, says how to push through"
run c "12 1 { 1.0 1.0 1.0 } 5242880" && ok "low disk retry: allowed" || no "low disk retry: allowed"
run d "12 1 { 1.0 1.0 1.0 } 20971520" && ok "20 GB free: allowed" || no "20 GB free: allowed"
[ "$(wc -l < "$t/log")" -eq 4 ] && grep -q "session=a .*waited=0s session-use=279.0%cpu/5610000kb cmd=npm test" "$t/log" && grep -q "session=c .*blocked" "$t/log" && ok "each hold and block logged" || no "each hold and block logged"

[ "$(sh "$here/sessions.sh")" = "100 279.0 5610000 5
200 3.0 310000 2" ] && ok "sessions: whole tree per session, nested claude -p charged to it, busiest first" || no "sessions: whole tree per session ($(sh "$here/sessions.sh" | tr '\n' '|'))"
[ "$(sh "$here/sessions.sh" 104)" = "100 279.0 5610000 5" ] && [ -z "$(sh "$here/sessions.sh" 400)" ] && ok "sessions <pid>: its session, none for a process outside" || no "sessions <pid>"

# The status-line widget over the same table: session 100 is heavy (orange), the Mac strained (red), 100 named on top.
w() { echo '{}' | HERDR_PANE_ID= SPEEDBUMP_DIR="$here" SPEEDBUMP_PID=$1 SPEEDBUMP_SIGNALS="$2" bash "$here/../statusline/statusline-load.sh"; }
out=$(w 101 "12 1 { 20.0 14.0 10.0 }"); case $out in *"⚡2.8c 5.4G"*"🔥1.7× · top: this session 2.8c"*) ok "widget: own use and the Mac, strained";; *) no "widget: own use and the Mac, strained ($out)";; esac
out=$(w 201 "12 1 { 4.0 3.0 2.0 }"); [ -z "$out" ] && ok "widget: light session on a fine Mac prints nothing" || no "widget: light session on a fine Mac prints nothing ($out)"
out=$(w 201 "12 1 { 13.0 9.0 8.0 }"); case $out in *"🔥1.1× · top: claude 100 2.8c"*) ok "widget: busy Mac names the heaviest other session";; *) no "widget: busy Mac names the heaviest other session ($out)";; esac

rm -rf "$t"
exit $fail

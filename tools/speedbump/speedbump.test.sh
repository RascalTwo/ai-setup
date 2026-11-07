#!/bin/sh
# speedbump.sh with faked signals: silent when fine; when strained, holds the command (SPEEDBUMP_WAIT), then
# allows it with a note for the agent, once per session; low disk blocks once. ~2 s. Run: sh tools/speedbump/speedbump.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); export SPEEDBUMP_STATE="$t" SPEEDBUMP_WAIT=0
fail=0; ok() { echo "ok - $1"; }; no() { echo "FAIL - $1"; fail=1; }
run() { printf '{"session_id":"%s","tool_input":{"command":"bun test"}}' "$1" | SPEEDBUMP_SIGNALS="$2" sh "$here/speedbump.sh" >"$t/out" 2>"$t/err"; }
ctx() { jq -r '.hookSpecificOutput.additionalContext' "$t/out"; }

run a "12 1 { 4.0 3.0 2.0 } 99999999" && [ ! -s "$t/err" ] && [ ! -s "$t/out" ] && ok "fine: silent, allowed" || no "fine: silent, allowed"
run a "12 1 { 20.0 9.0 8.0 } 99999999" && [ ! -s "$t/out" ] && ok "load spike without a sustained 5-min load: allowed" || no "load spike without a sustained 5-min load: allowed"

run a "12 1 { 20.0 14.0 10.0 } 99999999" && [ ! -s "$t/err" ] && ok "high load: allowed, no error" || no "high load: allowed, no error"
ctx | grep -q "Not an error" && ctx | grep -q "load is 20.0 on 12 cores" && ok "tells the agent why, as context" || no "tells the agent why, as context"
[ "$(ctx | grep -c '^- ')" = 3 ] && ok "names the 3 busiest processes" || no "names the 3 busiest processes"
run a "12 1 { 20.0 14.0 10.0 } 99999999" && [ ! -s "$t/out" ] && ok "same session within 10 min: silent, not held" || no "same session within 10 min: silent, not held"

start=$(date +%s); SPEEDBUMP_WAIT=2 run w "12 1 { 20.0 14.0 10.0 } 99999999"; took=$(( $(date +%s) - start ))
[ "$took" -ge 2 ] && ctx | grep -q "held 2s" && ok "still strained: holds the full wait" || no "still strained: holds the full wait (took ${took}s)"

run b "12 2 { 1.0 1.0 1.0 } 99999999" && [ ! -s "$t/out" ] && ok "memory pressure warning: allowed" || no "memory pressure warning: allowed"
run b "12 4 { 1.0 1.0 1.0 } 99999999" && ctx | grep -q "memory pressure is critical" && ok "memory pressure critical, another session: held, told" || no "memory pressure critical, another session: held, told"
run c "12 1 { 1.0 1.0 1.0 } 5242880"; [ $? = 2 ] && grep -q "low on disk (only 5.0 GB of disk free)" "$t/err" && grep -q "run the exact same command again" "$t/err" && ok "under 10 GB free: blocked, says how to push through" || no "under 10 GB free: blocked, says how to push through"
run c "12 1 { 1.0 1.0 1.0 } 5242880" && ok "low disk retry: allowed" || no "low disk retry: allowed"
run d "12 1 { 1.0 1.0 1.0 } 20971520" && ok "20 GB free: allowed" || no "20 GB free: allowed"
[ "$(wc -l < "$t/log")" -eq 4 ] && grep -q "session=a .*waited=0s cmd=bun test" "$t/log" && grep -q "session=c .*blocked" "$t/log" && ok "each hold and block logged" || no "each hold and block logged"

rm -rf "$t"
exit $fail

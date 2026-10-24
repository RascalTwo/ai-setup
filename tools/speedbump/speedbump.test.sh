#!/bin/sh
# speedbump.sh with faked signals: silent when fine, blocks once when strained, then lets the retry
# through, per session; low disk blocks too. Under 1 s. Run: sh tools/speedbump/speedbump.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
t=$(mktemp -d); export SPEEDBUMP_STATE="$t"
fail=0; ok() { echo "ok - $1"; }; no() { echo "FAIL - $1"; fail=1; }
run() { printf '{"session_id":"%s","tool_input":{"command":"bun test"}}' "$1" | SPEEDBUMP_SIGNALS="$2" sh "$here/speedbump.sh" 2>"$t/err"; }

run a "12 1 { 4.0 3.0 2.0 } 99999999" && [ ! -s "$t/err" ] && ok "fine: silent, allowed" || no "fine: silent, allowed"
run a "12 1 { 20.0 9.0 8.0 } 99999999" && ok "load spike without a sustained 5-min load: allowed" || no "load spike without a sustained 5-min load: allowed"

run a "12 1 { 20.0 14.0 10.0 } 99999999"; [ $? = 2 ] && ok "high load: blocked" || no "high load: blocked"
grep -q "Speed bump, not a wall" "$t/err" && grep -q "run the exact same command again" "$t/err" && ok "says how to push through" || no "says how to push through"
[ "$(grep -c '^- ' "$t/err")" = 3 ] && ok "names the 3 busiest processes" || no "names the 3 busiest processes"
run a "12 1 { 20.0 14.0 10.0 } 99999999" && ok "retry from the same session: allowed" || no "retry from the same session: allowed"

run b "12 2 { 1.0 1.0 1.0 } 99999999" && ok "memory pressure warning: allowed" || no "memory pressure warning: allowed"
run b "12 4 { 1.0 1.0 1.0 } 99999999"; [ $? = 2 ] && grep -q "memory pressure is critical" "$t/err" && ok "memory pressure critical, another session: blocked" || no "memory pressure critical, another session: blocked"
run c "12 1 { 1.0 1.0 1.0 } 5242880"; [ $? = 2 ] && grep -q "low on disk (only 5.0 GB of disk free)" "$t/err" && grep -q "run the exact same command again" "$t/err" && ok "under 10 GB free: blocked, says how to push through" || no "under 10 GB free: blocked, says how to push through"
run d "12 1 { 1.0 1.0 1.0 } 20971520" && ok "20 GB free: allowed" || no "20 GB free: allowed"
[ "$(wc -l < "$t/log")" -eq 3 ] && grep -q "session=a .*cmd=bun test" "$t/log" && ok "each block logged" || no "each block logged"

rm -rf "$t"
exit $fail

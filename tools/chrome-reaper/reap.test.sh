#!/bin/sh
# reap.sh against real headless Chromes: an orphan is reaped, one whose parent lives is not,
# and only stale, unused temp profiles are removed. About 10 s. Run: sh tools/chrome-reaper/reap.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
t=$(mktemp -d); export HOME="$t" REAP_TMP="$t"
fail=0; ok() { echo "ok - $1"; }; no() { echo "FAIL - $1"; fail=1; }
pid_of() { pgrep -f -- "--user-data-dir=$t/$1" | head -1; }

# An orphan: its parent subshell exits at once, so it hangs off PID 1.
( "$chrome" --headless=new --user-data-dir="$t/puppeteer_dev_chrome_profile-orphan" about:blank >/dev/null 2>&1 & )
# A kept child: its parent waits on it.
sh -c "'$chrome' --headless=new --user-data-dir='$t/puppeteer_dev_chrome_profile-kept' about:blank >/dev/null 2>&1 & wait" &
parent=$!
mkdir "$t/puppeteer_dev_chrome_profile-stale"
sleep 3
touch -t 202001010000 "$t/puppeteer_dev_chrome_profile-stale" "$t/puppeteer_dev_chrome_profile-kept"
[ -n "$(pid_of puppeteer_dev_chrome_profile-orphan)" ] && [ -n "$(pid_of puppeteer_dev_chrome_profile-kept)" ] || no "setup: both Chromes started"

# A sweep already running (a live reap.sh holds the lock): this one does nothing.
lock="$t/.agents/state/chrome-reaper/.lock"; mkdir -p "${lock%/*}"
sh -c 'sleep 30; :' reap.sh & holder=$!
ln -s "$holder" "$lock"
sh "$here/reap.sh"; sleep 1
[ -n "$(pid_of puppeteer_dev_chrome_profile-orphan)" ] && ok "a running sweep blocks a second" || no "a running sweep blocks a second"
kill "$holder"; wait "$holder" 2>/dev/null # its lock is now stale: the next sweep takes it over

sh "$here/reap.sh"; sleep 1
[ ! -L "$lock" ] && ok "lock released" || no "lock released"

[ -z "$(pid_of puppeteer_dev_chrome_profile-orphan)" ] && ok "orphan reaped" || no "orphan reaped"
[ -n "$(pid_of puppeteer_dev_chrome_profile-kept)" ] && ok "Chrome with a live parent kept" || no "Chrome with a live parent kept"
[ ! -d "$t/puppeteer_dev_chrome_profile-stale" ] && ok "stale profile removed" || no "stale profile removed"
[ -d "$t/puppeteer_dev_chrome_profile-kept" ] && ok "profile in use kept" || no "profile in use kept"
/usr/bin/grep -q "reap pid=.*profile-orphan" "$t/.agents/state/chrome-reaper/reap.log" && ok "reap logged" || no "reap logged"

pkill -f -- "--user-data-dir=$t/" ; kill "$parent" 2>/dev/null; sleep 1; rm -rf "$t"
exit $fail

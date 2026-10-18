#!/bin/sh
# chrome-reaper: kill automation Chromes whose parent died, and the temp profiles they left.
#
# A test run (Puppeteer, Playwright, anything) closes its browser when it ends normally. Killed
# instead (a closed pane, a timeout, kill -9), it never gets the chance, and the browser keeps
# running under launchd with nothing to stop it. 17 of them once filled 47 GB of swap overnight.
#
# Killed: a process whose parent is PID 1 AND that is an automation browser: run from Playwright's or
# Puppeteer's browser cache, or a Chrome started --headless or on a temp automation profile.
# The human's own Chrome is none of these.
# Usage: reap.sh [--dry-run]   Log: ~/.agents/state/chrome-reaper/reap.log

dry=; [ "$1" = "--dry-run" ] && dry=1
log="$HOME/.agents/state/chrome-reaper/reap.log"
mkdir -p "${log%/*}"

# One sweep at a time. launchd never overlaps its own runs, but a run by hand can meet one. The lock
# is a symlink to the sweep's pid (created atomically); one whose pid is no longer a reap.sh is stale.
lock="${log%/*}/.lock"
if ! ln -s $$ "$lock" 2>/dev/null; then
  /bin/ps -p "$(readlink "$lock")" -o command= 2>/dev/null | /usr/bin/grep -q 'reap\.sh' && exit 0
  rm -f "$lock"; ln -s $$ "$lock" 2>/dev/null || exit 0
fi
trap 'rm -f "$lock"' EXIT
trap 'exit 1' INT TERM
profiles='puppeteer_dev_chrome_profile-|puppeteer_dev_profile-|playwright_chromiumdev_profile-|playwright_firefoxdev_profile-'

/bin/ps -Ao pid=,ppid=,etime=,command= | while read -r pid ppid age cmd; do
  [ "$ppid" = 1 ] || continue
  case "$cmd" in
    */ms-playwright/*|*/.cache/puppeteer/*) ;; # browsers only automation runs (Playwright's Firefox and WebKit too)
    *"/Google Chrome"*|*Chromium*|*/chrome\ *)
      printf '%s\n' "$cmd" | /usr/bin/grep -Eq -- "--headless|$profiles" || continue ;;
    *) continue ;;
  esac
  dir=$(printf '%s\n' "$cmd" | /usr/bin/grep -Eo -- '--user-data-dir=[^ ]+' | head -1)
  echo "$(date '+%F %T') ${dry:+would }reap pid=$pid age=$age ${dir:-no-profile}" >> "$log"
  [ -n "$dry" ] && continue
  kill "$pid" 2>/dev/null
  sleep 2; kill -9 "$pid" 2>/dev/null
done

# Profiles a dead browser left behind, an hour on, unless a live process still names one.
live=$(/bin/ps -Ao command=)
d=${REAP_TMP:-$(getconf DARWIN_USER_TEMP_DIR 2>/dev/null)}; d=${d%/} # Puppeteer/Playwright's temp dir; launchd sets no TMPDIR
[ -d "$d" ] && /usr/bin/find "$d" -maxdepth 1 -type d -mmin +60 | /usr/bin/grep -E "/($profiles)" | while read -r p; do
  case "$live" in *"$p"*) continue ;; esac
  [ -n "$dry" ] && { echo "$(date '+%F %T') would remove $p" >> "$log"; continue; }
  rm -rf "$p"
done

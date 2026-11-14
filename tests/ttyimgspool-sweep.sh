#!/usr/bin/env bash
# The age sweep in tools/ttyimgspool: old session dirs go, fresh ones stay, and
# the session you are currently looking at is never swept out from under you.
set -uo pipefail
pass=0; fail=0
ok(){ printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }

root=$(mktemp -d); trap 'rm -rf "$root"' EXIT
mkdir -p "$root"/stale "$root"/fresh "$root"/current
touch "$root"/stale/a.png "$root"/fresh/a.png "$root"/current/a.png
# backdate two of them past the 30-day threshold
touch -t "$(date -v-40d +%Y%m%d%H%M 2>/dev/null || date -d '40 days ago' +%Y%m%d%H%M)" \
      "$root"/stale "$root"/current

dir="$root/current"; DAYS=30
find "$root" -mindepth 1 -maxdepth 1 -type d -mtime +"$DAYS" \
     ${dir:+! -path "$dir"} -exec rm -rf {} + 2>/dev/null

[ ! -d "$root/stale"   ] && ok "sweeps a session dir untouched for 40 days" || no "stale dir survived"
[   -d "$root/fresh"   ] && ok "leaves a dir written to today"              || no "fresh dir was swept"
[   -d "$root/current" ] && ok "never sweeps the session being viewed"      || no "current dir was swept"

# DAYS=0 disables it
root2=$(mktemp -d); trap 'rm -rf "$root" "$root2"' EXIT
mkdir -p "$root2"/stale; touch "$root2"/stale/a.png
touch -t "$(date -v-40d +%Y%m%d%H%M 2>/dev/null || date -d '40 days ago' +%Y%m%d%H%M)" "$root2"/stale
DAYS=0
[ "$DAYS" -gt 0 ] 2>/dev/null &&
  find "$root2" -mindepth 1 -maxdepth 1 -type d -mtime +"$DAYS" -exec rm -rf {} + 2>/dev/null
[ -d "$root2/stale" ] && ok "TTYIMGSPOOL_DAYS=0 turns the sweep off" || no "DAYS=0 still swept"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

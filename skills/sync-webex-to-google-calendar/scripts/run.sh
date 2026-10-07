#!/bin/bash
# Bring Webex forward, run the extractor, ALWAYS restore the previously frontmost app.
# usage: run.sh [--from YYYY-MM-DD] [--days N]   (default: today, 7 days) -> ~/.local/share/webex-calendar/out/week.json
cd "$(dirname "$0")"
data=$HOME/.local/share/webex-calendar; bin=$data/wx
mkdir -p "$data/out" && chmod 700 "$data"
[ "$bin" -nt wx.swift ] || swiftc -O wx.swift -o "$bin" || exit 1
prev=$(osascript -e 'tell application "System Events" to get bundle identifier of first application process whose frontmost is true' 2>/dev/null)
restore() { if [ -n "$prev" ] && [ "$prev" != "Cisco-Systems.Spark" ]; then osascript -e "tell application id \"$prev\" to activate" >/dev/null 2>&1; fi; }
trap restore EXIT INT TERM
osascript -e 'tell application "Webex" to activate' >/dev/null 2>&1
sleep 0.8
perl -e 'alarm 300; exec @ARGV' "$bin" "$@"

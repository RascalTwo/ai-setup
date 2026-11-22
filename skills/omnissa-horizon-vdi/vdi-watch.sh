#!/bin/sh
# Waits until the VDI screen shows something, judged on the Mac from the shots vdi.watch() downloads.
#   vdi-watch.sh --text 'Inbox|Sign in'          OCR each new shot, match an extended regex (case-insensitive)
#   vdi-watch.sh '"a red error dialog"'          hand each new shot to watch-for (any watch-for expression)
# Options: --timeout <s> (default 600), --stale <s> (default 30: no new shot that long = the page stopped).
# Exit 0 on a match (prints the matched line or watch-for's JSON, and the kept frame), 1 on timeout, 2 on error.
set -u
TIMEOUT=600 STALE=30 TEXT=
while [ $# -gt 1 ]; do
  case $1 in
    --text) TEXT=$2; shift 2 ;;
    --timeout) TIMEOUT=$2; shift 2 ;;
    --stale) STALE=$2; shift 2 ;;
    *) break ;;
  esac
done
EXPR=${1:-}
[ -n "$TEXT$EXPR" ] || { echo "usage: vdi-watch.sh [--timeout s] (--text REGEX | 'watch-for expression')" >&2; exit 2; }

STATE=~/.agents/state/omnissa-horizon-vdi
OCR=$STATE/ocr
WATCH_FOR=~/.agents/ai-setup/tools/watch-for/watch-for
DIR=$STATE/shots/watch-$$
mkdir -p "$DIR"
trap 'rm -rf "$DIR"' EXIT
[ -z "$TEXT" ] || [ -x "$OCR" ] || { echo "build $OCR first (see web-client.md, OCR)" >&2; exit 2; }

# Moves each new download into $DIR and prints its path; exits 1 at the timeout, 3 when shots stop arriving.
# Chrome writes a .crdownload and renames it when done, so a vdi-shot-*.png that exists is complete.
shots() {
  start=$(date +%s) last=$start
  while :; do
    now=$(date +%s)
    for f in ~/Downloads/vdi-shot-*.png; do
      [ -e "$f" ] || continue
      mv "$f" "$DIR/" && echo "$DIR/${f##*/}" && last=$now
    done
    [ $((now - start)) -ge "$TIMEOUT" ] && return 1
    [ $((now - last)) -ge "$STALE" ] && { echo "no shot for ${STALE}s: is vdi.watch() running and the tab still connected? (a page reload stops it)" >&2; return 3; }
    sleep 0.5
  done
}

# Any vdi-shot left in Downloads predates this wait; clear it so the first frame judged is current.
rm -f ~/Downloads/vdi-shot-*.png

mkfifo "$DIR/q"
shots > "$DIR/q" & P=$!
if [ -n "$TEXT" ]; then
  rc=1
  while read -r f; do
    hit=$("$OCR" "$f" 2>/dev/null | grep -Ei -m1 -- "$TEXT") && { cp "$f" "$STATE/watch-match.png"; echo "$hit"; echo "frame: $STATE/watch-match.png"; rc=0; break; }
    rm -f "$f"
  done < "$DIR/q"
  [ $rc -eq 0 ] || echo "no match (timeout or shots stopped)" >&2
else
  "$WATCH_FOR" --in - --timeout "$TIMEOUT" "$EXPR" < "$DIR/q"; rc=$?
fi
kill $P 2>/dev/null; wait $P 2>/dev/null
exit $rc

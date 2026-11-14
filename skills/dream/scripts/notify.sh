#!/usr/bin/env bash
# dream — tell Joseph, through herald's Discord DMs, that proposals are waiting.
#
#   usage: notify.sh <status> [error]      (nightly.sh calls it last, after the heartbeat)
#
# Proposals nobody hears about are proposals nobody judges, which is how the dream
# before this one died. So: one message per night when anything waits for review,
# and one when the night failed (silence would read as "nothing to review").
# A clean night with an empty queue says nothing.
#
# Delivery is a `dream` entry in herald's `now` queue (retinue's mailroom), written
# the way @r2/contracts/spool writes: .tmp then rename. No mailroom → no message,
# never an error: the nightly must not fail because a notifier is absent.
set -uo pipefail

STATUS="${1:-}"
ERROR="${2:-}"
STATE="${DREAM_STATE:-$HOME/.agents/state/dream}"
QUEUE="${DREAM_HERALD_QUEUE:-$HOME/retinue/members/mailroom/queue/now}"
REPO=$(cd "$(dirname "$0")/../../.." && pwd -P)
URL="${DREAM_QUEUE_URL:-http://127.0.0.1:5180/${REPO#"$HOME"/}/viz-pages/dream-queue/}"

[ "$STATUS" = "skipped" ] && exit 0     # on battery: nothing ran, nothing to say
[ -d "$(dirname "$QUEUE")" ] || { echo "dream/notify: no herald queue at $QUEUE, not notifying" >&2; exit 0; }

pending=0; fresh=0
today=$(date +%Y%m%d)
for f in "$STATE"/proposals/*.json; do
  [ -f "$f" ] || continue
  [ "$(jq -r '.status // empty' "$f")" = "pending" ] || continue
  pending=$((pending + 1))
  case "$(basename "$f")" in "$today"-*) fresh=$((fresh + 1)) ;; esac
done

if [ "$pending" -gt 0 ]; then
  s=""; [ "$pending" -eq 1 ] || s="s"
  text="dream has $pending proposal$s waiting for your review ($fresh new tonight): $URL"
  [ "$STATUS" = "ok" ] || text="$text (the night was $STATUS: ${ERROR:-see logs})"
elif [ "$STATUS" = "ok" ]; then
  exit 0
else
  text="dream's night was $STATUS and nothing is waiting for review: ${ERROR:-see ~/.agents/state/dream/logs}"
fi

id=$(uuidgen | tr '[:upper:]' '[:lower:]')
ms=$(( $(date +%s) * 1000 ))
mkdir -p "$QUEUE"
jq -n --arg id "$id" --arg at "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" --arg text "${text:0:1500}" \
  '{id: $id, receivedAt: $at, type: "dream", dream: {text: $text}}' > "$QUEUE/$ms-$id.tmp" \
  && mv "$QUEUE/$ms-$id.tmp" "$QUEUE/$ms-$id.json"
echo "dream/notify: spooled: $text" >&2

#!/usr/bin/env bash
# dream notify.sh check: what it spools into a throwaway herald queue, never the real
# one. `bash tests/dream-notify.sh`
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
N="$REPO/skills/dream/scripts/notify.sh"
export DREAM_STATE="$T/state" DREAM_HERALD_QUEUE="$T/mailroom/queue/now" DREAM_QUEUE_URL="http://q/"
mkdir -p "$DREAM_STATE/proposals" "$T/mailroom/queue"

pass=0; fail=0
ok(){ printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }
spooled(){ ls "$DREAM_HERALD_QUEUE"/*.json 2>/dev/null | wc -l | tr -d ' '; }
last(){ jq -r "$1" "$(ls "$DREAM_HERALD_QUEUE"/*.json | tail -1)"; }
reset(){ rm -rf "$DREAM_HERALD_QUEUE"; }
prop(){ printf '{"id":"%s","status":"%s"}\n' "$1" "$2" > "$DREAM_STATE/proposals/$1.json"; }

bash "$N" ok 2>/dev/null
[ "$(spooled)" -eq 0 ]                                  && ok "clean night, empty queue: silent"       || no "spooled on an empty clean night"

prop "$(date +%Y%m%d)-0001" pending; prop 20200101-0001 pending; prop 20200101-0002 merged
bash "$N" ok 2>/dev/null
[ "$(spooled)" -eq 1 ]                                  && ok "pending proposals: one message"         || no "spooled $(spooled)"
[ "$(last .type)" = dream ]                             && ok "entry type is dream"                    || no "type $(last .type)"
last .dream.text | grep -q "2 proposals waiting"        && ok "counts only pending (2, not merged)"    || no "text: $(last .dream.text)"
last .dream.text | grep -q "(1 new tonight)"            && ok "counts tonight's new ones"              || no "text: $(last .dream.text)"
last .dream.text | grep -q "http://q/"                  && ok "links the queue"                        || no "no link"
[ -z "$(ls "$DREAM_HERALD_QUEUE"/*.tmp 2>/dev/null)" ]  && ok "no .tmp left (atomic rename)"           || no ".tmp left behind"

reset; bash "$N" partial "Ollama busy" 2>/dev/null
last .dream.text | grep -q "the night was partial: Ollama busy" && ok "partial night says why"  || no "text: $(last .dream.text)"

reset; rm "$DREAM_STATE"/proposals/*; bash "$N" failed "environment not ready" 2>/dev/null
[ "$(spooled)" -eq 1 ] && last .dream.text | grep -q "failed.*environment not ready" \
                                                        && ok "failed night, nothing waiting: still says so" || no "silent on failure"

reset; prop "$(date +%Y%m%d)-0009" pending; bash "$N" skipped 2>/dev/null
[ "$(spooled)" -eq 0 ]                                  && ok "battery skip: silent"                   || no "spooled on a skip"

rm -rf "$T/mailroom"; bash "$N" ok 2>/dev/null; rc=$?
[ "$rc" -eq 0 ] && [ ! -d "$T/mailroom" ]               && ok "no mailroom: exits 0, creates nothing"  || no "rc $rc or created mailroom"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

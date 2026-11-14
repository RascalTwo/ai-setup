#!/usr/bin/env bash
# Check: herdr-space-cache.sh picks each Space's soonest-to-expire live session, and falls back to the
# freshest expired one. Pure: feeds a fixed pane list, no herdr needed.
set -u
here=$(dirname "$0"); f=$(mktemp); fail=0
pane() { printf '{"workspace_id":"%s","agent":"claude","tokens":{"%s":"%s"}},' "$1" "$2" "$3"; }
{ printf '{"result":{"panes":['
  pane wA cache_ok 60m
  pane wB cache_ok 41m; pane wB cache_warn 9m; pane wB cache_exp -54h42m   # the live 9m wins, not the dead one
  pane wC cache_exp -3m; pane wC cache_exp -125m                             # all expired: the freshest
  printf '{"workspace_id":"wE","agent":"codex"},{"workspace_id":"wD"}]}}'; } > "$f"   # wE: an agent with no cache yet; wD: no agent, nothing
want=$'wA ok 60m · 1 agent\nwB warn 9m · 3 agents\nwC exp -3m · 2 agents\nwE ok 1 agent'
got=$(env -u HERDR_WORKSPACE_ID HERDR_PANES_JSON=$f bash "$here/herdr-space-cache.sh")
[ "$got" = "$want" ] && echo "ok   herdr-space-cache.sh" || { echo "FAIL herdr-space-cache.sh:"; echo "$got"; fail=1; }
rm -f "$f"; exit $fail

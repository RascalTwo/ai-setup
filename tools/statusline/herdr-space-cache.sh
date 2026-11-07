#!/usr/bin/env bash
# herdr-space-cache.sh [workspace-id] — the Space's row in the herdr sidebar: the least prompt-cache
# time left among its sessions, then how many agents it has ("34m · 5 agents"), read from the cache_* tokens statusline-cache.sh puts on each
# pane. Same trick as there: the colour is picked by token NAME (spcache_ok / _warn <=15m / _exp),
# styled in herdr-sidebar.toml. Expired sessions have nothing left to lose, so the Space shows its
# soonest-to-expire LIVE session, and only when all are expired the freshest of those (red).
# 90s TTL against the 30s statusline refresh, so a Space with no live sessions clears itself.
# HERDR_PANES_JSON=<file> reads that instead of `herdr pane list` and prints "<ws> <band> <text>" lines
# instead of reporting (test-space-cache.sh).
herdr=${HERDR_BIN_PATH:-herdr}
ws=${1:-${HERDR_WORKSPACE_ID:-}}
panes=$( [ -n "${HERDR_PANES_JSON:-}" ] && cat "$HERDR_PANES_JSON" || "$herdr" pane list 2>/dev/null ) || exit 0
printf '%s' "$panes" | jq -r --arg ws "$ws" '
  def mins: . as $s | ltrimstr("-") | capture("^((?<h>[0-9]+)h)?(?<m>[0-9]+)m$")
            | ((.h // "0" | tonumber) * 60 + (.m | tonumber)) | if ($s | startswith("-")) then -. else . end;
  def fmt: if . <= -60 then "-\(-. / 60 | floor)h\("0" + ((-. % 60) | tostring) | .[-2:])m" else "\(.)m" end;
  [.result.panes[] | select(.agent != null and (($ws == "") or .workspace_id == $ws))]
  | group_by(.workspace_id)[]
  | .[0].workspace_id as $w | length as $n
  | [.[] | (.tokens // {}) | to_entries[] | select(.key | startswith("cache_")) | .value | mins] as $t
  | (([$t[] | select(. > 0)] | min) // ($t | max)) as $m
  | "\($w) \(if $m == null or $m > 15 then "ok" elif $m > 0 then "warn" else "exp" end) \([($m | if . == null then empty else fmt end), "\($n) agent\(if $n == 1 then "" else "s" end)"] | join(" · "))"' |
while IFS=" " read -r w band text; do
  if [ -n "${HERDR_PANES_JSON:-}" ]; then echo "$w $band $text"; continue; fi
  clear=(); for o in ok warn exp; do [ "$o" = "$band" ] || clear+=(--clear-token "spcache_$o"); done
  "$herdr" workspace report-metadata "$w" --source user:cache-ttl --token "spcache_$band=$text" --ttl-ms 90000 "${clear[@]}" >/dev/null 2>&1
done

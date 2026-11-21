#!/usr/bin/env bash
# Check: statusline-cache.sh / statusline-context.sh mirror their values into this pane's herdr
# tokens (cache_* / ctx_*), exactly one of each family set. Run inside a herdr pane.
# Caveat: this pane's LIVE statusline also writes these tokens every ~30s; a rare FAIL that
# passes on rerun is that tick landing mid-check.
set -u
[ -n "${HERDR_PANE_ID:-}" ] || { echo "run inside a herdr pane"; exit 1; }
here=$(dirname "$0"); tp=$(mktemp); fail=0
# check <widget> <token prefix> <stdin json> <expected "name=value", or empty = none>
check() {
  printf '%s' "$3" | bash "$here/$1" >/dev/null
  for _ in $(seq 20); do   # the report runs in the background: poll up to 3s
    got=$(herdr pane get "$HERDR_PANE_ID" | jq -r --arg p "$2" '(.result.pane.tokens // {}) | to_entries | map(select(.key|startswith($p))) | map("\(.key)=\(.value)") | join(",")')
    [ "$got" = "$4" ] && break; sleep 0.15
  done
  if [ "$got" = "$4" ]; then echo "ok   $1 -> '$got'"; else echo "FAIL $1 -> '$got' (want '$4')"; fail=1; fi
}
# cache: minutes since the last assistant event -> countdown token (60 - ago = minutes left)
for case in "48:cache_warn=12m" "30:cache_ok=30m" "53:cache_warn=7m" "62:cache_exp=-2m"; do
  ago=${case%%:*}
  printf '{"type":"assistant","timestamp":"%s"}\n' "$(date -u -v-"${ago}"M +%Y-%m-%dT%H:%M:%SZ)" > "$tp"
  check statusline-cache.sh cache_ "{\"transcript_path\":\"$tp\"}" "${case#*:}"
done
# context: used tokens of a 1M window -> band token
for case in "50000:ctx_g=50k" "150000:ctx_y=150k" "300000:ctx_o=300k" "600000:ctx_m=600k" "850000:ctx_r=850k"; do
  check statusline-context.sh ctx_ "{\"context_window\":{\"total_input_tokens\":${case%%:*},\"context_window_size\":1000000}}" "${case#*:}"
done
rm -f "$tp"
herdr pane report-metadata "$HERDR_PANE_ID" --source user:cache-ttl --clear-token cache_ok --clear-token cache_warn --clear-token cache_exp >/dev/null 2>&1
herdr pane report-metadata "$HERDR_PANE_ID" --source user:ctx --clear-token ctx_g --clear-token ctx_y --clear-token ctx_o --clear-token ctx_m --clear-token ctx_r >/dev/null 2>&1
exit $fail

#!/bin/sh
# Run JS in the page's MAIN world through a browse session, where window.editor and window.__td live.
# browse's page.evaluate runs in an isolated world and cannot see them; raw CDP Runtime.evaluate can.
#   main.sh <session> <file.js>       e.g. main.sh tld scripts/bootstrap.js   (install window.__td)
#   main.sh <session> -e '<js>'       e.g. main.sh tld -e 'window.__td.probe()'
# Top-level await works. The value of the last expression is printed as JSON.
set -eu
[ $# -ge 2 ] || { sed -n '2,6p' "$0"; exit 2; }
session=$1; shift
if [ "$1" = "-e" ]; then src=$2; else src=$(cat "$1"); fi
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
{
  printf 'const c = await context.newCDPSession(page);\n'
  printf 'const r = await c.send("Runtime.evaluate", { expression: %s, returnByValue: true, awaitPromise: true, replMode: true });\n' "$(printf '%s' "$src" | jq -Rs .)"
  printf 'await c.detach();\n'
  printf 'if (r.exceptionDetails) return { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text };\n'
  printf 'return r.result.value;\n'
} > "$tmp"
browse execute -s "$session" --timeout-ms 60000 --file "$tmp"

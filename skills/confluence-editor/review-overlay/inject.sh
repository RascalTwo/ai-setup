#!/bin/sh
# Evaluate the overlay bundle in a page of a browse session.
#   inject.sh <session> <crv-bundle.js> [--target-url <substring of the page's URL>]
# Prints "crv: N items, located M". Run it once per draft tab: the bundle picks its items by the page id in the URL.
# The overlay only reads and draws on the DOM, so browse's isolated world is enough (no CDP needed).
set -eu
[ $# -ge 2 ] || { sed -n '2,5p' "$0"; exit 2; }
session=$1; bundle=$2; shift 2
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
printf 'return await page.evaluate(%s);\n' "$(jq -Rs . "$bundle")" > "$tmp"
browse execute -s "$session" --timeout-ms 60000 "$@" --file "$tmp"

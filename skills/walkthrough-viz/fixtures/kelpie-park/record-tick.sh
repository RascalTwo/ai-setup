#!/bin/bash
# Records the clip for the park walkthrough's tick step: from a fresh start, this build parks the
# task, then runs the next `kelpie tick`, which would open a Claude session in herdr. The fake herdr
# takes the call instead, and its log shows what the real one would have been asked to do.
# Usage: record-tick.sh <sandbox> <out file>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); S=$1 out=$2
"$here/stage.sh" "$S" >/dev/null
run() { echo "\$ kelpie $*"; "$here/cmd.sh" "$S" now kelpie "$@"; echo; }
{
  run park "rethink it"
  run tick
  run status
  echo "What the tick asked herdr for (a fake one, so nothing opened):"
  sed -e 's/^herdr /  herdr /' -e "s/--settings .* \"\\\$(cat [^)]*)\"/--settings '<its hooks>' \"<the refine prompt>\"/" "$S/now-side/herdr.log"
} > "$out" 2>&1
"$here/stage.sh" "$S" >/dev/null # leave the sandbox at the walkthrough's start

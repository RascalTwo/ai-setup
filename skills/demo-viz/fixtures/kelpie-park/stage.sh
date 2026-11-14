#!/bin/bash
# Stages (and resets) the kelpie-park demo (ai-setup 563236a, "kelpie: park returns a task to
# the refine queue") in <sandbox>: the CLI at 563236a and at 563236a^, and for each side its own
# HOME, Kelpie config and state, its own throwaway calendar-app repo, and its own fresh plan with
# the same starting point on the sandbox's Timeline Studio (the month-span fixture's, on :8092).
# Nothing real: not your plan, not your queue, no herdr (a fake answers). Re-run to start over.
# Usage: stage.sh <sandbox dir>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); skill=$here/../..
S=$1 SYNC=${SYNC:-http://localhost:8092}
REPO=${AI_SETUP_REPO:-$HOME/Desktop/Desktop/Code/ai-setup}
curl -sf -o /dev/null "$SYNC/api/health" || { echo "no Timeline Studio at $SYNC: stage the month-span fixture first" >&2; exit 1; }
[ -d "$S/now/.git" ] || "$skill/sandbox/clone-pair.sh" "$REPO" 563236a 563236a^ "$S" >/dev/null
for side in now before; do
  D=$S/$side-side
  rm -rf "$D"; mkdir -p "$D/kelpie-config/projects" "$D/home/.agents/state/ai-tidemark/claude-code"
  git init -q -b main "$D/calendar-app" && echo "# calendar" > "$D/calendar-app/README.md"
  git -C "$D/calendar-app" add . && git -C "$D/calendar-app" -c user.name=demo -c user.email=demo@example.invalid commit -qm initial
  echo '{}' > "$D/kelpie-config/config.json"
  printf -- '---\ncolor: calendar\nspace: Calendar\nrepos:\n  - path: %s\n    base: main\n---\nA small calendar app.\n' "$D/calendar-app" > "$D/kelpie-config/projects/calendar.md"
  # Fresh usage data, so the gate reads open.
  bun -e 'const n=new Date(),r=new Date(+n+3*864e5);console.log(JSON.stringify({t:n.toISOString(),src:"api",usage:{seven_day:{utilization:20,resets_at:r.toISOString()}}}))' \
    > "$D/home/.agents/state/ai-tidemark/claude-code/$(date -u +%Y-%m).jsonl"
  HOME=$D/home KELPIE_CONFIG=$D/kelpie-config KELPIE_STATE=$D/kelpie-state PATH=$skill/sandbox:$PATH \
    bun "$here/seed-plan.ts" "$D" "$S/$side/tools/kelpie" "$SYNC"
done
echo "staged: both sides at the same start"

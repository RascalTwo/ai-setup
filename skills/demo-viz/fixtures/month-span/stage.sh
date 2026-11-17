#!/bin/bash
# Stages the month-span demo (Timeline Studio 3c303d1, "Calendar view: month span") on
# throwaway copies in <sandbox>: its own S3 container, sync server and data, this build on :5193
# with the guide injected, the previous build (3c303d1^) on :5194, and a fresh demo plan. Each
# build's own preview runs 100 ports up, behind sandbox/front.ts, which answers the app's /wake. Nothing
# of the real plan or the real local stack (:9002/:8090/:5190) is touched. Re-running is safe.
# Usage: stage.sh <sandbox dir> <viz dir>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); skill=$here/../..
S=$1 V=$2
TS=${TS_REPO:-$HOME/Desktop/Desktop/Code/timeline-studio}
export S3_PORT=9013 SYNC_PORT=8092 WEB_PORT=5293 BEFORE_PORT=5294
export DATA_BUCKET=walk-fixtures S3_CONTAINER=ts-s3-walk TIMELINE_DATA_DIR=$S/data/s3
mkdir -p "$S/data"

"$skill/sandbox/clone-pair.sh" "$TS" 3c303d1 3c303d1^ "$S"
for d in now/web before/web now/sync-server; do
  [ -d "$S/$d/node_modules" ] || (cd "$S/$d" && npm ci --prefer-offline --no-audit --no-fund >/dev/null)
done
# web/src's shared .d.ts files are built, not tracked (the repo's own pretest builds them the same way).
for side in now before; do (cd "$S/$side" && web/node_modules/.bin/tsc -p shared/tsconfig.json); done

# The app's own launcher, on the sandbox's ports: S3, the sync server, and this build's web page.
"$S/now/scripts/local-up.sh" >"$S/data/local-up.log" 2>&1 || { cat "$S/data/local-up.log"; exit 1; }
bun "$skill/guide/inject.ts" "$S/now/web/dist" "$V/walk.json"

# The previous build beside it, against the same sync server, so both open the same plan.
if ! curl -sf "http://localhost:$BEFORE_PORT/" | grep -qi timeline; then
  (cd "$S/before/web" && npm run build >"$S/data/before-build.log" 2>&1)
  (cd "$S/before/web" && SYNC_PORT=$SYNC_PORT nohup npx vite preview --port "$BEFORE_PORT" --strictPort \
    >"$S/data/before-preview.log" 2>&1 &)
  for _ in $(seq 1 60); do curl -sf -o /dev/null "http://localhost:$BEFORE_PORT/" && break; sleep 1; done
fi

# The app POSTs /wake to its production edge on load; locally nothing answers it, so the fronts say
# what a warm server says.
for p in 5193:$WEB_PORT 5194:$BEFORE_PORT; do
  curl -sf -o /dev/null "http://localhost:${p%%:*}/" ||
    (nohup bun "$skill/sandbox/front.ts" "${p%%:*}" "http://localhost:${p##*:}" '/wake={"status":"ready","running":1}' >"$S/data/front-${p%%:*}.log" 2>&1 &)
done
for _ in $(seq 1 20); do curl -sf -o /dev/null http://localhost:5194/ && break; sleep 0.5; done

bun "$here/seed.ts" "http://localhost:$SYNC_PORT" "$S/plan.token"
echo "staged: this build http://localhost:5193/ (guide in), previous build http://localhost:5194/"

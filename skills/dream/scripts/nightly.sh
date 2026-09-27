#!/bin/bash
# dream: nightly entry point. Invoked by launchd (com.rascaltwo.dream).
#
# DESIGN INVARIANT -- this script is AUTHORITATIVE and IDEMPOTENT.
# The Stop / SessionEnd hooks are pure optimization. If every hook fails
# forever, a nightly run must still produce a correct result. Nothing below
# may assume a hook has ever run, and nothing below may be skipped because a
# hook "already did it".
#
# Order: AC gate -> PID lock -> scan -> score -> ollama preflight -> cluster ->
#        synthesize -> conflicts -> heartbeat (ALWAYS, even on failure).
#
# Deliberately NO `set -e`: a mid-script abort would skip the heartbeat, and a
# missing heartbeat is indistinguishable from "the machine never woke up".

SKILL=$(cd "$(dirname "$0")/.." && pwd -P)
# State lives outside the repo like every other tool here: ~/.agents/state/<name>/.
STATE="${DREAM_STATE:-$HOME/.agents/state/dream}"
SCRIPTS="$SKILL/scripts"
HEARTBEAT="$STATE/last-dream.json"
LOCKDIR="$STATE/dream.lock"        # mkdir is atomic on every filesystem
PY="${DREAM_PYTHON:-python3}"

OLLAMA_URL="${DREAM_OLLAMA_URL:-http://localhost:11434}"
OLLAMA_WAIT_S="${DREAM_OLLAMA_WAIT_S:-300}"
# nomic-embed-text is ~0.4 GB and is the model clustering WANTS resident, so the
# "is something big in the way" threshold sits above it.
OLLAMA_BIG_GB="${DREAM_OLLAMA_BIG_GB:-2}"
OLLAMA_BLOCKER=""

mkdir -p "$STATE/stage1" "$STATE/candidates" "$STATE/proposals" "$STATE/logs"

START_EPOCH=$(date +%s)
STATUS="failed"
ERROR=""
STEPS=""
HELD_LOCK=0
WRITE_HEARTBEAT=1
STEP_PID=""       # in-flight pipeline step, so cleanup can reap it
WATCHDOG_PID=""   # its timeout watchdog, so it never outlives us

log() { printf '[dream %s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# --- heartbeat -------------------------------------------------------------
# Hand-rolled JSON on purpose: no python3, no jq, no dependency that can be
# absent. This is the one thing in the system that must never fail to write.

json_escape() {
  # Strip the only characters that can break a JSON string literal, and flatten
  # newlines. Lossy, but a truncated-but-valid heartbeat beats invalid JSON.
  printf '%s' "$1" | tr -d '"\\' | tr '\n\r\t' '   ' | cut -c1-500
}

count_proposals() {
  local prop=0 f
  for f in "$STATE"/proposals/*.json; do [ -f "$f" ] && prop=$((prop + 1)); done
  echo "$prop"
}

# Read a carried-forward timestamp field out of the previous heartbeat.
# Matches only the QUOTED form: BSD sed has no `\|` alternation (a GNU
# extension), so a combined "string-or-null" pattern silently matches nothing
# and resets the clock on every failure -- which would permanently null the
# field and make staleness uncomputable. A previous null simply fails to match
# and falls through to the null default.
prev_field() {
  local v=""
  [ -f "$HEARTBEAT" ] && v=$(sed -n "s/.*\"$1\":[ ]*\"\([^\"]*\)\".*/\"\1\"/p" "$HEARTBEAT" | head -1)
  [ -z "$v" ] && v=null
  echo "$v"
}

counts_json() {
  local cand=0 clus=null prop
  cand=$(cat "$STATE"/candidates/*.jsonl 2>/dev/null | wc -l | tr -d ' ')
  [ -z "$cand" ] && cand=0
  prop=$(count_proposals)
  if [ -f "$STATE/clusters.json" ]; then
    clus=$("$PY" -c 'import json,sys
try:
    d=json.load(open(sys.argv[1]))
    print(len(d.get("clusters",[])) if isinstance(d,dict) else len(d))
except Exception:
    print("null")' "$STATE/clusters.json" 2>/dev/null || echo null)
    [ -z "$clus" ] && clus=null
  fi
  printf '{"candidates":%s,"clusters":%s,"proposals":%s}' "$cand" "$clus" "$prop"
}

write_heartbeat() {
  [ "$WRITE_HEARTBEAT" -eq 1 ] || return 0

  # Three distinct clocks, because "it ran" and "it worked" and "it produced
  # something" are three different questions and collapsing them re-creates the
  # exact rot this file exists to detect: a dashboard that says "last dream:
  # today" forever while the pipeline emits nothing, night after night.
  #
  #   ts            -- this attempt, whatever the outcome (detects: stopped running)
  #   last_clean_run-- last run where every step exited 0 (detects: pipeline broken)
  #   last_success  -- last run that was clean AND grew the proposal count
  #                    (detects: pipeline runs green but produces nothing)
  #
  # All carry forward across later failures; a battery skip never resets them.
  local now prev_success prev_clean
  now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  prev_success=$(prev_field last_success)
  prev_clean=$(prev_field last_clean_run)

  if [ "$STATUS" = "ok" ]; then
    prev_clean="\"$now\""
    # PROP_BEFORE is sampled before the pipeline runs. Requiring real growth is
    # what stops a green-but-empty run from resetting the staleness clock.
    if [ "$(count_proposals)" -gt "${PROP_BEFORE:-0}" ]; then
      prev_success="\"$now\""
    fi
  fi

  local err_json="null"
  [ -n "$ERROR" ] && err_json="\"$(json_escape "$ERROR")\""

  local tmp="$HEARTBEAT.$$.tmp"
  cat > "$tmp" <<EOF
{
  "ts": "$now",
  "status": "$STATUS",
  "last_success": $prev_success,
  "last_clean_run": $prev_clean,
  "proposals_added": $(( $(count_proposals) - ${PROP_BEFORE:-0} )),
  "duration_s": $(( $(date +%s) - START_EPOCH )),
  "counts": $(counts_json),
  "steps": [$STEPS],
  "error": $err_json,
  "host": "$(json_escape "$(hostname -s 2>/dev/null)")",
  "pid": $$
}
EOF
  mv -f "$tmp" "$HEARTBEAT" 2>/dev/null || rm -f "$tmp"
}

cleanup() {
  # Kill the in-flight step and its watchdog FIRST. Without this, terminating
  # the run (launchd stop, shutdown, Ctrl-C) reparents the watchdog subshell to
  # init, where it sleeps out its full budget and then fires
  # `kill -TERM <step_pid>` at a PID that by then may belong to something else
  # entirely. Observed for real: two orphans each holding `sleep 1800`.
  [ -n "$WATCHDOG_PID" ] && kill "$WATCHDOG_PID" 2>/dev/null
  [ -n "$STEP_PID" ] && kill -TERM "$STEP_PID" 2>/dev/null
  write_heartbeat
  [ "$HELD_LOCK" -eq 1 ] && rm -rf "$LOCKDIR"
  return 0
}
# INT/TERM are trapped explicitly so a signalled run still runs cleanup: bash
# does not fire the EXIT trap for an untrapped fatal signal.
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

note_error() { [ -z "$ERROR" ] && ERROR="$1"; log "ERROR: $1"; }

# --- ollama contention -----------------------------------------------------
# Ollama serialises work and holds models in VRAM. With a large model resident
# it does not reject an embedding request -- it STALLS it, silently, until the
# caller times out. That is what turned a healthy cluster.py into a 240 s
# "failure" that looked like a code bug. So: never let two stages' models be
# resident at once, and never start a stage into a known-blocked Ollama.

ollama_resident() {
  # Emits "<name><TAB><vram-gb>" per resident model. Silent on any failure --
  # a missing/broken Ollama simply looks like "nothing resident", and the step
  # itself will report the real error.
  curl -s --max-time 10 "$OLLAMA_URL/api/ps" 2>/dev/null | "$PY" -c '
import json, sys
try:
    ms = json.load(sys.stdin).get("models", [])
except Exception:
    sys.exit(0)
for m in ms:
    print("%s\t%.2f" % (m.get("name", ""), m.get("size_vram", 0) / 1e9))
' 2>/dev/null
}

# keep_alive:0 evicts immediately. /api/generate accepts it for embedding
# models too, so one code path handles both.
ollama_unload() {
  curl -s --max-time 20 "$OLLAMA_URL/api/generate" \
    -d "{\"model\":\"$1\",\"keep_alive\":0}" >/dev/null 2>&1
}

ollama_unload_all() {
  local line name
  ollama_resident > "$STATE/.ollama-ps.$$" 2>/dev/null
  while IFS= read -r line; do
    name="${line%%	*}"
    [ -n "$name" ] && { log "ollama: unloading $name"; ollama_unload "$name"; }
  done < "$STATE/.ollama-ps.$$"
  rm -f "$STATE/.ollama-ps.$$"
}

# Returns 0 when Ollama is clear, 1 when a large model is still parked after
# the wait budget. Waiting is the right move rather than force-evicting: a
# resident model may belong to an interactive session, and Ollama's own
# keep_alive (5 min default) usually clears it without us doing anything.
ollama_preflight() {
  local waited=0 big
  while :; do
    big=$(ollama_resident | awk -F'\t' -v t="$OLLAMA_BIG_GB" '$2+0 >= t {print $1; exit}')
    [ -z "$big" ] && { [ "$waited" -gt 0 ] && log "ollama: clear after ${waited}s"; return 0; }
    if [ "$waited" -ge "$OLLAMA_WAIT_S" ]; then
      OLLAMA_BLOCKER="$big"
      return 1
    fi
    log "ollama: $big resident, waiting (${waited}s/${OLLAMA_WAIT_S}s)"
    sleep 30
    waited=$((waited + 30))
  done
}

# --- (a) AC power gate -----------------------------------------------------
# `pmset -g ps` line 1 is either
#   "Now drawing from 'AC Power'"  or  "Now drawing from 'Battery Power'"
# Match AC positively: if pmset is missing or output is unrecognised we skip,
# which is the safe direction (never drain the battery).

POWER=$(/usr/bin/pmset -g ps 2>/dev/null | head -1)
case "$POWER" in
  *"'AC Power'"*) ;;
  *)
    STATUS="skipped"
    ERROR="not on AC power (pmset: ${POWER:-unavailable})"
    log "on battery, skipping"
    exit 0
    ;;
esac

# --- (b) PID lock ----------------------------------------------------------
# Safe to run alongside an interactive session and alongside a second launchd
# wake-up. If the lock is held by a LIVE process we exit 0 and do NOT write the
# heartbeat -- the live holder owns it, and clobbering it mid-run would report
# a duration and counts that belong to neither run.

if ! mkdir "$LOCKDIR" 2>/dev/null; then
  OTHER=$(cat "$LOCKDIR/pid" 2>/dev/null)
  if [ -n "$OTHER" ] && kill -0 "$OTHER" 2>/dev/null; then
    log "lock held by live pid $OTHER, exiting"
    WRITE_HEARTBEAT=0
    exit 0
  fi
  # Stale lock (holder died, e.g. killed by a forced sleep). Reclaim it.
  log "reclaiming stale lock (pid ${OTHER:-unknown} not running)"
  rm -rf "$LOCKDIR"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    note_error "could not acquire lock"
    exit 0
  fi
fi
HELD_LOCK=1
echo $$ > "$LOCKDIR/pid"

# --- (c) pipeline ----------------------------------------------------------
# Each step is independent and idempotent. A missing or failing step is
# RECORDED and the run continues: cluster/synthesize over yesterday's
# candidates still has value, and stopping early would also stop the heartbeat
# from describing what actually happened.

FAILURES=0
SKIPS=0
RAN=0
# 90 min per step. Sized from MEASURED rates, not guessed, because a cap that
# is merely "generous-sounding" kills the first real run for being slow rather
# than broken -- which then looks like a bug:
#   cluster.py    ~16-30 candidates/sec uncontended -> ~5-9 min COLD for the
#                 full corpus, seconds once the embedding cache is warm.
#   synthesize.py measured 48 s/cluster on `claude -p --model sonnet`
#                 (2026-08-16, live clusters; the old local 30B was ~30 s and
#                 the slowest arm in the A/B once its 43 s load is counted). At
#                 118 clusters that is ~94 min, and it grows linearly with the
#                 corpus. A 30-min cap sat right on top of that.
# Since 2026-08-16 this cap is also the nightly COST cap: synthesis is ~$0.13 a
# cluster on Claude, so 90 min is ~112 clusters is ~$14. Being SIGTERMed here is
# safe -- synthesize.py turns SIGTERM into SystemExit so its dedup index is still
# written, and tomorrow resumes from it rather than re-paying.
# Worst case 4 steps still lands hours before morning from a 03:17 start.
STEP_TIMEOUT="${DREAM_STEP_TIMEOUT_S:-5400}"

# macOS ships no `timeout(1)`. Without a cap, one step blocking forever (a
# stalled Ollama call already cost a 240 s step in testing) would hold the lock
# indefinitely, and every later night would see a LIVE holder and exit 0 --
# silent permanent death. Bound each step so a hang becomes a recorded failure.
run_with_limit() {
  local limit="$1"; shift
  "$@" &
  STEP_PID=$!

  # The watchdog counts in short naps and re-checks its world each time, so it
  # is SELF-TERMINATING: the moment the parent run disappears, it vanishes too.
  # A single long `sleep "$limit"` cannot do this -- killing its subshell leaves
  # the sleep orphaned on init, and a watchdog that outlives its parent
  # eventually fires `kill -TERM` at a PID the OS has since recycled. That was
  # not theoretical: this script left two such orphans during testing.
  # Worst-case orphan lifetime is now one nap.
  local parent=$$
  ( local w=0
    while [ "$w" -lt "$limit" ]; do
      sleep 5; w=$((w + 5))
      kill -0 "$parent" 2>/dev/null || exit 0    # run is gone -> so are we
    done
    kill -TERM "$STEP_PID" 2>/dev/null
    sleep 5
    kill -KILL "$STEP_PID" 2>/dev/null ) >/dev/null 2>&1 &
  WATCHDOG_PID=$!

  local rc
  wait "$STEP_PID"; rc=$?
  kill "$WATCHDOG_PID" 2>/dev/null
  wait "$WATCHDOG_PID" 2>/dev/null
  STEP_PID=""
  WATCHDOG_PID=""
  return $rc
}

run_step() {
  # run_step <name> [soft_exit_code]
  # soft_exit_code marks an ENVIRONMENT condition rather than a defect: the step
  # is recorded as "skipped" and does not count as a failure, so the viz can say
  # "clustering sat this one out" instead of screaming about a broken pipeline.
  # run_step <name> <soft_exit_code|-> [script args...]
  # `-` means "no soft exit code". Args after it go to the SCRIPT, not to us.
  # This shape exists because the two-positional version silently swallowed
  # script flags: `run_step scan.py - --subagents` bound "--subagents" to $soft
  # and never passed it on, so the flag looked applied and did nothing.
  local name="$1" soft="${2:-}"
  shift 2 2>/dev/null || shift $#
  [ "$soft" = "-" ] && soft=""
  local path="$SCRIPTS/$name"
  local t0 dur rc out

  RAN=$((RAN + 1))
  t0=$(date +%s)

  if [ ! -f "$path" ]; then
    rc="missing"
    FAILURES=$((FAILURES + 1))
    note_error "$name is missing from $SCRIPTS (component not built yet?)"
    STEPS="$STEPS${STEPS:+,}{\"name\":\"$name\",\"status\":\"missing\",\"exit\":null,\"duration_s\":0}"
    return 0
  fi

  log "--- $name ---"
  if [ "${name##*.}" = "py" ]; then
    run_with_limit "$STEP_TIMEOUT" "$PY" "$path" "$@"
  else
    run_with_limit "$STEP_TIMEOUT" /bin/bash "$path" "$@"
  fi
  rc=$?
  dur=$(( $(date +%s) - t0 ))

  if [ -n "$soft" ] && [ $rc -eq "$soft" ]; then
    SKIPS=$((SKIPS + 1))
    note_error "$name skipped (exit $rc: environment not ready, retry next run)"
    STEPS="$STEPS${STEPS:+,}{\"name\":\"$name\",\"status\":\"skipped\",\"exit\":$rc,\"duration_s\":$dur}"
  elif [ $rc -ne 0 ]; then
    FAILURES=$((FAILURES + 1))
    note_error "$name exited $rc"
    STEPS="$STEPS${STEPS:+,}{\"name\":\"$name\",\"status\":\"failed\",\"exit\":$rc,\"duration_s\":$dur}"
  else
    log "$name ok (${dur}s)"
    STEPS="$STEPS${STEPS:+,}{\"name\":\"$name\",\"status\":\"ok\",\"exit\":0,\"duration_s\":$dur}"
  fi
  return 0
}

log "dream starting (pid $$, skill $SKILL)"

# Baseline for `proposals_added` / `last_success`. Must be sampled BEFORE the
# pipeline runs -- a cumulative count alone can never distinguish "produced
# something tonight" from "produced something once, months ago".
PROP_BEFORE=$(count_proposals)

# scan.py first: it is the authoritative, Ollama-free stage. Preflighting ahead
# of it would throw away cheap guaranteed work just because a GPU was busy.
# --subagents: enabled 2026-08-16. Subagent transcripts carry assistant
# self-retractions that exist nowhere else (measured: 99.5% absent from the
# parent session's capture). ~91 moments and ~$0.20 a night in steady state.
run_step scan.py - --subagents

# score.py turns the stage-1 funnel into actual candidates. It is the one stage
# that calls out to Claude, and the only stage that can be rate-limited or
# unauthenticated, so exit 1 (every batch failed) is a soft skip: tonight's
# stage-1 output stays on disk and the next run scores it from the cache.
run_step score.py 1

# cluster.py is now the ONLY Ollama stage -- synthesize.py moved to Claude on
# 2026-08-16 (eval/RESULTS.md: 4.45/12 local vs 11.09/12 sonnet), so it needs no
# GPU and must not be gated behind one. Gating it here would skip synthesis
# every night an interactive session happened to hold VRAM, for no reason.
if ollama_preflight; then
  # cluster.py: 0 ok, 1 missing input, 2 Ollama unusable, 130 interrupted.
  # 2 is an environment condition, not a defect -> soft skip.
  run_step cluster.py 2

  # Leave the machine as we found it -- an interactive session at 08:00 should
  # not find last night's dream still holding VRAM.
  ollama_unload_all
else
  SKIPS=$((SKIPS + 1))
  RAN=$((RAN + 1))
  note_error "Ollama busy: $OLLAMA_BLOCKER still resident after ${OLLAMA_WAIT_S}s; embedding requests would stall silently. Skipped clustering, will retry next run."
  STEPS="$STEPS${STEPS:+,}{\"name\":\"cluster.py\",\"status\":\"skipped\",\"exit\":null,\"duration_s\":0}"
fi

# Outside the Ollama gate on purpose. Like score.py this calls Claude, so it is
# rate-limitable: exit 1 is a soft skip and the dedup index means the next run
# re-proposes only the clusters this one did not reach. When clustering was
# skipped it re-reads the previous clusters.json, which is still worth doing.
# --limit bounds the night DELIBERATELY. Without it the run relied on the 90-min
# STEP_TIMEOUT killing it, which is resumable (the dedup index means tomorrow
# picks up where tonight stopped) but reports as a FAILED step -- so the
# dashboard screams about expected behaviour and a real hang looks identical.
# Measured 2026-08-16: ~60 s/cluster typical, 174 s worst. 50 fits inside the
# timeout even at the worst rate, and steady state is only 20-40 new clusters a
# night, so the cap binds only while catching up on a backlog.
run_step synthesize.py 1 --min-occurrences 3 --limit 50

run_step detect-conflicts.sh -

if [ $FAILURES -eq 0 ] && [ $SKIPS -eq 0 ]; then
  STATUS="ok"
elif [ $FAILURES -ge $RAN ]; then
  STATUS="failed"
else
  # Includes the skip-only case: the run was healthy, but a stage sat out, so
  # it must not be reported as a clean night.
  STATUS="partial"
fi

log "dream finished: status=$STATUS failures=$FAILURES skips=$SKIPS of $RAN steps"
exit 0

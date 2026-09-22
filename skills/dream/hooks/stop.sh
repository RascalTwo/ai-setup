#!/bin/bash
# dream: Claude Code `Stop` hook -- opportunistic incremental capture.
#
# Stop fires immediately before Claude concludes a response, i.e. MANY times per
# session. The overwhelmingly common case must be a no-op, so the fast path uses
# shell BUILTINS only (parameter expansion, regex match, arithmetic, `[ -f ]`)
# and forks exactly ONE process -- `stat`, the only thing bash cannot do itself.
# Measured: ~3.4 ms of that is bash startup, which is the hard floor.
#
# This hook is PURE OPTIMIZATION. It only ever moves work earlier. scan.py is
# authoritative and idempotent: if this hook never runs, or fails every single
# time, the nightly dream still produces exactly the same result -- just later
# and in one bigger batch. Never make anything depend on it having run.
#
# Fast path: read stdin -> pull two fields -> compare transcript size against a
# per-session watermark -> exit 0. Only when enough NEW transcript bytes have
# accumulated do we detach a background worker and return immediately.
#
# Env:
#   DREAM_DISABLE         non-empty  -> exit 0 immediately (kill switch)
#   DREAM_MIN_NEW_BYTES   default 65536; 0 forces extraction on any new bytes
#   DREAM_SYNC            1 -> run extraction inline instead of detaching
#                              (used by session-end.sh to sequence before enrichment)
#   DREAM_WRITER          ledger `writer` column, default "stop-hook"

[ -n "$DREAM_DISABLE" ] && exit 0

# Pure parameter expansion. `$(cd "$(dirname "$0")/.." && pwd -P)` would be two
# extra forks (subshell + dirname) on the hottest path in the system; measured
# at ~7 ms of the ~11 ms total. The `/..` is left unresolved on purpose -- the
# filesystem collapses it, and leaving it alone means invoking this through the
# ~/.agents/skills/dream symlink still lands on the same files.
case "$0" in
  */*) SKILL="${0%/*}/.." ;;
  *)   SKILL=".." ;;
esac
STATE="${DREAM_STATE:-$HOME/.agents/state/dream}"

# File kill switch: `[ -f ]` is a builtin, so this costs no fork.
[ -f "$STATE/.disabled" ] && exit 0

# Builtin read of the whole stdin blob. `-d ''` reads to EOF; it returns
# non-zero because no NUL delimiter was found, which is expected.
IFS= read -r -d '' HOOK_JSON

# Verified against Claude Code 2.1.233 by capturing real hook stdin. The Stop
# payload is:
#   session_id, transcript_path, cwd, prompt_id, permission_mode, effort,
#   hook_event_name, stop_hook_active, last_assistant_message,
#   background_tasks, session_crons
# Patterns live in variables because bash 3.2 (what macOS ships) treats quotes
# inside an inline =~ pattern as literal.
re_tp='"transcript_path":[[:space:]]*"([^"]*)"'
re_sid='"session_id":[[:space:]]*"([^"]*)"'

[[ $HOOK_JSON =~ $re_tp ]] || exit 0
TRANSCRIPT="${BASH_REMATCH[1]}"
[[ $HOOK_JSON =~ $re_sid ]] || exit 0
SESSION_ID="${BASH_REMATCH[1]}"

# Reject anything that would let a malformed payload write outside state/.
case "$SESSION_ID" in
  ''|*/*|*..*) exit 0 ;;
esac

MARK_DIR="$STATE/.watermarks"
MARK="$MARK_DIR/$SESSION_ID"
MIN_NEW="${DREAM_MIN_NEW_BYTES-65536}"

# The single fork in the fast path.
SIZE=$(stat -f %z "$TRANSCRIPT" 2>/dev/null) || exit 0
[ -z "$SIZE" ] && exit 0

PREV=0
[ -f "$MARK" ] && read -r PREV < "$MARK"
[ -z "$PREV" ] && PREV=0

# The gate. Everything above this line is the common case.
[ $((SIZE - PREV)) -lt "$MIN_NEW" ] && exit 0

# --- work path (rare) ------------------------------------------------------

mkdir -p "$MARK_DIR" "$STATE/stage1" "$STATE/logs" "$STATE/.locks" 2>/dev/null

# Advance the watermark BEFORE dispatching. This rate-limits: further Stop
# events will not re-trigger until another MIN_NEW bytes accumulate, even while
# the worker is still running. If the worker then fails, we simply lose an
# optimization -- scan.py re-derives it tonight from the ledger watermark.
echo "$SIZE" > "$MARK"

extract() {
  local sid="$1" tp="$2"
  local py="${DREAM_PYTHON:-python3}"
  local prefilter="$SKILL/scripts/prefilter.py"
  local ledger="$STATE/processed.tsv"
  local lockdir="$STATE/.locks/$sid"

  [ -f "$prefilter" ] || { echo "prefilter.py missing" >&2; return 0; }

  # Per-session lock: two writers appending to the same stage1 file would
  # duplicate moments, which inflates cluster occurrence counts and therefore
  # proposal rank. mkdir is atomic.
  mkdir "$lockdir" 2>/dev/null || return 0
  trap 'rm -rf "$lockdir"' RETURN

  # Resume watermark: newest ledger row for this session wins. The ledger is
  # append-only and chronological, so the last matching line is the newest.
  local since
  since=$(grep -F "$sid" "$ledger" 2>/dev/null | tail -1 | cut -f3)

  local out="$lockdir/out.jsonl" summary
  # prefilter.py puts stage-1 moments on stdout and a one-line JSON summary on
  # stderr. `2>&1 >file` sends stderr to the capture and stdout to the file.
  #
  # --skip-captured-agents must match what nightly.sh asks scan.py for. It runs
  # `scan.py --subagents`, so a subagent's own transcript is already mined and a
  # dispatch report in this parent is the same text a second time. stage1/ is
  # append-only and the ledger watermark stops scan.py re-deriving what the hook
  # already wrote, so a duplicate emitted here is permanent.
  if [ -n "$since" ]; then
    summary=$("$py" "$prefilter" "$tp" --session-id "$sid" --since-uuid "$since" \
              --skip-captured-agents 2>&1 >"$out")
  else
    summary=$("$py" "$prefilter" "$tp" --session-id "$sid" --skip-captured-agents 2>&1 >"$out")
  fi

  local re_uuid='"last_uuid":[ ]*"([^"]*)"'
  local re_n='"candidates":[ ]*([0-9]+)'
  local last_uuid="" n=0
  [[ $summary =~ $re_uuid ]] && last_uuid="${BASH_REMATCH[1]}"
  [[ $summary =~ $re_n ]] && n="${BASH_REMATCH[1]}"

  [ -z "$last_uuid" ] && { echo "prefilter gave no last_uuid: $summary" >&2; return 0; }

  [ "$n" -gt 0 ] && [ -s "$out" ] && cat "$out" >> "$STATE/stage1/$sid.jsonl"

  # Ledger row: <session-id>\t<iso8601-utc>\t<last-uuid>\t<count>\t<writer>
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$sid" "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$last_uuid" "$n" \
    "${DREAM_WRITER:-stop-hook}" >> "$ledger"
}

if [ "$DREAM_SYNC" = "1" ]; then
  extract "$SESSION_ID" "$TRANSCRIPT"
else
  # Detach so Claude never waits on us. Verified on 2.1.233: a nohup'd child
  # outlives both the hook timeout and full Claude Code exit.
  ( extract "$SESSION_ID" "$TRANSCRIPT" >>"$STATE/logs/hooks.log" 2>&1 & ) &
fi

exit 0

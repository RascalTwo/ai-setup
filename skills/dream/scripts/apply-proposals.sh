#!/usr/bin/env bash
# dream — turn each new proposal's change.md into a real edit on its dream/ branch.
#
#   usage: apply-proposals.sh [--limit N]     (default: no limit)
#
# synthesize.py writes proposals as prose. Until this step existed nothing applied
# them, so the queue showed no diff and merge-approved.sh had nothing to merge.
# For each pending proposal whose branch doesn't exist yet:
#   propose-branch.sh begin -> headless `claude -p` edits inside that worktree
#   -> propose-branch.sh commit (the repo's pre-commit hook runs there).
#
# Skipped: proposals whose branch already exists (never touch a branch someone may
# have edited), basic-memory-only proposals (a note has no branch; it is written
# on approval), and proposals that already failed once (`apply_error` is set;
# delete that field to retry). A failed attempt is aborted, which deletes the
# branch: safe, because only branches this run just created get here.
#
# Exit: 0 when nothing failed or something succeeded, 1 when every attempt failed
# (nightly.sh treats that as a soft skip, like score.py being rate-limited).
set -uo pipefail

PROG="dream/apply-proposals"
note() { printf '%s: %s\n' "$PROG" "$*" >&2; }

LIMIT=999999
case "${1:-}" in
  --limit) LIMIT="${2:?--limit needs a number}" ;;
  "") ;;
  *) note "usage: $0 [--limit N]"; exit 2 ;;
esac

SCRIPTS=$(cd "$(dirname "$0")" && pwd -P)
STATE="${DREAM_STATE:-$HOME/.agents/state/dream}"
PROPOSALS="$STATE/proposals"
REPO="${DREAM_REPO:-$(git -C "$SCRIPTS" rev-parse --show-toplevel)}"
MODEL="${DREAM_APPLY_MODEL:-sonnet}"
LOGS="$STATE/logs"
mkdir -p "$LOGS"
export DREAM_REPO="$REPO" DREAM_STATE="$STATE"

field() { jq -r --arg k "$2" '.[$k] // empty' "$1"; }

set_error() {  # $1=envelope $2=message
  local tmp="$1.dream.tmp"
  jq --arg e "$2" '.apply_error = $e' "$1" > "$tmp" && mv "$tmp" "$1"
}

# True when every "### " target under the change is a basic-memory:// note.
note_only() {
  local heads
  heads=$(grep -E '^### ' "$1" || true)
  [ -n "$heads" ] && ! grep -qv 'basic-memory://' <<<"$heads"
}

PROMPT_HEAD='Apply the change described below to the files in the current directory, exactly as described.
- Edit or create only the files the change names. Do not touch anything else.
- Skip any section whose target is basic-memory:// (those notes are written elsewhere).
- Do not run git or any other command. Just make the edits and stop.

'

tried=0; ok=0; failed=0
for env_file in "$PROPOSALS"/*.json; do
  [ -f "$env_file" ] || continue
  [ "$tried" -lt "$LIMIT" ] || { note "limit $LIMIT reached; the rest wait for the next run"; break; }
  [ "$(field "$env_file" status)" = "pending" ] || continue
  [ -z "$(field "$env_file" apply_error)" ] || continue
  id=$(field "$env_file" id)
  change="$PROPOSALS/$id.change.md"
  [ -f "$change" ] || continue
  br=$(field "$env_file" branch)
  if [ -n "$br" ] && git -C "$REPO" show-ref --verify --quiet "refs/heads/$br"; then continue; fi
  if note_only "$change"; then note "$id: basic-memory note only, no branch"; continue; fi

  tried=$((tried + 1))
  note "$id: applying"
  if ! begin=$("$SCRIPTS/propose-branch.sh" begin "$id" 2>>"$LOGS/apply.log"); then
    failed=$((failed + 1)); set_error "$env_file" "propose-branch begin failed (see logs/apply.log)"; continue
  fi
  wt=$(sed -n 's/^DREAM_WORKTREE=//p' <<<"$begin")

  # Flags as in synthesize.py's post(): no inherited settings, MCP or slash
  # commands, and DREAM_DISABLE so dream's own hooks stay quiet. Edit tools only.
  if ( cd "$wt" && { printf '%s' "$PROMPT_HEAD"; cat "$change"; } | DREAM_DISABLE=1 claude -p \
         --model "$MODEL" --max-turns 30 \
         --tools "Read,Edit,Write,Glob,Grep" --permission-mode acceptEdits \
         --disable-slash-commands --strict-mcp-config --setting-sources "" \
         >>"$LOGS/apply.log" 2>&1 ) \
     && "$SCRIPTS/propose-branch.sh" commit "$id" >>"$LOGS/apply.log" 2>&1; then
    ok=$((ok + 1)); note "$id: committed on $(field "$env_file" branch)"
  else
    failed=$((failed + 1))
    "$SCRIPTS/propose-branch.sh" abort "$id" >>"$LOGS/apply.log" 2>&1
    set_error "$env_file" "apply failed $(date -u +%Y-%m-%dT%H:%M:%SZ) (see logs/apply.log)"
    note "$id: failed, aborted"
  fi
done

note "applied $ok, failed $failed"
[ "$failed" -gt 0 ] && [ "$ok" -eq 0 ] && exit 1
exit 0

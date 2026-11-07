#!/usr/bin/env bash
# dream — compute conflicts between proposal branches.  LOCAL ONLY, READ ONLY.
#
# For every proposal envelope that has a live dream/ branch, this answers two
# questions with `git merge-tree --write-tree` (a dry-run three-way merge):
#
#   1. does the branch still merge into private/trunk?   -> reported, not stored
#   2. does it merge with each other proposal branch?    -> stored in the
#      envelope's `conflicts_with` array (proposal ids, symmetric, sorted)
#
# `merge-tree --write-tree` writes a result tree into the object database and
# prints its oid. It never reads or writes the index or the working tree, so this
# script is safe to run against a dirty repo, mid-session, in parallel. Nothing
# here checks out, stashes, resets, merges for real, or moves any ref.
#
# Trunk conflicts deliberately do NOT go into `conflicts_with` — that array is
# specified as a list of proposal ids and the viz reads it as such. A branch that
# no longer merges into trunk is handled by merge-approved.sh, which marks it
# stale. Here it is only reported. That is a routine outcome (it happens whenever
# the human commits to trunk between runs), so the default exit stays 0 and the
# nightly orchestrator does not log a false failure; pass --strict to get exit 3.
#
# Envelopes are rewritten only when the computed set actually differs, so repeat
# runs leave file mtimes alone.
set -euo pipefail

PROG="dream/detect-conflicts"
die()  { printf '%s: %s\n' "$PROG" "$*" >&2; exit 1; }
note() { printf '%s: %s\n' "$PROG" "$*" >&2; }

# ── SAFETY GUARD ─────────────────────────────────────────────────────────────
# This repo's pre-push hook converts ANY push into a full public force-publish of
# the whole tree. So: no push, no fetch, no remote, ever, in any code path here.
# The two literals below exist solely to be refused.
TRUNK="private/trunk"
FORBIDDEN_BRANCH="main"                 # publish artifact — never a target here
guard_ref() {
  case "$1" in
    "$FORBIDDEN_BRANCH"|"refs/heads/$FORBIDDEN_BRANCH")
      die "REFUSING: '$1' is the publish-artifact branch and is never a target" ;;
    refs/remotes/*|origin/*|*:*|*@*)
      die "REFUSING: '$1' looks like a remote ref; this script is local-only" ;;
  esac
}
guard_ref "$TRUNK"
# ─────────────────────────────────────────────────────────────────────────────

STRICT=0
case "${1:-}" in
  --strict) STRICT=1 ;;
  "") ;;
  *) die "usage: $0 [--strict]" ;;
esac

command -v jq >/dev/null 2>&1 || die "jq is required"

REPO="${DREAM_REPO:-}"
if [ -z "$REPO" ]; then
  REPO=$(cd "$(dirname "$0")" && git rev-parse --show-toplevel) \
    || die "cannot locate repo root from $0"
fi
STATE="${DREAM_STATE:-$HOME/.agents/state/dream}"
PROPOSALS="$STATE/proposals"

[ "$(git -C "$REPO" rev-parse --symbolic-full-name "$TRUNK" 2>/dev/null || true)" \
  = "refs/heads/$TRUNK" ] || die "no local branch '$TRUNK' in $REPO"
[ -d "$PROPOSALS" ] || die "no proposals directory: $PROPOSALS"

# 0 = merges clean, 1 = conflicts. merge-tree returns >1 on error (e.g. unrelated
# histories); we treat that as a conflict, which is the conservative direction.
mergeable() {  # $1 $2 -> 0 clean / 1 conflicting
  local rc=0
  git -C "$REPO" merge-tree --write-tree --quiet "$1" "$2" >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) return 1 ;;
    *) note "merge-tree exit $rc for '$1' vs '$2' — treating as a conflict"; return 1 ;;
  esac
}

# ── collect proposals that have a live branch ────────────────────────────────
n=0
ids=(); brs=()
missing=""
for env_file in "$PROPOSALS"/*.json; do
  [ -f "$env_file" ] || continue
  id=$(jq -r '.id // empty' "$env_file")
  [ -n "$id" ] || { note "envelope with no id, skipping: $env_file"; continue; }
  br=$(jq -r '.branch // empty' "$env_file")
  [ -z "$br" ] || guard_ref "$br"        # a corrupt envelope must stop the run, not be skipped
  if [ -z "$br" ] || ! git -C "$REPO" show-ref --verify --quiet "refs/heads/$br"; then
    # No branch means nothing to conflict with. Clear the array so a deleted
    # branch does not leave stale ids behind for the viz to render.
    missing="$missing $id"
    cur=$(jq -c '.conflicts_with // []' "$env_file")
    if [ "$cur" != "[]" ]; then
      tmp="$env_file.dream.tmp"
      jq '.conflicts_with = []' "$env_file" > "$tmp" && mv "$tmp" "$env_file"
    fi
    continue
  fi
  case "$br" in
    dream/*) ;;
    *) note "envelope $id names non-dream branch '$br' — skipping"; continue ;;
  esac
  guard_ref "$br"
  ids[$n]="$id"; brs[$n]="$br"; n=$((n + 1))
done

if [ "$n" -eq 0 ]; then
  printf '%s: no proposal branches to evaluate.\n' "$PROG"
  exit 0
fi

# ── 1. each branch against trunk ─────────────────────────────────────────────
trunk_bad=""
i=0
while [ "$i" -lt "$n" ]; do
  if ! mergeable "$TRUNK" "${brs[$i]}"; then
    trunk_bad="$trunk_bad ${ids[$i]}"
  fi
  i=$((i + 1))
done

# ── 2. pairwise ──────────────────────────────────────────────────────────────
pairs=$(mktemp)
trap 'rm -f "$pairs"' EXIT
checks=0
i=0
while [ "$i" -lt "$n" ]; do
  j=$((i + 1))
  while [ "$j" -lt "$n" ]; do
    checks=$((checks + 1))
    if ! mergeable "${brs[$i]}" "${brs[$j]}"; then
      printf '%s\t%s\n' "${ids[$i]}" "${ids[$j]}" >> "$pairs"
      printf '%s\t%s\n' "${ids[$j]}" "${ids[$i]}" >> "$pairs"
    fi
    j=$((j + 1))
  done
  i=$((i + 1))
done

# ── 3. write conflicts_with back, only where it changed ──────────────────────
changed=0
i=0
while [ "$i" -lt "$n" ]; do
  id="${ids[$i]}"
  env_file="$PROPOSALS/$id.json"
  new=$(awk -F'\t' -v k="$id" '$1 == k { print $2 }' "$pairs" | sort -u \
        | jq -R -s -c 'split("\n") | map(select(length > 0))')
  cur=$(jq -c '(.conflicts_with // []) | sort' "$env_file")
  if [ "$new" != "$cur" ]; then
    tmp="$env_file.dream.tmp"
    jq --argjson c "$new" '.conflicts_with = $c' "$env_file" > "$tmp" && mv "$tmp" "$env_file"
    changed=$((changed + 1))
  fi
  i=$((i + 1))
done

# ── summary ──────────────────────────────────────────────────────────────────
printf '\n%s: %d branch(es), %d pairwise check(s), %d envelope(s) updated\n' \
  "$PROG" "$n" "$checks" "$changed"
i=0
while [ "$i" -lt "$n" ]; do
  id="${ids[$i]}"
  with=$(awk -F'\t' -v k="$id" '$1 == k { print $2 }' "$pairs" | sort -u | tr '\n' ' ')
  if [ -n "$with" ]; then
    printf '  CONFLICT  %-16s %s <-> %s\n' "$id" "${brs[$i]}" "$with"
  else
    printf '  clean     %-16s %s\n' "$id" "${brs[$i]}"
  fi
  i=$((i + 1))
done
if [ -n "$missing" ]; then
  printf '  no branch:%s (conflicts_with cleared)\n' "$missing"
fi
if [ -n "$trunk_bad" ]; then
  printf '\n  !! no longer merges into %s:%s\n' "$TRUNK" "$trunk_bad"
  printf '     (not recorded in conflicts_with; merge-approved.sh will mark these stale)\n'
  [ "$STRICT" -eq 1 ] && exit 3
fi
exit 0

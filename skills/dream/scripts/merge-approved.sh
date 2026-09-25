#!/usr/bin/env bash
# dream — squash-merge approved proposals into private/trunk.  LOCAL ONLY.
#
#   usage: merge-approved.sh [--dry-run]
#
# Three passes, in order:
#   1. denied   — delete the branch, keep the envelope at status "denied" so the
#                 dream does not re-propose the same thing forever.
#   2. approved — squash-merge serially in approval order. Before each merge the
#                 branch is re-checked against the *current* trunk with
#                 `git merge-tree --write-tree`; a branch that an earlier merge
#                 broke becomes status "stale" and its branch is deleted. It will
#                 be re-derived on the next run. No rebase loops, no merge queue.
#   3. sweep    — any still-open dream branch that no longer merges into the new
#                 trunk also becomes "stale" and is deleted.
#
# Approval order = `approved_at` when the envelope carries it, else `created`,
# with the proposal id as a stable tiebreak. (See the integrator note: file mtime
# is deliberately NOT used, because detect-conflicts.sh rewrites envelopes.)
#
# Idempotent: a second run finds nothing at status "approved" and does nothing.
#
# Requires a clean tracked tree, because a squash merge happens in the real
# working tree. It REFUSES on a dirty tree rather than stashing — a stash that
# fails to restore would silently eat the user's work.
set -euo pipefail

PROG="dream/merge-approved"
die()  { printf '%s: %s\n' "$PROG" "$*" >&2; exit 1; }
note() { printf '%s: %s\n' "$PROG" "$*" >&2; }

# ── SAFETY GUARD ─────────────────────────────────────────────────────────────
# This repo's pre-push hook converts ANY push into a full public force-publish of
# the whole tree. So: no push, no fetch, no remote, ever, in any code path here.
# The merge target is a single hard-coded local branch; the two literals below
# exist solely to be refused.
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

DRY=0
case "${1:-}" in
  --dry-run|-n) DRY=1 ;;
  "") ;;
  *) die "usage: $0 [--dry-run]" ;;
esac

command -v jq >/dev/null 2>&1 || die "jq is required"

REPO="${DREAM_REPO:-}"
if [ -z "$REPO" ]; then
  REPO=$(cd "$(dirname "$0")" && git rev-parse --show-toplevel) \
    || die "cannot locate repo root from $0"
fi
STATE="${DREAM_STATE:-$HOME/.agents/state/dream}"
PROPOSALS="$STATE/proposals"
GITDIR=$(git -C "$REPO" rev-parse --path-format=absolute --git-dir)

[ -d "$PROPOSALS" ] || die "no proposals directory: $PROPOSALS"

# ── preflight ────────────────────────────────────────────────────────────────
here=$(git -C "$REPO" symbolic-ref --short HEAD 2>/dev/null || true)
[ "$here" = "$TRUNK" ] || die "HEAD is on '$here'; this must run with '$TRUNK' checked out"
guard_ref "$here"

for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG rebase-merge rebase-apply; do
  [ -e "$GITDIR/$f" ] && die "an operation is already in progress ($f) — resolve it first"
done

if [ "$DRY" -eq 0 ] && [ -n "$(git -C "$REPO" status --porcelain --untracked-files=no)" ]; then
  die "working tree has uncommitted tracked changes — refusing.
     Commit or stash them yourself, then re-run. (Re-run with --dry-run to see the plan.)"
fi

git -C "$REPO" worktree prune

# ── helpers ──────────────────────────────────────────────────────────────────
field() { jq -r --arg k "$2" '.[$k] // empty' "$1"; }

set_status() {  # $1=envelope $2=status
  local tmp
  if [ "$DRY" -eq 1 ]; then return 0; fi
  tmp="$1.dream.tmp"
  jq --arg s "$2" '.status = $s' "$1" > "$tmp" && mv "$tmp" "$1"
}

branch_live() { git -C "$REPO" show-ref --verify --quiet "refs/heads/$1"; }

delete_dream_branch() {  # $1=branch — refuses anything outside dream/
  case "$1" in
    dream/*) ;;
    *) die "REFUSING to delete non-dream branch '$1'" ;;
  esac
  guard_ref "$1"
  branch_live "$1" || return 0
  if git -C "$REPO" worktree list --porcelain | grep -Fqx "branch refs/heads/$1"; then
    note "branch '$1' is checked out in a worktree — leaving it alone"
    return 1
  fi
  if [ "$DRY" -eq 1 ]; then return 0; fi
  git -C "$REPO" branch -D "$1" >/dev/null
}

mergeable() {  # $1 $2 -> 0 clean / 1 conflicting. Dry run: no index, no worktree.
  local rc=0
  git -C "$REPO" merge-tree --write-tree --quiet "$1" "$2" >/dev/null 2>&1 || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) return 1 ;;
    *) note "merge-tree exit $rc for '$1' vs '$2' — treating as a conflict"; return 1 ;;
  esac
}

MERGED=""; STALE=""; SKIPPED=""; DENIED=""
add() { eval "$1=\"\$$1 \$2\""; }

# ── pass 1: denied ───────────────────────────────────────────────────────────
for env_file in "$PROPOSALS"/*.json; do
  [ -f "$env_file" ] || continue
  [ "$(field "$env_file" status)" = "denied" ] || continue
  id=$(field "$env_file" id); br=$(field "$env_file" branch)
  [ -z "$br" ] || guard_ref "$br"        # a corrupt envelope must stop the run, not be skipped
  if [ -n "$br" ] && branch_live "$br"; then
    if delete_dream_branch "$br"; then
      if [ "$DRY" -eq 1 ]; then add DENIED "$id(would delete branch)"; else add DENIED "$id(branch deleted)"; fi
    else
      add DENIED "$id(branch held)"
    fi
  else
    add DENIED "$id"
  fi
done

# ── pass 2: approved, serially, in approval order ────────────────────────────
queue=$(mktemp); trap 'rm -f "$queue"' EXIT
for env_file in "$PROPOSALS"/*.json; do
  [ -f "$env_file" ] || continue
  jq -r 'select(.status == "approved")
         | [ (.approved_at // .created // ""), (.id // ""), (.branch // "") ]
         | @tsv' "$env_file" >> "$queue"
done
sort -t "$(printf '\t')" -k1,1 -k2,2 -o "$queue" "$queue"

while IFS="$(printf '\t')" read -r key id br; do
  [ -n "$id" ] || continue
  env_file="$PROPOSALS/$id.json"
  [ -z "$br" ] || guard_ref "$br"        # a corrupt envelope must stop the run, not be skipped
  if [ -z "$br" ] || ! branch_live "$br"; then
    add SKIPPED "$id(no branch)"; continue
  fi
  case "$br" in
    dream/*) ;;
    *) add SKIPPED "$id(branch '$br' outside dream/)"; continue ;;
  esac
  if git -C "$REPO" worktree list --porcelain | grep -Fqx "branch refs/heads/$br"; then
    add SKIPPED "$id(worktree open — someone is editing it)"; continue
  fi

  if ! mergeable "$TRUNK" "$br"; then
    set_status "$env_file" stale
    delete_dream_branch "$br" || true
    add STALE "$id"
    continue
  fi

  if [ "$DRY" -eq 1 ]; then
    add MERGED "$id(would merge)"
    note "dry-run: cannot simulate the effect of this merge on later ones"
    continue
  fi

  if ! git -C "$REPO" merge --squash "$br" >/dev/null 2>&1; then
    git -C "$REPO" reset --hard HEAD >/dev/null    # tree was clean by preflight
    rm -f "$GITDIR/SQUASH_MSG" "$GITDIR/MERGE_MSG"
    note "unexpected: '$br' passed the dry-run check but the squash merge failed"
    set_status "$env_file" stale
    delete_dream_branch "$br" || true
    add STALE "$id(merge failed)"
    continue
  fi

  if git -C "$REPO" diff --cached --quiet; then
    rm -f "$GITDIR/SQUASH_MSG" "$GITDIR/MERGE_MSG"
    set_status "$env_file" merged
    delete_dream_branch "$br" || true
    add MERGED "$id(already in $TRUNK, no-op)"
    continue
  fi

  title=$(field "$env_file" title); [ -n "$title" ] || title="(untitled proposal)"
  tip=$(git -C "$REPO" rev-parse "$br")
  {
    printf 'dream(%s): %s\n\n' "$id" "$title"
    rationale=$(field "$env_file" rationale)
    if [ -n "$rationale" ]; then printf '%s\n\n' "$rationale"; fi
    printf 'Proposal-Id: %s\n'  "$id"
    printf 'Dream-Branch: %s\n' "$br"
    printf 'Squashed-From: %s\n' "$tip"
    printf 'Blast-Radius: %s\n' "$(field "$env_file" blast_radius)"
    printf 'Evidence: %s\n'     "$(jq -r '(.evidence // []) | join(",")' "$env_file")"
    printf 'Approved-By: human (dream viz)\n'
  } | git -C "$REPO" commit --quiet -F -
  rm -f "$GITDIR/SQUASH_MSG" "$GITDIR/MERGE_MSG"

  set_status "$env_file" merged
  delete_dream_branch "$br" || true
  add MERGED "$id->$(git -C "$REPO" rev-parse --short HEAD)"
done < "$queue"

# ── pass 3: sweep every still-open dream branch against the new trunk ────────
for env_file in "$PROPOSALS"/*.json; do
  [ -f "$env_file" ] || continue
  st=$(field "$env_file" status)
  case "$st" in pending|approved) ;; *) continue ;; esac
  id=$(field "$env_file" id); br=$(field "$env_file" branch)
  [ -z "$br" ] || guard_ref "$br"        # a corrupt envelope must stop the run, not be skipped
  [ -n "$br" ] && branch_live "$br" || continue
  case "$br" in dream/*) ;; *) continue ;; esac
  if git -C "$REPO" worktree list --porcelain | grep -Fqx "branch refs/heads/$br"; then
    continue
  fi
  if ! mergeable "$TRUNK" "$br"; then
    set_status "$env_file" stale
    delete_dream_branch "$br" || true
    add STALE "$id(swept)"
  fi
done

# ── summary ──────────────────────────────────────────────────────────────────
show() { if [ -n "$2" ]; then printf '  %-9s%s\n' "$1" "$2"; else printf '  %-9s—\n' "$1"; fi; }
printf '\n%s summary%s\n' "$PROG" "$([ "$DRY" -eq 1 ] && printf ' (DRY RUN — nothing changed)' || true)"
printf '  target   %s @ %s\n' "$TRUNK" "$(git -C "$REPO" rev-parse --short "$TRUNK")"
show "merged"  "$MERGED"
show "stale"   "$STALE"
show "skipped" "$SKIPPED"
show "denied"  "$DENIED"

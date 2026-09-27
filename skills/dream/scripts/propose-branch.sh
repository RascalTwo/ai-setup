#!/usr/bin/env bash
# dream — git mechanics for one proposal branch.  LOCAL ONLY, NEVER ANY REMOTE.
#
# ── THE BOUNDARY: this script does not apply the change ──────────────────────
# state/proposals/<id>.change.md is a natural-language description of a complete,
# ready-to-apply change. Turning it into edits needs a model, so the CALLER (a
# Claude session) applies the edits. This script owns *only* the git mechanics
# around that, split into three steps:
#
#   propose-branch.sh begin  <id>   -> prints an isolated directory; caller edits THERE
#   propose-branch.sh commit <id>   -> commits what the caller wrote, on dream/<id>-<slug>
#   propose-branch.sh abort  <id>   -> throws the attempt away
#
# `begin` emits KEY=VALUE lines on stdout so a caller can `eval` them:
#   DREAM_WORKTREE=<abs dir>   DREAM_BRANCH=<dream/...>
#   DREAM_CHANGE_FILE=<abs>    DREAM_BASE=<sha of private/trunk at branch time>
#
# The isolated directory is a git worktree checked out from private/trunk, kept
# under <git-common-dir>/dream-worktrees/<id>. Consequences that matter:
#   * the user's real working tree is never checked out, stashed, or reset, so
#     this is safe against a dirty tree and safe alongside a live session;
#   * "return to the starting branch" is vacuous here — we never leave it.
#
# State lives at ~/.agents/state/dream/, outside this repo, so nothing under it can
# be staged by accident any more. The guard below stays anyway: state holds verbatim
# excerpts of client work and this repo's tree is published wholesale by a separate,
# human-only process, so a second lock on that door is worth its three lines.
# Staging is by explicit enumerated path, never `git add -A`.
set -euo pipefail

PROG="dream/propose-branch"
die()  { printf '%s: %s\n' "$PROG" "$*" >&2; exit 1; }
note() { printf '%s: %s\n' "$PROG" "$*" >&2; }

# ── SAFETY GUARD ─────────────────────────────────────────────────────────────
# This repo's pre-push hook converts ANY push into a full public force-publish of
# the whole tree. So: no push, no fetch, no remote, ever, in any code path here.
# Every ref this script touches must be a local branch, and must not be the
# publish-artifact branch. The two literals below exist solely to be refused.
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

WT_ROOT="$(git -C "$REPO" rev-parse --path-format=absolute --git-common-dir)/dream-worktrees"

usage() {
  cat >&2 <<EOF
usage: $0 begin|commit|abort <proposal-id>

  begin   create/resume worktree for <id> on its dream/ branch; print where to edit
  commit  stage the caller's edits (explicit paths, never state/) and commit
  abort   discard the worktree and delete the dream/ branch
EOF
  exit 2
}

# Read one field from the envelope, empty if absent.
field() { jq -r --arg k "$2" '.[$k] // empty' "$1"; }

# Set one field in the envelope, only rewriting the file if the value changed.
set_field() {  # $1=envelope $2=key $3=value
  local cur tmp
  cur=$(field "$1" "$2")
  [ "$cur" = "$3" ] && return 0
  tmp="$1.dream.tmp"
  jq --arg k "$2" --arg v "$3" '.[$k] = $v' "$1" > "$tmp" && mv "$tmp" "$1"
}

envelope_for() {  # $1=id  -> echoes path, dies if missing
  local f="$PROPOSALS/$1.json"
  [ -f "$f" ] || die "no envelope: $f"
  printf '%s\n' "$f"
}

# Branch name: the envelope's own `branch` if set, else dream/<id>-<slug-of-title>.
branch_for() {  # $1=id $2=envelope
  local b slug
  b=$(field "$2" branch)
  if [ -z "$b" ]; then
    slug=$(field "$2" title \
      | tr '[:upper:]' '[:lower:]' \
      | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-*//' -e 's/-*$//' \
      | cut -c1-40 | sed -e 's/-*$//')
    [ -n "$slug" ] || slug="proposal"
    b="dream/$1-$slug"
  fi
  case "$b" in
    dream/*) ;;
    *) die "branch '$b' is not under dream/ — refusing" ;;
  esac
  guard_ref "$b"
  printf '%s\n' "$b"
}

cmd_begin() {
  local id="$1" env_file change_file branch wt on
  env_file=$(envelope_for "$id")
  change_file="$PROPOSALS/$id.change.md"
  [ -f "$change_file" ] || die "no change file: $change_file"
  branch=$(branch_for "$id" "$env_file")
  wt="$WT_ROOT/$id"

  git -C "$REPO" worktree prune
  if [ -e "$wt" ]; then
    on=$(git -C "$wt" symbolic-ref --short HEAD 2>/dev/null || true)
    [ "$on" = "$branch" ] \
      || die "worktree $wt is on '$on', expected '$branch' — run: $0 abort $id"
    note "resuming existing worktree for $id"
  else
    mkdir -p "$WT_ROOT"
    if git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch"; then
      note "branch $branch already exists — checking it out to continue"
      git -C "$REPO" worktree add --quiet "$wt" "$branch"
    else
      git -C "$REPO" worktree add --quiet -b "$branch" "$wt" "$TRUNK"
    fi
  fi

  set_field "$env_file" branch "$branch"

  cat >&2 <<EOF
$PROG: proposal $id is ready to apply.

  1. read      $change_file
  2. apply the described edits INSIDE  $wt
     (that directory is a full checkout of $TRUNK — edit real files there,
      do not edit the user's working tree, do not run git in it)
  3. then run  $0 commit $id

EOF
  printf 'DREAM_WORKTREE=%s\n'    "$wt"
  printf 'DREAM_BRANCH=%s\n'      "$branch"
  printf 'DREAM_CHANGE_FILE=%s\n' "$change_file"
  printf 'DREAM_BASE=%s\n'        "$(git -C "$REPO" rev-parse "$TRUNK")"
}

cmd_commit() {
  local id="$1" env_file branch wt on entry st p n sha title rationale
  env_file=$(envelope_for "$id")
  branch=$(branch_for "$id" "$env_file")
  wt="$WT_ROOT/$id"
  [ -d "$wt" ] || die "no worktree for $id — run '$0 begin $id' first"
  on=$(git -C "$wt" symbolic-ref --short HEAD 2>/dev/null || true)
  [ "$on" = "$branch" ] || die "worktree $wt is on '$on', expected '$branch'"
  guard_ref "$on"

  # Stage explicit paths only: enumerate what the caller changed, drop anything
  # under state/, print every path, then add exactly those paths.
  n=0
  paths=()
  while IFS= read -r -d '' entry; do
    st=${entry:0:2}
    p=${entry:3}
    case "$p" in
      skills/dream/state/*|*/skills/dream/state/*)
        note "SKIPPING (state is never committed): $p"; continue ;;
    esac
    case "$st" in
      R*|C*) die "unexpected staged rename/copy '$entry' — the caller should not run git in $wt" ;;
    esac
    paths[$n]="$p"
    n=$((n + 1))
  done < <(git -C "$wt" status --porcelain=v1 -z --untracked-files=all)

  [ "$n" -gt 0 ] || die "no changes in $wt — the caller applied nothing; nothing to commit"
  printf '%s: staging %d path(s):\n' "$PROG" "$n" >&2
  for p in "${paths[@]}"; do printf '    %s\n' "$p" >&2; done
  git -C "$wt" add -- "${paths[@]}"
  if git -C "$wt" diff --cached --quiet; then
    die "nothing staged after filtering — refusing to create an empty commit"
  fi

  title=$(field "$env_file" title);      [ -n "$title" ] || title="(untitled proposal)"
  rationale=$(field "$env_file" rationale)
  {
    printf 'dream(%s): %s\n\n' "$id" "$title"
    if [ -n "$rationale" ]; then printf '%s\n\n' "$rationale"; fi
    printf 'Proposal-Id: %s\n'   "$id"
    printf 'Dream-Branch: %s\n'  "$branch"
    printf 'Dream-Base: %s\n'    "$(git -C "$wt" rev-parse "$TRUNK")"
    printf 'Blast-Radius: %s\n'  "$(field "$env_file" blast_radius)"
    printf 'Occurrences: %s\n'   "$(jq -r '.occurrences // 0' "$env_file")"
    printf 'Evidence: %s\n'      "$(jq -r '(.evidence // []) | join(",")' "$env_file")"
    printf 'Change-File: %s/proposals/%s.change.md\n' "$STATE" "$id"
    printf 'Applied-By: caller (model); committed by %s\n' "$PROG"
  } | git -C "$wt" commit --quiet -F -

  sha=$(git -C "$wt" rev-parse HEAD)
  git -C "$REPO" worktree remove --force "$wt"
  git -C "$REPO" worktree prune

  note "committed $sha on $branch; worktree removed; $TRUNK untouched"
  printf 'DREAM_BRANCH=%s\n' "$branch"
  printf 'DREAM_COMMIT=%s\n' "$sha"
}

cmd_abort() {
  local id="$1" env_file branch wt
  env_file=$(envelope_for "$id")
  branch=$(branch_for "$id" "$env_file")
  wt="$WT_ROOT/$id"

  if [ -e "$wt" ]; then
    git -C "$REPO" worktree remove --force "$wt"
    note "removed worktree $wt"
  fi
  git -C "$REPO" worktree prune

  case "$branch" in
    dream/*) ;;
    *) die "refusing to delete non-dream branch '$branch'" ;;
  esac
  guard_ref "$branch"
  if git -C "$REPO" show-ref --verify --quiet "refs/heads/$branch"; then
    git -C "$REPO" branch -D "$branch" >/dev/null
    note "deleted branch $branch"
  fi
  note "aborted $id"
}

[ $# -eq 2 ] || usage
case "$1" in
  begin)  cmd_begin  "$2" ;;
  commit) cmd_commit "$2" ;;
  abort)  cmd_abort  "$2" ;;
  *) usage ;;
esac

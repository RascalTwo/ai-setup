#!/usr/bin/env bash
# Mirror r2-main onto main as a single squashed commit (local + remote).
#
# main is the PUBLIC face: always exactly ONE parentless commit. r2-main is the
# private working branch (real history) and is never pushed. Each run snapshots
# r2-main's tree into a fresh orphan commit and force-pushes it over main.
set -euo pipefail

SRC=r2-main
DST=main
REMOTE=origin

# --- Auto-select a gh account with push access (see viz-pages/deploy.sh for the why):
# gh's credential helper only serves the ACTIVE account, so pushing main 403s when the active
# account can't write here. Switch to one that can, restore the original on exit. ---
_GH_ORIG=""
gh_pick_pusher() {  # $1 = remote URL
  command -v gh >/dev/null 2>&1 || return 0
  case "$1" in *github.com*) ;; *) return 0 ;; esac
  local nwo acct orig
  nwo="${1#*github.com[:/]}"; nwo="${nwo%.git}"
  [ "$(gh api "repos/$nwo" --jq '.permissions.push' 2>/dev/null)" = "true" ] && return 0
  orig="$(gh api user --jq '.login' 2>/dev/null || true)"
  for acct in $(gh auth status 2>/dev/null | sed -nE 's/.*Logged in to [^ ]+ account ([A-Za-z0-9_-]+).*/\1/p' | sort -u); do
    [ "$acct" = "$orig" ] && continue
    gh auth switch -h github.com -u "$acct" >/dev/null 2>&1 || continue
    if [ "$(gh api "repos/$nwo" --jq '.permissions.push' 2>/dev/null)" = "true" ]; then
      _GH_ORIG="$orig"; echo "  ↳ gh: pushing as $acct (write access to $nwo)${orig:+; restoring $orig after}"; return 0
    fi
  done
  [ -n "$orig" ] && gh auth switch -h github.com -u "$orig" >/dev/null 2>&1 || true
  echo "  ⚠️  no logged-in gh account has write to $nwo — push may 403" >&2
}
gh_restore() { [ -n "$_GH_ORIG" ] && gh auth switch -h github.com -u "$_GH_ORIG" >/dev/null 2>&1 || true; }
trap gh_restore EXIT

# ponytail: orphan snapshot each run — main is a 1-commit mirror, never real history
tree=$(git rev-parse "$SRC^{tree}")
msg="Snapshot of $SRC @ $(git rev-parse --short "$SRC") ($(git log -1 --format=%s "$SRC"))"
commit=$(git commit-tree "$tree" -m "$msg")

git branch -f "$DST" "$commit"
gh_pick_pusher "$(git remote get-url "$REMOTE")"
git push --force "$REMOTE" "$DST"

echo "main -> $commit"

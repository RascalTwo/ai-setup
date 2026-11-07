#!/bin/bash
# Throwaway copies of a repo for a walkthrough: <dir>/now at <head> and <dir>/before at <base>.
# Plain local clones, so the source repo is only read (no worktree is registered in it).
# Usage: clone-pair.sh <repo> <head> <base> <dir>. Re-running resets both copies to those commits.
set -euo pipefail
repo=$1 head=$2 base=$3 dir=$4
mkdir -p "$dir"
for side in now before; do
  rev=$head; [ "$side" = before ] && rev=$base
  sha=$(git -C "$repo" rev-parse --verify "$rev^{commit}")
  [ -d "$dir/$side/.git" ] || git clone -q --no-checkout "$repo" "$dir/$side"
  git -C "$dir/$side" fetch -q "$repo" "$sha" 2>/dev/null || true
  git -C "$dir/$side" checkout -q --force --detach "$sha"
  git -C "$dir/$side" clean -qfd -e node_modules
  echo "$side: $(git -C "$dir/$side" log -1 --format='%h %s')"
done

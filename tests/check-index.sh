#!/usr/bin/env bash
# The pre-commit check must judge the index git is committing. `git commit -- <paths>` stages into a temporary index
# and points GIT_INDEX_FILE at it; the check used to drop that variable, saw an empty index and passed everything
# ("nothing to check"). This stages one change into a temporary index only (the real one is untouched) and expects
# the check to see it. `bash tests/check-index.sh`
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# Start from HEAD, not the real index: whatever else is staged (this test included) would otherwise be checked too,
# and a staged copy of this test makes the inner check run it again, recursively.
GIT_INDEX_FILE="$T/index" git -C "$REPO" read-tree HEAD
blob=$( (cat "$REPO/skills/browser/SKILL.md"; printf '\n') | git -C "$REPO" hash-object -w --stdin)
GIT_INDEX_FILE="$T/index" git -C "$REPO" update-index --cacheinfo "100644,$blob,skills/browser/SKILL.md"

out=$(cd "$REPO" && GIT_INDEX_FILE="$T/index" bun scripts/check.ts --staged 2>&1)
if grep -q 'skills check: skills/browser' <<<"$out"; then
  echo "ok: the check judged the commit's own index"
else
  echo "FAIL: the check ignored GIT_INDEX_FILE. It printed:"; echo "$out" | head -5; exit 1
fi

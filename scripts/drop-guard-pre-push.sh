#!/usr/bin/env bash
# private trunk, public drop — pre-push guard.
#
# The invariant this enforces: everything public is ONE parentless (orphan) commit.
# `private/trunk` holds the real history and is never pushed; `main` is a fresh
# orphan snapshot force-pushed over the last one.
#
# Three independent checks, cheapest first:
#   1. name    — refuse any ref under private/          (blocks the obvious mistake)
#   2. shape   — commit must have no parents            (blocks publishing real history)
#   3. content — tree must not match drop.blockPaths    (blocks publishing the wrong tree)
#
# Checks 2 and 3 are NOT redundant. A repo whose public branch is a subset of the
# working tree (e.g. main is README-only) can produce a parentless commit that
# still contains everything — shape passes, content catches it. Set the posture
# explicitly per repo, never inferred:
#
#   git config drop.blockPaths '^(viz-pages|repo-issue-scanner)/'
#
# Unset drop.blockPaths = full-tree posture (ai-setup, explorables, snippets).
# Deliberate override: git push --no-verify
#
# LOCAL ONLY (.git/hooks, per-clone). Reinstall with scripts/install-drop-guard.sh.
set -euo pipefail

remote="$1"
ZERO='0000000000000000000000000000000000000000'
BLOCK_RE="$(git config --get drop.blockPaths || true)"
status=0

while read -r local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$ZERO" ] && continue   # branch deletion — nothing to inspect
  short="$(git rev-parse --short "$local_sha")"

  case "$local_ref" in
    refs/heads/private/*)
      # Auto-publish: pushing the trunk means "publish", so just do it. We must STILL
      # exit non-zero afterwards — a pre-push hook can only veto, never redirect, so
      # exiting 0 here would let git push the trunk itself right after. The "failed to
      # push" git then prints is expected and is not a failure of the drop.
      publish="$(git rev-parse --show-toplevel)/squash-to-main.sh"
      if [ -n "${DROP_GUARD_PUBLISHING:-}" ]; then
        echo "❌ pre-push BLOCKED: $local_ref — refusing to push a trunk from inside a publish." >&2
      elif [ -x "$publish" ]; then
        echo "🔒 $local_ref is private — publishing a public drop instead:" >&2
        if DROP_GUARD_PUBLISHING=1 "$publish" >&2; then
          echo "✅ Drop published to main. Your commit history stayed local." >&2
          echo "   The 'failed to push some refs' below is DELIBERATE — git can only veto a" >&2
          echo "   push, not redirect one, so the original trunk push is aborted by design." >&2
        else
          echo "❌ squash-to-main.sh failed — nothing was published." >&2
        fi
      else
        {
          echo "❌ pre-push BLOCKED: $local_ref is a private trunk — it must never leave this machine."
          echo "   This repo has no squash-to-main.sh (subset posture — it publishes a subset"
          echo "   of the tree, so there is no safe automatic drop). Publish it deliberately."
          echo "   Override: git push --no-verify"
        } >&2
      fi
      status=1; continue ;;
  esac

  if git rev-parse -q --verify "${local_sha}^" >/dev/null 2>&1; then
    {
      echo "❌ pre-push BLOCKED: $short ($local_ref -> ${remote_ref:-?}) has a parent."
      echo "   Public refs must be exactly ONE orphan commit — this would publish real history."
      echo "   Publish with ./squash-to-main.sh instead. Override: git push --no-verify"
    } >&2
    status=1; continue
  fi

  if [ -n "$BLOCK_RE" ] && git ls-tree -r --name-only "$local_sha" | grep -qE "$BLOCK_RE"; then
    {
      echo "❌ pre-push BLOCKED: $short ($local_ref -> ${remote_ref:-?}) contains local-only content."
      echo "   Tree matches drop.blockPaths ($BLOCK_RE) — this repo publishes a subset only."
      echo "   Override: git push --no-verify"
    } >&2
    status=1; continue
  fi
done

exit "$status"

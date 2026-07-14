#!/usr/bin/env bash
# Deploy this repo's viz-pages to its static host. The host (GitHub / GitLab
# Pages) is auto-detected from `origin`, so this same script drops into any repo.
#
# Runs from ANY repo state or branch: it reads viz-pages off disk and builds into
# a throwaway dir — it never depends on a clean working tree. (The clean-tree
# guard lives in the central orchestrator, deploy-all.ts, not here.)
#
# Exit 0 = deployed (or CI triggered), 1 = failed. Set DRY_RUN=1 to build only.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"                       # the viz-pages dir
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
REMOTE="$(git -C "$HERE" remote get-url origin)"
BUILD="$HOME/.claude/skills/viz/build.ts"

# --- Auto-select a gh account with push access, so deploying never needs a manual
# `gh auth switch`. gh's git-credential helper only serves the ACTIVE account's token, so a
# push 403s when the active account lacks write here. gh_pick_pusher switches to a logged-in
# account that HAS write (saving the original in _GH_ORIG); gh_restore puts it back — wired
# into the EXIT trap. No-op without gh, or if the active account is already good. ---
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

case "$REMOTE" in
  *github.com*)
    slug="${REMOTE#*github.com[:/]}"; slug="${slug%.git}"
    owner="$(echo "${slug%%/*}" | tr '[:upper:]' '[:lower:]')"; repo="${slug#*/}"
    base="https://${owner}.github.io/${repo}"
    out="$(mktemp -d)"; trap 'rm -rf "$out"; gh_restore' EXIT
    bun "$BUILD" "$HERE" --out "$out" --base-url "$base"
    touch "$out/.nojekyll"                                  # skip GitHub's Jekyll pass
    [ -n "${DRY_RUN:-}" ] && { echo "(dry-run) built → $out, not pushing"; exit 0; }
    # Force-push the built site as a fresh orphan history on gh-pages.
    git -C "$out" init -q -b gh-pages
    git -C "$out" add -A
    git -C "$out" -c user.email=deploy@local -c user.name=deploy commit -qm "Deploy viz pages"
    gh_pick_pusher "$REMOTE"
    git -C "$out" push -f "$REMOTE" gh-pages:gh-pages
    echo "✅ ${base}/"
    ;;
  *gitlab.com*)
    # GitLab Pages can't take an orphan-branch push — it needs a CI `pages:` job
    # that serves a committed public/. So build into public/, commit, and push;
    # CI publishes. (Other CI jobs firing as a side effect is accepted.)
    slug="${REMOTE#*gitlab.com[:/]}"; slug="${slug%.git}"
    group="$(echo "${slug%%/*}" | tr '[:upper:]' '[:lower:]')"; repo="${slug##*/}"
    base="https://${group}.gitlab.io/${repo}"
    bun "$BUILD" "$HERE" --out "$ROOT/public" --base-url "$base"
    [ -n "${DRY_RUN:-}" ] && { echo "(dry-run) built → $ROOT/public, not committing/pushing"; exit 0; }
    git -C "$ROOT" add public
    git -C "$ROOT" -c user.email=deploy@local -c user.name=deploy commit -qm "Deploy viz pages" \
      || echo "(public/ unchanged — nothing to commit)"
    trap gh_restore EXIT
    gh_pick_pusher "$REMOTE"
    git -C "$ROOT" push origin HEAD
    echo "✅ pushed — GitLab CI pages job will publish ${base}/"
    ;;
  *)
    echo "❌ unrecognized origin host: $REMOTE" >&2; exit 1
    ;;
esac

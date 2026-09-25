#!/usr/bin/env bash
# One-off: move tool state out of ~/.claude into ~/.agents/state/<tool>/.
#
# This is deliberately NOT part of install.ts. The installer describes the
# current setup; it is not a museum of every layout this repo has had. Run this
# once per machine that predates the move, then delete your interest in it.
#
# Idempotent and non-destructive: it moves, never copies-then-deletes, skips
# anything already migrated, and refuses to overwrite an existing destination.
set -uo pipefail

STATE="$HOME/.agents/state"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
moved=0; skipped=0

move() {  # move <src> <dest>
  local src="$1" dest="$2"
  if [ ! -e "$src" ]; then printf '  – %-44s not present\n' "~${src#$HOME}"; skipped=$((skipped+1)); return; fi
  if [ -e "$dest" ]; then printf '  ! %-44s destination exists, left alone\n' "~${src#$HOME}"; skipped=$((skipped+1)); return; fi
  mkdir -p "$(dirname "$dest")"
  mv "$src" "$dest"
  printf '  ✓ %-44s → %s\n' "~${src#$HOME}" "~${dest#$HOME}"
  moved=$((moved+1))
}

echo "== ttyimgspool =="
move "$HOME/.claude/ttyimgspool"           "$STATE/ttyimgspool"
echo "== herdr-autolabel =="
move "$HOME/.claude/herdr-autolabel"       "$STATE/herdr-autolabel"
echo "== statusline =="
move "$HOME/.claude/usage-share.json"      "$STATE/statusline/usage-share.json"
move "$HOME/.claude/usage-scan-memo.json"  "$STATE/statusline/usage-scan-memo.json"
move "$HOME/.claude/usage-share.lock"      "$STATE/statusline/usage-share.lock"

echo "== skills =="
move "$HOME/.cache/aws-sso-creds"          "$STATE/aws-sso-creds"
move "$HOME/.claude/fleet"                 "$STATE/fleet"
move "$HOME/.cache/rnv"                    "$STATE/read-video-locally/cache"
move "$HOME/.crv/memory.db"                "$STATE/read-video-locally/memory.db"
move "$HOME/.claude/pipeline-runs"         "$STATE/r2-sdlc"        # r2-gauntlet shares this store
move "$HOME/.viz-pages"                    "$STATE/viz"
move "$HOME/.claude/viz-pages"             "$STATE/viz"            # the older of viz's two legacy roots

# Only our own caches move out of these two. ~/.okta/okta.yaml and ~/.ping/ping.yaml
# are the Okta and PingOne CLIs' config, not ours, and stay exactly where they are.
move "$HOME/.okta/spec-cache"              "$STATE/okta-api/spec-cache"
move "$HOME/.ping/spec-cache"              "$STATE/ping-api/spec-cache"
move "$HOME/.ping/token-cache.json"        "$STATE/ping-api/token-cache.json"

# dream's state was inside the repo, held out of git by a nested .gitignore. It holds
# verbatim excerpts of client work and this tree is published, so outside is safer.
move "$REPO/skills/dream/state"            "$STATE/dream"

printf '\n%d moved, %d skipped.\n' "$moved" "$skipped"

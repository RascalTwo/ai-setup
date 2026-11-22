#!/usr/bin/env bash
# install.ts overlay-manifest check. Runs against a throwaway $HOME, so it never
# touches the real one. `bash tests/overlays.sh`
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT

# One overlay plus a stray: a repo whose skills/ holds two, and a live link from a
# source the manifest never mentions.
mkdir -p "$T/.agents/skills" "$T/many/skills/alpha" "$T/many/skills/beta" "$T/nowhere/skills/ghost"
ln -s "$T/nowhere/skills/ghost" "$T/.agents/skills/ghost"
cat > "$T/.agents/overlays.json" <<JSON
{ "overlays": ["~/many"] }
JSON

out="$(HOME="$T" node "$REPO/install.ts" --list 2>&1)"
pass=0; fail=0
ok(){ printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  ❌ %s\n' "$1"; fail=$((fail+1)); printf '%s\n' "$out"; }

grep -q "  alpha$"          <<<"$out" && ok "links every dir under skills/"     || no "missed skills/alpha"
grep -q "  beta$"           <<<"$out" && ok "links more than the first"        || no "missed skills/beta"
grep -q "$T/many  — 2"      <<<"$out" && ok "counts an overlay's skills"       || no "wrong count"
grep -q "$T/many"           <<<"$out" && ok "~ expands to \$HOME"              || no "tilde not expanded"
grep -q "NOT IN ANY SOURCE" <<<"$out" && ok "stray reported"                   || no "stray not reported"
grep -q "    ghost ->"      <<<"$out" && ok "stray names its real source"      || no "stray source missing"

# --externals restores from every root's skills-lock.json, overlays included. --dry-run installs nothing.
cat > "$T/many/skills-lock.json" <<JSON
{ "version": 2, "skills": { "find-skills": { "source": "vercel-labs/skills", "sourceType": "github", "skillPath": "skills/find-skills/SKILL.md", "computedHash": "x" } } }
JSON
out="$(HOME="$T" node "$REPO/install.ts" --externals --dry-run 2>&1)"
grep -q "$T/many"                       <<<"$out" && ok "--externals visits an overlay's skills-lock.json" || no "overlay lock not read"
grep -q "find-skills from vercel-labs"  <<<"$out" && ok "--dry-run lists the locked skill"                || no "locked skill not listed"
[ ! -e "$T/.agents/skills/find-skills" ]            && ok "--dry-run installs nothing"                     || no "dry run installed"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

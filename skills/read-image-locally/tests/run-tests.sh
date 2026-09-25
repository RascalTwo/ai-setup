#!/usr/bin/env bash
# Verification harness for the read-image-locally skill engine.
# Run from anywhere:  bash tests/run-tests.sh
# Env: LV_MODELS (default gemma4:e4b).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$HERE/.." && pwd)"
ENGINE="$SKILL_DIR/vision_judge.py"
ASSET="$HERE/assets/hud.png"
MODELS="${LV_MODELS:-gemma4:e4b}"

pass=0; fail=0
ok()   { printf '  ✅ %s\n' "$1"; pass=$((pass+1)); }
no()   { printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }
hdr()  { printf '\n=== %s ===\n' "$1"; }

hdr "1. Engine — success path (structured extraction)"
if out="$(python3 "$ENGINE" "$ASSET" --prompt 'Extract the SCORE and LIVES numbers.' --models "$MODELS" 2>/dev/null)"; then
  printf '%s\n' "$out" | grep -q '\[read-image-locally OK\]' && ok "emits OK header" || no "missing OK header"
  printf '%s\n' "$out" | grep -q '42' && ok "extracted SCORE 42" || no "did not extract 42 (got: $(printf '%s' "$out" | tail -1))"
else
  no "engine exited non-zero on a valid image"
fi

hdr "2. Engine — failure path (bad model → LOCAL_VISION_FAILED, non-zero exit)"
out="$(python3 "$ENGINE" "$ASSET" --models 'definitely-not-a-real-model:zzz' 2>/dev/null)"; rc=$?
[ "$rc" -ne 0 ] && ok "non-zero exit ($rc)" || no "expected non-zero exit"
printf '%s\n' "$out" | grep -q 'LOCAL_VISION_FAILED' && ok "prints LOCAL_VISION_FAILED" || no "missing LOCAL_VISION_FAILED"

printf '\n=== summary: %d passed, %d failed ===\n' "$pass" "$fail"
[ "$fail" -eq 0 ]

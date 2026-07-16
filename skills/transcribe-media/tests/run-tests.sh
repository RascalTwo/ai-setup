#!/usr/bin/env bash
# Tests for transcribe-media. Builds a spoken fixture with `say`, transcribes it,
# and asserts the words come back. Also checks the failure path.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../transcribe.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

# --- fixture: a known sentence spoken by macOS `say`, wrapped as a tiny mp4 (video path too)
say -o "$work/clip.aiff" "the quick brown fox jumps over the lazy dog"
ffmpeg -y -loglevel error -f lavfi -i color=c=black:s=64x64 -i "$work/clip.aiff" \
  -shortest -pix_fmt yuv420p "$work/clip.mp4"

# --- test 1: transcription returns the txt path on stdout and contains the spoken words
txt=$("$script" "$work/clip.mp4" --format txt --language en | tail -1)
[ -f "$txt" ] || fail "no transcript file at reported path: $txt"
grep -qi "fox"  "$txt" || fail "transcript missing 'fox' — got: $(cat "$txt")"
grep -qi "lazy" "$txt" || fail "transcript missing 'lazy' — got: $(cat "$txt")"
echo "PASS: transcribes audio from a video file and returns the txt path"

# --- test 2: intermediate wav removed by default, kept with --keep-wav
[ ! -f "$work/clip.transcript-turbo/audio.wav" ] || fail "audio.wav should be removed by default"
"$script" "$work/clip.mp4" --format txt --language en --keep-wav >/dev/null
[ -f "$work/clip.transcript-turbo/audio.wav" ] || fail "--keep-wav should retain audio.wav"
echo "PASS: --keep-wav toggles wav retention"

# --- test 3: failure path exits non-zero with TRANSCRIBE_FAILED
if out=$("$script" "$work/does-not-exist.mp4" 2>&1); then
  fail "expected non-zero exit on missing file"
fi
echo "$out" | grep -q "TRANSCRIBE_FAILED" || fail "expected TRANSCRIBE_FAILED marker, got: $out"
echo "PASS: failure path exits non-zero with TRANSCRIBE_FAILED"

echo "ALL TESTS PASSED"

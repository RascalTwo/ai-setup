#!/usr/bin/env bash
# Tests for transcribe-media. Builds a spoken fixture, transcribes it, and asserts
# the words come back. Also checks the failure path.
#
# Runs on macOS and on Windows under Git Bash. The only platform-specific part is
# synthesising the fixture: `say` on macOS, System.Speech on Windows.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
# TRANSCRIBE_CMD overrides the launcher, e.g. a venv's python + transcribe.py on the PC.
script=${TRANSCRIBE_CMD:-"$here/../transcribe.sh"}
py=${TEST_PYTHON:-python3}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() { echo "FAIL: $1" >&2; exit 1; }

SENTENCE="the quick brown fox jumps over the lazy dog"

# --- fixture: a known sentence spoken by the OS, wrapped as a tiny mp4 (video path too)
case "$(uname -s)" in
  Darwin)
    clip_audio="$work/clip.aiff"
    say -o "$clip_audio" "$SENTENCE"
    ;;
  *)
    # Windows: System.Speech ships with .NET on every desktop SKU.
    clip_audio="$work/clip.wav"
    win_out=$(cygpath -w "$clip_audio" 2>/dev/null || echo "$clip_audio")
    powershell -NoProfile -Command "
      Add-Type -AssemblyName System.Speech
      \$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
      \$s.SetOutputToWaveFile('$win_out')
      \$s.Speak('$SENTENCE')
      \$s.Dispose()" >/dev/null
    [ -s "$clip_audio" ] || fail "could not synthesise a spoken fixture on this platform"
    ;;
esac

ffmpeg -y -loglevel error -f lavfi -i color=c=black:s=64x64 -i "$clip_audio" \
  -shortest -pix_fmt yuv420p "$work/clip.mp4"

# --- unit tests: engine order and the Parakeet -> Whisper converter (no model needed)
"$py" "$here/test_convert.py" 2>&1 | tail -1 | grep -qx OK || { "$py" "$here/test_convert.py"; fail "unit tests"; }
echo "PASS: unit tests (engine order, converter, writers)"

# --- failure path exits non-zero with TRANSCRIBE_FAILED
if out=$($script "$work/does-not-exist.mp4" 2>&1); then
  fail "expected non-zero exit on missing file"
fi
echo "$out" | grep -q "TRANSCRIBE_FAILED" || fail "expected TRANSCRIBE_FAILED marker, got: $out"
echo "PASS: failure path exits non-zero with TRANSCRIBE_FAILED"

# Screen recorders write mic/system/room to separate tracks; ffmpeg's default stream pick takes
# only one, so a real meeting silently transcribed as near-silence (and hallucinated a loop).
# Fixture mirrors that: track 0 silent, the words only on track 1.
ffmpeg -y -loglevel error -f lavfi -i color=c=black:s=64x64 \
  -f lavfi -i anullsrc=r=44100:cl=mono -i "$clip_audio" \
  -map 0:v -map 1:a -map 2:a -shortest -pix_fmt yuv420p "$work/multi.mp4"
ntracks=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$work/multi.mp4" | wc -l | tr -d ' ')
[ "$ntracks" -eq 2 ] || fail "fixture should have 2 audio tracks, has $ntracks"
# 20 s of silence: Whisper's home turf for hallucinating; must not be a failure.
ffmpeg -y -loglevel error -f lavfi -i anullsrc=r=16000:cl=mono -t 20 "$work/silence.wav"

# --- every installed engine gets the same behavioural checks
ran=0
for engine in parakeet-mlx mlx_whisper parakeet whisper.cpp; do
  if ! txt=$($script "$work/clip.mp4" --engine "$engine" --format all --language en --output-dir "$work/$engine" 2>"$work/$engine.err" | tail -1); then
    grep -qE "not found|needs a model file" "$work/$engine.err" && { echo "SKIP: $engine not installed (or no model)"; continue; }
    fail "$engine errored: $(cat "$work/$engine.err")"
  fi
  ran=$((ran + 1))
  grep -qi "fox"  "$txt" || fail "$engine: transcript missing 'fox' — got: $(cat "$txt")"
  grep -qi "lazy" "$txt" || fail "$engine: transcript missing 'lazy' — got: $(cat "$txt")"
  for ext in txt srt vtt tsv json; do [ -s "$work/$engine/clip.$ext" ] || fail "$engine: no clip.$ext"; done
  "$py" - "$work/$engine/clip.json" <<'PY' || fail "$engine: json is not Whisper-shaped"
import json, sys
r = json.load(open(sys.argv[1], encoding="utf-8"))
assert r["language"] == "en" and r["text"].strip(), r
words = [w for s in r["segments"] for w in s["words"]]
assert all({"id", "start", "end", "text"} <= s.keys() for s in r["segments"])
assert any("fox" in w["word"].lower() for w in words), words
assert all(w["start"] <= w["end"] for w in words)
PY
  case "$engine" in parakeet*)
    [ -s "$work/$engine/clip.parakeet.json" ] || fail "$engine: raw clip.parakeet.json not kept" ;;
  esac
  [ ! -f "$work/$engine/audio.wav" ] || fail "$engine: audio.wav should be removed by default"
  $script "$work/clip.mp4" --engine "$engine" --format txt --language en --output-dir "$work/$engine" --keep-wav >/dev/null 2>&1
  [ -f "$work/$engine/audio.wav" ] || fail "$engine: --keep-wav should retain audio.wav"
  txt=$($script "$work/multi.mp4" --engine "$engine" --format txt --language en --output-dir "$work/$engine-multi" 2>/dev/null | tail -1)
  grep -qi "fox" "$txt" || fail "$engine: words on track 1 were lost — got: $(cat "$txt")"
  $script "$work/silence.wav" --engine "$engine" --format txt --language en --output-dir "$work/$engine-silence" >/dev/null 2>&1 \
    || fail "$engine: pure silence should not be a failure"
  echo "PASS: $engine — words, all five formats, Whisper-shaped json, --keep-wav, multi-track, silence"
done
[ "$ran" -gt 0 ] || fail "no engine installed to test"

# --- auto picks the first installed engine; a Whisper --model still gets Whisper
if [ -n "$(command -v parakeet-mlx)" ] && [ -n "$(command -v mlx_whisper)" ]; then
  $script "$work/clip.mp4" --format txt --language en --output-dir "$work/auto" 2>&1 >/dev/null | grep -q "engine=parakeet-mlx" \
    || fail "auto should pick parakeet-mlx first"
  $script "$work/clip.mp4" --format txt --language en --output-dir "$work/auto-w" --model mlx-community/whisper-large-v3-turbo 2>&1 >/dev/null \
    | grep -q "engine=mlx_whisper" || fail "a Whisper --model should route to mlx_whisper"
  $script "$work/clip.mp4" --format txt --language ja --output-dir "$work/auto-ja" 2>&1 >/dev/null | grep -q "engine=mlx_whisper" \
    || fail "a language Parakeet lacks should route to mlx_whisper"
  echo "PASS: auto order, --model family routing, non-European language fallback"
fi

echo "ALL TESTS PASSED"

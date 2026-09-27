#!/usr/bin/env bash
# Tests for transcribe-media. Builds a spoken fixture, transcribes it, and asserts
# the words come back. Also checks the failure path.
#
# Runs on macOS and on Windows under Git Bash. The only platform-specific part is
# synthesising the fixture: `say` on macOS, System.Speech on Windows.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
script="$here/../transcribe.sh"
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

# --- test 1: transcription returns the txt path on stdout and contains the spoken words
txt=$("$script" "$work/clip.mp4" --format txt --language en | tail -1)
[ -f "$txt" ] || fail "no transcript file at reported path: $txt"
grep -qi "fox"  "$txt" || fail "transcript missing 'fox' — got: $(cat "$txt")"
grep -qi "lazy" "$txt" || fail "transcript missing 'lazy' — got: $(cat "$txt")"
echo "PASS: transcribes audio from a video file and returns the txt path"

# --- test 2: intermediate wav removed by default, kept with --keep-wav.
# The output folder is named after the model, which differs per engine, so take it
# from the path the script actually reported rather than hardcoding a tag.
outdir=$(dirname "$txt")
[ ! -f "$outdir/audio.wav" ] || fail "audio.wav should be removed by default"
"$script" "$work/clip.mp4" --format txt --language en --keep-wav >/dev/null
[ -f "$outdir/audio.wav" ] || fail "--keep-wav should retain audio.wav"
echo "PASS: --keep-wav toggles wav retention"

# --- test 3: failure path exits non-zero with TRANSCRIBE_FAILED
if out=$("$script" "$work/does-not-exist.mp4" 2>&1); then
  fail "expected non-zero exit on missing file"
fi
echo "$out" | grep -q "TRANSCRIBE_FAILED" || fail "expected TRANSCRIBE_FAILED marker, got: $out"
echo "PASS: failure path exits non-zero with TRANSCRIBE_FAILED"

# --- test 4: speech on a non-default audio track still gets transcribed.
# Screen recorders write mic/system/room to separate tracks; ffmpeg's default stream pick takes
# only one, so a real meeting silently transcribed as near-silence (and hallucinated a loop).
# Fixture mirrors that: track 0 silent, the words only on track 1.
ffmpeg -y -loglevel error -f lavfi -i color=c=black:s=64x64 \
  -f lavfi -i anullsrc=r=44100:cl=mono -i "$clip_audio" \
  -map 0:v -map 1:a -map 2:a -shortest -pix_fmt yuv420p "$work/multi.mp4"
ntracks=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$work/multi.mp4" | wc -l | tr -d ' ')
[ "$ntracks" -eq 2 ] || fail "fixture should have 2 audio tracks, has $ntracks"
txt=$("$script" "$work/multi.mp4" --format txt --language en | tail -1)
grep -qi "fox" "$txt" || fail "words on track 1 were lost — got: $(cat "$txt")"
echo "PASS: transcribes speech carried on a non-default audio track"

echo "ALL TESTS PASSED"

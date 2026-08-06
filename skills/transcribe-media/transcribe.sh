#!/usr/bin/env bash
# transcribe-media — speech → text from a local audio/video file, via Mac-optimized MLX Whisper.
# Prints a success header, then the path to the .txt transcript on the last line.
# On failure prints `TRANSCRIBE_FAILED …` and exits non-zero.
set -euo pipefail

MODEL="mlx-community/whisper-large-v3-turbo"
OUTDIR=""
FORMAT="all"
LANGUAGE=""          # empty => auto-detect
KEEP_WAV=0
declare -a EXTRA     # any extra flags passed straight through to mlx_whisper

usage() {
  cat >&2 <<'EOF'
Usage: transcribe.sh <media-file> [options] [-- <extra mlx_whisper flags>]
  --model <hf-repo>     MLX Whisper model (default: mlx-community/whisper-large-v3-turbo)
                        Accuracy over speed: mlx-community/whisper-large-v3
  --output-dir <dir>    Where to write outputs (default: <media-dir>/<stem>.transcript-<tag>/)
  --format <fmt>        txt|vtt|srt|tsv|json|all (default: all)
  --language <code>     e.g. en. Omit to auto-detect (specifying is faster + avoids misdetection).
  --keep-wav            Keep the intermediate 16k mono wav (default: always removed, even on failure).
Anything after `--` is forwarded verbatim to mlx_whisper (e.g. --condition-on-previous-text False).
EOF
  exit 2
}

[ $# -ge 1 ] || usage
MEDIA="$1"; shift
while [ $# -gt 0 ]; do
  case "$1" in
    --model) MODEL="$2"; shift 2;;
    --output-dir) OUTDIR="$2"; shift 2;;
    --format) FORMAT="$2"; shift 2;;
    --language) LANGUAGE="$2"; shift 2;;
    --keep-wav) KEEP_WAV=1; shift;;
    --) shift; EXTRA+=("$@"); break;;
    -h|--help) usage;;
    *) echo "TRANSCRIBE_FAILED unknown option: $1" >&2; exit 2;;
  esac
done

command -v ffmpeg     >/dev/null || { echo "TRANSCRIBE_FAILED ffmpeg not found (brew install ffmpeg)" >&2; exit 1; }
command -v mlx_whisper >/dev/null || { echo "TRANSCRIBE_FAILED mlx_whisper not found (brew install mlx_whisper)" >&2; exit 1; }
[ -f "$MEDIA" ] || { echo "TRANSCRIBE_FAILED no such file: $MEDIA" >&2; exit 1; }

dir=$(dirname "$MEDIA"); base=$(basename "$MEDIA"); stem="${base%.*}"
# short tag from the model name for the folder + a stable output name
tag="${MODEL##*/}"; tag="${tag#whisper-}"; tag="${tag#large-v3-}"; tag="${tag:-model}"
[ -n "$OUTDIR" ] || OUTDIR="$dir/$stem.transcript-$tag"
mkdir -p "$OUTDIR"
wav="$OUTDIR/audio.wav"
# The wav is a large (100+ MB/hr) derived artifact. Clean it up on EVERY exit — success,
# failure, or interrupt — not just the happy path: the failure exits below are exactly the
# ones that used to strand it. --keep-wav opts out (and keeps the reuse check above useful).
cleanup() { [ "$KEEP_WAV" -eq 1 ] || rm -f "$wav"; }
trap cleanup EXIT

# Normalize any audio/video input to 16k mono wav (Whisper's native rate). Idempotent.
# Mixes EVERY audio track (screen recorders put mic/system/room on separate tracks; ffmpeg's
# default stream pick silently takes only one) and levels the result to broadcast loudness —
# Whisper hallucinates repetition loops on far-field audio recorded much below ~-30 dB.
if [ ! -f "$wav" ] || [ "$MEDIA" -nt "$wav" ]; then
  na=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$MEDIA" | wc -l | tr -d ' ')
  [ "${na:-0}" -ge 1 ] || { echo "TRANSCRIBE_FAILED no audio stream in $base" >&2; exit 1; }
  labels=""; for ((i=0; i<na; i++)); do labels+="[0:a:$i]"; done
  echo "[transcribe-media] extracting 16k mono wav from $base (mixing $na audio track(s), normalizing loudness) ..." >&2
  ffmpeg -y -loglevel error -i "$MEDIA" \
    -filter_complex "${labels}amix=inputs=$na:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[a]" \
    -map "[a]" -ac 1 -ar 16000 "$wav" \
    || { echo "TRANSCRIBE_FAILED ffmpeg could not decode audio from $base" >&2; exit 1; }
fi

lang_args=(); [ -n "$LANGUAGE" ] && lang_args=(--language "$LANGUAGE")
# Whisper feeds each window's output back as the next window's prompt, which is what lets a
# repetition loop sustain itself once it starts. Off by default: real recordings loop without it
# even after normalization. Listed before EXTRA so `-- --condition-on-previous-text True` re-enables.
echo "[transcribe-media] transcribing with $MODEL ..." >&2
mlx_whisper "$wav" \
  --model "$MODEL" \
  --output-dir "$OUTDIR" --output-name "$stem" \
  --output-format "$FORMAT" --word-timestamps True \
  --condition-on-previous-text False \
  ${lang_args[@]+"${lang_args[@]}"} ${EXTRA[@]+"${EXTRA[@]}"} \
  > "$OUTDIR/whisper.log" 2>&1 \
  || { echo "TRANSCRIBE_FAILED mlx_whisper errored — see $OUTDIR/whisper.log" >&2; tail -3 "$OUTDIR/whisper.log" >&2; exit 1; }

# Report the transcript in the requested format (all/txt -> .txt; else the format's ext).
case "$FORMAT" in all|txt) ext=txt;; *) ext="$FORMAT";; esac
out="$OUTDIR/$stem.$ext"
[ -f "$out" ] || out=$(ls "$OUTDIR/$stem".* 2>/dev/null | grep -Ev '\.(wav|log)$' | head -1 || true)
[ -n "$out" ] && [ -f "$out" ] || { echo "TRANSCRIBE_FAILED no transcript produced — see $OUTDIR/whisper.log" >&2; exit 1; }

txt="$OUTDIR/$stem.txt"

# Did Whisper get stuck repeating one line? That's its silence-hallucination failure ("Next."
# x1992). The output still LOOKS healthy — right size, plausible segment count, evenly spaced
# timestamps — so only the words give it away. Real transcripts here top out at ~36 repeats in
# a row; stuck ones start at ~180. Fail rather than hand back garbage that reads as success.
if [ -f "$txt" ]; then
  stuck=$(awk '
    /^[[:space:]]*$/ {next}
    { n++; if ($0==prev) run++; else {run=1; prev=$0}
      if (run>max) {max=run; line=$0} }
    END { if (n>=20 && max>=50) printf "%d|%s", max, line }
  ' "$txt")
  if [ -n "$stuck" ]; then
    echo "TRANSCRIBE_FAILED transcript is stuck repeating itself: \"${stuck#*|}\" x${stuck%%|*} in a row" >&2
    echo "  Whisper looped instead of transcribing — usually near-silent or unintelligible audio." >&2
    echo "  Audio was already track-mixed and loudness-normalized, so try in order:" >&2
    echo "    1. --model mlx-community/whisper-large-v3  (more robust than turbo)" >&2
    echo "    2. check the recording actually has audible speech" >&2
    echo "  Partial output kept for inspection: $txt  (add --keep-wav to also keep the audio)" >&2
    exit 1
  fi
fi

words=$([ -f "$txt" ] && wc -w < "$txt" | tr -d ' ' || echo '?')
echo "[transcribe-media OK] model=$MODEL words=$words format=$FORMAT -> ${out##*/}" >&2
echo "$out"

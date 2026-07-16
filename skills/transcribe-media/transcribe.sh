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
  --keep-wav            Keep the intermediate 16k mono wav (default: removed on success).
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

# Normalize any audio/video input to 16k mono wav (Whisper's native rate). Idempotent.
if [ ! -f "$wav" ] || [ "$MEDIA" -nt "$wav" ]; then
  echo "[transcribe-media] extracting 16k mono wav from $base ..." >&2
  ffmpeg -y -loglevel error -i "$MEDIA" -vn -ac 1 -ar 16000 "$wav" \
    || { echo "TRANSCRIBE_FAILED ffmpeg could not decode audio from $base" >&2; exit 1; }
fi

lang_args=(); [ -n "$LANGUAGE" ] && lang_args=(--language "$LANGUAGE")
echo "[transcribe-media] transcribing with $MODEL ..." >&2
mlx_whisper "$wav" \
  --model "$MODEL" \
  --output-dir "$OUTDIR" --output-name "$stem" \
  --output-format "$FORMAT" --word-timestamps True \
  ${lang_args[@]+"${lang_args[@]}"} ${EXTRA[@]+"${EXTRA[@]}"} \
  > "$OUTDIR/whisper.log" 2>&1 \
  || { echo "TRANSCRIBE_FAILED mlx_whisper errored — see $OUTDIR/whisper.log" >&2; tail -3 "$OUTDIR/whisper.log" >&2; exit 1; }

# Report the transcript in the requested format (all/txt -> .txt; else the format's ext).
case "$FORMAT" in all|txt) ext=txt;; *) ext="$FORMAT";; esac
out="$OUTDIR/$stem.$ext"
[ -f "$out" ] || out=$(ls "$OUTDIR/$stem".* 2>/dev/null | grep -Ev '\.(wav|log)$' | head -1 || true)
[ -n "$out" ] && [ -f "$out" ] || { echo "TRANSCRIBE_FAILED no transcript produced — see $OUTDIR/whisper.log" >&2; exit 1; }

[ "$KEEP_WAV" -eq 1 ] || rm -f "$wav"
txt="$OUTDIR/$stem.txt"
words=$([ -f "$txt" ] && wc -w < "$txt" | tr -d ' ' || echo '?')
echo "[transcribe-media OK] model=$MODEL words=$words format=$FORMAT -> ${out##*/}" >&2
echo "$out"

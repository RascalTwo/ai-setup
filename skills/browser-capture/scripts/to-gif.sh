#!/bin/bash
# to-gif.sh <in.mp4|webm> <out.gif> [width=800] [fps=15] [colors=128]
#
# Video -> GIF with a two-pass palette (palettegen + paletteuse in one ffmpeg call).
# One palette per clip beats ffmpeg's default 256-colour global palette: UI text stays crisp
# and the file is a fraction of the size. Prints frame count, size and dimensions.
set -euo pipefail
IN="${1:?usage: to-gif.sh <in.mp4|webm> <out.gif> [width=800] [fps=15] [colors=128]}"
OUT="${2:?usage: to-gif.sh <in.mp4|webm> <out.gif> [width] [fps] [colors]}"
W="${3:-800}" FPS="${4:-15}" COLORS="${5:-128}"
command -v ffmpeg >/dev/null || { echo "ffmpeg not on PATH" >&2; exit 1; }
ffmpeg -y -loglevel error -i "$IN" -vf \
  "fps=$FPS,scale=$W:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=$COLORS:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" \
  "$OUT"
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames,width,height -of csv=p=0 "$OUT" | tr ',' ' ' \
  | awk -v b="$(wc -c < "$OUT" | tr -d ' ')" '{print $3" frames, "$1"x"$2", "b" bytes"}'

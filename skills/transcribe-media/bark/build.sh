#!/usr/bin/env bash
# One-command (re)build of the Bark 3.0 Pro engine: a pinned venv plus the weights.
#   bash bark/build.sh            build what is missing
#   REBUILD=1 bash bark/build.sh  start over
# macOS: MLX venv plus weights converted to MLX layout. Elsewhere (the PC, in Git Bash): CUDA PyTorch venv plus the
# vendor's safetensors as they are. Everything lands in $TRANSCRIBE_MEDIA_BARK (default ~/.cache/transcribe-media/bark);
# model/.complete marks success.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
home=${TRANSCRIBE_MEDIA_BARK:-$HOME/.cache/transcribe-media/bark}
PRO=ConwayResearch/Underdog-Bark-3.0-Pro; PRO_REV=4b5c51e04aa8d16dda9ecdff71bc29f7360149e4
BASE=ConwayResearch/Underdog-Bark-3.0;     BASE_REV=85db2ad18ab41e534a222ee253c29191d77ed919  # macOS: tokenizer files only
export PATH="$HOME/.local/bin:$PATH"
if [ "$(uname -s)" = Darwin ]; then py="$home/venv/bin/python"; else py="$home/venv/Scripts/python.exe"; fi
[ "${REBUILD:-}" = 1 ] && rm -rf "$home"
mkdir -p "$home"
[ -x "$py" ] || uv venv -q --python 3.12 "$home/venv"
if [ "$(uname -s)" = Darwin ]; then
  uv pip install -q --python "$py" mlx==0.32.2 mlx-audio==0.5.3 numpy==2.4.6 soundfile==0.14.0 huggingface_hub
else
  # The +cu128 pin and the lone index matter: uv ranks an extra index above --index-url, which got the CPU wheel from PyPI.
  uv pip install -q --python "$py" torch==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128
  uv pip install -q --python "$py" transformers==5.19.0 numpy==2.4.6 librosa==0.11.0 soundfile==0.14.0 huggingface_hub
fi
if [ ! -f "$home/model/.complete" ]; then
  rm -rf "$home/model" "$home/src"
  "$py" - "$home" "$PRO" "$PRO_REV" "$BASE" "$BASE_REV" "$(uname -s)" <<'PY'
import sys
from huggingface_hub import snapshot_download
home, pro, pro_rev, base, base_rev, system = sys.argv[1:]
if system == "Darwin":
    snapshot_download(pro, revision=pro_rev, local_dir=f"{home}/src/pro", allow_patterns=["model.safetensors"])
    snapshot_download(base, revision=base_rev, local_dir=f"{home}/src/base", allow_patterns=["mlx/*"])
else:
    snapshot_download(pro, revision=pro_rev, local_dir=f"{home}/model",
                      allow_patterns=["model.safetensors", "config.json", "generation_config.json", "processor_config.json",
                                      "tokenizer.json", "tokenizer_config.json"])
PY
  if [ "$(uname -s)" = Darwin ]; then
    "$py" "$here/bark.py" convert "$home/src/pro" "$home/src/base/mlx" "$home/model"
    rm -rf "$home/src"
  fi
  touch "$home/model/.complete"
fi
echo "bark ready: $home (Pro @ $PRO_REV)"

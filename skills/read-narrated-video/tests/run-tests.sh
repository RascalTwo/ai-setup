#!/bin/bash
# Self-check for read-narrated-video. Builds tiny narrated + silent clips, then exercises the
# fast/cheap parts of the engine (no heavy Qwen3-VL load). Run after changing narrate_video.py.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

# --- build fixtures: known narration + a moving box, plus a silent copy --------------------------
say -v Samantha -o "$T/n.aiff" "The red box appears now. Watch it slide to the right." 2>/dev/null \
  || fail "macOS 'say' unavailable"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$T/n.aiff")
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=white:s=320x180:d=$DUR \
  -f lavfi -i color=c=red:s=40x40:d=$DUR \
  -filter_complex "[0][1]overlay=x='(W-40)*t/${DUR%.*}':y=70" -pix_fmt yuv420p "$T/m.mp4"
ffmpeg -hide_banner -loglevel error -i "$T/m.mp4" -i "$T/n.aiff" -c:v copy -c:a aac -shortest "$T/narrated.mp4"
ffmpeg -hide_banner -loglevel error -i "$T/m.mp4" -c copy "$T/silent.mp4"

# --- 1. silence detection: narrated has speech, silent does not ----------------------------------
python3 - "$HERE/narrate_video.py" "$T/narrated.mp4" "$T/silent.mp4" <<'PY' || fail "has_speech"
import importlib.util, sys
spec = importlib.util.spec_from_file_location("nv", sys.argv[1]); nv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nv)
assert nv.has_speech(sys.argv[2]) is True,  "narrated clip should have speech"
assert nv.has_speech(sys.argv[3]) is False, "silent clip should NOT have speech"
print("ok: has_speech narrated=True silent=False")
PY

# --- 2. whisper word-timestamps actually come back -----------------------------------------------
python3 - "$HERE/narrate_video.py" "$T/narrated.mp4" <<'PY' || fail "transcribe"
import importlib.util, sys
spec = importlib.util.spec_from_file_location("nv", sys.argv[1]); nv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nv)
words = nv.transcribe(sys.argv[2], "large-v3-turbo")
assert len(words) >= 5, f"expected several words, got {len(words)}"
assert all("start" in w and "word" in w for w in words), "words need start+word"
assert any("box" in w["word"].lower() for w in words), "should hear 'box'"
print(f"ok: transcribe -> {len(words)} word-stamps")
PY

# --- 3. prompt construction for all three modes --------------------------------------------------
python3 - "$HERE/narrate_video.py" <<'PY' || fail "build_prompt"
import importlib.util, sys
spec = importlib.util.spec_from_file_location("nv", sys.argv[1]); nv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nv)
w = [{"start":0.1,"end":0.3,"word":"box"}]
assert "VERIFY" in nv.build_prompt(w, None, False),        "narrated mode -> verify"
assert "specific question" in nv.build_prompt(w, "Q?", False), "narrated+question appends Q"
sq = nv.build_prompt([], "Q?", False)
assert "Q?" in sq and "per-frame" in sq, "silent+question uses the question + enumeration framing"
assert "timestamped description" in nv.build_prompt([], None, True), "timeline -> dense caption"
try:
    nv.build_prompt([], None, False); assert False, "silent+no-question should exit"
except SystemExit as e:
    assert "RNV_FAILED" in str(e)
print("ok: build_prompt covers narrated / +question / silent / timeline / fail")
PY

# --- 4. fallback: missing file -> RNV_FAILED, non-zero --------------------------------------------
if python3 "$HERE/narrate_video.py" "$T/nope.mp4" >"$T/out" 2>&1; then
  fail "missing file should exit non-zero"
fi
grep -q "RNV_FAILED" "$T/out" || fail "missing file should print RNV_FAILED"
echo "ok: missing-file fallback -> RNV_FAILED"

# --- 5. montage prompt: neutral sensor contract, never leads the verdict -------------------------
python3 - "$HERE/narrate_video.py" <<'PY' || fail "montage_prompt"
import importlib.util, sys
spec = importlib.util.spec_from_file_location("nv", sys.argv[1]); nv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nv)
p = nv.montage_prompt("Rate the plate brightness.", 12)
assert "Rate the plate brightness." in p, "caller question must be carried through"
assert "exactly 12" in p and "integer" in p, "must enforce 12 bare integers"
assert not any(w in p.lower() for w in ("gradual", "sudden", "snap")), "prompt must NOT leak a verdict"
assert "9" in nv.montage_prompt(None, 9), "default prompt honours the tile count"
print("ok: montage_prompt is a neutral per-tile sensor contract")
PY

# --- 6. montage builder: trims the static tail; hard cut -> STEP, fade -> RAMP --------------------
# Tests the frame trim/sample/tile logic (the part that was buggy), measured with PIL — no model.
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=160x120:d=1.5 \
  -f lavfi -i color=c=0x00ff00:s=160x120:d=1.5 \
  -filter_complex "[0:v][1:v]concat=n=2:v=1[v]" -map "[v]" -pix_fmt yuv420p "$T/snap.mp4"
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=0x00ff00:s=160x120:d=3 \
  -vf "fade=t=in:st=0:d=3" -pix_fmt yuv420p "$T/fade.mp4"
python3 - "$HERE/narrate_video.py" "$T/snap.mp4" "$T/fade.mp4" "$T/mont.png" <<'PY' || fail "build_montage"
import importlib.util, sys
from PIL import Image
spec = importlib.util.spec_from_file_location("nv", sys.argv[1]); nv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(nv)
def transitional(video):  # count montage tiles that are mid-green (neither dark nor full)
    cnt = nv.build_montage(video, sys.argv[4], "4x3", None)
    im = Image.open(sys.argv[4]).convert("RGB")
    tw, pad = 280, 6; th = round(tw * 120 / 160)  # source 160x120, no crop
    vals = []
    for n in range(cnt):
        c, r = n % 4, n // 4
        x = pad + c * (tw + pad) + tw // 2; y = pad + r * (th + pad) + th // 2
        vals.append(round(im.getpixel((x, y))[1] / 25.5))
    return vals, sum(1 for v in vals if 2 <= v <= 8)
sv, st = transitional(sys.argv[2]); fv, ft = transitional(sys.argv[3])
print(f"snap montage {sv} transitional={st}")
print(f"fade montage {fv} transitional={ft}")
assert st <= 2, f"hard cut should yield ~0 transitional tiles, got {st}: {sv}"
assert ft >= 4, f"fade should yield several transitional tiles, got {ft}: {fv}"
assert ft > st, "fade montage must show more transitional tiles than a hard cut"
print("ok: build_montage trims tail -> step(cut) vs ramp(fade)")
PY

echo "ALL TESTS PASSED"

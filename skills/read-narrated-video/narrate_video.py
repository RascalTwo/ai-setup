#!/usr/bin/env python3
"""read-narrated-video: understand a video locally and return TEXT (~0 Claude vision tokens).

Splits the job across two local models on a shared timeline (seconds into the clip):
  - Whisper  hears the English voice track  -> word-level timestamped transcript
  - Qwen3-VL (via mlx-vlm) sees the picture  -> reasons over sampled frames, each stamped
The transcript is fed to Qwen3-VL as timestamped text context, so "spoken X at 0:42" lines up
with "frame at 0:42 shows Y". A vision-only model thus behaves like an audio+video model.

TWO modes, auto-detected from the audio track:
  1. Narrated  (audio present): the narration BECOMES the query list — each spoken comment is
     verified against the video. No hand-authored question needed.
  2. Silent    (no/empty audio, e.g. an agent's own screen-capture): Whisper is skipped; the
     caller's --question (or dense captioning) drives the model. This is how an agent verifies
     motion-over-time it can't judge from a single screenshot.

On any hard failure prints 'RNV_FAILED ...' and exits non-zero — the caller should then extract
frames with ffmpeg and read them natively (the local-vision sibling policy).
"""
import argparse, json, subprocess, sys, tempfile, os, re

SILENCE_DB = -50.0  # mean_volume at/below this (or no audio stream) => treat as silent


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def has_speech(video: str) -> bool:
    """True if the video has an audio stream that isn't effectively silent."""
    probe = run(["ffprobe", "-v", "error", "-select_streams", "a",
                 "-show_entries", "stream=codec_type", "-of", "csv=p=0", video])
    if "audio" not in probe.stdout:
        return False
    vd = run(["ffmpeg", "-hide_banner", "-i", video, "-af", "volumedetect", "-f", "null", "-"])
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", vd.stderr)
    return bool(m) and float(m.group(1)) > SILENCE_DB


def transcribe(video: str, whisper_model: str) -> list:
    """Word-level timestamped transcript via OpenAI whisper. Returns list of {start,end,word}."""
    with tempfile.TemporaryDirectory() as d:
        r = run(["whisper", video, "--model", whisper_model, "--language", "en",
                 "--word_timestamps", "True", "--output_format", "json", "--output_dir", d])
        if r.returncode != 0:
            raise RuntimeError(f"whisper failed: {r.stderr[-400:]}")
        jf = os.path.join(d, os.path.splitext(os.path.basename(video))[0] + ".json")
        data = json.load(open(jf))
    return [w for s in data.get("segments", []) for w in s.get("words", [])]


def fmt_ts(sec: float) -> str:
    return f"{int(sec) // 60}:{int(sec) % 60:02d}.{int((sec % 1) * 10)}"


def build_prompt(words: list, question: str | None, timeline: bool) -> str:
    """Shape the Qwen3-VL prompt. Video models are prompt-driven — never a generic caption."""
    if words:
        lines = " ".join(w["word"].strip() for w in words)
        # compact per-word timeline so the model can ground deictic words ("here"/"this")
        stamps = " ".join(f"[{fmt_ts(w['start'])}]{w['word'].strip()}" for w in words)
        head = (
            "A person is narrating this video. Below is their speech, first as plain text, then "
            "word-by-word with [m:ss.t] timestamps that share this clip's timeline.\n\n"
            f"NARRATION: {lines}\n\nTIMED: {stamps}\n\n"
            "Treat each spoken comment as a claim to VERIFY against the video. For each claim, "
            "state the timestamp, what was said, and whether the frames at that time confirm or "
            "contradict it. Describe the actual on-screen motion over time, not just static frames."
        )
        if question:
            head += f"\n\nAlso answer this specific question: {question}"
        return head
    if question:
        # Enumeration framing matters more than model size: asking the model to walk the frames
        # one by one before judging stops it from lazily summarizing fast motion as a "teleport".
        return (question + "\n\nFirst walk through the timestamped frames in order and note the "
                "position/state of the relevant subject in EACH frame. Only after that per-frame "
                "pass, answer — grounding the answer in how things change from frame to frame.")
    if timeline:
        return ("Give a timestamped description of the notable events and on-screen motion in this "
                "video. Use [m:ss] markers. Focus on what CHANGES over time (movement, appearance, "
                "disappearance, transitions), not a static description of any single frame.")
    raise SystemExit("RNV_FAILED: silent video and no --question given; pass --question or --timeline")


def _generate(media_args: list, prompt: str, model: str, max_tokens: int) -> str:
    """Run mlx_vlm.generate over --video or --image and return just the assistant's answer."""
    r = run([sys.executable, "-m", "mlx_vlm.generate", "--model", model, *media_args,
             "--max-tokens", str(max_tokens), "--temperature", "0",
             "--repetition-penalty", "1.05",  # guard: quantized model can degenerate into repeats on dense frames
             "--prompt", prompt])
    if r.returncode != 0:
        raise RuntimeError(f"mlx_vlm.generate failed: {r.stderr[-600:]}")
    out = r.stdout
    # the CLI echoes the prompt then the answer after the assistant turn; keep only the answer
    if "<|im_start|>assistant" in out:
        out = out.split("<|im_start|>assistant", 1)[1].lstrip("\n")
    # strip any trailing generation-stats block the CLI may append
    out = re.split(r"\n=+\s*\n(?:Files:|Prompt:)|\nPrompt:\s*\d", out)[0]
    return out.strip()


def ask_qwen(video: str, prompt: str, model: str, fps: float, max_tokens: int) -> str:
    return _generate(["--video", video, "--fps", str(fps)], prompt, model, max_tokens)


def build_montage(video: str, out_png: str, tiles: str, crop: str | None) -> int:
    """Sample frames evenly across the clip, optionally crop to an ROI, number them, and tile into
    one image. Returns the tile count. A montage turns a brief/fine TEMPORAL change into a SPATIAL
    one — Qwen3-VL reads a grid of stills far more reliably than it resolves a fast transition in
    the video path (where a short event gets averaged into a static-looking gist)."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        raise RuntimeError("montage needs Pillow: pip install pillow")
    cols, rows = (int(x) for x in tiles.lower().split("x"))
    count = cols * rows
    with tempfile.TemporaryDirectory() as d:
        # ponytail: extract all frames then subsample — fine for short capture clips; for a long
        # video add an `fps=` pre-filter to cap extraction.
        r = run(["ffmpeg", "-hide_banner", "-i", video, "-vsync", "0",
                 os.path.join(d, "f_%05d.png")])
        frames = sorted(f for f in os.listdir(d) if f.endswith(".png"))
        if len(frames) < count:
            raise RuntimeError(f"montage: only {len(frames)} frames, need >= {count} for {tiles}")
        # Trim the settled tail before sampling: a brief transition (often early) must FILL the grid,
        # not get 2 tiles while a long static tail wastes the other 10 (which makes the model invent
        # a ramp across near-duplicate tiles). Find where motion stops via frame-to-frame diff, keep a
        # short hold, then sample within [0, settle+hold].
        grays = [Image.open(os.path.join(d, f)).convert("L").resize((32, 32)).tobytes() for f in frames]
        def mad(a, b):
            return sum(abs(x - y) for x, y in zip(a, b)) / len(a)
        diffs = [mad(grays[i - 1], grays[i]) for i in range(1, len(grays))]
        peak = max(diffs) if diffs else 0.0
        # last frame whose change exceeds 12% of the peak change = the motion's settle point
        settle = max((i + 1 for i, dv in enumerate(diffs) if dv > peak * 0.12), default=len(frames) - 1)
        end = min(len(frames) - 1, settle + max(2, count // 6))
        # Sample WITHIN the active window even if it's shorter than the grid — a snap has only ~2
        # distinct states, so duplicating them (6 black + 6 green) is the CORRECT step signature.
        # Falling back to the full clip here would re-bury the transition.
        window = frames[: end + 1] if end >= 1 else frames
        idx = [round(i * (len(window) - 1) / (count - 1)) for i in range(count)]
        frames = window
        box = None
        if crop:  # ffmpeg-style "W:H:X:Y" -> PIL (left, upper, right, lower)
            w, h, x, y = (int(v) for v in crop.split(":"))
            box = (x, y, x + w, y + h)
        tiles_img, tw, th = [], 280, None
        for n, i in enumerate(idx, 1):
            im = Image.open(os.path.join(d, frames[i])).convert("RGB")
            if box:
                im = im.crop(box)
            if th is None:
                th = round(tw * im.height / im.width)
            im = im.resize((tw, th))
            dr = ImageDraw.Draw(im)
            try:
                font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", round(th * 0.22))
            except Exception:
                font = ImageFont.load_default()
            label = str(n)
            dr.rectangle([2, 2, 6 + dr.textlength(label, font=font), 4 + round(th * 0.24)], fill="black")
            dr.text((5, 2), label, fill="yellow", font=font)
            tiles_img.append(im)
    pad = 6
    canvas = Image.new("RGB", (cols * tw + (cols + 1) * pad, rows * th + (rows + 1) * pad), "white")
    for n, im in enumerate(tiles_img):
        c, rr = n % cols, n // cols
        canvas.paste(im, (pad + c * (tw + pad), pad + rr * (th + pad)))
    canvas.save(out_png)
    return count


def montage_prompt(question: str | None, count: int) -> str:
    """Neutral, NON-leading prompt. The model is a SENSOR (per-tile reading), never the judge —
    naming a verdict ("snap"/"gradual") or the expected levels makes it parrot the framing instead
    of reading pixels. The caller computes the verdict from the returned trajectory."""
    grid = (f"This is a grid of {count} numbered frames of one scene in time order (tile 1 = "
            f"earliest; read left-to-right, top-to-bottom).")
    if question:
        # caller says WHAT to measure per tile; we enforce the bare-integer sensor contract
        return (f"{grid}\n\n{question}\n\nFor EACH tile 1..{count} give exactly one integer 0-10. "
                f"Reply with exactly {count} comma-separated integers in tile order and NOTHING "
                f"else. Do not name or describe the change in words.")
    return (f"{grid} For EACH tile 1..{count}, output one integer 0-10 rating how far the main "
            f"on-screen change has progressed in that tile (0 = initial state, 10 = final state). "
            f"Reply with exactly {count} comma-separated integers in tile order and nothing else.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Understand a (possibly narrated) video locally; return text.")
    ap.add_argument("video")
    ap.add_argument("--question", help="specific question; required for silent video unless --timeline")
    ap.add_argument("--timeline", action="store_true",
                    help="dense timestamped description (reusable, cache it)")
    ap.add_argument("--model", default="mlx-community/Qwen3-VL-8B-Instruct-8bit",
                    help="mlx-vlm model repo/path. 8bit (~10GB) is the default — it enumerates "
                         "frames reliably; 4bit is faster/smaller but degenerates on dense frames.")
    ap.add_argument("--whisper-model", default="large-v3-turbo")
    ap.add_argument("--fps", type=float, default=4.0,
                    help="frames/sec sampled (sampled = duration*fps, merged by 2, capped at 768). "
                         "Too few frames and smooth motion can read as teleporting; too many and the "
                         "4-bit model can degenerate. 4 is a safe middle; raise for long clips you "
                         "need fine detail on, use the 8-bit model for reliable fine-motion verdicts.")
    # ponytail: uniform fps; densify around narrated windows only if alignment proves too coarse
    ap.add_argument("--max-tokens", type=int, default=1200)
    ap.add_argument("--montage", action="store_true",
                    help="brief/fine-change mode: tile sampled frames into ONE numbered image and "
                         "read it in image mode (Qwen resolves a grid of stills far better than a "
                         "fast transition in the video path). Returns a per-tile 0-10 trajectory; "
                         "the CALLER computes snap-vs-gradual. Best for 'how many in-between states' "
                         "questions — for easing-feel/continuity use the video path or a human.")
    ap.add_argument("--crop", help="montage ROI as ffmpeg 'W:H:X:Y' to zoom the tiles on the subject")
    ap.add_argument("--tiles", default="4x3", help="montage grid, e.g. 4x3 (default) = 12 frames")
    a = ap.parse_args()

    if not os.path.exists(a.video):
        print(f"RNV_FAILED: no such file: {a.video}"); sys.exit(2)

    if a.montage:
        out_png = os.path.splitext(a.video)[0] + ".montage.png"
        try:
            count = build_montage(a.video, out_png, a.tiles, a.crop)
            answer = _generate(["--image", out_png], montage_prompt(a.question, count), a.model, a.max_tokens)
        except Exception as e:
            print(f"RNV_FAILED: {e}\nFall back: extract frames with ffmpeg and read them natively.")
            sys.exit(3)
        if not answer:
            print("RNV_FAILED: empty model output — fall back to native frame reading."); sys.exit(3)
        print(f"[read-narrated-video OK] mode=montage model={a.model} tiles={a.tiles} sheet={out_png}")
        print(answer)
        return

    words = []
    mode = "silent"
    try:
        if has_speech(a.video):
            words = transcribe(a.video, a.whisper_model)
            mode = "narrated"
    except Exception as e:
        print(f"[rnv] whisper step failed, continuing without narration: {e}", file=sys.stderr)

    prompt = build_prompt(words, a.question, a.timeline)
    try:
        answer = ask_qwen(a.video, prompt, a.model, a.fps, a.max_tokens)
    except Exception as e:
        print(f"RNV_FAILED: {e}\nFall back: extract frames with ffmpeg and read them natively.")
        sys.exit(3)
    if not answer:
        print("RNV_FAILED: empty model output — fall back to native frame reading."); sys.exit(3)

    print(f"[read-narrated-video OK] mode={mode} model={a.model} words={len(words)}")
    print(answer)


if __name__ == "__main__":
    main()

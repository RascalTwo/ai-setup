#!/usr/bin/env python3
"""Watch the macOS clipboard for screenshots, OCR each one with the local
vision model, and when you're done drop the combined text back on the clipboard.

Flow:
  1. Run this, then go take screenshots (Cmd+Ctrl+Shift+4 copies to clipboard).
  2. Each image that lands on the clipboard is queued and transcribed in the
     background while you keep capturing.
  3. Come back to this terminal and press Enter when you've grabbed them all.
  4. Once the queue drains, the concatenated text is put on your clipboard.

Falls back to the read-image-locally skill for the actual OCR (Ollama, ~0 cloud tokens).

Usage:  python3 screenshot-ocr-queue.py [--prompt "..."]
"""

from pathlib import Path
import argparse
import io
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time

from AppKit import NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeTIFF
from PIL import Image

VISION_JUDGE = str(Path.home() / ".claude/skills/read-image-locally/vision_judge.py")
MLX_MODEL = "mlx-community/Qwen3-VL-8B-Instruct-8bit"  # 8-bit; better OCR than Ollama's 4-bit qwen3-vl:8b
DEFAULT_PROMPT = (
    "Transcribe ALL text in this image exactly as written, preserving line "
    "breaks, tables, and structure. Output only the transcribed text, nothing else."
)

work = queue.Queue()          # (index, image_path)
results = {}                  # index -> transcribed text
sizes = {}                    # index -> megapixels (for ETA scaling)
results_lock = threading.Lock()  # guards results + sizes
proc_secs = 0.0               # total OCR seconds over finished images
proc_mp = 0.0                 # total megapixels over finished images
stop = threading.Event()      # set when user presses Enter
done = threading.Event()      # set when --count captures have arrived
pending = 0                   # captures not yet processed
pending_lock = threading.Lock()
TARGET = None                 # stop automatically after this many captures


def read_clipboard_image():
    """Return a PIL image from the clipboard, or None if it isn't an image."""
    pb = NSPasteboard.generalPasteboard()
    for ns_type in (NSPasteboardTypePNG, NSPasteboardTypeTIFF):
        data = pb.dataForType_(ns_type)
        if data is not None:
            return Image.open(io.BytesIO(bytes(data))).convert("RGB")
    return None


def watch_clipboard():
    """Poll the clipboard; enqueue every new image until stop is set."""
    global pending
    pb = NSPasteboard.generalPasteboard()
    last_change = pb.changeCount()  # ignore whatever is already on the clipboard
    idx = 0
    while not stop.is_set():
        change = pb.changeCount()
        if change != last_change:
            last_change = change
            img = read_clipboard_image()
            if img is not None:
                path = tempfile.mktemp(suffix=".png")
                img.save(path, "PNG")
                with results_lock:
                    sizes[idx] = img.size[0] * img.size[1] / 1e6
                with pending_lock:
                    pending += 1
                work.put((idx, path))
                idx += 1
                tail = f" ({idx}/{TARGET})" if TARGET else " — keep going, Enter when done"
                print(f"📸 captured #{idx} ({img.size[0]}x{img.size[1]}){tail}")
                if TARGET and idx >= TARGET:
                    done.set()
                    return
        time.sleep(0.3)


_mlx = None                   # cached (model, processor, config) — loaded once, stays resident
_mlx_lock = threading.Lock()


def _mlx_engine():
    """Load the MLX model on first use and keep it resident for the process lifetime."""
    global _mlx
    with _mlx_lock:
        if _mlx is None:
            from mlx_vlm import load
            from mlx_vlm.utils import load_config
            print(f"⏳ loading {MLX_MODEL} (one-time, ~10GB)…")
            model, processor = load(MLX_MODEL)
            _mlx = (model, processor, load_config(MLX_MODEL))
    return _mlx


def ocr_mlx(path):
    """OCR via the 8-bit MLX Qwen3-VL, model loaded once and reused. Raises on failure."""
    from mlx_vlm import generate
    from mlx_vlm.prompt_utils import apply_chat_template
    model, processor, config = _mlx_engine()
    formatted = apply_chat_template(processor, config, PROMPT, num_images=1)
    return generate(model, processor, formatted, image=[path],
                    max_tokens=2048, temperature=0.0, repetition_penalty=1.05,
                    verbose=False).text.strip()


def ocr_vision_judge(path):
    """Fallback: the Ollama-backed read-image-locally skill, best-first tier order."""
    proc = subprocess.run(
        ["python3", VISION_JUDGE, path, "--prompt", PROMPT, "--models", MODELS],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stdout.strip() or proc.stderr.strip())
    # First stdout line is the "[read-image-locally OK] ..." header; drop it.
    return proc.stdout.split("\n", 1)[1].strip() if "\n" in proc.stdout else ""


def ocr(path, idx):
    """MLX 8-bit first; fall back to the Ollama tiers if it's missing or errors."""
    try:
        return ocr_mlx(path)
    except Exception as e:
        print(f"⚠️  MLX OCR failed for #{idx + 1} ({str(e)[:80]}…) — falling back to Ollama")
    try:
        return ocr_vision_judge(path)
    except Exception as e:
        return f"[OCR FAILED for screenshot #{idx + 1}: {e}]"


def _fmt(secs):
    """Seconds → compact '12s' or '2m05s'."""
    secs = round(secs)
    return f"{secs}s" if secs < 60 else f"{secs // 60}m{secs % 60:02d}s"


def process_queue():
    """Pull images off the queue and OCR them, MLX-first with an Ollama fallback."""
    global pending, proc_secs, proc_mp
    while not (stop.is_set() and work.empty()):
        try:
            idx, path = work.get(timeout=0.3)
        except queue.Empty:
            continue
        t0 = time.time()
        text = ocr(path, idx)
        elapsed = time.time() - t0
        with results_lock:
            results[idx] = text
            proc_secs += elapsed
            proc_mp += sizes[idx]
            # Rate from work actually done; scale by the pixels still queued.
            rate = proc_secs / proc_mp if proc_mp else 0.0
            remaining_mp = sum(mp for i, mp in sizes.items() if i not in results)
        with pending_lock:
            pending -= 1
            remaining = pending
        eta = f", {remaining} left ~{_fmt(remaining_mp * rate)} ETA" if remaining else ""
        print(f"✅ #{idx + 1} done ({elapsed:.1f}s){eta}")
        work.task_done()


def write_clipboard_text(text):
    subprocess.run(["pbcopy"], input=text, text=True)
    # ponytail: built-in macOS sound + notification, no deps
    subprocess.run(["afplay", "/System/Library/Sounds/Glass.aiff"])
    subprocess.run([
        "osascript", "-e",
        'display notification "Transcribed text is on your clipboard" with title "Screenshot OCR"',
    ])


def main():
    global PROMPT, TARGET, MODELS
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", default=DEFAULT_PROMPT, help="OCR instruction passed to the vision model")
    ap.add_argument("--count", type=int, help="Finish automatically after this many screenshots instead of waiting for Enter")
    ap.add_argument("--models", default="qwen3-vl:8b,gemma4:12b,gemma4:e4b",
                    help="Best-first tier order; first one that responds wins, rest are fallbacks")
    args = ap.parse_args()
    PROMPT = args.prompt
    TARGET = args.count
    MODELS = args.models

    threading.Thread(target=watch_clipboard, daemon=True).start()
    worker = threading.Thread(target=process_queue, daemon=True)
    worker.start()

    if TARGET:
        print(f"👀 Watching clipboard for {TARGET} screenshot(s). Take them now (Enter to finish early).\n")
        # Whichever happens first: target reached or you press Enter.
        threading.Thread(target=lambda: (input(), done.set()), daemon=True).start()
        done.wait()
    else:
        print("👀 Watching clipboard for screenshots. Take them now; press Enter when finished.\n")
        input()
    stop.set()
    print("\n⏳ Finishing the queue...")
    worker.join()

    if not results:
        print("Nothing captured — clipboard unchanged.")
        return
    combined = (
        "⚠️ Text captured via local OCR — transcription errors may exist. Verify before relying on it.\n"
        "Each screenshot's text is separated by a '---' delimiter, in capture order.\n\n"
        + "\n\n---\n\n".join(results[i] for i in sorted(results))
    )
    write_clipboard_text(combined)
    out_dir = Path.home() / ".agents/state/screenshot-ocr-queue"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "output.txt"   # last run only; outside the repo so a run never dirties it
    with open(out_file, "w") as f:
        f.write(combined)
    print(f"\n📋 {len(results)} screenshot(s) transcribed → on your clipboard.")
    print(f"\n{'=' * 60}\n{combined}\n{'=' * 60}")
    print(f"\n💾 also written to: {out_file}")


if __name__ == "__main__":
    main()

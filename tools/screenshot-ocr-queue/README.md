---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  requires:
    commands: [python3, ollama]
    skills: [read-image-locally]
  platforms: macOS (AppKit clipboard, MLX)
---

# screenshot-ocr-queue

Watches the macOS clipboard for screenshots, OCRs each one locally in the background, and when you press Enter puts all the text, in order, back on the clipboard.

## Use

```sh
python3 ~/.agents/ai-setup/tools/screenshot-ocr-queue/screenshot-ocr-queue.py [--count N] [--prompt "..."] [--models a,b,c]
```

1. Start it, then take screenshots with `Cmd+Ctrl+Shift+4` (copies to the clipboard).
2. Each image is queued and transcribed while you keep capturing.
3. Press Enter once you have them all (or pass `--count N` to stop after N); when the queue drains, the joined text, `---` between screenshots, is on the clipboard and a notification sounds.

The last run's text is also saved to `~/.agents/state/screenshot-ocr-queue/output.txt`, overwritten each run, so it is safe to delete.

OCR runs on this machine: an 8-bit MLX Qwen3-VL first (about 10 GB, loaded once), then the [`read-image-locally`](../../skills/read-image-locally/) skill's Ollama models (`--models`, best first) if MLX is missing or fails. No cloud tokens, but expect the odd transcription error.

## Deps

```sh
pip install Pillow pyobjc mlx-vlm   # mlx-vlm is optional: without it every image goes to Ollama
```

The Ollama fallback needs Ollama running and the `read-image-locally` skill installed (`~/.claude/skills/read-image-locally/`).

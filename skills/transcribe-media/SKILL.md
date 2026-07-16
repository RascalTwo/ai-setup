---
name: transcribe-media
description: Transcribe SPOKEN WORDS from a local audio or video FILE into text, using the Mac-optimized MLX Whisper (`mlx_whisper`, whisper-large-v3-turbo). Use whenever you need a transcript / captions / subtitles / "what was said" from an audio or video file on disk — a screen recording, a meeting capture, a voice memo, a downloaded clip. This is the canonical speech-to-text primitive; other skills should invoke it rather than re-deriving the command. Do NOT use for: understanding what a video SHOWS visually (use read-narrated-video); pulling an EXISTING embedded caption track without re-recognizing speech (use extract-video-subtitles); or a Google Drive / Meet recording behind a browser (use extract-gdrive-transcript).
---

Turn recorded speech into text **locally**, fast, on Apple Silicon. `mlx_whisper` is the
MLX-optimized Whisper build (Homebrew) — it runs on the Mac's GPU, unlike the plain
`openai-whisper` CLI which falls back to CPU and is far slower. Default model is
`whisper-large-v3-turbo`: near-large-v3 quality at a fraction of the time.

## The decision boundary (read this first)

Several skills touch audio/video — pick by **what you actually want out**:

- **Fresh transcript of the speech in a file → this skill.** Runs speech recognition (ASR)
  on the audio. Use for recordings that have no caption track, or when you want a clean
  re-transcription.
- **What the video *shows* (visual/motion) → `read-narrated-video`.** It reasons over frames;
  it only uses Whisper internally to anchor narration to what's on screen.
- **An *already-embedded* subtitle/caption track → `extract-video-subtitles`.** Pure ffmpeg
  stream copy, no recognition — instant, but only works if the file already carries captions.
- **A Google Drive / Meet recording → `extract-gdrive-transcript`.** Browser-driven, for
  media you can't (or don't want to) download to disk first.

## Usage

```bash
skills/transcribe-media/transcribe.sh <media-file> [options] [-- <extra mlx_whisper flags>]
```

The script normalizes any input (audio or video) to 16 kHz mono wav, runs `mlx_whisper`,
writes outputs to a sibling `<stem>.transcript-<model-tag>/` folder, prints a
`[transcribe-media OK] …` header to stderr, and prints **the path to the transcript (in the
requested `--format`; `.txt` by default) as the last stdout line** — so a caller can capture
it directly (e.g. `--format json` for a machine-readable, word-timestamped transcript).

```bash
# Simplest: transcribe a screen recording (writes txt/vtt/srt/tsv/json alongside it)
skills/transcribe-media/transcribe.sh ~/Movies/"2026-07-15 16-33-32.mkv"

# Capture just the transcript path for downstream use
transcript=$(skills/transcribe-media/transcribe.sh meeting.mp4 --format txt --language en | tail -1)

# Maximize accuracy over speed on a hard recording
skills/transcribe-media/transcribe.sh interview.wav --model mlx-community/whisper-large-v3

# Forward raw mlx_whisper flags (e.g. tame a repetition loop on trailing silence)
skills/transcribe-media/transcribe.sh talk.mkv -- --condition-on-previous-text False
```

Options: `--model` · `--output-dir` · `--format {txt,vtt,srt,tsv,json,all}` (default `all`) ·
`--language <code>` (omit to auto-detect; specifying `en` is faster and avoids misdetection) ·
`--keep-wav`. Everything after `--` is passed straight to `mlx_whisper`.

## Gotchas

- **Silence hallucination.** Whisper invents phrases over silence — classically repeated
  "Thank you." / "Yeah." lines, especially at the head/tail of a recording. This is a Whisper
  trait, not a bug here. If a run is polluted, re-run with `-- --condition-on-previous-text
  False` (breaks failure loops) or trim the silent lead/tail first.
- **First run per model downloads it** (turbo ≈ few hundred MB) to `~/.cache/huggingface`;
  cached after that.
- The intermediate `audio.wav` is removed on success unless you pass `--keep-wav`.

## Fallback

If `mlx_whisper` errors (or isn't installed), the script prints `TRANSCRIBE_FAILED …` and
exits non-zero, echoing the tail of `whisper.log`. Last-resort path: the plain
`whisper <file>` CLI (CPU, slow) produces the same output formats.

## Prerequisites

- `mlx_whisper` and `ffmpeg` on PATH (`brew install mlx_whisper ffmpeg`). Apple Silicon.

## Tests

`tests/run-tests.sh` builds a short spoken fixture with `say` + `ffmpeg` and asserts the
transcript contains the spoken words and that the failure path exits non-zero. Run after
changing `transcribe.sh`.

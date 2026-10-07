---
name: transcribe-media
description: "Transcribes spoken words from a local audio or video file into text (Parakeet v3, Whisper fallback); the canonical speech-to-text skill. Use for a transcript, captions, or \"what was said\" from a recording, voice memo, or clip on disk. Not for what a video shows (read-video-locally)."
rascaltwo-ai-setup:
  kind: skill
  state: false
  requires: [ffmpeg, parakeet-mlx, mlx_whisper]
---

Turn recorded speech into text **locally**. The engine is chosen by **probing for it at
runtime**, not by checking the platform — the first one installed, in this order:

| # | Engine | Where | Model |
|---|---|---|---|
| 1 | `parakeet-mlx` | Apple Silicon | `mlx-community/parakeet-tdt-0.6b-v3` |
| 2 | `mlx_whisper` | Apple Silicon | `mlx-community/whisper-large-v3-turbo` |
| 3 | `parakeet` (onnx-asr, CUDA if available) | anywhere, e.g. the PC | `nemo-parakeet-tdt-0.6b-v3` |
| 4 | `whisper.cpp` | anywhere | a `ggml-*.bin` |

**Why Parakeet first:** ~30% fewer errors than Whisper turbo on the meeting benchmark (AMI WER
11.4 vs 16.1), and it was trained on non-speech to stay silent over silence — where Whisper
loops. Its known weakness: it can **drop short asides** Whisper would catch. Force an engine
with `--engine`; `--engine mlx_whisper` is the one-flag way back.

Two things route around Parakeet automatically:
- **A `--model` names its family.** A Whisper model (read-video-locally passes one) gets a Whisper
  engine; a Parakeet model gets a Parakeet engine.
- **A `--language` Parakeet lacks** (it knows 25 European languages) goes to Whisper.

**Parakeet's own output is the source of truth**: it is kept as `<stem>.parakeet.json`, and
every other format — including `<stem>.json` — is derived from it **in Whisper's shape**
(`segments[].words[]`, the same `txt`/`srt`/`vtt`/`tsv` layout), so callers see one schema
whatever engine ran. Parakeet does not report a language, so `language` in the derived json is
what `--language` asked for, or `null`.

## The decision boundary (read this first)

Several skills touch audio/video — pick by **what you actually want out**:

- **Fresh transcript of the speech in a file → this skill.** Runs speech recognition (ASR)
  on the audio. Use for recordings that have no caption track, or when you want a clean
  re-transcription.
- **What the video *shows* (visual/motion) → `read-video-locally`.** It reasons over frames;
  it only uses Whisper internally to anchor narration to what's on screen.
- **An *already-embedded* subtitle/caption track → `extract-video-subtitles`.** Pure ffmpeg
  stream copy, no recognition — instant, but only works if the file already carries captions.
- **A Google Drive / Meet recording → `extract-gdrive-transcript`.** Browser-driven, for
  media you can't (or don't want to) download to disk first.

## Usage

```bash
~/.agents/skills/transcribe-media/transcribe.sh <media-file> [options] [-- <extra mlx_whisper flags>]
```

The script normalizes any input (audio or video) to 16 kHz mono wav, runs `mlx_whisper`,
writes outputs to a sibling `<stem>.transcript-<model-tag>/` folder, prints a
`[transcribe-media OK] …` header to stderr, and prints **the path to the transcript (in the
requested `--format`; `.txt` by default) as the last stdout line** — so a caller can capture
it directly (e.g. `--format json` for a machine-readable, word-timestamped transcript).

Three defaults exist to survive real-world screen recordings; all are overridable:

- **Every audio track is mixed**, not just ffmpeg's default pick. Screen recorders (OBS, Owl
  setups) split mic / system / room onto separate tracks, and any one of them may be the silent
  one — or the only one with the voices.
- **Loudness is normalized** to -16 LUFS. Far-field room audio often lands near -36 dB, and
  Whisper hallucinates repetition loops on speech that quiet. `LRA=11` keeps the dynamic range
  and `TP=-1.5` prevents clipping, so this is not "make everything loud". Applied to the
  throwaway wav only — the source file is never modified.
- **`--condition-on-previous-text False`**, because Whisper feeding its own output back as the
  next window's prompt is what sustains a loop once it starts. Normalization alone does *not*
  prevent this on real recordings. Pass `-- --condition-on-previous-text True` to restore.

The script then **fails** (non-zero, `TRANSCRIBE_FAILED`) if the transcript came back stuck
repeating itself — 50+ identical lines in a row, which is Whisper looping rather than
transcribing. Partial output is kept for inspection.

```bash
# Simplest: transcribe a screen recording (writes txt/vtt/srt/tsv/json alongside it)
~/.agents/skills/transcribe-media/transcribe.sh ~/Movies/"2026-07-15 16-33-32.mkv"

# Capture just the transcript path for downstream use
transcript=$(~/.agents/skills/transcribe-media/transcribe.sh meeting.mp4 --format txt --language en | tail -1)

# Maximize accuracy over speed on a hard recording
~/.agents/skills/transcribe-media/transcribe.sh interview.wav --model mlx-community/whisper-large-v3

# Forward raw mlx_whisper flags (e.g. tame a repetition loop on trailing silence)
~/.agents/skills/transcribe-media/transcribe.sh talk.mkv -- --condition-on-previous-text False
```

Options: `--model` · `--output-dir` · `--format {txt,vtt,srt,tsv,json,all}` (default `all`) ·
`--language <code>` (omit to auto-detect; specifying `en` is faster and avoids misdetection) ·
`--keep-wav` · `--engine {auto,parakeet-mlx,mlx_whisper,parakeet,whisper.cpp}` (default `auto`). Everything after `--`
is passed straight to the engine.

With `whisper.cpp`, `--model` is a path to a `ggml-*.bin` rather than a Hugging Face repo, and
the binary is found via `PATH`, `WHISPER_CPP_BIN`, or `WHISPER_CPP_DIR`. Its JSON output is
rewritten into Whisper's own schema, so callers see one shape regardless of engine.

## Gotchas

- **Silence hallucination (Whisper).** Whisper invents phrases over quiet or silent audio and loops on
  them — real examples from one meeting archive: 1,992 consecutive `Next.`, 2,625 × `Up.`,
  1,027 × `Yeah.`. The defaults above (track mixing, loudness normalization, no
  previous-text conditioning) prevent this in the cases seen so far, and the stuck-repeating
  check catches what slips through. **The danger is that a looped transcript looks healthy**: correct
  file size, plausible word count, evenly spaced timestamps, `OK` header. Only the words differ.
  Verify content, never structure — `sort -u file.txt | wc -l` against total lines is the
  cheapest tell. If a run still fails, escalate to `--model mlx-community/whisper-large-v3`.
- **Non-MLX Parakeet needs long chunks.** Parakeet takes ~30 s at a time, so the onnx engine
  cuts audio at pauses first. onnx-asr's default cutting (20 s, split on any 100 ms gap) hands it
  fragments too short for context — one 4 s fragment of English came back as **Russian**, since
  Parakeet guesses the language per chunk. The engine uses 60 s chunks cut only at pauses; on a
  6 min meeting that matches parakeet-mlx 93%, the same as parakeet-mlx against itself at
  another chunk size (94%). Without chunking, the two engines are word-for-word identical.
- **Non-MLX Parakeet models live in `~/.cache/transcribe-media/`, not the Hugging Face cache**
  (override: `TRANSCRIBE_MEDIA_MODELS`). The HF cache is symlinks into `blobs/`, and onnxruntime
  refuses external weights that resolve outside the model folder ("External data path escapes
  model directory"). A folder without `.complete` is an interrupted download and is re-fetched.
  To seed a machine without re-downloading 2.4 GB, copy the folder over, `.complete` included.
- **First run per model downloads it** (turbo ≈ few hundred MB) to `~/.cache/huggingface`;
  cached after that.
- The intermediate `audio.wav` is removed on **every** exit — success, failure, or interrupt —
  via an `EXIT` trap, unless you pass `--keep-wav`. It is ~100 MB per hour of audio, so the
  older "clean up only on success" behavior silently stranded gigabytes on the failure paths.

## Fallback

If the selected engine errors, the script prints `TRANSCRIBE_FAILED …` and exits non-zero,
echoing the tail of `engine.log`. When neither engine is installed it says so rather than
guessing. Last-resort path: the plain `whisper <file>` CLI (CPU, slow) produces the same
output formats.

## Prerequisites

- `ffmpeg`/`ffprobe` and Python 3 on PATH, plus at least one engine (install a Parakeet
  *and* a Whisper one, so the fallback exists):
  - **Apple Silicon:** `parakeet-mlx` (`pip install parakeet-mlx` into the Homebrew Python) and
    `mlx_whisper` (`brew install mlx_whisper ffmpeg`).
  - **Elsewhere:** `pip install "onnx-asr[hub]" "onnxruntime-gpu[cuda,cudnn]"` (NVIDIA; plain
    `onnxruntime` for CPU) into the Python that **runs `transcribe.py`** — the engine runs
    in-process, so point the launcher at that interpreter. Whisper fallback: a built `whisper.cpp`
    binary on PATH or at `WHISPER_CPP_BIN`, and a `ggml-*.bin` via `--model` or `WHISPER_CPP_MODEL`.

`transcribe.sh` is a shim; the implementation is `transcribe.py`, so it runs on Windows too.

## Tests

`tests/test_convert.py` (stdlib `unittest`, no model needed) covers engine order and routing,
the Parakeet → Whisper converter, and the exact text of every derived format.
`tests/run-tests.sh` runs those, then synthesises a short spoken fixture (`say` on macOS,
System.Speech under Git Bash on Windows) and puts **every installed engine** through the same
checks: the spoken words come back, all five formats exist, the json is Whisper-shaped, the raw
`.parakeet.json` is kept, `--keep-wav` works, speech on a non-default track is not lost, and pure
silence is not a failure. Run after changing `transcribe.py`. `TRANSCRIBE_CMD` overrides the
launcher (e.g. a venv's python + `transcribe.py`).

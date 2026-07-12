---
name: read-narrated-video
description: Understand a video LOCALLY and get back TEXT (~0 Claude vision tokens) — the video sibling of local-vision. Whisper hears the English voice track, Qwen3-VL sees the picture, joined on one timeline. Use when you have a video with English narration to verify ("does what they SAID match what's on screen?"), or when an agent records its OWN silent clip to check motion-over-time it can't judge from a single screenshot ("did the ingredient animate onto the plate, or teleport?"). Trigger on "read this video", "what happens in this clip", "verify this narrated recording", "check the recording", or self-verifying a captured gameplay/UI clip. NOT for a single still image (use local-vision) and NOT for holistic aesthetic judgment.
---

Offload **video** understanding to local models so it costs ~0 Claude vision tokens instead of the
thousands a frame-by-frame native read would burn. Claude can't `Read` video; the best local video
model (Qwen3-VL) is vision-only and **cannot hear audio**. So the job is split on a shared timeline:

- **Whisper** hears the English voice → word-level timestamped transcript (the *spotlight*).
- **Qwen3-VL** (via mlx-vlm) sees the picture → reasons over timestamped sampled frames (the *eyes*).

The transcript is fed to Qwen3-VL as timestamped text, so "spoken X at 0:42" lines up with "frame at
0:42 shows Y". A vision-only model thus behaves like an audio+video model — locally, no Omni needed.

## Two modes (auto-detected from the audio track)

1. **Narrated** — audio present. The narration **becomes the query list**: each spoken comment is a
   claim verified against the video. You don't hand-author questions; the speaker's words are them.
2. **Silent** — no/empty audio (e.g. an agent's own screen-capture). Whisper is skipped; the
   caller's `--question` (or `--timeline`) drives the model. This upgrades agent self-verification
   from a flipbook of stills to **motion-over-time** — "did it animate or teleport?" — which a single
   screenshot can't answer. (Subjective "is it juicy/fun" stays a human call.)

## Usage

```bash
python3 narrate_video.py <video> [--question "..."] [--timeline] \
  [--model mlx-community/Qwen3-VL-8B-Instruct-8bit] [--whisper-model large-v3-turbo] [--fps 4]
```

- **Narrated clip** — just pass the video; the transcript drives verification automatically:
  `python3 narrate_video.py demo.mp4`
- **Silent clip, targeted question** (the agent-self-verify path):
  `python3 narrate_video.py /tmp/capture.mp4 --question "Does the red ingredient slide onto the plate, or jump there instantly?"`
- **Reusable text timeline** — run once, cache the text, query it many times without re-running the heavy model:
  `python3 narrate_video.py demo.mp4 --timeline > /tmp/demo.timeline.txt`

On success it prints `[read-narrated-video OK] mode=… model=… words=…` then the text answer.

**Always pass a specific intent.** Like local-vision, a video model is only as good as the prompt —
never expect a useful answer from a vague request. Narrated mode supplies the intent from speech;
silent mode needs your `--question` (or `--timeline` for dense captioning).

## Montage mode (`--montage`) — brief / fine changes the video path averages away

The video path samples frames as a temporal sequence and **merges adjacent pairs**, so a *brief* event
(a fast tween, a 6-frame transition) buried in a mostly-static clip gets averaged into a gist — the
model reports a flat "it's a green plate" and misses the change entirely. Montage mode reframes the
**temporal** question as a **spatial** one: it tiles sampled frames into one numbered contact-sheet and
reads it in **image mode** (Qwen3-VL resolves a grid of stills far better than a fast transition).

```bash
python3 narrate_video.py capture.mp4 --montage \
  --crop 320:200:415:290 \                 # ffmpeg W:H:X:Y — zoom the tiles onto the subject
  --tiles 5x4 \                            # grid (default 4x3=12); more tiles = finer time resolution
  --question "Rate the plate disc's green brightness (0=black, 10=max bright green)."
```

It samples frames **inside the active window** (it auto-trims the settled tail via frame-diff, so a
brief transition fills the grid instead of getting 2 tiles while 10 are wasted on the static end),
numbers them, and returns a **per-tile 0–10 trajectory** — e.g. snap → `0,0,0,0,0,3,6,9,10,10,10,10`,
tween → `0,0,0,3,5,6,7,8,9,10,10,10`. **The caller computes the verdict** from the trajectory (count
transitional tiles / rise-width); the prompt never names "snap/gradual" so the model can't be led.

**Boundaries (measured):**
- Use it for **"how many in-between states were there"** — position-over-time, presence/appearance, a
  scalar that ramps. For **easing-feel / continuity / bounce**, the still-grid hides it: use the video
  path or a human.
- The model **smears a hard edge by ~2–3 tiles** (reads an instant jump as a short ramp). So separating
  a true snap from a *sub-0.2s* scalar tween is **marginal** — raise `--tiles` and judge on rise-WIDTH,
  not "any intermediate value". For a pure colour/brightness trajectory a **direct pixel read** (PIL on
  the frames) is more reliable than any model — reach for the model when the per-frame question is
  *semantic* (where/what/whether), not a number you could measure directly.
- Needs **Pillow** (`pip install pillow`) for the sheet build.

## Recording a silent clip to verify (no new dependency)

If the app exposes a screenshot/debug hook, drive a sequence, capture a frame burst, and stitch:

```bash
ffmpeg -framerate 10 -pattern_type glob -i '/tmp/burst/*.png' -pix_fmt yuv420p /tmp/capture.mp4
python3 narrate_video.py /tmp/capture.mp4 --question "Did <expected motion> happen? If not, describe what visually happened."
```

This works even where OS screen-recording is blocked for the app (e.g. Godot via computer-use).

## Fallback

On any hard failure (mlx/Qwen3-VL load error, empty output) the engine prints `RNV_FAILED …` and
exits non-zero. When that happens, **extract frames with ffmpeg and read them natively** — this skill
is an optimization, never a hard dependency:

```bash
ffmpeg -i video.mp4 -vf fps=2 /tmp/frames/f%03d.png   # then Read the frames
```

The Whisper step is best-effort: if it fails, the engine continues in silent mode (warns on stderr).

## Prerequisites (all verified on Apple M3 Pro / 36 GB, macOS)

- **ffmpeg / ffprobe** — `/opt/homebrew/bin` (audio extract + silence detection + frame sampling).
- **whisper** (OpenAI) — `/opt/homebrew/bin/whisper`, models `large-v3-turbo` (default) / `large-v3`.
  `--word_timestamps True` gives the per-word times that anchor deictic words ("here"/"this").
- **mlx-vlm** — `pip install mlx-vlm` (Apple-Silicon only; Qwen3-VL is first-class). Verified on
  Python 3.14. Model auto-downloads on first run.

### Model choice
- Default **`Qwen3-VL-8B-Instruct-8bit`** (~10 GB, fits 36 GB with headroom). The 4-bit (~4.5 GB) is
  faster/smaller but **degenerates on dense frames** (repeats tokens) and is flakier on fine-motion
  verdicts — use it only when speed matters and the question is coarse. Don't bother with bf16: 8-bit
  is near-lossless vs full precision and faster on Apple Silicon (inference is bandwidth-bound).
- **ollama's `qwen3-vl:8b` is image-only** — its runner does no temporal video encoding. Don't route
  video through ollama; mlx-vlm is the video path. (ollama stays fine for single images / local-vision.)

### Whisper model
- `large-v3-turbo` (default) is fast and accurate enough. Use `--whisper-model large-v3` for the
  best transcription when accuracy matters more than speed.

## Alignment & frame-density knob

Whisper word-times and Qwen3-VL frames share the clip's start (same file). `--fps` controls density:
sampled frames ≈ `duration × fps` (merged by 2, capped at 768). Default `4` lands a word at 0:42.3
near a 0:42 frame. Densify around narrated moments if grounding is too coarse (the comment in
`narrate_video.py` marks per-window densification as the upgrade path).

## Reliability boundary (measured)

- **Narrated verification is strong & stable.** The transcript anchors the model; per-claim
  verification with timestamps is accurate.
- **The real lever for motion is prompt framing, not model size.** A plain "does it slide or
  teleport?" made *both* 4-bit and 8-bit lazily call a smooth slide a "teleport". The fix (now baked
  into the silent-question prompt) is **enumeration framing**: make the model walk the frames one by
  one and note each position *before* judging. With that, the verdict is correct.
- **8-bit is what makes the enumeration reliable.** 4-bit, asked to enumerate, sometimes degenerated
  into repeated junk (`x=10, x=10, …`); 8-bit enumerates cleanly every time. That's why 8-bit is the
  default — the upgrade pays off *in combination with* the framing, not on its own.
- Subjective calls ("is the easing/juice right") still belong to a human.

## Relationship to local-vision

`local-vision` is the **image** sibling (single still → text via Ollama). `read-narrated-video` is the
**video** sibling (motion + speech → text via Whisper + Qwen3-VL). Same philosophy: local model
returns text, ~0 Claude vision tokens, never ask for a generic caption.

## Tests

`tests/run-tests.sh` builds a tiny narrated clip and a silent clip with ffmpeg + macOS `say`, then
checks: silence detection (narrated vs silent), Whisper word-timestamp output, prompt construction
for all three modes, and the `RNV_FAILED` fallback path. Run after changing the engine.

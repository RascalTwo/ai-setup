---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: delete
  requires:
    commands: [python3, ollama, ffmpeg]  # plus `ollama pull d1:2b` and Pillow
---

# watch-for

Watches a stream of frames (a screen, a window, a video, a camera, a folder of images) until a condition is true, then exits. Each frame is judged on this Mac by Liquid's `d1:2b` decision model on Ollama, so waiting costs no Claude vision tokens. Claude runs it as a background command and is told when it exits.

```bash
watch-for '"Deploy succeeded"' --in window:Chrome --timeout 10m
watch-for '("Saved" in bottom_right or "error dialog") and not "spinner"' --in screen
watch-for '"spinner"' --gone                      # wait until it disappears
watch-for '"goal scored banner"' --in match.mp4 --all   # every moment in a recording
ls shots/*.png | watch-for '"login form"' --in -
```

`watch-for --help` lists the sources and regions. The skill (`skills/watch-for`) tells Claude when to use it.

## How it decides

- **Conditions** are quoted strings joined with `and`, `or`, `not` and parentheses. Python's own parser reads them; anything else is refused.
- **Regions**: `"x" in bottom_right` judges only that part of the frame. Named regions (`top`, `bottom`, `left`, `right`, the four quarters, `center`) are aliases for `box(x, y, w, h)` in fractions of the frame; `px(x, y, w, h)` takes pixels. Both give d1 the same crop: fractions survive a resize, pixels are exact for a known layout.
- **One d1 call per distinct region per frame**, asking every condition in that region at once. Batching 4 questions matched asking them one at a time (98.8–100% same verdicts, 40 screenshots) at a third of the time.
- **Native resolution.** On a real 3456×2234 screen it answered the same as at 1536 px, ~25% slower.
- **Match** = the expression is true (each condition at p ≥ 0.5) on 2 frames in a row. A frame that hasn't changed repeats the last verdict without asking the model again.
- **Pace**: live sources take the next frame as soon as the answer is in, at most one per second. Files and folders go frame by frame; video is sampled at 1 frame per second.

## Output

One JSON line per match: `{"matched": true, "t": 312.0, "frame": "~/.agents/state/watch-for/….png", "p": {"Saved @ frac[0.5, 0.5, 0.5, 0.5]": 0.91, …}}`. `t` is seconds since start (live) or into the video (frame index for a folder). Exit 0 on a match, 1 on timeout or end of stream without one (it prints `{"matched": false, …}` with the last probabilities), 2 on an error.

## Speed and accuracy (2026-11-01, 36 GB Mac)

| | per frame | text visible and caught | overall accuracy |
|---|---|---|---|
| full screen, 3456×2234 | 2.4–3.0 s | — | — |
| screenshots up to ~1.9k px | 0.6–1.4 s | 82–85% | 93% |

A small target can take a few frames to trigger; a region makes it bigger and faster. Ollama answers one request at a time, so a watcher waits behind any other local-model work (and vice versa).

## Tests

`python3 tools/watch-for/test_watch_for.py` (`--fast` runs only the parser tests; the rest need Ollama with `d1:2b`).

---
name: watch-for
description: "Waits until something is visible on a screen, window, video, camera or folder of images, judged by a local model (0 Claude vision tokens). Use to wait for a UI state (dialog, banner, page loaded, spinner gone) instead of repeated screenshots, or to find the moments a video shows something."
rascaltwo-ai-setup:
  kind: skill
  state: false
  integrates:
    ollama: d1:2b decision model
  requires:
    commands: [python3, ollama, ffmpeg]
---

`~/.agents/ai-setup/tools/watch-for/watch-for` watches frames until a boolean expression of things-to-see is true, then exits. Its README holds the measurements; `--help` holds every source and region.

## Waiting on a UI

1. **Phrase each condition as something visible**, as concretely as the screen shows it: `"Deploy succeeded"` (its exact text) or `"a red error dialog"`. Wait for success **or** failure in one expression, so a failure ends the wait at once instead of at the timeout: `'"Deploy succeeded" or "Deploy failed"'`.
2. **Narrow the source**: `--in window:<App>` beats `--in screen`, and `"Saved" in bottom_right` (or `box(x, y, w, h)` fractions, `px(…)` pixels) beats the whole frame. A smaller frame is faster and makes small text readable. A full Retina screen costs ~2.5 s per check.
3. **Run it with Bash `run_in_background: true`** and a `--timeout` sized to the wait. You are notified when it exits; keep working or end the turn meanwhile.
4. **Read the result**: exit 0 and its JSON line say which conditions were true (`p` per condition) and where the matched frame is. Exit 1 is a timeout: the last `p` values show how close it came. Exit 2 is an error on stderr.
5. **Before an irreversible action, look once yourself**: `Read` the saved `frame` (one native image) to confirm. d1 is ~93% right per frame and confirms over 2 frames, which is good for waiting and short of proof.

A remote desktop inside a browser tab (Horizon web client) is a canvas the screen sources can't see while the tab is in the background: use `omnissa-horizon-vdi`'s `vdi-watch.sh` (in its `web-client.md`), which feeds this tool the guest's own frames.

`--gone` waits for the expression to turn false (`'"spinner"' --gone`).

## Finding moments in a recording

`--in <video> --all` (or `--in dir:<folder>`) prints one JSON line per match with `t` in seconds into the video (sampled at 1 frame per second). It reads frames only; for speech use `transcribe-media`, for "what happens in it" use `read-video-locally`.

## Limits

- It answers "is X visible", never "what does it say": reading values is `read-image-locally`.
- Ollama runs one request at a time; another local-model job (yours or another session's) delays every check. A check that hangs on it ends as exit 2 after 300 s.

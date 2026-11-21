---
name: r2-tts
description: "Speaks text to an audio file, or serves voicemode's speech endpoint, picking the voice by who will hear it: Joseph hears a not-Joseph voice (Harper), everyone else hears Joseph's cloned voice. Use whenever a tool or task needs generated speech: narration for a demo, film or video, a voice clip, a voice reply, or choosing a TTS engine."
rascaltwo-ai-setup:
  kind: skill
  state: true
  deletion-policy: retain
  integrates:
    voicemode: VOICEMODE_TTS_BASE_URLS=http://127.0.0.1:8895/v1 (r2-tts serve)
    launchd: [com.rascaltwo.r2-tts]
    ollama: phonon (Harper)
    viz: every narration voice (profiles in ~/.config/viz/voices.json name an audience)
    windows-task-scheduler: ming-tts-server (home PC, at logon)
  requires:
    commands: [python3, ffmpeg, uv]
    manual: [Zonos3-Mini in ~/.agents/state/r2-tts/zonos3, Qwen3-TTS via mlx-audio, Ming-3.0-tts on the home PC (ming/README.md)]
  platforms: macOS; the Ming server runs on Windows 10 + WSL2 with an NVIDIA GPU
---

# r2-tts

One way in for every generated voice. Tools say **who will hear it**; r2-tts picks the voice and the engine, falls back down a ranked chain when one is missing, re-rolls bad takes, and levels every clip to -16 LUFS so tracks from different engines sit at one loudness.

```sh
R2TTS=~/.claude/skills/r2-tts/r2_tts.py
$R2TTS say --audience others --text "…" --out clip.mp3        # → {"file", "audience", "voice", "engine"}
$R2TTS say --audience both --lean me --text-file s.txt --out clip.wav   # clip.me.wav (default) + clip.others.wav
```

## Audience decides the voice

| `--audience` | Voice | Chain, first that answers |
|---|---|---|
| `me`: Joseph hears it (voicemode replies, grill and spec films) | Harper | phonon Harper (Mac, Ollama) → Ming US_Emma (PC) → macOS `say` |
| `others`: someone else hears it (anidoodle films, forwarded demos) | Joseph | Zonos3-Mini (Mac) → Qwen3 (Mac) → Ming joseph (PC) → phonon Harper → `say` |
| `both`: two files; `--lean` names the likelier audience, whose track is the default | both | each as above |

Per tool: voicemode `me`; voicemode-hold's word cursor `me`; grill/spec films and the grill poster's acks `me`; demo-viz `both --lean me`; pr-viz `both --lean others`; anidoodle `others`. A tool may override per call.

Tools keep no speech code of their own: no engine calls, no browser `speechSynthesis`, no `say`. A tool that needs something (a speed, an emotion, word times, two tracks) asks r2-tts for it; when r2-tts can't do it yet, add it here.

- **Emotion** (`--emotion happy|sad|angry|fear|disgust|surprise`), inline tags (`[Laughter]`) and pitch/volume start the chain at Ming, for either voice: Joseph preferred Ming's happy to Zonos's emotion steering in an A/B. If Ming is away, the rest of the chain speaks the line plainly, with tags stripped.
- **Speed**: Qwen3 and Ming speak at it natively; the rest are retimed with ffmpeg `atempo`.
- **Pronunciations**: the `TTS <regex> <replacement>` lines in `~/.voicemode/voicemode.env` apply to every request, re-read each time.

## The two front doors

`say` writes files and prints one JSON line per file. When `serve` is running it goes through it, so Zonos and Qwen3 stay warm between calls; otherwise it runs the engines in-process and stops any model server it started on exit. `R2TTS_LOCAL=1` forces in-process. `--words FILE` also writes `[[word, start, end], …]` for one audience, estimated by sharing the clip's sounding frames out over the words by length, so pauses fall between words; a word can be about 0.2 s off (viz transcribes its clips instead when it needs exact times).

`serve` is voicemode's OpenAI-style endpoint on `127.0.0.1:8895` (`POST /v1/audio/speech`), run by launchd. Body: `input`, `voice`, `speed`, `response_format` (wav mp3 opus flac aac pcm), plus `audience`, `emotion`, `pitch`, `volume`. Without `audience`: `joseph` (or a body with `ref_audio`) is Joseph's voice, a Ming built-in by name (`US_James`, `UK_George`…) is that voice, and anything else (`af_sky`) is Harper. The response names the engine in `X-Voice-Backend`. A model server the daemon started stops after 5 idle minutes.

launchd cannot read `~/Desktop`, so it runs an installed copy. After editing `r2_tts.py`:

```sh
cp r2_tts.py ~/.agents/state/r2-tts/serve/ && launchctl kickstart -k gui/$(id -u)/com.rascaltwo.r2-tts
```

First install: substitute `YOUR-USER` in `launchd/com.rascaltwo.r2-tts.plist`, copy it to `~/Library/LaunchAgents/`, `launchctl bootstrap gui/$(id -u) <plist>`. Log: `~/.agents/state/r2-tts/serve.log`.

## Engines

- **Zonos3-Mini** (Apache-2.0): cloned from `~/.config/viz/voice-references/joseph-animated.wav` at `delivery.tempo` 2. Server started on demand from `~/.agents/state/r2-tts/zonos3` (`servers/mlx/scripts/serve.sh`, port 1919); about 50 s cold, 1.5 s per 11 s of speech warm. Its known failures are a long gap mid-sentence and a take that stops short, so every take is checked: a length outside 0.4–2.5× of about 19 characters a second, or any pause over 1 s, re-rolls the seed, up to 4 seeds, then the chain moves on.
- **Qwen3-TTS** 1.7B via mlx-audio, from the same reference and its transcript (`joseph-animated.txt`), on port 8892.
- **Ming** on the home PC: setup, networking and its own re-roll guard are in [ming/README.md](ming/README.md).
- **phonon** (Ollama) voice Harper; `PHONON_VOICE` overrides it.

The ranking came from blind listening tests; why the voice follows the audience, and why the router retired, is `docs/adr/2026-11-20-pick-the-voice-by-who-hears-it.md`. Check: `python3 -B test_r2_tts.py`.

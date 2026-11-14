---
rascaltwo-ai-setup:
  kind: tool
  state: true
  deletion-policy: retain
  integrates:
    voicemode: VOICEMODE_TTS_BASE_URLS (the router only)
    ollama: phonon (Mac fallback voice)
    viz: pr-viz joseph-animated profile url in ~/.config/viz/voices.json
    launchd: [com.rascaltwo.ming-router]
    windows-task-scheduler: ming-tts-server (home PC, at logon)
  requires:
    commands: [python3, ffmpeg, ssh, ollama]
    manual: [home-pc SSH access, Ming-3.0-tts-0.5B in WSL on the home PC, Qwen3-TTS via mlx-audio]
  platforms: macOS (router); Windows 10 + WSL2 with an NVIDIA GPU (server)
---
# ming-tts

Joseph's voice (Ming-3.0-tts-0.5B cloned from the pr-viz `joseph-animated` reference) and a generic voice (Ming built-in `US_Emma`), served from the home PC to the Mac, with Mac-local fallbacks.

```
voicemode / pr-viz --> router.py (Mac, 127.0.0.1:8895, LaunchAgent)
                         |-- PC up   --> ming_server.py (PC, WSL, tailnet 100.65.216.8:8894)
                         |-- PC down --> joseph: Qwen3 via mlx_audio.server (started on demand, stopped after 5 min idle)
                                         other:  phonon via Ollama 127.0.0.1:11434, voice Harper
```

`joseph`, or any request carrying `ref_audio` (pr-viz), is the cloned voice; every other voice name (`af_sky`, `emma`, ...) is `US_Emma`, except the Ming built-ins by name (`US_James`, `US_Stella`, `UK_George`, `UK_Charlotte`). The router applies the `TTS <regex> <replacement>` rules from `~/.voicemode/voicemode.env` to every request, so pr-viz gets voicemode's pronunciations.

Extra request fields beyond OpenAI's: `emotion` (happy sad angry fear disgust surprise neutral), `pitch` and `volume` (low medium high), honoured for `joseph` only; `speed` below 0.9 or above 1.1 becomes slow or fast. Inline `[Laughter]`-style tags pass through for `joseph` and are stripped for built-in voices. Formats: wav from Ming, converted by ffmpeg for mp3/opus/flac/aac/pcm (pcm is 24 kHz s16le mono).

## Ming server (PC)

`ming_server.py` is stdlib-only and runs in WSL (`/root/ming`: repo, venv, weights, see `~/.agents/state/ming-tts/REPORT.md`). The model loads on the first request (about 12 s cold, 2 s warm after) and unloads after 10 idle minutes (`MING_IDLE_S`), freeing about 3 GB VRAM. It does not take the shared `gpu.lock`.

Each take is checked against an expected length (about 19 characters per second plus 0.8 s per tag): shorter than 0.4x or longer than 2.5x is re-rolled with a new seed, up to 5 tries, then the request fails with 502 and the router falls back. Decoding is capped at 2.6x the expected length so a runaway costs about 7 s instead of 20. Retries show in the `X-Ming-Retries` header and the server log. Question tags (`[Question-ei]` etc.) are the weak spot: expect 2-3 re-rolls, 15-25 s.

Networking: WSL2 NAT already forwards Windows `127.0.0.1:8893` into WSL; a `netsh portproxy` on `0.0.0.0:8894` re-exposes it, and a firewall rule admits only `100.64.0.0/10` (Tailscale). Windows 10 has no mirrored networking. Startup is the Scheduled Task `ming-tts-server` (at logon, no time limit, runs `pc/run-server.sh` in the foreground so `wsl.exe` keeps the VM alive).

Install on the PC (elevated): copy `ming_server.py`, `pc/*`, `joseph-ref.wav` (the reference at 44.1 kHz) and `joseph-ref.txt` (its transcript) into one folder on the PC (e.g. `%USERPROFILE%\ai-eval\ming-server\`), then, from that folder, `powershell -ExecutionPolicy Bypass -File install.ps1`. Remove with `uninstall.ps1`. Restart the server: `wsl --shutdown` also stops other WSL jobs, so prefer `wsl -d Ubuntu-24.04 -u root -e pkill -f ming_server.py` then `schtasks /run /tn ming-tts-server`.

## Router (Mac)

launchd cannot read `~/Desktop`, so the LaunchAgent runs an installed copy. After editing `router.py`:

```sh
cp router.py ~/.agents/state/ming-tts/router/
launchctl kickstart -k gui/$(id -u)/com.rascaltwo.ming-router
```

First install: substitute `YOUR-USER` in `launchd/com.rascaltwo.ming-router.plist`, put it in `~/Library/LaunchAgents/`, `launchctl bootstrap gui/$(id -u) <plist>`. The PC is probed with a 1 s timeout at most every 30 s. Log: `~/.agents/state/ming-tts/router.log` (backend and retries per request). `MING_URL` overrides the PC address (point it at a dead port to test the fallbacks).

## Wiring

voicemode: `VOICEMODE_TTS_BASE_URLS=http://127.0.0.1:8895/v1` in `~/.voicemode/voicemode.env` (voice stays `af_sky`; the router maps it to Emma, or to phonon's Harper when the PC is away). The router is the only endpoint: launchd keeps it alive, and voicemode cannot call phonon directly (Ollama rejects its `tts-1` model, `af_sky` voice and mp3 format).

phonon (Ollama's 31M Gradium model) replaced Kokoro as the Mac fallback on 2026-10-31: about 2x faster, 177 MB loaded only while in use against Kokoro's 743 MB always-on server, 112 MB on disk against 2.1 GB. It speaks only at speed 1 and returns only wav or pcm, so the router retimes with ffmpeg `atempo` and converts. `Harper` is the phonon voice closest to Kokoro `af_sky` on pitch and MFCC timbre; override with `PHONON_VOICE`. pr-viz: `"url": "http://127.0.0.1:8895"` on the `joseph-animated` profile in `~/.config/viz/voices.json`; `narration.ts` already uses a server listening at a profile's `url`, so no code changed. pr-viz's clip cache is keyed on the text and reference, not the backend, so clips cached from Qwen3 stay until the cue text changes.

Check: `python3 test_ming_tts.py`.

# Ming on the home PC

Ming-3.0-tts-0.5B serves Joseph's cloned voice (`joseph`, from the `joseph-animated` reference) and its five built-in voices (`US_Emma`, `US_James`, `US_Stella`, `UK_George`, `UK_Charlotte`) from the PC's GPU. It is r2-tts's third engine for Joseph's voice and the second for Harper's, and the one that does emotion, pitch, volume and inline tags. r2-tts calls it at `http://100.65.216.8:8894/v1/audio/speech` (`MING_URL` overrides) with `{input, voice, speed?, emotion?, pitch?, volume?}`.

Fields beyond OpenAI's: `emotion` (happy sad angry fear disgust surprise neutral), `pitch` and `volume` (low medium high); `speed` below 0.9 or above 1.1 becomes slow or fast. Inline `[Laughter]`-style tags pass through for `joseph`. Replies are wav.

## Ming server (PC)

`ming_server.py` is stdlib-only and runs in WSL (`/root/ming`: repo, venv, weights, see `~/.agents/state/ming-tts/REPORT.md`). The model loads on the first request (about 12 s cold, 2 s warm after) and unloads after 10 idle minutes (`MING_IDLE_S`), freeing about 3 GB VRAM. It does not take the shared `gpu.lock`.

Each take is checked against an expected length (about 19 characters per second plus 0.8 s per tag): shorter than 0.4x or longer than 2.5x is re-rolled with a new seed, up to 5 tries, then the request fails with 502 and the router falls back. Decoding is capped at 2.6x the expected length so a runaway costs about 7 s instead of 20. Retries show in the `X-Ming-Retries` header and the server log. Question tags (`[Question-ei]` etc.) are the weak spot: expect 2-3 re-rolls, 15-25 s.

Networking: WSL2 NAT already forwards Windows `127.0.0.1:8893` into WSL; a `netsh portproxy` on `0.0.0.0:8894` re-exposes it, and a firewall rule admits only `100.64.0.0/10` (Tailscale). Windows 10 has no mirrored networking. Startup is the Scheduled Task `ming-tts-server` (at logon, no time limit, runs `pc/run-server.sh` in the foreground so `wsl.exe` keeps the VM alive).

Install on the PC (elevated): copy `ming_server.py`, `pc/*`, `joseph-ref.wav` (the reference at 44.1 kHz) and `joseph-ref.txt` (its transcript), plus any `<voice>-ref.wav`/`.txt` for a built-in voice (its own plain take; with one, that voice's emotion, tag and pitch/speed requests clone from it instead of being dropped) into one folder on the PC (e.g. `%USERPROFILE%\ai-eval\ming-server\`), then, from that folder, `powershell -ExecutionPolicy Bypass -File install.ps1`. Remove with `uninstall.ps1`. Restart the server: `wsl --shutdown` also stops other WSL jobs, so prefer `wsl -d Ubuntu-24.04 -u root -e pkill -f ming_server.py` then `schtasks /run /tn ming-tts-server`.

Check: `python3 -B test_ming_tts.py`.

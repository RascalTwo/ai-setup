#!/usr/bin/env python3
"""r2-tts: one way in for every generated voice. Usage and the why are in SKILL.md.

  r2_tts.py say --audience me|others|both [--lean me|others] (--text T | --text-file F) --out FILE
                [--speed S] [--emotion E]
  r2_tts.py serve [--port 8895]     OpenAI-style POST /v1/audio/speech (voicemode's endpoint)

Standard library only: launchd runs `serve` with no venv. The engines run in their own processes.
"""

from __future__ import annotations

import argparse
import array
import atexit
import base64
import dataclasses
import json
import math
import os
import re
import signal
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import final, override

HOME = Path.home()
STATE = HOME / ".agents/state/r2-tts"
PORT = int(os.environ.get("R2TTS_PORT", "8895"))
FFMPEG = os.environ.get("FFMPEG", "/opt/homebrew/bin/ffmpeg")
PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"  # launchd's PATH has no Homebrew (uv)
REF_WAV = Path(os.environ.get("R2TTS_REF_WAV", HOME / ".config/viz/voice-references/joseph-animated.wav"))
REF_TXT = REF_WAV.with_suffix(".txt")
ZONOS_DIR = Path(os.environ.get("R2TTS_ZONOS_DIR", STATE / "zonos3"))
ZONOS_URL = "http://127.0.0.1:1919"
ZONOS_TEMPO = 2.0  # delivery.tempo: Zonos is slow at 0; 2 matched Qwen3's pace in blind test 4
ZONOS_SEEDS = (7, 11, 23, 42)
QWEN_PYTHON = os.environ.get("R2TTS_QWEN_PYTHON", str(HOME / ".scratch/local-voice-cloning/.venv/bin/python"))
QWEN_MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"
QWEN_URL = "http://127.0.0.1:8892"
MING = os.environ.get("MING_URL", "http://100.65.216.8:8894")
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
PHONON_VOICE = os.environ.get("PHONON_VOICE", "Harper")
IDLE_S = 300
ENV_FILE = HOME / ".voicemode/voicemode.env"
MING_BUILTIN = {"us_emma", "us_james", "us_stella", "uk_george", "uk_charlotte"}
TAG = re.compile(r"\[[A-Za-z-]+\]")
EMOTIONS = {"", "neutral", "happy", "sad", "angry", "fear", "disgust", "surprise"}  # Ming's set
AUDIENCE_VOICE = {"me": "harper", "others": "joseph"}  # you hear somebody else; everyone else hears you
CHAINS = {
    "joseph": ["zonos", "qwen3", "ming", "phonon", "say"],
    "harper": ["phonon", "ming", "say"],
}
FORMATS = {  # format -> (content type, ffmpeg output args)
    "wav": ("audio/wav", ["-f", "wav"]),
    "mp3": ("audio/mpeg", ["-f", "mp3"]),
    "opus": ("audio/ogg", ["-c:a", "libopus", "-f", "ogg"]),
    "flac": ("audio/flac", ["-f", "flac"]),
    "aac": ("audio/aac", ["-f", "adts"]),
    "pcm": ("audio/L16", ["-f", "s16le", "-ac", "1"]),  # OpenAI pcm: 24 kHz s16le mono
}
EXT_FORMAT = {".ogg": "opus", ".m4a": "aac"}


def log(*parts: object) -> None:
    print(*parts, file=sys.stderr, flush=True)


@dataclasses.dataclass
class Req:
    text: str
    voice: str  # "joseph" or "harper"
    speed: float = 1.0
    emotion: str = ""
    pitch: str = ""
    volume: str = ""
    ming_voice: str = ""  # a Ming built-in asked for by name
    fmt: str = "wav"
    tries: list[str] = dataclasses.field(default_factory=list)  # "engine:why" per failed attempt, for the log

    def chain(self) -> list[str]:
        chain = list(CHAINS[self.voice])
        # Inline tags, pitch, volume and emotion start at Ming: Joseph preferred Ming's happy to Zonos's
        # emotions.happy at 1.0 and 2.0 (A/B 2026-11-20), so the rest of the chain speaks such lines plainly.
        if self.ming_voice or TAG.search(self.text) or self.pitch or self.volume or self.emotion not in {"", "neutral"}:
            chain.remove("ming")
            chain.insert(0, "ming")
        return chain


# ── text ────────────────────────────────────────────────────────────────────────────────────────


def pronunciation_rules(path: Path = ENV_FILE) -> list[tuple[re.Pattern[str], str]]:
    """voicemode.env's `TTS <regex> <replacement> # comment` lines; re-read per request so edits apply live."""
    rules: list[tuple[re.Pattern[str], str]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return rules
    for line in lines:
        m = re.match(r"TTS\s+(\S+)\s+(.*?)\s*(?:#.*)?$", line.strip())
        if m:
            try:
                rules.append((re.compile(m[1]), m[2]))
            except re.error:
                log("r2-tts: bad TTS rule skipped:", line)
    return rules


def apply_rules(text: str, rules: list[tuple[re.Pattern[str], str]]) -> str:
    for rx, rep in rules:
        text = rx.sub(rep, text)
    return text


def expected_s(text: str) -> float:
    """Speech length to expect: ~19 chars/s, plus ~0.8 s per inline tag (Ming's measured rule)."""
    return max(0.8, len(TAG.sub("", text)) / 19 + 0.8 * len(TAG.findall(text)))


# ── audio checks ────────────────────────────────────────────────────────────────────────────────

RATE = 16000
FRAME = RATE // 50  # 20 ms


def pcm16(audio: bytes) -> array.array[int]:
    """Any audio ffmpeg reads -> 16 kHz mono s16 samples, so wav float/int variants all look alike."""
    out = subprocess.run(
        [FFMPEG, "-v", "error", "-i", "pipe:0", "-f", "s16le", "-ac", "1", "-ar", str(RATE), "pipe:1"],
        input=audio, capture_output=True, check=True,
    ).stdout
    samples = array.array("h")
    samples.frombytes(out[: len(out) // 2 * 2])
    return samples


def voiced(samples: array.array[int]) -> list[bool]:
    """One flag per 20 ms frame. Silence is relative to the clip's own loud frames, because an
    absolute floor counted Zonos's quiet speech as silence."""
    rms = [
        math.sqrt(sum(s * s for s in samples[i : i + FRAME]) / FRAME)
        for i in range(0, len(samples) - FRAME + 1, FRAME)
    ]
    if not rms:
        return []
    loud = sorted(rms)[int(len(rms) * 0.95)]
    return [r > loud * 0.03 for r in rms]  # 30 dB under the loud frames


def shape(samples: array.array[int]) -> tuple[float, float]:
    """(seconds, longest pause between the first and last sound)."""
    voiced_ = voiced(samples)
    if not voiced_:
        return 0.0, 0.0
    if True not in voiced_:
        return len(samples) / RATE, len(samples) / RATE
    first, last = voiced_.index(True), len(voiced_) - 1 - voiced_[::-1].index(True)
    longest = run = 0
    for v in voiced_[first : last + 1]:
        run = 0 if v else run + 1
        longest = max(longest, run)
    return len(samples) / RATE, longest * FRAME / RATE


def word_times(audio: bytes, text: str) -> list[tuple[str, float, float]]:
    """[(word, start s, end s)] estimated from the clip: the words share out the sounding frames by
    length, so pauses fall between words. shortcut: no forced alignment, so a word can be off by
    ~0.2 s; align with an ASR when something needs exact times."""
    frames = [i for i, v in enumerate(voiced(pcm16(audio))) if v]
    words = text.split()
    total = sum(len(w) + 1 for w in words)
    if not frames or not words:
        return []
    out: list[tuple[str, float, float]] = []
    done = 0
    for w in words:
        a = frames[min(len(frames) - 1, done * len(frames) // total)]
        done += len(w) + 1
        b = frames[max(0, done * len(frames) // total - 1)]
        out.append((w, round(a * FRAME / RATE, 3), round((b + 1) * FRAME / RATE, 3)))
    return out


def good_take(audio: bytes, text: str) -> str:
    """'' if the take is plausible, else why not: Zonos sometimes leaves a long gap or stops short."""
    secs, pause = shape(pcm16(audio))
    exp = expected_s(text)
    if not 0.4 * exp <= secs <= 2.5 * exp:
        return f"length {secs:.1f}s vs expected {exp:.1f}s"
    if pause > 1.0:
        return f"{pause:.1f}s pause"
    return ""


def finish(audio: bytes, fmt: str, retime: float = 1.0) -> bytes:
    """Retime (for engines that speak only at 1.0), level to -16 LUFS (Zonos runs ~6 dB quiet), encode."""
    filters = [f"atempo={retime}"] if abs(retime - 1.0) > 0.01 else []
    filters.append("loudnorm=I=-16:TP=-1.5:LRA=11")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "out"  # a file, not a pipe, so wav headers carry real sizes
        subprocess.run(
            [FFMPEG, "-v", "error", "-i", "pipe:0", "-filter:a", ",".join(filters), "-ar", "24000",
             *FORMATS[fmt][1], str(out)],
            input=audio, capture_output=True, check=True,
        )
        return out.read_bytes()


# ── engines ─────────────────────────────────────────────────────────────────────────────────────


def http(url: str, body: object | None = None, timeout: float = 60) -> tuple[bytes, dict[str, str]]:
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data, {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), dict(r.headers)


def up(url: str) -> bool:
    try:
        http(url, timeout=1)
    except (OSError, ValueError):
        return False
    return True


@final
class LocalServer:
    """A model server on the Mac started on first need and stopped after IDLE_S idle (serve) or at
    exit (say), so no model sits in memory unused. One render at a time: the Mac is the slow path."""

    def __init__(self, name: str, probe: str, cmd: Callable[[], list[str]], start_s: float) -> None:
        self.name, self.probe, self.cmd, self.start_s = name, probe, cmd, start_s
        self.proc: subprocess.Popen[bytes] | None = None
        self.last = 0.0
        self.lock = threading.Lock()

    def ensure(self) -> None:
        if up(self.probe):
            return
        STATE.mkdir(parents=True, exist_ok=True)
        logf = (STATE / f"{self.name}-serve.log").open("ab")
        self.proc = subprocess.Popen(self.cmd(), stdout=logf, stderr=logf, env={**os.environ, "PATH": PATH})
        end = time.time() + self.start_s
        while not up(self.probe):
            if self.proc.poll() is not None or time.time() > end:
                self.stop()
                msg = f"{self.name} server did not start; see {STATE}/{self.name}-serve.log"
                raise RuntimeError(msg)
            time.sleep(0.5)

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
        self.proc = None

    def reap(self) -> None:
        if self.proc and time.time() - self.last > IDLE_S and self.lock.acquire(blocking=False):
            try:
                self.stop()
            finally:
                self.lock.release()


zonos_server = LocalServer("zonos", ZONOS_URL + "/v2/capabilities",
                           lambda: ["bash", str(ZONOS_DIR / "servers/mlx/scripts/serve.sh")], 180)
qwen_server = LocalServer("qwen3", QWEN_URL + "/openapi.json",
                          lambda: [QWEN_PYTHON, "-m", "mlx_audio.server", "--host", "127.0.0.1", "--port", "8892"], 90)


def zonos(r: Req) -> tuple[bytes, bool]:
    """Joseph's voice, cloned from REF_WAV. Re-rolls the seed on an implausible length or a long pause."""
    controls = {"delivery.tempo": ZONOS_TEMPO}
    ref = base64.b64encode(REF_WAV.read_bytes()).decode()
    with zonos_server.lock:
        zonos_server.ensure()
        for seed in ZONOS_SEEDS:
            body = {"text": r.text, "stream": False, "format": "wav", "speaker_mode": "reference",
                    "speaker_audio_base64": ref, "seed": seed, "controls": controls}
            wav, _ = http(ZONOS_URL + "/v2/generate", body, 300)
            zonos_server.last = time.time()
            why = good_take(wav, r.text)
            if not why:
                return wav, False
            r.tries.append(f"zonos seed {seed}: {why}")
    msg = f"no good Zonos take in {len(ZONOS_SEEDS)} seeds"
    raise RuntimeError(msg)


def qwen3(r: Req) -> tuple[bytes, bool]:
    body = {"model": QWEN_MODEL, "input": r.text, "ref_audio": str(REF_WAV), "ref_text": REF_TXT.read_text(encoding="utf-8").strip(),
            "speed": r.speed, "temperature": 0, "lang_code": "English", "max_tokens": 512, "response_format": "wav"}
    with qwen_server.lock:
        qwen_server.ensure()
        wav, _ = http(QWEN_URL + "/v1/audio/speech", body, 600)
        qwen_server.last = time.time()
    return wav, True


@final
class PcHealth:
    """One short probe, cached 30 s, so a powered-off PC costs ~1 s once, not a hang per request."""

    def __init__(self) -> None:
        self.at, self.ok = 0.0, False

    def up(self) -> bool:
        if time.time() - self.at > 30:
            self.ok, self.at = up(MING + "/health"), time.time()
        return self.ok


pc = PcHealth()


def ming(r: Req) -> tuple[bytes, bool]:
    """Ming on the home PC: Joseph's clone, or a built-in voice (US_Emma unless one is named)."""
    if not pc.up():
        msg = "PC is away"
        raise RuntimeError(msg)
    voice = "joseph" if r.voice == "joseph" else (r.ming_voice or "us_emma")
    extra = {k: v for k, v in (("emotion", r.emotion), ("pitch", r.pitch), ("volume", r.volume)) if v}
    try:
        wav, _ = http(MING + "/v1/audio/speech", {**extra, "input": r.text, "voice": voice, "speed": r.speed}, 120)
    except urllib.error.HTTPError:
        raise  # reachable but unhappy (it re-rolled 5 times): fall back, keep the PC "up"
    except OSError:
        pc.at, pc.ok = time.time(), False
        raise
    return wav, True


def phonon(r: Req) -> tuple[bytes, bool]:
    """phonon via Ollama: speaks only at 1.0 and returns only wav or pcm."""
    body = {"model": "phonon", "input": r.text, "voice": PHONON_VOICE, "response_format": "wav"}
    # phonon answers in 0.2-2 s; a longer wait means Ollama is busy with another model, so move on.
    return http(OLLAMA + "/v1/audio/speech", body, 15)[0], False


def say(r: Req) -> tuple[bytes, bool]:
    """macOS `say`: always there, the floor of every chain."""
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "say.aiff"
        subprocess.run(["/usr/bin/say", "-o", str(out), r.text], check=True, capture_output=True)
        return out.read_bytes(), False


ENGINES: dict[str, Callable[[Req], tuple[bytes, bool]]] = {
    "zonos": zonos, "qwen3": qwen3, "ming": ming, "phonon": phonon, "say": say,
}


def synthesize(r: Req) -> tuple[bytes, str]:
    """(audio in r.fmt, engine name): the first engine in the voice's chain that gives a take."""
    if r.fmt not in FORMATS:
        msg = f"unsupported format {r.fmt!r}"
        raise ValueError(msg)
    r.text = apply_rules(r.text, pronunciation_rules())
    if not TAG.sub("", r.text).strip():
        msg = "nothing to say"
        raise ValueError(msg)
    for name in r.chain():
        plain = r.text if name == "ming" else TAG.sub("", r.text).strip()  # only Ming speaks [Laughter]
        try:
            audio, native_speed = ENGINES[name](dataclasses.replace(r, text=plain))
            return finish(audio, r.fmt, 1.0 if native_speed else r.speed), name
        except Exception as e:
            r.tries.append(f"{name}: {e!r}"[:300])
            log(f"r2-tts: {name} failed for {r.voice}: {e!r}"[:300])
    msg = "every engine failed: " + "; ".join(r.tries)
    raise RuntimeError(msg)


# ── serve: voicemode's endpoint ─────────────────────────────────────────────────────────────────


def request_from_json(body: dict[str, object]) -> Req:
    """OpenAI speech body plus extras. `audience` wins; else `joseph` (or pr-viz's ref_audio) is you,
    a Ming built-in by name is that voice, and anything else (af_sky...) is the not-you voice."""
    voice = str(body.get("voice") or "").lower()
    audience = str(body.get("audience") or "")
    if audience:
        if audience not in AUDIENCE_VOICE:
            msg = f"audience must be me or others, not {audience!r}"
            raise ValueError(msg)
        who = AUDIENCE_VOICE[audience]
    else:
        who = "joseph" if voice == "joseph" or body.get("ref_audio") else "harper"
    emotion = str(body.get("emotion") or "").lower()
    if emotion not in EMOTIONS:
        msg = f"emotion must be one of {sorted(EMOTIONS - {''})}, not {emotion!r}"
        raise ValueError(msg)
    return Req(
        text=str(body.get("input") or ""), voice=who, speed=float(str(body.get("speed") or 1.0)),
        emotion=emotion, pitch=str(body.get("pitch") or ""),
        volume=str(body.get("volume") or ""), ming_voice=voice if voice in MING_BUILTIN else "",
        fmt=str(body.get("response_format") or "mp3"),
    )


@final
class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes | dict[str, object], ctype: str = "application/json",
              extra: dict[str, str] | None = None) -> None:
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        # /openapi.json is pr-viz's "is a server listening" probe; /v1/models and voices are voicemode's discovery.
        if self.path == "/health":
            self._send(200, {"ok": True, "pc_up": pc.up()})
        elif self.path in {"/openapi.json", "/v1/models"}:
            self._send(200, {"data": [{"id": "tts-1"}]})
        elif self.path == "/v1/audio/voices":
            self._send(200, {"voices": ["joseph", "harper"]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/v1/audio/speech":
            self._send(404, {"error": "not found"})
            return
        t0 = time.time()
        try:
            r = request_from_json(json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0)))))
            audio, engine = synthesize(r)
        except (ValueError, json.JSONDecodeError) as e:
            self._send(400, {"error": str(e)})
            return
        except Exception as e:
            log("r2-tts: error:", repr(e))
            self._send(502, {"error": str(e)})
            return
        log(f"{r.voice} -> {engine} tries={len(r.tries)} {time.time() - t0:.1f}s")
        self._send(200, audio, FORMATS[r.fmt][0], {"X-Voice-Backend": engine, "X-TTS-Tries": str(len(r.tries))})

    @override
    def log_message(self, format: str, *args: object) -> None:
        pass  # one line per request comes from do_POST


def serve(port: int) -> None:
    def reaper() -> None:
        while True:
            time.sleep(30)
            zonos_server.reap()
            qwen_server.reap()

    def shutdown(*_: object) -> None:  # launchd restarts send SIGTERM: take our model servers with us
        zonos_server.stop()
        qwen_server.stop()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    threading.Thread(target=reaper, daemon=True).start()
    log(f"r2-tts serving on 127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


# ── say: the command every tool calls ───────────────────────────────────────────────────────────


def speak_one(text: str, audience: str, out: Path, speed: float, emotion: str, words: Path | None = None) -> dict[str, object]:
    """Through the running daemon when there is one (its model servers stay warm between calls),
    else in this process."""
    fmt = EXT_FORMAT.get(out.suffix.lower(), out.suffix.lower().lstrip("."))
    body: dict[str, object] = {"input": text, "audience": audience, "speed": speed, "emotion": emotion,
                               "response_format": fmt}
    if os.environ.get("R2TTS_LOCAL") != "1" and up(f"http://127.0.0.1:{PORT}/health"):
        try:
            audio, headers = http(f"http://127.0.0.1:{PORT}/v1/audio/speech", body, 900)
        except urllib.error.HTTPError as e:
            msg = f"r2-tts serve answered {e.code}: {e.read()[:300]!r}"
            raise RuntimeError(msg) from e
        engine = headers.get("X-Voice-Backend", "?")
    else:
        audio, engine = synthesize(request_from_json(body))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(audio)
    if words:
        words.write_text(json.dumps(word_times(audio, text)), encoding="utf-8")
    return {"file": str(out), "audience": audience, "voice": AUDIENCE_VOICE[audience], "engine": engine}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="r2-tts", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("say", help="speak text to a file; prints one JSON line per file written")
    s.add_argument("--audience", required=True, choices=["me", "others", "both"],
                   help="who will hear it: me = Joseph (a not-Joseph voice), others = Joseph's voice, both = two files")
    s.add_argument("--lean", choices=["me", "others"], help="with --audience both: the likelier audience, the default track")
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--text")
    g.add_argument("--text-file", type=Path)
    s.add_argument("--out", required=True, type=Path, help="wav, mp3, flac, ogg (opus) or aac, by extension")
    s.add_argument("--speed", type=float, default=1.0)
    s.add_argument("--words", type=Path, help="also write [[word, start, end], ...] estimated from the clip (one audience only)")
    s.add_argument("--emotion", default="", help="happy, sad, angry, fear, disgust, surprise: starts at Ming; other engines speak plainly")
    v = sub.add_parser("serve", help="the OpenAI-style HTTP endpoint (launchd runs this)")
    v.add_argument("--port", type=int, default=PORT)
    a = p.parse_args(argv)

    if a.cmd == "serve":
        serve(a.port)
        return 0
    if a.audience == "both" and not a.lean:
        p.error("--audience both needs --lean me|others (which track plays by default)")
    if a.audience == "both" and a.words:
        p.error("--words takes one audience")
    text = a.text if a.text is not None else a.text_file.read_text(encoding="utf-8")
    atexit.register(zonos_server.stop)  # a model this process started goes when it does
    atexit.register(qwen_server.stop)
    out: Path = a.out
    targets = [(a.audience, out)] if a.audience != "both" else [
        (who, out.with_name(f"{out.stem}.{who}{out.suffix}")) for who in (a.lean, "others" if a.lean == "me" else "me")
    ]
    for i, (who, path) in enumerate(targets):
        try:
            line = speak_one(text, who, path, a.speed, a.emotion, a.words)
        except (RuntimeError, ValueError) as e:
            log(f"r2-tts: {e}")
            return 1
        if a.audience == "both":
            line["default"] = i == 0
        print(json.dumps(line), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())

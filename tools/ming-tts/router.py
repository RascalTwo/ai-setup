"""Local OpenAI-compatible TTS router: Ming on the PC first, Mac fallbacks when the PC is away.

  joseph (or any request carrying ref_audio, i.e. pr-viz) -> PC Ming "joseph"   -> local Qwen3 (mlx_audio.server, on demand)
  anything else (af_sky, emma, ...)                       -> PC Ming "US_Emma"  -> local phonon "Harper" (Ollama)
Applies the `TTS <regex> <replacement>` rules from ~/.voicemode/voicemode.env to every request. See README.md.
"""
import json, os, re, subprocess, sys, threading, time, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("ROUTER_PORT", "8895"))
MING = os.environ.get("MING_URL", "http://100.65.216.8:8894")
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
PHONON_VOICE = os.environ.get("PHONON_VOICE", "Harper")  # closest phonon voice to Kokoro af_sky (pitch + MFCC timbre)
QWEN_PORT = 8892
QWEN_IDLE_S = 300
HOME = os.path.expanduser("~")
ENV_FILE = os.path.join(HOME, ".voicemode/voicemode.env")
VOICES_JSON = os.path.join(HOME, ".config/viz/voices.json")
FFMPEG = os.environ.get("FFMPEG", "/opt/homebrew/bin/ffmpeg")
FORMATS = {  # response_format -> (content type, ffmpeg output args)
    "mp3": ("audio/mpeg", ["-f", "mp3"]), "opus": ("audio/ogg", ["-c:a", "libopus", "-f", "ogg"]),
    "flac": ("audio/flac", ["-f", "flac"]), "aac": ("audio/aac", ["-f", "adts"]),
    "pcm": ("audio/L16", ["-f", "s16le", "-ar", "24000", "-ac", "1"]),  # OpenAI pcm: 24 kHz s16le mono
}
BUILTIN = {"us_emma", "us_james", "us_stella", "uk_george", "uk_charlotte"}


def pronunciation_rules(path=ENV_FILE):
    """`TTS <regex> <replacement> # comment` lines; re-read per request so edits apply live."""
    rules = []
    try:
        for line in open(path):
            m = re.match(r"TTS\s+(\S+)\s+(.*?)\s*(?:#.*)?$", line.strip())
            if m:
                try:
                    rules.append((re.compile(m[1]), m[2]))
                except re.error:
                    pass
    except OSError:
        pass
    return rules


def apply_rules(text, rules):
    for rx, rep in rules:
        text = rx.sub(rep, text)
    return text


def http_json(url, body, timeout):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers


class PcHealth:
    """One short probe, cached 30 s, so a powered-off PC costs ~1 s once, not a hang per request."""
    def __init__(self):
        self.at, self.ok = 0.0, False

    def up(self):
        if time.time() - self.at > 30:
            try:
                urllib.request.urlopen(MING + "/health", timeout=1).read()
                self.ok = True
            except Exception:
                self.ok = False
            self.at = time.time()
        return self.ok

    def mark_down(self):
        self.at, self.ok = time.time(), False


pc = PcHealth()


class Qwen:
    """pr-viz's own Qwen3 path: mlx_audio.server started on first need, stopped after QWEN_IDLE_S idle."""
    def __init__(self):
        self.proc, self.last, self.lock = None, 0.0, threading.Lock()

    def _up(self):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{QWEN_PORT}/openapi.json", timeout=1).read()
            return True
        except Exception:
            return False

    def speak(self, text, speed):
        prof = next(p for p in json.load(open(VOICES_JSON))["profiles"] if p["id"] == "joseph-animated")
        with self.lock:
            if not self._up():
                self.proc = subprocess.Popen([prof["python"], "-m", "mlx_audio.server", "--host", "127.0.0.1", "--port", str(QWEN_PORT)],
                                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                end = time.time() + 90
                while not self._up():
                    if self.proc.poll() is not None or time.time() > end:
                        raise RuntimeError("mlx_audio.server did not start")
                    time.sleep(0.5)
        self.last = time.time()
        body = {"model": prof["model"], "input": text, "ref_audio": prof["referenceWav"], "ref_text": prof["transcript"],
                "speed": speed, "temperature": 0, "lang_code": "English", "max_tokens": 512, "response_format": "wav"}
        with self.lock:  # one render at a time: the Mac is the slow path
            wav, _ = http_json(f"http://127.0.0.1:{QWEN_PORT}/v1/audio/speech", body, 600)
        self.last = time.time()
        return wav

    def reap(self):
        if self.proc and self.proc.poll() is None and time.time() - self.last > QWEN_IDLE_S and self.lock.acquire(blocking=False):
            try:
                self.proc.terminate()
            finally:
                self.lock.release()


qwen = Qwen()


def convert(wav, fmt, speed=1.0):
    """wav -> the requested format; `speed` retimes it (atempo) for backends that only speak at 1.0."""
    tempo = ["-filter:a", f"atempo={speed}"] if abs(speed - 1.0) > 0.01 else []
    if fmt == "wav" and not tempo:
        return wav, "audio/wav"
    ctype, args = FORMATS[fmt] if fmt != "wav" else ("audio/wav", ["-f", "wav"])
    out = subprocess.run([FFMPEG, "-v", "error", "-i", "pipe:0", *tempo, *args, "pipe:1"], input=wav, capture_output=True, check=True).stdout
    return out, ctype


def synthesize(req):
    """Returns (audio bytes, content type, backend name, ming retries)."""
    fmt = req.get("response_format") or "mp3"
    if fmt not in FORMATS and fmt != "wav":
        raise ValueError(f"unsupported response_format {fmt!r}")
    text = apply_rules(str(req.get("input", "")), pronunciation_rules())
    speed = float(req.get("speed") or 1.0)
    voice = str(req.get("voice") or "")
    joseph = voice.lower() == "joseph" or bool(req.get("ref_audio"))
    ming_voice = "joseph" if joseph else (voice.lower() if voice.lower() in BUILTIN else "US_Emma")
    if pc.up():
        body = {k: req[k] for k in ("emotion", "pitch", "volume") if req.get(k)}
        try:
            wav, headers = http_json(MING + "/v1/audio/speech", {**body, "input": text, "voice": ming_voice, "speed": speed}, 120)
            audio, ctype = convert(wav, fmt)
            return audio, ctype, "ming", headers.get("X-Ming-Retries", "0")
        except urllib.error.HTTPError as e:
            print("ming refused:", e.code, e.read()[:200], file=sys.stderr, flush=True)  # reachable but unhappy: fall back, keep PC "up"
        except Exception as e:
            print("ming failed:", repr(e), file=sys.stderr, flush=True)
            pc.mark_down()
    if joseph:
        audio, ctype = convert(qwen.speak(text, speed), fmt)
        return audio, ctype, "qwen3", "0"
    # phonon (Ollama) speaks only at speed 1 and only returns wav/pcm: ask for wav, retime and convert here.
    wav, _ = http_json(OLLAMA + "/v1/audio/speech", {"model": "phonon", "input": text, "voice": PHONON_VOICE,
                                                     "response_format": "wav"}, 60)
    audio, ctype = convert(wav, fmt, speed)
    return audio, ctype, "phonon", "0"


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, str(v))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # openapi.json is pr-viz's "is a server already listening" probe; the rest is voicemode's endpoint discovery
        if self.path == "/health":
            self._send(200, {"ok": True, "pc_up": pc.up()})
        elif self.path in ("/openapi.json", "/v1/models"):
            self._send(200, {"data": [{"id": "tts-1"}]})
        elif self.path == "/v1/audio/voices":
            self._send(200, {"voices": ["joseph", "emma"]})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self._send(404, {"error": "not found"})
        t0 = time.time()
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            audio, ctype, backend, retries = synthesize(req)
        except (ValueError, json.JSONDecodeError) as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            print("error:", repr(e), file=sys.stderr, flush=True)
            return self._send(502, {"error": str(e)})
        print(f"{req.get('voice')} -> {backend} retries={retries} {time.time() - t0:.1f}s", file=sys.stderr, flush=True)
        self._send(200, audio, ctype, {"X-Voice-Backend": backend, "X-Ming-Retries": retries})


if __name__ == "__main__":
    def reaper():
        while True:
            time.sleep(30)
            qwen.reap()
    threading.Thread(target=reaper, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

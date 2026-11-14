"""Ming-3.0-tts-0.5B behind an OpenAI-style POST /v1/audio/speech (wav only). Runs in WSL on the PC.

Stdlib HTTP only. The model loads on the first request and unloads after IDLE_S without one,
so the gaming PC's VRAM is free when nobody is listening. See README.md.
"""
import io, json, os, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.environ.get("MING_MODEL_DIR", "/root/ming/Ming-3.0-tts-0.5b")
REPO_DIR = os.environ.get("MING_REPO_DIR", "/root/ming/repo")
IDLE_S = int(os.environ.get("MING_IDLE_S", "600"))
PORT = int(os.environ.get("MING_PORT", "8893"))
REF_WAV = os.path.join(HERE, "joseph-ref.wav")  # 44.1 kHz copy of the pr-viz joseph-animated reference
REF_TXT = os.path.join(HERE, "joseph-ref.txt")
BUILTIN = {v.lower(): v for v in ("US_Emma", "US_James", "US_Stella", "UK_George", "UK_Charlotte")}
EMOTIONS = {"happy": "高兴", "sad": "悲伤", "angry": "愤怒", "fear": "恐惧", "disgust": "厌恶", "surprise": "惊讶", "neutral": "中性"}
LEVEL = {"low": "低", "medium": "中", "high": "高"}
SPEED = {"slow": "慢速", "medium": "中速", "fast": "快速"}
STEPS_PER_S = 12.7  # measured: a take cut off at a 71-step cap came out 5.6 s long, so ~79 ms of audio per step
TAG = re.compile(r"\[[A-Za-z-]+\]")
MAX_TRIES = 5  # question tags needed up to 4 re-rolls in the demo run; a capped runaway costs ~1 s


def expected_s(text):
    """Speech length to expect: ~19 chars/s measured on 57-470 char lines, plus ~0.8 s per inline tag."""
    return max(0.8, len(TAG.sub("", text)) / 19 + 0.8 * len(TAG.findall(text)))


def plausible(audio_s, exp):
    return 0.4 * exp <= audio_s <= 2.5 * exp


class Ming:
    def __init__(self):
        self.lock, self.model, self.last = threading.Lock(), None, time.time()

    def _load(self):
        import sys
        sys.path.insert(0, REPO_DIR)
        from ming_tts import MingTTS
        self.model = MingTTS(MODEL_DIR, text_normalization=False)

    def unload_if_idle(self):
        if self.lock.acquire(blocking=False):
            try:
                if self.model is not None and time.time() - self.last > IDLE_S:
                    import gc, torch
                    self.model = None
                    gc.collect()
                    torch.cuda.empty_cache()
                    print("unloaded after idle", flush=True)
            finally:
                self.lock.release()

    def speak(self, req):
        """Returns (wav bytes, retries). Raises ValueError for a bad request, RuntimeError if no take was plausible."""
        import soundfile, torch
        text = str(req.get("input", "")).strip()
        if not text:
            raise ValueError("input is empty")
        voice = str(req.get("voice", "joseph")).lower()
        joseph = voice == "joseph"
        if not joseph and voice not in BUILTIN:
            raise ValueError(f"unknown voice {voice!r}: joseph or {sorted(BUILTIN)}")
        emotion, speed = req.get("emotion"), float(req.get("speed") or 1.0)
        pitch, volume = req.get("pitch"), req.get("volume")
        if emotion and emotion not in EMOTIONS:
            raise ValueError(f"emotion must be one of {sorted(EMOTIONS)}")
        for name, v in (("pitch", pitch), ("volume", volume)):
            if v and v not in LEVEL:
                raise ValueError(f"{name} must be one of {sorted(LEVEL)}")
        kw = {"language_id": "English", "use_zero_spk_emb": True}
        if joseph:
            kw = {"language_id": "English", "prompt_wav_path": REF_WAV, "use_spk_emb": True}
            basic = pitch or volume or speed < 0.9 or speed > 1.1
            if emotion:  # one control task per call: emotion wins over basic
                kw.update(task="EMOTION", controls={"emotion": EMOTIONS[emotion]})
            elif basic:
                kw.update(task="BASIC", controls={
                    "speed": SPEED["slow" if speed < 0.9 else "fast" if speed > 1.1 else "medium"],
                    "pitch": LEVEL.get(pitch, "中"), "volume": LEVEL.get(volume, "中")})
            else:
                kw.update(task="TTS", prompt_text=open(REF_TXT).read().strip())
        else:  # built-in voices take no inline tags or emotion/basic controls
            text = TAG.sub("", text).strip()
            kw.update(task="IP", controls={"ip": BUILTIN[voice]})
        exp = expected_s(text)
        # A runaway is cut off at 2.6x the expected length (instead of ~20 s), which lands above the 2.5x
        # plausibility ceiling, so a truncated take is rejected like any other runaway.
        kw["max_decode_steps"] = max(20, int(STEPS_PER_S * 2.6 * exp))
        with self.lock:
            if self.model is None:
                self._load()
            best = None
            for attempt in range(MAX_TRIES):
                torch.manual_seed(attempt + 1)
                wav = self.model.synthesize(text=text, **kw)
                audio_s = wav.shape[-1] / 44100
                print(f"voice={voice} try={attempt + 1} audio={audio_s:.1f}s expected={exp:.1f}s", flush=True)
                if plausible(audio_s, exp):
                    buf = io.BytesIO()
                    soundfile.write(buf, wav.squeeze().float().cpu().numpy(), 44100, format="WAV", subtype="PCM_16")
                    self.last = time.time()
                    return buf.getvalue(), attempt
            self.last = time.time()
            raise RuntimeError(f"no plausible take in {MAX_TRIES} tries")


ming = Ming()


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

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True, "loaded": ming.model is not None, "idle_s": int(time.time() - ming.last)})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self._send(404, {"error": "not found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            wav, retries = ming.speak(req)
        except (ValueError, json.JSONDecodeError) as e:
            return self._send(400, {"error": str(e)})
        except Exception as e:
            print("error:", repr(e), flush=True)
            return self._send(502, {"error": str(e)})
        self._send(200, wav, "audio/wav", {"X-Ming-Retries": retries})


if __name__ == "__main__":
    def reaper():
        while True:
            time.sleep(30)
            ming.unload_if_idle()
    threading.Thread(target=reaper, daemon=True).start()
    print(f"ming server on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

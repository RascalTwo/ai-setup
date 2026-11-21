"""Self-check for r2-tts's logic, engines faked: python3 -B test_r2_tts.py"""

import array
import io
import json
import math
import os
import tempfile
import wave
from contextlib import redirect_stdout
from pathlib import Path

os.environ["R2TTS_LOCAL"] = "1"  # never reach a running daemon from the tests
import r2_tts as t


def tone(*parts: tuple[float, bool]) -> bytes:
    """A 16-bit wav of (seconds, sounding?) parts."""
    samples = array.array("h")
    for secs, on in parts:
        samples.extend(int(8000 * math.sin(i / 8)) if on else 0 for i in range(int(secs * t.RATE)))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(t.RATE)
        w.writeframes(samples.tobytes())
    return buf.getvalue()


# Pronunciation rules: voicemode.env's TTS lines, whole words only, bad lines skipped.
with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False, encoding="utf-8") as env:
    env.write("TTS \\bJSON\\b jason # JSON\nTTS \\bkubectl\\b kube control\nTTS ( broken\nOTHER x y\n")
rules = t.pronunciation_rules(Path(env.name))
assert t.apply_rules("run kubectl on JSON", rules) == "run kube control on jason"
assert t.apply_rules("kubectlx", rules) == "kubectlx"

# Audience: me -> the not-you voice, others -> you; HTTP voice names keep the router's mapping.
assert t.request_from_json({"input": "x", "audience": "me"}).voice == "harper"
assert t.request_from_json({"input": "x", "audience": "others"}).voice == "joseph"
assert t.request_from_json({"input": "x", "voice": "af_sky"}).voice == "harper"
assert t.request_from_json({"input": "x", "voice": "joseph"}).voice == "joseph"
assert t.request_from_json({"input": "x", "ref_audio": "/r.wav"}).voice == "joseph"
try:
    t.request_from_json({"input": "x", "audience": "everyone"})
    raise AssertionError("bad audience accepted")
except ValueError:
    pass

# Chains: Zonos first for you; Ming jumps the queue for tags, pitch, a named built-in, or emotion in the not-you voice.
assert t.Req("hi", "joseph").chain() == ["zonos", "qwen3", "ming", "phonon", "say"]
assert t.Req("hi", "harper").chain() == ["phonon", "ming", "say"]
assert t.Req("hi [Laughter]", "joseph").chain()[0] == "ming"
assert t.Req("hi", "joseph", emotion="happy").chain()[0] == "ming"  # Ming's happy beat Zonos's in the A/B
assert t.Req("hi", "harper", emotion="happy").chain()[0] == "ming"
assert t.Req("hi", "joseph", emotion="neutral").chain()[0] == "zonos"
try:
    t.request_from_json({"input": "x", "emotion": "smug"})
    raise AssertionError("bad emotion accepted")
except ValueError:
    pass
assert t.request_from_json({"input": "x", "voice": "UK_George"}).chain()[0] == "ming"

# The Zonos guard: a plausible take passes; a long gap or a short stop is re-rolled.
text = "Hey, sounds good, give me a second and I'll take a look."  # expected ~3 s
assert t.good_take(tone((3, True)), text) == ""
assert "pause" in t.good_take(tone((1.2, True), (1.5, False), (1.2, True)), text)
assert "length" in t.good_take(tone((0.5, True)), text)
assert t.shape(t.pcm16(tone((0.5, False), (2, True), (0.8, False))))[1] < 0.1  # edge silence isn't a pause

# Word times share the sounding frames by word length, so a pause lands between words.
times = t.word_times(tone((1, True), (1, False), (1, True)), "abcd efgh")
assert [w for w, *_ in times] == ["abcd", "efgh"]
assert times[0][1] < 0.1 and 0.9 < times[0][2] < 1.1, times
assert 1.9 < times[1][1] < 2.1 and times[1][2] > 2.9, times

# Fallback: the first engine that answers wins, each failure is recorded, tags reach only Ming.
seen: list[tuple[str, str]] = []


def fake(name: str, ok: bool):
    def engine(r: t.Req) -> tuple[bytes, bool]:
        seen.append((name, r.text))
        if not ok:
            raise RuntimeError(f"{name} down")
        return tone((1, True)), False

    return engine


t.ENGINES.update(zonos=fake("zonos", ok=False), qwen3=fake("qwen3", ok=True), ming=fake("ming", ok=True),
                 phonon=fake("phonon", ok=True), say=fake("say", ok=True))
r = t.Req("Six! [Laughter]", "joseph")
r.chain = lambda: ["zonos", "qwen3"]  # type: ignore[method-assign]  # pyright: ignore[reportAttributeAccessIssue] -- pin the order under test
audio, engine = t.synthesize(r)
assert engine == "qwen3" and seen == [("zonos", "Six!"), ("qwen3", "Six!")], seen
assert len(r.tries) == 1 and r.tries[0].startswith("zonos")
assert audio[:4] == b"RIFF"
t.ENGINES.update(zonos=fake("zonos", ok=False), qwen3=fake("qwen3", ok=False), ming=fake("ming", ok=False),
                 phonon=fake("phonon", ok=False), say=fake("say", ok=False))
try:
    t.synthesize(t.Req("hi", "harper"))
    raise AssertionError("all-down did not raise")
except RuntimeError as e:
    assert "phonon" in str(e) and "say" in str(e)

# Retiming: an engine that speaks only at 1.0 is sped up by atempo.
slow = t.finish(tone((2, True)), "wav")
fast = t.finish(tone((2, True)), "wav", 2.0)
assert 0.4 < len(fast) / len(slow) < 0.6

# say --audience both: two files, the lean one first and marked default.
t.ENGINES.update(phonon=fake("phonon", ok=True), zonos=fake("zonos", ok=True))
with tempfile.TemporaryDirectory() as tmp:
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = t.main(["say", "--audience", "both", "--lean", "me", "--text", "hello", "--out", f"{tmp}/c.mp3"])
    lines = [json.loads(x) for x in buf.getvalue().splitlines()]
    assert code == 0 and [x["audience"] for x in lines] == ["me", "others"], lines
    assert lines[0]["default"] and not lines[1]["default"]
    assert [x["engine"] for x in lines] == ["phonon", "zonos"]
    assert Path(f"{tmp}/c.me.mp3").stat().st_size > 1000 and Path(f"{tmp}/c.others.mp3").exists()
print("ok")

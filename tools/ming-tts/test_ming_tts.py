"""Self-check for the pure logic: python3 test_ming_tts.py"""
import re, sys, tempfile
import router
sys.modules.setdefault("soundfile", None)  # ming_server imports it lazily; not needed here
import ming_server as srv

env = tempfile.NamedTemporaryFile("w", suffix=".env", delete=False)
env.write("TTS \\bJSON\\b jason # JSON as jason\nTTS \\bkubectl\\b kube control # kubectl\nTTS \\bAPI\\b A P I # api\nOTHER x y\n")
env.close()
rules = router.pronunciation_rules(env.name)
assert router.apply_rules("run kubectl on the API", rules) == "run kube control on the A P I"
assert router.apply_rules("kubectlx", rules) == "kubectlx"

e = srv.expected_s("Hey, sounds good, give me a second and I'll take a look.")  # measured 2.9 s
assert 2.5 < e < 3.5, e
assert srv.plausible(2.9, e) and not srv.plausible(20.4, e) and not srv.plausible(0.3, e)
assert srv.expected_s("Hey [Laughter] ok") > srv.expected_s("Hey ok")
# phonon only speaks at 1.0: the router retimes with atempo, and passes wav through untouched at 1.0
import subprocess
wav = subprocess.run([router.FFMPEG, "-v", "error", "-f", "lavfi", "-i", "sine=d=1", "-f", "wav", "pipe:1"], capture_output=True, check=True).stdout
assert router.convert(wav, "wav") == (wav, "audio/wav")
fast, ctype = router.convert(wav, "wav", 2.0)
assert ctype == "audio/wav" and len(fast) < len(wav) * 0.6
assert router.convert(wav, "mp3", 1.0)[1] == "audio/mpeg"
print("ok")

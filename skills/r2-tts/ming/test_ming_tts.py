"""Self-check for the Ming server's pure logic: python3 -B test_ming_tts.py"""

import sys

sys.modules.setdefault("soundfile", None)  # ming_server imports it lazily; not needed here
import ming_server as srv

e = srv.expected_s("Hey, sounds good, give me a second and I'll take a look.")  # measured 2.9 s
assert 2.5 < e < 3.5, e
assert srv.plausible(2.9, e) and not srv.plausible(20.4, e) and not srv.plausible(0.3, e)
assert srv.expected_s("Hey [Laughter] ok") > srv.expected_s("Hey ok")
print("ok")

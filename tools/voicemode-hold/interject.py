#!/usr/bin/env python3
"""Say something mid-sentence without ending the agent's turn.

prefix+m already exists and is the blunt instrument: it cuts the utterance dead
and hands you the mic. This is the other half — a *temporary* interruption. Press
once and playback holds where it is, the karaoke cursor freezes, and the mic
opens. Press again and playback carries on from the same word while what you said
is stashed. When the turn finally ends, the stash rides back to the agent glued
onto the front of your actual reply, in the order you said it.

Subcommands:

  toggle   The keybind. First press starts a capture, second press ends it.
  drain    Pop the stash. The transcript hook calls this from PostToolUse.
  demo     Self-check of the stash and the stale-pid path.

Two things make it safe to run off a single key:

  Capture and playback never overlap. Pause goes out before the stream opens and
  resume goes out the instant it closes, so the mic is only ever live while the
  speaker is silent — no TTS bleed into your own transcription.

  Resume happens before transcription, not after. Whisper takes about a second on
  a short clip, and that second would otherwise be dead air in the middle of a
  sentence. Nothing downstream needs the text until the converse call returns.
"""

import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import time
import wave
from datetime import datetime

WHISPER = os.environ.get("VOICEMODE_WHISPER_URL", "http://127.0.0.1:2022")
SOCKET = os.environ.get("VOICEMODE_CONTROL_SOCKET",
                        os.path.expanduser("~/.voicemode/control.sock"))

# What the transcript pane publishes about the utterance in flight, and the log
# voicemode writes the only clock those word timings mean anything against.
# Our own state. It lives under ~/.agents/state/<tool>/ like every other tool
# here, and deliberately NOT in ~/.voicemode/ — that directory belongs to
# voice-mode, and two owners writing into one directory is how you end up
# unable to say which files you may delete.
WORDS = os.path.expanduser("~/.agents/state/voicemode-hold/transcript.json")
EVENTS = os.path.expanduser("~/.voicemode/logs/events/voicemode_events_%Y-%m-%d.jsonl")

# Words of run-up handed back with an interjection. Enough to place "no, that's
# wrong" against a referent; not so much that it competes with the reply.
RUN_UP = 18

PID = os.path.expanduser("~/.agents/state/voicemode-hold/.interject.pid")

# Written only once a pause has actually been delivered, and it is this — not the
# pid file — that tells the pane to freeze its karaoke cursor. The two used to be
# the same file, which meant a pause the server never received still froze the
# highlight: the words stopped and the voice carried on.
HOLD = os.path.expanduser("~/.agents/state/voicemode-hold/.interject.hold")
STASH = os.path.expanduser("~/.agents/state/voicemode-hold/interjections.jsonl")
CLIP = os.path.expanduser("~/.agents/state/voicemode-hold/.interject.wav")

RATE = 16000

# The same two cues voicemode plays around its own recording — 800Hz then 1000Hz
# opening, the reverse closing — regenerated rather than imported. Importing
# voice_mode.core to borrow them costs a second or two of module load, and the
# whole point of the hold is that it lands on the word you pressed at.
CHIME_RATE = 24000
OPENING, CLOSING = (800, 1000), (1000, 800)

# The backstop for a capture you walked away from, not the normal way to end one
# — that is a second press. Well under voicemode's own 300s pause timeout, which
# stops playback outright and cannot be resumed from.
MAX_CAPTURE = 60


def control(command):
    """One newline-delimited JSON line to the socket voicemode listens on while
    it speaks. Written directly rather than through the `voicemode` CLI: that
    costs most of a second to start at each end of the hold, and the pane
    measures the hold to decide how far to shift its karaoke clock — so the
    CLI's own startup time came out as the highlight lagging the voice.

    Returns whether it landed. The socket only exists while the server is
    speaking, so a miss is ordinary — it means there was nothing to pause.
    """
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(2)
            client.connect(SOCKET)
            client.sendall(json.dumps({"command": command}).encode() + b"\n")
        return True
    except OSError:
        return False


# ---------------------------------------------------------------- position

def audio_start(path=None):
    """Epoch of the live utterance's first audio, or None if nothing is playing.

    voicemode's event log, not the transcript file's own t0: that one is when the
    hook fired, which leads real audio by the MCP round trip and conch
    acquisition, and by a margin that is not constant.
    """
    path = path or time.strftime(EVENTS)
    try:
        with open(path) as f:
            lines = f.readlines()[-500:]
    except OSError:
        return None
    started = None
    for line in lines:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("event_type") == "TTS_FIRST_AUDIO":
            started = datetime.fromisoformat(ev["timestamp"]).timestamp()
        elif ev.get("event_type") == "TTS_PLAYBACK_END":
            started = None  # that utterance is over; nothing is in flight
    return started


def glue(words):
    """Join spoken tokens back into a sentence, punctuation kept tight."""
    out = ""
    for w in words:
        out += w if not out or re.fullmatch(r"[^\w]+", w) else " " + w
    return out.strip()


def position(t0):
    """The tail of what had actually been said when the hold went in.

    An interjection is close to unreadable without it. "No, that's wrong" needs a
    referent, and the agent has no other way to know how far into its own
    sentence it got — it wrote the whole thing before the first word was spoken.
    """
    if t0 is None:
        return ""
    try:
        with open(WORDS) as f:
            words = json.load(f).get("words") or []
    except (OSError, ValueError):
        return ""
    elapsed = time.time() - t0
    # Past the end of the text we are holding means the text is not the one
    # playing: the pane had not caught up to a new utterance yet, and the words
    # on hand belong to the last one. Quoting those back would be a lie.
    if not words or elapsed > words[-1]["end_time"] + 1:
        return ""
    return glue([w["word"] for w in words if w["start_time"] <= elapsed][-RUN_UP:])


# ---------------------------------------------------------------- stash

def stash(text, at=""):
    with open(STASH, "a") as f:
        f.write(json.dumps({"t": time.time(), "text": text, "at": at}) + "\n")


def drain(_argv=None):
    """Pop every interjection, oldest first. Reading is destructive by design:
    each one belongs to exactly one agent turn, and a note replayed on the next
    turn reads as the user repeating themselves."""
    try:
        with open(STASH) as f:
            said = [json.loads(line) for line in f if line.strip()]
    except (OSError, ValueError):
        return []
    os.remove(STASH)
    return said


# ---------------------------------------------------------------- capture

def chime(tones, seconds=0.1):
    """Two faded sine tones out the default output. Never while the stream is
    open: the microphone would record the cue and hand it to whisper."""
    import numpy as np
    import sounddevice as sd

    # Bluetooth output is quiet enough that voicemode's near-silent default
    # vanishes on it, so it takes the same louder amplitude voicemode uses.
    amplitude = 0.0375
    try:
        name = sd.query_devices(kind="output")["name"].lower()
        if any(k in name for k in ("airpod", "bluetooth", "bt", "wh-", "wf-")):
            amplitude = 0.15
    except Exception:
        pass

    t = np.linspace(0, seconds, int(CHIME_RATE * seconds), endpoint=False)
    fade = np.linspace(0, 1, int(CHIME_RATE * 0.01))  # 10ms, or it clicks
    parts = []
    for hz in tones:
        tone = amplitude * np.sin(2 * np.pi * hz * t)
        tone[:len(fade)] *= fade
        tone[-len(fade):] *= fade[::-1]
        parts.append(tone)
    try:
        sd.play(np.concatenate(parts).astype(np.float32), CHIME_RATE)
        sd.wait()
    except Exception:
        pass


def spoken(text):
    """Whisper labels silence rather than returning nothing — "[BLANK_AUDIO]",
    "(silence)". A press and an unpress with nothing in between is not an
    interjection, and must not reach the agent as one."""
    text = text.strip()
    return "" if re.fullmatch(r"[\[(].*[\])]", text) else text


def transcribe(path):
    out = subprocess.run(
        ["curl", "-s", "-m", "30", f"{WHISPER}/v1/audio/transcriptions",
         "-F", f"file=@{path}", "-F", "model=whisper-1",
         "-F", "response_format=json"],
        capture_output=True, text=True)
    try:
        return (json.loads(out.stdout).get("text") or "").strip()
    except ValueError:
        return ""


def capture(_argv=None):
    """Hold playback, record until the second press, then let playback go on."""
    import numpy as np
    import sounddevice as sd

    with open(PID, "w") as f:
        f.write(str(os.getpid()))

    at = ""
    done = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: done.set())
    signal.signal(signal.SIGINT, lambda *_: done.set())

    frames = []
    try:
        # Only freeze the pane if the server actually took the pause. It binds
        # the socket while it speaks, so pressing the key during the gap between
        # a turn being generated and its first sample reaching the device finds
        # nothing listening — and used to stop the highlight anyway.
        if control("pause"):
            open(HOLD, "w").close()
        # None when nothing was playing — the key still works as a standalone
        # note, it just has no utterance to place itself in.
        playing = audio_start()
        at = position(playing)  # where the voice got to, before the mic opens
        chime(OPENING)
        started = time.time()
        with sd.InputStream(samplerate=RATE, channels=1, dtype="int16",
                            callback=lambda data, *_: frames.append(data.copy())):
            # Interruptible on the main thread: the second press arrives as
            # SIGTERM and breaks the wait rather than running out the backstop.
            while not done.wait(0.25):
                if time.time() - started > MAX_CAPTURE:
                    break
                # prefix+m, a stop, or the pause timeout ends the turn out from
                # under the hold. There is then nothing to resume into and
                # voicemode wants the mic for its own listen, so the capture ends
                # with the utterance rather than recording over the top of it.
                if playing and audio_start() is None:
                    break
    finally:
        chime(CLOSING)  # before the resume, so it doesn't land over my own voice
        control("resume")
        for marker in (HOLD, PID):
            try:
                os.remove(marker)
            except OSError:
                pass

    if not frames:
        return
    with wave.open(CLIP, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(np.concatenate(frames).tobytes())
    text = spoken(transcribe(CLIP))
    if text:
        stash(text, at)


def running():
    """The pid of a live capture, or None. A pid file outlives a worker that was
    killed outright, so the file alone is not the answer — the process is."""
    try:
        with open(PID) as f:
            pid = int(f.read().strip())
    except (OSError, ValueError):
        return None
    try:
        os.kill(pid, 0)
    except OSError:
        os.remove(PID)
        return None
    return pid


def toggle(_argv=None):
    pid = running()
    if pid:
        os.kill(pid, signal.SIGTERM)
        return
    # Detached: the key press must return at once, and the capture outlives it.
    subprocess.Popen([sys.executable, __file__, "capture"],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


# ---------------------------------------------------------------- demo

def demo(_argv=None):
    global PID, STASH
    PID = "/tmp/.interject-demo.pid"
    STASH = "/tmp/interject-demo.jsonl"
    for p in (PID, STASH):
        if os.path.exists(p):
            os.remove(p)

    assert drain() == [], "no stash reads as nothing said"
    stash("wait, the other file", "so the helper lives in")
    stash("and skip the tests")
    popped = drain()
    assert [n["text"] for n in popped] == ["wait, the other file", "and skip the tests"], "order preserved"
    assert popped[0]["at"] == "so the helper lives in", "each one remembers where it landed"
    assert drain() == [], "draining is destructive"

    assert glue(["no", ",", "the", "other", "file", "."]) == "no, the other file.", "punctuation stays tight"
    assert audio_start("/nonexistent") is None, "no event log, no position"
    assert position(None) == "", "nothing playing, nothing to place it against"

    assert spoken("[BLANK_AUDIO]") == "", "silence is not an interjection"
    assert spoken("(silence)") == "", "nor is whisper's other label for it"
    assert spoken("  wait  ") == "wait", "real speech survives"
    assert spoken("(see the file) but skip it").startswith("("), "only a wholly bracketed line is dropped"

    assert running() is None, "no pid file means no capture"
    with open(PID, "w") as f:
        f.write("999999")  # a pid that cannot be live
    assert running() is None, "a stale pid does not block a new capture"
    assert not os.path.exists(PID), "and is cleaned up on the way past"
    print("ok")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "demo"
    out = {"toggle": toggle, "capture": capture, "drain": drain, "demo": demo}[cmd](sys.argv)
    if cmd == "drain":
        print(json.dumps(out))  # the transcript hook shells out for this

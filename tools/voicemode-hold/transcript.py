#!/usr/bin/env python3
"""Live transcript pane for mcp__voicemode__converse.

Highlights the word being spoken as it is spoken, karaoke style, so the pane
shows what is coming as well as what has been said. Supersedes the shell version
that tailed an append-only log and so could only ever show speech after the fact.

Subcommands:

  prime   PreToolUse hook. Takes the converse tool_input on stdin, asks Kokoro
          for word-level timestamps of the text about to be spoken, and drops
          them in STATE. Runs detached so it never delays the speech, and opens
          the pane if one isn't up.
  heard   PostToolUse hook. Records whisper's transcription of the reply.
  view    Render loop for the pane. Repaints the utterance every frame with words
          coloured by whether they have been spoken, are being spoken right now,
          or are still coming.
  demo    Self-check of the cursor maths.

Two things make the highlight land on the right word:

  Word timings come from Kokoro itself. The TTS voicemode already speaks through
  exposes /dev/captioned_speech, which returns per-word start and end times for
  the audio it generated. Measured against real playback of a 66s utterance,
  those times were accurate to 0.1%, where a character-count estimate would have
  drifted. It costs one POST, roughly 2.5s for a long utterance.

  The clock starts on voicemode's own TTS_FIRST_AUDIO event, read from its event
  log. Timing from when this hook fires does not work: the gap to real audio also
  covers the MCP round trip and conch acquisition, and it is not constant.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request

# Our own state. It lives under ~/.agents/state/<tool>/ like every other tool
# here, and deliberately NOT in ~/.voicemode/ — that directory belongs to
# voice-mode, and two owners writing into one directory is how you end up
# unable to say which files you may delete.
STATE = os.path.expanduser("~/.agents/state/voicemode-hold/transcript.json")
KOKORO = os.environ.get("VOICEMODE_KOKORO_URL", "http://127.0.0.1:8880")

# The starting gun. voicemode logs TTS_FIRST_AUDIO the instant the first sample
# reaches the device, so the clock is slaved to that rather than to when this
# hook fired. Guessing the gap instead was hopeless: it covers the other hooks,
# the MCP round trip and conch acquisition, and it is not constant.
EVENTS_DIR = os.path.expanduser("~/.voicemode/logs/events")

START, END = "TTS_FIRST_AUDIO", "TTS_PLAYBACK_END"

PANE_FILE = os.path.expanduser("~/.agents/state/voicemode-hold/.transcript-pane")

# The interject key writes this for as long as it is holding playback — and only
# if the server actually took the pause. A hold it never took must not freeze the
# cursor, or the words stop while the voice keeps going.
HOLD_FILE = os.path.expanduser("~/.agents/state/voicemode-hold/.interject.hold")

# Who is talking, shown only while someone is. Only the events that actually
# change the state belong here. Matching the whole TTS_ family and falling back
# to idle was why the speaker never appeared: TTS_FIRST_AUDIO lands a frame after
# TTS_PLAYBACK_START and reset the label as fast as playback had set it.
STATES = {
    "TTS_PLAYBACK_START": "🔊",
    "RECORDING_START": "🎤",
    "TTS_PLAYBACK_END": None,
    "RECORDING_END": None,
}
IDLE = "voice"


def events_path(when=None):
    day = time.strftime("%Y-%m-%d", time.localtime(when))
    return os.path.join(EVENTS_DIR, f"voicemode_events_{day}.jsonl")


def to_epoch(stamp):
    from datetime import datetime
    return datetime.fromisoformat(stamp).timestamp()

# Upcoming text is the part worth reading — it gets the most legible colour, not
# the least. Spoken text is the part you can stop reading, so that is what
# recedes. The cursor wins attention on weight and hue rather than on brightness,
# which leaves it legible against the light text ahead of it.
SPOKEN = "\033[38;5;66m"      # muted teal-grey: done, still readable
CURRENT = "\033[1;38;5;214m"  # bold amber
AHEAD = "\033[38;5;253m"      # near-white
HEARD = "\033[38;5;109m"      # what whisper thinks you said
RESET = "\033[0m"

PUNCT = re.compile(r"^[^\w]+$")

# Both sides of the conversation sit behind a speaker gutter, so the pane reads
# as a dialogue rather than one wall of text. The emoji is double-width: "🎤 "
# is two characters but three columns.
GUTTER = 3


def mark(emoji, n):
    """The gutter for line `n` of a block: the emoji on the first, blanks under."""
    return f"{emoji} " if n == 0 else " " * GUTTER


# ---------------------------------------------------------------- prime

def extract_text(payload):
    """The text converse is about to speak. A `turns` survey carries it per turn."""
    ti = payload.get("tool_input") or {}
    if ti.get("message"):
        return ti["message"], ti
    turns = ti.get("turns") or []
    said = [t.get("say") or t.get("ask") for t in turns if isinstance(t, dict)]
    return "\n".join(s for s in said if s), ti


def fetch_timestamps(text, voice, speed):
    body = json.dumps({
        "model": "kokoro", "input": text, "voice": voice, "speed": speed,
        "response_format": "mp3", "stream": False, "return_timestamps": True,
    }).encode()
    req = urllib.request.Request(
        f"{KOKORO}/dev/captioned_speech", data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get("timestamps") or []


def ensure_view():
    """Open the transcript pane once. No-op if a view is already running.

    Only herdr can split the pane this session actually lives in; tmux is the
    fallback.
    """
    if subprocess.run(["pgrep", "-f", "transcript.py view"],
                      capture_output=True).returncode == 0:
        return
    cmd = f'clear; python3 "{__file__}" view'
    if shutil.which("herdr"):
        # --ratio sizes the ORIGINAL pane, so 0.85 leaves the transcript pane the rest.
        out = subprocess.run(
            ["herdr", "pane", "split", "--current", "--direction", "down", "--ratio", "0.85"],
            capture_output=True, text=True)
        try:
            pane = json.loads(out.stdout)["result"]["pane"]["pane_id"]
        except (ValueError, KeyError, TypeError):
            pane = None
        if pane:
            with open(PANE_FILE, "w") as f:
                f.write(pane)
            subprocess.run(["herdr", "pane", "rename", pane, IDLE], capture_output=True)
            subprocess.run(["herdr", "pane", "run", pane, cmd], capture_output=True)
            return
    if os.environ.get("TMUX"):
        subprocess.run(["tmux", "split-window", "-d", "-v", "-l", "15%", cmd])


def prime(argv):
    # Re-exec detached so the hook returns immediately; the 10s hook timeout
    # would otherwise cap how long an utterance we can time.
    if "--worker" not in argv:
        raw = sys.stdin.read()
        subprocess.Popen(
            [sys.executable, __file__, "prime", "--worker", str(time.time())],
            stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, start_new_session=True,
        ).communicate(raw.encode())
        ensure_view()
        return

    t0 = float(argv[argv.index("--worker") + 1])
    payload = json.loads(sys.stdin.read() or "{}")
    text, ti = extract_text(payload)
    if not text.strip():
        return

    # Two writes. Kokoro takes a couple of seconds to time a long utterance, by
    # which point the speech has already started — so publish the text first so
    # the pane shows what is coming, then upgrade it in place once the word
    # times land. Both share t0, so the cursor is correct from the moment it
    # appears. Neither carries the last reply: it is a line up in the scrollback.
    write_state(t0, text, [])
    try:
        words = fetch_timestamps(text, ti.get("voice") or "af_sky", ti.get("speed") or 1.0)
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return  # keep the plain-text frame; better than a blank pane
    write_state(t0, text, words)


def read_state():
    try:
        with open(STATE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def unwrap(raw):
    """Pull the reply text out of a tool_response.

    It arrives in three shapes: a JSON string, a dict with `result`, or a list of
    content blocks (which is what a backgrounded call returns).
    """
    if isinstance(raw, list):
        raw = "".join(b.get("text", "") for b in raw if isinstance(b, dict))
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            return raw
    if isinstance(raw, dict):
        return raw.get("result") or ""
    return ""


def interjections():
    """Whatever the interject key captured while this utterance was paused."""
    out = subprocess.run(
        [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                      "interject.py"), "drain"],
        capture_output=True, text=True)
    try:
        return json.loads(out.stdout)
    except ValueError:
        return []


def heard(_argv):
    """PostToolUse hook. Records whisper's transcription of the reply.

    Worth showing: what reaches the model is whisper's guess, not what was said,
    and a misheard homophone is only catchable if the guess is on screen.

    Also the one moment an interjection can reach the agent. One said mid-
    utterance was spoken long after the tool call went out, so the only way home
    is the hook's own return — it rides back as additionalContext, ahead of the
    reply it preceded.
    """
    payload = json.loads(sys.stdin.read() or "{}")
    text = unwrap(payload.get("tool_response"))
    text = re.sub(r"^Voice response:\s*", "", text)
    text = re.sub(r"\s*\(STT:[^)]*\)\s*\|\s*Timing:.*$", "", text, flags=re.S).strip()
    # Not every response carries a reply: wait_for_response=false only confirms
    # playback, and a call that outran its timeout reports being backgrounded
    # instead. Showing either as "what you said" would be a lie.
    if not text or "Message spoken successfully" in text or "still running after" in text:
        text = ""

    notes = interjections()
    parts = [n.get("text", "") for n in notes] + [text]
    said = " ".join(" ".join(p.split()) for p in parts if p.strip())
    if said:
        try:
            with open(STATE) as f:
                state = json.load(f)
            write_state(state["t0"], state["text"], state["words"], said)
        except (OSError, ValueError, KeyError):
            pass

    if notes:
        # Each one carries the run-up: the tail of what had actually been spoken
        # when it landed. "No, that's wrong" is unreadable without a referent.
        placed = [f'{n["text"]} (said right after you spoke the words: …{n["at"]})'
                  if n.get("at") else n["text"] for n in notes]
        print(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext":
                "Interjected while you were still speaking, so this came before "
                "the reply in the tool result: " + " | ".join(placed),
        }}))


def write_state(t0, text, words, heard=None):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"t0": t0, "text": text, "words": words, "heard": heard}, f)
    os.replace(tmp, STATE)  # atomic: view never reads a half-written frame


# ---------------------------------------------------------------- view

def active_index(words, elapsed):
    """Index of the word being spoken at `elapsed`, or -1 before the first one.

    Returns len(words) once the utterance is done. Gaps between words count as
    still-speaking the previous word, so the highlight never flickers off
    mid-sentence.
    """
    if elapsed < 0 or not words:
        return -1
    for i, w in enumerate(words):
        if elapsed < w["end_time"]:
            return i if elapsed >= w["start_time"] else max(i - 1, 0)
    return len(words)


def hold_started(path=HOLD_FILE):
    """When the interject key put playback on hold, or None if it hasn't."""
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def clock(audio_t0, held, now):
    """Seconds of speech played by `now`. A hold freezes the cursor where it
    stopped: the audio is not moving, so the highlight must not either."""
    return (held or now) - audio_t0


def layout(tokens, width):
    """Greedy wrap into lines of (token, index) pairs, punctuation kept tight."""
    lines, line, used = [], [], 0
    for i, tok in enumerate(tokens):
        glue = bool(line) and not PUNCT.match(tok)
        need = len(tok) + (1 if glue else 0)
        if line and used + need > width:
            lines.append(line)
            line, used, glue, need = [], 0, False, len(tok)
        line.append((tok, i, glue))
        used += need
    if line:
        lines.append(line)
    return lines


def reply(heard, width):
    """What whisper made of the reply, wrapped under its own gutter.

    Wrapped, not sliced: a long reply used to be cut mid-word, and the cut line
    was itself a column too wide, so it took two terminal rows while the window
    maths counted one and everything below it came out doubled.
    """
    body = max(width - GUTTER - 1, 20)
    return [HEARD + mark("🎤", n) + line + RESET
            for n, line in enumerate(textwrap.wrap(heard, body) or [""])]


def render(state, elapsed, width, rows=None):
    """`elapsed` is seconds since TTS_FIRST_AUDIO, or None before playback starts.

    With `rows` given, the output is windowed to keep the spoken word on screen:
    an utterance can easily be taller than the pane, and the old transcript
    resized the pane to fit. Scrolling the text instead leaves the pane alone.
    """
    words = state.get("words") or []
    tokens = [w["word"] for w in words] or state.get("text", "").split()
    cursor = active_index(words, elapsed) if words and elapsed is not None else -1

    # Lay out inside the gutter, and a column short of the pane edge. A line that
    # fills the last column costs a second terminal row, and the repaint below
    # counts rows to find its way back to the top of the frame.
    body = max(width - GUTTER - 1, 20)

    out, cursor_row = [], 0
    for line in layout(tokens, body):
        buf = ""
        for tok, i, glue in line:
            colour = AHEAD if i > cursor else (CURRENT if i == cursor else SPOKEN)
            if i == cursor:
                cursor_row = len(out)
            buf += (" " if glue else "") + colour + tok + RESET
        out.append(buf)
    # Once the utterance is over the cursor runs past the last token, so no line
    # claims it and the window fell back to the top — the pane rewound to the
    # start of a speech that had just finished, hiding the part you most want to
    # read back. Finished means hold the window on the end.
    if cursor >= len(tokens):
        cursor_row = max(len(out) - 1, 0)
    out = [mark("🔊", n) + buf for n, buf in enumerate(out)]

    heard = state.get("heard")
    if heard:
        out += [""] + reply(heard, width)

    if rows and len(out) > rows:
        # A quarter down rather than centred. A pane can't scroll its own
        # viewport, so while an utterance is taller than the pane a window is
        # unavoidable — and the words worth having on screen are the ones still
        # coming. What has already been said needs only enough to keep your place.
        top = min(max(cursor_row - rows // 4, 0), len(out) - rows)
        out = out[top:top + rows]
    return out


def remaining(words, elapsed):
    """Time left in the utterance as m:ss, or "" when it can't be known. Kokoro's
    word timings carry the real end, so this is a countdown rather than a guess —
    but a frame published before the timings land has nothing to count."""
    if not words or elapsed is None or elapsed == float("inf"):
        return ""
    left = max(int(words[-1]["end_time"] - elapsed), 0)
    return f"{left // 60}:{left % 60:02d}"


def set_label(want, current):
    """Put the voice state in the pane border. Returns the label now showing."""
    if want == current:
        return current
    try:
        with open(PANE_FILE) as f:
            pane = f.read().strip()
    except OSError:
        return current
    if pane:
        subprocess.run(["herdr", "pane", "rename", pane, want], capture_output=True)
    return want


def emit(lines, up):
    """Repaint `lines` over the frame that started `up` rows above the cursor.

    Every line clears its own tail: without that a short line leaves the end of
    whatever was longer at that row and consecutive frames bleed together.
    """
    if up:
        sys.stdout.write(f"\033[{up}A")
    sys.stdout.write("\r" + "\r\n".join(l + "\033[K" for l in lines) + "\033[J")
    sys.stdout.flush()


def view(_argv):
    sys.stdout.write("\033[?25l")  # hide cursor
    last_mtime, state = 0.0, None
    painted, held = 0, None
    mode = None
    released, shown, dumped = None, None, None
    audio_t0, ended, last_t0 = None, None, None
    label = None
    path, fh = None, None
    try:
        while True:
            try:
                mtime = os.path.getmtime(STATE)
                if mtime != last_mtime:
                    with open(STATE) as f:
                        state = json.load(f)
                    last_mtime = mtime
                    # A fresh t0 means a new utterance: drop the old clock so the
                    # new text reads as upcoming rather than inheriting the last
                    # one's finished state. `heard` rewrites the file with the
                    # same t0, and must not reset anything.
                    if state.get("t0") != last_t0:
                        last_t0, audio_t0, ended = state.get("t0"), None, None
                        # Start the new utterance below the old one rather than
                        # over it, so finished exchanges fall into scrollback.
                        if painted:
                            sys.stdout.write("\r\n\r\n")
                            painted = 0
                        released, shown, dumped = None, None, None
            except (OSError, ValueError):
                pass

            # Tail the event log. Reopen across midnight, when the filename rolls.
            if fh is None or path != events_path():
                if fh:
                    fh.close()
                path = events_path()
                try:
                    fh = open(path)
                    fh.seek(0, os.SEEK_END)  # only care about events from now on
                except OSError:
                    fh = None
            # readline, not iteration: a file iterator's read-ahead buffer does
            # not reliably resume once it has hit EOF on a file still being
            # appended to. A line without a trailing newline is a half-written
            # record; rewind and pick it up whole next frame.
            while fh:
                where = fh.tell()
                line = fh.readline()
                if not line.endswith("\n"):
                    fh.seek(where)
                    break
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                kind = ev.get("event_type")
                if kind == START:
                    audio_t0, ended = to_epoch(ev["timestamp"]), None
                elif kind == END:
                    # When playback stopped, not "it stopped". prefix+m cuts the
                    # voice mid-sentence while the text runs on, and treating
                    # that as done marched the cursor to the end of a script I
                    # never finished saying. Freezing at the cut leaves the words
                    # I never got to as upcoming, which is what they are.
                    ended = to_epoch(ev["timestamp"])
                if kind in STATES:
                    mode = STATES[kind]

            # A hold stops the audio but not the wall clock the cursor rides
            # on. Freeze the cursor for the length of it, then push the clock
            # forward by that much so speech and highlight come back in step.
            started = hold_started()
            if held is None:
                # A hold older than this utterance's audio belongs to the last
                # one. Freezing on it pins the cursor before the first word,
                # which renders as no highlight at all — the whole pane white.
                if started and audio_t0 is not None and started >= audio_t0:
                    held = started
            elif not started:
                # audio_t0 is None when a new utterance started while the hold
                # was on — prefix+m under a hold does exactly that. Adding to it
                # raised, which killed the render loop and left the pane frozen
                # on its last frame with the label stuck mid-hold.
                if audio_t0 is not None:
                    audio_t0 += time.time() - held
                held = None

            size = shutil.get_terminal_size((100, 10))
            elapsed = None if audio_t0 is None else clock(
                audio_t0, held or ended, time.time())

            if state and ended is not None and released != last_t0:
                # Over. Print it whole, unwindowed, and stop repainting it: it is
                # ordinary scrollback from here. Keeping a finished utterance
                # inside a one-screen window hid whatever prefix+m cut me off
                # before saying, which is the part most worth reading back.
                emit(render(state, elapsed, size.columns), painted)
                sys.stdout.write("\r\n\r\n")
                sys.stdout.flush()
                painted, released, shown = 0, last_t0, state.get("heard")
            elif held and dumped != held:
                # Held: nothing is moving, so stop looking through a slot. Print
                # the whole utterance unwindowed and leave it there — read ahead,
                # scroll to the end, take as long as you like. Letting the voice
                # go starts the live window again below it.
                emit(render(state, elapsed, size.columns), painted)
                # One newline, not two: a blank line here is a line you have to
                # scroll past to reach the end of what you stopped me to read.
                sys.stdout.write("\r\n")
                sys.stdout.flush()
                painted, dumped = 0, held
            elif held:
                pass  # already printed in full; a hold has nothing to repaint
            elif released == last_t0:
                # Static now; only the reply can still arrive. It prints under
                # the released text rather than forcing a repaint of it.
                now_heard = state.get("heard") if state else None
                if now_heard and now_heard != shown:
                    emit(reply(now_heard, size.columns), 0)
                    sys.stdout.write("\r\n\r\n")
                    sys.stdout.flush()
                    shown = now_heard
            else:
                # Live. Repaint relative to the top of this frame, not the top of
                # the screen: homing overwrote every finished utterance, which is
                # why the pane had nothing to scroll back through.
                lines = (render(state, elapsed, size.columns, size.lines - 1)
                         if state else [AHEAD + "waiting for speech…" + RESET])
                emit(lines, painted)
                painted = len(lines) - 1

            # Recomputed every frame rather than on events alone, because the
            # countdown moves between them. set_label is a no-op unless the
            # string actually changed, so this renames about once a second.
            left = remaining(state.get("words") if state else None, elapsed)
            if held:
                want = "🎤 hold"  # your microphone, my sentence parked
            elif mode:
                want = f"{mode} {IDLE}"
            else:
                want = IDLE
            if left and (held or mode == "🔊"):
                want += f" · {left}"
            label = set_label(want, label)
            time.sleep(0.03)
    except KeyboardInterrupt:
        pass
    finally:
        sys.stdout.write("\033[?25h\n")


# ---------------------------------------------------------------- demo

def demo(_argv):
    w = [{"word": "Hello", "start_time": 0.0, "end_time": 0.3},
         {"word": "there", "start_time": 0.3, "end_time": 0.6},
         {"word": ",", "start_time": 0.6, "end_time": 0.65},
         {"word": "world", "start_time": 0.9, "end_time": 1.4}]
    assert active_index(w, -0.5) == -1, "before playback nothing is highlighted"
    assert active_index(w, 0.1) == 0
    assert active_index(w, 0.45) == 1
    assert active_index(w, 0.62) == 2
    assert active_index(w, 0.8) == 2, "a gap holds the previous word, not nothing"
    assert active_index(w, 1.0) == 3
    assert active_index(w, 9.9) == len(w), "past the end everything reads as spoken"
    assert active_index([], 1.0) == -1, "no timestamps means no cursor"

    state = {"t0": 0, "text": "Hello there, world", "words": w}
    plain = lambda ls: [re.sub(r"\033\[[0-9;]*m", "", l) for l in ls]
    assert plain(render(state, None, 80)) == ["🔊 Hello there, world"], "text intact before playback"
    assert CURRENT not in "".join(render(state, None, 80)), "nothing highlighted before the gun"
    assert CURRENT in "".join(render(state, 0.45, 80)), "a word is lit mid-playback"
    done = render(state, float("inf"), 80)
    assert AHEAD not in "".join(done) and CURRENT not in "".join(done), "after the end, all spoken"

    lines = layout(["Hello", "there", ",", "world"], 12)
    assert [t for ln in lines for t, _, _ in ln] == ["Hello", "there", ",", "world"], "wrap drops nothing"
    assert all(sum(len(t) + g for t, _, g in ln) <= 12 for ln in lines), "no line exceeds width"
    assert not lines[0][0][2], "first token on a line never carries a leading space"

    assert remaining([{"end_time": 62.0}], 20.0) == "0:42", "counts down to the last word"
    assert remaining([{"end_time": 62.0}], 999.0) == "0:00", "never counts past the end"
    assert remaining([{"end_time": 130.0}], 4.0) == "2:06", "minutes and seconds"
    assert remaining([], 4.0) == "", "no timings, no countdown"
    assert remaining([{"end_time": 62.0}], float("inf")) == "", "nor once it is over"

    assert clock(100.0, None, 105.0) == 5.0, "no hold, the cursor tracks the wall clock"
    assert clock(100.0, 103.0, 109.0) == 3.0, "a hold freezes the cursor where it stopped"
    assert hold_started("/nonexistent") is None, "no capture running, no hold"

    tall = {"t0": 0, "text": "", "words": [{"word": f"w{i}", "start_time": i, "end_time": i + 1}
                                           for i in range(40)]}
    assert "w39" in "".join(render(tall, float("inf"), 20, rows=4)), "a finished utterance shows its end"
    assert "w0" in "".join(render(tall, None, 20, rows=4)), "an unstarted one shows its beginning"
    cut = render(tall, 10.5, 40, rows=6)
    assert "w10" in "".join(cut), "a cut utterance stays where the voice stopped"
    assert AHEAD in "".join(cut), "and what it never said still reads as upcoming"

    wide = {"t0": 0, "text": "ok", "words": [], "heard": "yes " * 60}
    said = plain(render(wide, None, 40))
    assert len(said) > 2, "a long reply wraps instead of being cut off"
    assert "".join(said).count("yes") == 60, "wrapping drops nothing"
    assert all(len(l) < 40 for l in said), "no line reaches the pane edge"
    assert said[0].startswith("🔊 "), "the utterance comes first"
    assert said[2].startswith("🎤 ") and said[3].startswith("   "), "the reply follows it"
    print("ok")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "demo"
    {"prime": prime, "heard": heard, "view": view, "demo": demo}[cmd](sys.argv)

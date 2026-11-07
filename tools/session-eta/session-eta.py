#!/usr/bin/env python3
"""session-eta: a Claude Code hook that keeps one app-panel bar per turn answering
"how long until this session needs me?". Hooks record each tool call (cheap, no model);
once a turn runs long, a detached local-model call reads the ask, Claude's recent words,
the steps so far and how long similar commands took before, and posts stages + time left.
Register it for UserPromptSubmit, PreToolUse, PostToolUse and Stop. See README.md."""
import fcntl, json, math, os, re, statistics, subprocess, sys, time, urllib.request
from contextlib import contextmanager

HOME = os.path.expanduser("~")
STATE = os.environ.get("SESSION_ETA_STATE", f"{HOME}/.agents/state/session-eta")
PANELS = os.environ.get("APP_PANEL_SESSIONS", f"{HOME}/.agents/state/app-panel/sessions")
OLLAMA = os.environ.get("OLLAMA_HOST_URL", "http://localhost:11434")
MODEL = os.environ.get("SESSION_ETA_MODEL", "qwen3.5:9b")
SHOW_AFTER = int(os.environ.get("SESSION_ETA_SHOW_AFTER", 45))  # seconds into a turn before a bar appears: short turns never get one
EVERY = 60       # seconds between re-estimates, unless a long command starts
LONG = 60        # a command whose past runs took this long gets an estimate as it starts


def panel_url():
    pane = os.environ.get("HERDR_PANE_ID")
    if not pane:
        return None
    try:
        with open(f"{PANELS}/{re.sub(r'[^\w.-]', '_', pane)}.json") as f:
            return json.load(f)["url"]
    except (OSError, ValueError, KeyError):
        return None


def post(p):
    url = panel_url()
    if url:
        try:
            urllib.request.urlopen(urllib.request.Request(url, json.dumps(p).encode(), method="POST"), timeout=3)
        except OSError:
            pass  # a gone panel never breaks the session


def log(name, row):
    with open(f"{STATE}/{name}.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")


@contextmanager
def session(sid):
    """This session's state, locked: parallel tool calls fire hooks at once."""
    os.makedirs(f"{STATE}/sessions", exist_ok=True)
    with open(f"{STATE}/sessions/{re.sub(r'[^\w-]', '_', sid)}.json", "a+") as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        try:
            st = json.loads(f.read() or "{}")
        except ValueError:
            st = {}
        yield st
        f.seek(0), f.truncate(), f.write(json.dumps(st))


WRAPPERS = {"time", "/usr/bin/time", "timeout", "gtimeout", "nice", "env", "sudo", "caffeinate", "command", "exec"}


def command_key(cmd):
    """`cd x && FOO=1 npm run build -- --x` → `npm run build`: what to match past durations on."""
    line = cmd.strip().splitlines()[0] if cmd.strip() else ""
    line = re.sub(r"^(cd\s+\S+\s*(&&|;)\s*)+", "", line)
    words = [w for w in line.split() if not re.match(r"^\w+=", w)]
    while words and (words[0] in WRAPPERS or (words[0].startswith("-") or words[0].isdigit()) and len(words) > 1):
        words = words[1:]  # `/usr/bin/time -p bun test` and `timeout 300 npm test` are the test, not the wrapper
    n = 3 if len(words) > 2 and words[1] in ("run", "exec", "x") else 2
    return " ".join(words[:n])


def past_secs(key, cwd):
    """Median of the last 5 runs of this command here (else anywhere), or None."""
    try:
        rows = [json.loads(l) for l in open(f"{STATE}/durations.jsonl")]
    except OSError:
        return None
    here = [r["secs"] for r in rows if r["key"] == key and r["cwd"] == cwd]
    runs = (here or [r["secs"] for r in rows if r["key"] == key])[-5:]
    return statistics.median(runs) if runs else None


def what(tool, inp):
    """One short line for a tool call."""
    v = inp.get("command") or inp.get("description") or inp.get("file_path") or inp.get("prompt") or inp.get("query") or ""
    if tool == "TodoWrite":
        v = "; ".join(f"[{t.get('status', '')}] {t.get('content', '')}" for t in inp.get("todos", []))
    return f"{tool}: {str(v).strip().splitlines()[0][:160] if str(v).strip() else ''}"


def mmss(s):
    s = int(s)
    return f"{s // 60}m{s % 60:02d}s"


def hook(p):
    ev, sid, now = p.get("hook_event_name"), p.get("session_id", "none"), time.time()
    tool, inp = p.get("tool_name", ""), p.get("tool_input") or {}
    with session(sid) as st:
        if ev == "UserPromptSubmit":
            ask = str(p.get("prompt", "")).strip()
            if ask.startswith("<") and st.get("ask"):
                ask = st["ask"]  # a task notification starts a turn but isn't a request: keep the last real one
            st.clear()
            st.update(turn=now, ask=ask[:2000], title=f"Back in… · {ask.splitlines()[0][:40] if ask else 'turn'}",
                      events=[], pending={}, shown=False, self=False, last=0)
            # One watchdog per turn: hooks only fire between tool calls, so a single long silent call needs a timer.
            run_detached("watch", sid, p.get("transcript_path", ""), str(now))
            return
        if "turn" not in st:
            return  # a hook from before this tool was installed, or a resumed session mid-turn
        if ev == "Stop":
            if st.get("shown") and not st.get("self"):
                post({"title": st["title"], "status": "done", "note": f"took {mmss(now - st['turn'])}"})
            if st.get("shown"):
                log("actuals", {"session": sid, "turn": st["turn"], "actual": round(now - st["turn"])})
            st["stopped"] = True
            return
        if st.get("stopped"):
            # Another Stop hook can send Claude back to work after Stop: the turn goes on, and so does its watchdog.
            st["stopped"] = False
            run_detached("watch", sid, p.get("transcript_path", ""), str(st["turn"]))
        if tool == "mcp__app-panel__progress":
            st["self"] = True  # Claude is reporting itself; don't draw a second bar
        long_start = False
        if ev == "PreToolUse":
            past = past_secs(command_key(inp.get("command", "")), p.get("cwd")) if tool == "Bash" else None
            st["pending"][p.get("tool_use_id", tool)] = {"t": now, "what": what(tool, inp), "past": past}
            long_start = bool(past and past >= LONG)
        elif ev == "PostToolUse":
            run = st["pending"].pop(p.get("tool_use_id", tool), None)
            took = now - run["t"] if run else None
            st["events"] = (st["events"] + [{"t": now, "what": what(tool, inp), "took": took}])[-30:]
            if tool == "Bash" and took and took >= 5 and not inp.get("run_in_background"):
                log("durations", {"key": command_key(inp.get("command", "")), "cwd": p.get("cwd"), "secs": round(took)})
        if st["self"]:
            return
        spawn = long_start and claim(st, now)
    if spawn:
        run_detached("estimate", sid, p.get("transcript_path", ""))


def claim(st, now):
    """Mark an estimate as starting now; the first one also opens the bar so it shows before the model answers."""
    if not st["shown"]:
        post({"title": st["title"], "stage": "Working", "note": "estimating…"})
    st.update(shown=True, last=now)
    return True


def run_detached(*args):
    out = open(f"{STATE}/estimator.log", "a")
    subprocess.Popen([sys.executable, __file__, *args], start_new_session=True, stdin=subprocess.DEVNULL, stdout=out, stderr=out)


def watch(sid, transcript, turn):
    """Re-estimate on a timer for as long as this turn runs: first at SHOW_AFTER, then every EVERY seconds."""
    turn = float(turn)
    while time.time() - turn < 4 * 3600:
        time.sleep(5)
        now = time.time()
        with session(sid) as st:
            if st.get("turn") != turn or st.get("stopped") or st.get("self"):
                return
            due = now - turn >= SHOW_AFTER and now - st["last"] >= EVERY and claim(st, now)
        if due:
            try:
                estimate(sid, transcript)
            except Exception as e:
                log("errors", {"t": now, "error": repr(e)})


def claude_said(transcript, n=3):
    """Claude's last few things said in words: where it states its plan."""
    try:
        with open(transcript, "rb") as f:
            f.seek(max(0, os.path.getsize(transcript) - 400_000))
            lines = f.read().decode("utf8", "replace").splitlines()[1:]
    except OSError:
        return []
    said = []
    for l in lines:
        try:
            m = json.loads(l)
        except ValueError:
            continue
        if m.get("type") == "assistant":
            said += [c["text"].strip()[:500] for c in m["message"].get("content", []) if isinstance(c, dict) and c.get("type") == "text" and c["text"].strip()]
    return said[-n:]


def turn_prior():
    """How long this user's past long turns really took: the estimate's anchor."""
    try:
        runs = sorted([json.loads(l)["actual"] for l in open(f"{STATE}/actuals.jsonl")][-200:])
    except OSError:
        return ""
    if len(runs) < 3:
        return ""
    return f"Past turns that ran over {SHOW_AFTER}s took: median {mmss(statistics.median(runs))}, longest-quarter {mmss(runs[len(runs) * 3 // 4])} ({len(runs)} turns)."


def history_end(elapsed):
    """Median length of past turns that ran longer than this one has so far: the no-model half of the estimate."""
    try:
        longer = [d for d in (json.loads(l)["actual"] for l in open(f"{STATE}/actuals.jsonl")) if d > elapsed]
    except OSError:
        return None
    return statistics.median(longer) if len(longer) >= 5 else None


def prompt_for(st, said, now):
    prior = turn_prior()
    steps = [f"- {mmss(e['t'] - st['turn'])} {e['what']}" + (f" (took {mmss(e['took'])})" if e.get("took") else "") for e in st["events"][-20:]]
    running = [f"- RUNNING NOW for {mmss(now - r['t'])}: {r['what']}" + (f" (past runs took ~{mmss(r['past'])})" if r.get("past") else "") for r in st["pending"].values()]
    return f"""An AI coding agent is working on a request. Estimate how many more minutes until it finishes and the human must come back.
Think in stages (2-6 short names, like "Reading code", "Fixing", "Running tests"). This agent is fast; use the past durations below rather than guessing.
{prior}

REQUEST:
{st['ask'][:1500]}

ELAPSED: {mmss(now - st['turn'])}

AGENT'S RECENT WORDS:
{chr(10).join('- ' + s.replace(chr(10), ' ') for s in said) or '(none)'}

STEPS SO FAR (time into turn, tool, duration):
{chr(10).join(steps + running) or '(none)'}

Reply with only this JSON shape:
{{"stages": [{{"name": "Running tests", "minutes": 3}}], "stage": "Running tests", "minutes_left": 12}}
stage is the one running now; minutes_left covers the whole remaining turn."""


def stage_of(s):
    """(name, minutes) from a stage however the model spelled it: a schema'd reply hangs qwen3.5, so the shape is only asked for."""
    if isinstance(s, str):
        return s, 2
    name = s.get("name") or s.get("stage") or ""
    mins = next((v for k, v in s.items() if "min" in k and isinstance(v, (int, float))), 2)
    return str(name), float(mins)


def estimate(sid, transcript):
    now = time.time()
    with session(sid) as st:
        snap = json.loads(json.dumps(st))
    if "turn" not in snap or snap.get("stopped") or snap.get("self"):
        return
    body = {"model": MODEL, "prompt": prompt_for(snap, claude_said(transcript), now), "stream": False, "think": False,
            "format": "json", "keep_alive": "5m", "options": {"num_ctx": 8192, "temperature": 0}}
    req = urllib.request.Request(f"{OLLAMA}/api/generate", json.dumps(body).encode(), {"Content-Type": "application/json"})
    t0 = time.time()
    out = json.loads(json.loads(urllib.request.urlopen(req, timeout=120).read())["response"])
    elapsed = now - snap["turn"]
    model_end = elapsed + max(30, float(out.get("minutes_left") or 5) * 60)
    hist_end = history_end(elapsed)
    # Replayed on 15 past turns (replay.py): the model alone ran 1.35x long, history alone short early on;
    # their geometric mean had the smallest error (median 1.40x) at every checkpoint.
    left = max(30, (math.sqrt(model_end * hist_end) if hist_end else model_end) - elapsed)
    with session(sid) as st:
        if st.get("turn") != snap["turn"] or st.get("stopped") or st.get("self"):
            return  # the turn ended while the model thought: a late post would reopen a finished bar
        stages = [{"name": name[:40], "eta": max(10, mins * 60)} for name, mins in (stage_of(x) for x in (out.get("stages") or [])[:6]) if name]
        post({"title": st["title"], "stages": stages, "stage": str(out.get("stage", ""))[:40], "eta": left,
              "note": f"back in ~{max(1, round(left / 60))}m (estimate)"})
    log("estimates", {"session": sid, "turn": snap["turn"], "at": round(now - snap["turn"]), "left": round(left),
                      "model_end": round(model_end), "hist_end": hist_end and round(hist_end), "stage": out.get("stage"), "model": MODEL, "model_secs": round(time.time() - t0, 1)})


if __name__ == "__main__":
    os.makedirs(STATE, exist_ok=True)
    if sys.argv[1:2] == ["estimate"]:
        estimate(sys.argv[2], sys.argv[3])
    elif sys.argv[1:2] == ["watch"]:
        watch(*sys.argv[2:5])
    else:
        try:
            hook(json.load(sys.stdin))
        except Exception as e:  # a hook that throws shows up in every turn; log and move on
            log("errors", {"t": time.time(), "error": repr(e)})

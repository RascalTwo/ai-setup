#!/usr/bin/env python3
"""Run one Claude Code turn on a local Ollama model, isolated from the user's setup.

usage: delegate-local.py [-C DIR] [--minutes N] [--model M] [--resume SESSION_ID] PROMPT

Writes ~/.agents/state/delegate-to-local/runs/<timestamp>/{result.md,session_id,meta.json,stdout.json,stderr.log}
and prints the run folder. Exit: 0 done, 1 run error, 2 pre-flight refused, 124 timed out.
"""
import argparse, json, os, re, signal, subprocess, sys, time, urllib.request, uuid
from datetime import datetime

OLLAMA = "http://localhost:11434"
STATE = os.path.expanduser("~/.agents/state/delegate-to-local")
DEFAULT_MODEL = "qwen3.6:35b-a3b"
KNOWN_SIZES = {DEFAULT_MODEL: "23 GB"}
BIG = 2 * 1024**3  # another model this size or larger leaves too little memory for ours
# The user's own hook helpers: unloaded rather than refused. session-eta skips while run.lock is held;
# herdr-autolabel skips while another model is loaded and its own is not.
HELPERS = {"qwen3.5:9b": "session-eta", "qwen2.5-coder:7b": "herdr-autolabel"}


def ollama(path, body=None):
    data = json.dumps(body).encode() if body else None
    with urllib.request.urlopen(urllib.request.Request(OLLAMA + path, data), timeout=30) as r:
        return json.load(r)


def refuse(msg):
    print(f"delegate-local: refused: {msg}", file=sys.stderr)
    sys.exit(2)


def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def preflight(model, lock):
    try:
        ollama("/api/version")
    except Exception as e:
        refuse(f"Ollama is not answering at {OLLAMA} ({e}). Start it: open -a Ollama (or `ollama serve`).")
    disk = {m["name"]: m.get("size", 0) for m in ollama("/api/tags")["models"]}
    names = set(disk)
    if model not in names and f"{model}:latest" not in names:
        size = KNOWN_SIZES.get(model, f"see https://ollama.com/library/{model.split(':')[0]}/tags")
        refuse(f"{model} is not installed (download size {size}). Nothing was downloaded. "
               f"If you want it, run yourself: ollama pull {model}")
    # A just-loaded model can report far less than its weights (gemma4:12b showed 1.1 GB), so use the larger.
    for m in (loaded := ollama("/api/ps")["models"]):
        m["size"] = max(m.get("size", 0), disk.get(m["name"], 0))
    others = [m for m in loaded if m["name"] != model and m["size"] >= BIG]
    helpers = [m["name"] for m in others if m["name"] in HELPERS]
    others = [m for m in others if m["name"] not in HELPERS]
    if others:
        listed = ", ".join(f"{m['name']} ({m['size'] / 1024**3:.1f} GB)" for m in others)
        stops = "; ".join(f"ollama stop {m['name']}" for m in others)
        refuse(f"another large model is loaded in Ollama: {listed}. Unload it first: {stops}")
    if os.path.exists(lock):
        pid = int(open(lock).read().strip() or 0)
        if pid and alive(pid):
            refuse(f"another delegate-local run is in progress (pid {pid}); runs go one at a time.")
    # Swap is warn-only: on this Mac most of it is in use on an ordinary day.
    swap = subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True).stdout.strip()
    free = re.search(r"free percentage: (\d+)%",
                     subprocess.run(["memory_pressure", "-Q"], capture_output=True, text=True).stdout)
    print(f"delegate-local: note: swap {swap}; memory free {free.group(1) + '%' if free else '?'}", file=sys.stderr)
    return helpers


def unload(helpers):
    for name in helpers:
        ollama("/api/generate", {"model": name, "keep_alive": 0})
        print(f"delegate-local: note: unloaded {name} ({HELPERS[name]}'s model)", file=sys.stderr)


def child_env(model):
    # Drop the parent session's CLAUDE*/ANTHROPIC* vars (session id, messaging socket, subagent model, auth).
    env = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE", "ANTHROPIC"))}
    env.update(
        ANTHROPIC_BASE_URL=OLLAMA, ANTHROPIC_AUTH_TOKEN="ollama", ANTHROPIC_API_KEY="",
        CLAUDE_CONFIG_DIR=f"{STATE}/claudehome", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC="1",
        # Every model alias Claude Code might ask for (subagents, background calls) maps to the local model.
        ANTHROPIC_DEFAULT_OPUS_MODEL=model, ANTHROPIC_DEFAULT_SONNET_MODEL=model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL=model, CLAUDE_CODE_SUBAGENT_MODEL=model,
    )
    return env


def kill_tree(p):
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(p.pid, sig)
        except ProcessLookupError:
            return
        try:
            p.wait(timeout=10)
            return
        except subprocess.TimeoutExpired:
            pass


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("prompt")
    ap.add_argument("-C", dest="cwd", default=os.getcwd(), help="working folder (default: current)")
    ap.add_argument("--minutes", type=float, default=30, help="time limit (default 30)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--resume", metavar="SESSION_ID", help="continue a previous run's session")
    a = ap.parse_args()

    os.makedirs(f"{STATE}/claudehome", exist_ok=True)
    lock = f"{STATE}/run.lock"
    helpers = preflight(a.model, lock)
    run = f"{STATE}/runs/{datetime.now():%Y%m%d-%H%M%S}"
    os.makedirs(run)
    open(lock, "w").write(str(os.getpid()))  # before unloading, so session-eta can't reload in between
    unload(helpers)

    cmd = ["claude", "-p", "--model", a.model, "--output-format", "json",
           "--dangerously-skip-permissions", "--safe-mode", "--strict-mcp-config"]
    # Pick the session id up front so even a timed-out run can be resumed.
    session = a.resume or str(uuid.uuid4())
    cmd += ["--resume", session] if a.resume else ["--session-id", session]
    cmd.append(a.prompt)
    print(f"delegate-local: run folder {run}", file=sys.stderr)
    t0 = time.time()
    try:
        with open(f"{run}/stdout.json", "w") as out, open(f"{run}/stderr.log", "w") as err:
            p = subprocess.Popen(cmd, cwd=a.cwd, env=child_env(a.model), stdin=subprocess.DEVNULL,
                                 stdout=out, stderr=err, start_new_session=True)

            def stop(sig, _):  # the launcher being stopped stops the local run too
                kill_tree(p)
                sys.exit(128 + sig)
            for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                signal.signal(sig, stop)
            try:
                p.wait(timeout=a.minutes * 60)
                timed_out = False
            except subprocess.TimeoutExpired:
                kill_tree(p)
                timed_out = True
    finally:
        os.remove(lock)

    secs = round(time.time() - t0)
    result = None
    try:
        out = json.load(open(f"{run}/stdout.json"))
        session, result = out.get("session_id") or session, out.get("result")
        is_error = bool(out.get("is_error"))
    except (ValueError, OSError):
        is_error = True
    if timed_out:
        status = f"timed out after {a.minutes:g} min"
    elif p.returncode != 0 or is_error:
        status = f"error (exit {p.returncode}); see {run}/stderr.log and stdout.json"
    else:
        status = "done"
    open(f"{run}/result.md", "w").write(f"status: {status}\n\n{result or ''}\n")
    open(f"{run}/session_id", "w").write(session)
    json.dump(dict(status=status, seconds=secs, model=a.model, cwd=a.cwd, session_id=session,
                   resume=a.resume, prompt=a.prompt), open(f"{run}/meta.json", "w"), indent=1)
    print(f"{status} in {secs}s. Result: {run}/result.md  Session: {session}")
    sys.exit(124 if timed_out else 0 if status == "done" else 1)


if __name__ == "__main__":
    main()

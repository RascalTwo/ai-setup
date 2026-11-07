"""outbox.py against a fake Timeline Studio: sent, queued while it's down, sent on the next write, rejected kept aside,
and every write signed with x-timeline-by (override, Claude session, queued-then-flushed by another session, no agent)."""

import http.server
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import threading

HERE = pathlib.Path(__file__).parent
received: list[dict] = []
answer = {"status": 200}


class Fake(http.server.BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if answer["status"] == 200:
            received.append({"token": self.headers["x-timeline-token"], "by": self.headers.get("x-timeline-by"), "keys": set(body), **body})
        self.send_response(answer["status"])
        self.end_headers()
        self.wfile.write(b'{"ok":true}' if answer["status"] == 200 else b'{"error":"no such task"}')

    def log_message(self, *_: object) -> None:
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=server.serve_forever, daemon=True).start()
tmp = pathlib.Path(tempfile.mkdtemp())
outbox = tmp / "outbox"
config = tmp / "config.json"


def use(base: str) -> None:
    config.write_text(json.dumps({"base": base, "token": "t0ken"}))


last_stderr = ""


def who(**agent: str) -> dict:
    """An environment with no agent in it, plus the given variables."""
    clean = {k: v for k, v in os.environ.items() if not k.startswith(("CLAUDE_CODE_", "CODEX_", "TIMELINE_BY"))}
    return {**clean, **agent}


def send(cmd: dict, env: dict | None = None) -> int:
    global last_stderr
    env = {**(env if env is not None else who(TIMELINE_BY="test/default")),
           "TIMELINE_STUDIO_CONFIG": str(config), "TIMELINE_STUDIO_OUTBOX": str(outbox)}
    run = subprocess.run([sys.executable, "-I", HERE / "outbox.py", "send"], input=json.dumps({"cmd": cmd}),
                         capture_output=True, text=True, env=env)
    last_stderr = run.stderr
    return run.returncode


def check(label: str, ok: bool) -> None:
    print(("ok   " if ok else "FAIL ") + label)
    if not ok:
        sys.exit(1)


up = f"http://127.0.0.1:{server.server_address[1]}"
# GIVEN the service up: a write goes straight through, with the token, and `at` stamped
use(up)
check("sent when the service is up", send({"type": "startTask", "id": "a"}) == 0)
check("the token travels as the header", received[-1]["token"] == "t0ken")
check("`at` is stamped on every command", "at" in received[-1]["cmds"][0])
# WHEN nothing listens at all (connection refused), then when it answers 503
use("http://127.0.0.1:9")
check("queued when nothing answers", send({"type": "finishTask", "id": "a"}) == 2)
use(up)
answer["status"] = 503
check("queued on a 5xx", send({"type": "addComment", "id": "a", "comment": {"text": "x"}}) == 2)
check("two batches wait in the outbox", len(list(outbox.glob("*.json"))) == 2)
# THEN the next write, once it's back, sends the queue first (oldest first) and then itself
answer["status"] = 200
before = len(received)
check("sent once it's back", send({"type": "startTask", "id": "b"}) == 0)
order = [batch["cmds"][0]["type"] for batch in received[before:]]
check("the queue goes first, oldest first", order == ["finishTask", "addComment", "startTask"])
check("the outbox is empty after", list(outbox.glob("*.json")) == [])
# AND a 4xx is never queued, never retried
answer["status"] = 400
check("a 4xx is rejected, not queued", send({"type": "startTask", "id": "nope"}) == 1)
check("…and nothing is left in the outbox", list(outbox.glob("*.json")) == [])
# AND every write is signed: the override, then the Claude session id, then Codex's
use(up)
answer["status"] = 200
check("sent with TIMELINE_BY", send({"type": "startTask", "id": "c"}, who(TIMELINE_BY="test/x")) == 0)
check("TIMELINE_BY travels as x-timeline-by", received[-1]["by"] == "test/x")
check("the override wins over a session id", send({"type": "startTask", "id": "c"}, who(TIMELINE_BY="test/x", CLAUDE_CODE_SESSION_ID="5A1AD3C2-aaaa")) == 0 and received[-1]["by"] == "test/x")
send({"type": "startTask", "id": "c"}, who(CLAUDE_CODE_SESSION_ID="5A1AD3C2-aaaa"))
check("a Claude session signs claude/<first 8, lowercase>", received[-1]["by"] == "claude/5a1ad3c2")
send({"type": "startTask", "id": "c"}, who(CODEX_THREAD_ID="01a19552-53dd"))
check("a Codex thread signs codex/<first 8>", received[-1]["by"] == "codex/01a19552")
send({"type": "startTask", "id": "c"}, who(CODEX_CI="1"))
check("Codex without an id signs plain codex", received[-1]["by"] == "codex")
# GIVEN session A queued a batch while the service was down, WHEN session B flushes it with its next write
use("http://127.0.0.1:9")
check("A's batch is queued", send({"type": "addComment", "id": "a", "comment": {"text": "from A"}}, who(CLAUDE_CODE_SESSION_ID="aaaaaaaa-1")) == 2)
use(up)
before = len(received)
check("B sends", send({"type": "addComment", "id": "a", "comment": {"text": "from B"}}, who(CLAUDE_CODE_SESSION_ID="bbbbbbbb-2")) == 0)
check("A's batch keeps A's name, B's keeps B's", [r["by"] for r in received[before:]] == ["claude/aaaaaaaa", "claude/bbbbbbbb"])
check("no body carries a `by` key", all(r["keys"] == {"cmds"} for r in received[before:]))
# AND with no agent at all the write still goes in, unsigned, with one warning
before = len(received)
check("no agent: still sent", send({"type": "startTask", "id": "d"}, who()) == 0)
check("…with no header", received[before]["by"] is None)
check("…and one stderr warning", last_stderr.count("warning") == 1 and len(last_stderr.strip().splitlines()) == 1)
# AND `by` prints what send would use
def printed(env: dict) -> str:
    return subprocess.run([sys.executable, "-I", HERE / "outbox.py", "by"], capture_output=True, text=True, env=env).stdout.strip()
check("`by` prints the Claude value", printed(who(CLAUDE_CODE_SESSION_ID="5a1ad3c2-x")) == "claude/5a1ad3c2")
check("`by` prints the override", printed(who(TIMELINE_BY="test/x")) == "test/x")
server.shutdown()
print("ALL PASS")

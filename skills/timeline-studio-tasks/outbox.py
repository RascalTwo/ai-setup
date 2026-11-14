#!/usr/bin/env python3
"""Sends a batch of plan commands, or keeps it for later when Timeline Studio can't be reached.

    python3 -I outbox.py send < batch.json   the one way to write: flushes the outbox, then sends this batch
    python3 -I outbox.py flush               only the outbox (e.g. at the start of a session)
    python3 -I outbox.py by                  the author name `send` signs with, for calls that skip the outbox

batch.json is the body /api/commands takes: {"cmd": {...}} or {"cmds": [...]}. Every command without an `at` gets
one stamped now, so a batch sent hours late still records when the work happened. Outcomes, one line each:
  sent           applied
  queued <file>  the service is unreachable (no connection, TLS, timeout, 5xx): kept in the outbox
  rejected       a 4xx: the command itself is wrong, never retried. Kept as <file>.rejected.json with the
                 answer beside it as <file>.error.txt, for a person to look at
Exit 0 when sent, 2 when queued, 1 when rejected.

Every POST carries `x-timeline-by`, decided when the batch is queued and stored with it (a `by` key beside `cmds`,
stripped before sending), so a batch flushed later by another session keeps its author. See `by()`.
"""

import datetime
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

# The overrides are for test_outbox.py.
CONFIG = pathlib.Path(os.environ.get("TIMELINE_STUDIO_CONFIG", pathlib.Path.home() / ".config/timeline-studio/config.json"))
OUTBOX = pathlib.Path(os.environ.get("TIMELINE_STUDIO_OUTBOX", pathlib.Path.home() / ".agents/state/timeline-studio-tasks/outbox"))
DEFAULT_BASE = "https://timeline-studio.rascaltwo.com"


def by() -> str | None:
    """Who is writing, first match wins: TIMELINE_BY, claude/<8>, codex/<8>, plain codex, else None (server says `agent`).

    Codex sets CODEX_THREAD_ID (same value as CODEX_SESSION_ID), CODEX_CI and CODEX_VERSION (found by running
    `env` under `codex exec`, codex-cli 0.166.0). A Codex started from Claude Code inherits the Claude id and signs as claude.
    """
    env = os.environ
    if env.get("TIMELINE_BY"):
        return env["TIMELINE_BY"]
    if env.get("CLAUDE_CODE_SESSION_ID"):
        return f"claude/{env['CLAUDE_CODE_SESSION_ID'][:8].lower()}"
    codex_id = env.get("CODEX_THREAD_ID") or env.get("CODEX_SESSION_ID")
    if codex_id:
        return f"codex/{codex_id[:8].lower()}"
    return "codex" if env.get("CODEX_CI") or env.get("CODEX_VERSION") else None


def post(body: dict) -> tuple[str, str]:
    """POST the batch: ("sent" | "unreachable" | "rejected", detail). The token never reaches a log or a URL."""
    config = json.loads(CONFIG.read_text())
    body = dict(body)
    author = body.pop("by", None)  # the server takes cmd/cmds only
    request = urllib.request.Request(
        f"{config.get('base', DEFAULT_BASE)}/api/commands",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-timeline-token": config["token"],
                 **({"x-timeline-by": author} if author else {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return "sent", response.read().decode()
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        return ("unreachable" if error.code >= 500 else "rejected"), f"{error.code} {detail}"
    except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
        return "unreachable", str(error)


def stamped(body: dict) -> dict:
    """The batch with `at` on every command that has none: the moment it was meant to apply."""
    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    commands = body.get("cmds") or [body["cmd"]]
    return {"cmds": [{"at": now, **command} for command in commands]}


def flush() -> bool:
    """Send every queued batch, oldest first. False if the service is still unreachable (the rest wait)."""
    for path in sorted(OUTBOX.glob("*.json")):
        if path.name.endswith(".rejected.json"):
            continue
        outcome, detail = post(json.loads(path.read_text()))
        if outcome == "unreachable":
            return False
        if outcome == "rejected":
            path.rename(path.with_name(path.stem + ".rejected.json"))
            path.with_name(path.stem + ".error.txt").write_text(detail)
            print(f"rejected (queued {path.name}): {detail}")
        else:
            path.unlink()
            print(f"sent (queued {path.name})")
    return True


def send(body: dict) -> int:
    body = stamped(body)
    author = by()
    if author:
        body["by"] = author
    else:
        print("warning: no agent recognised (set TIMELINE_BY); the server signs this write `agent`", file=sys.stderr)
    if flush():
        outcome, detail = post(body)
        if outcome == "sent":
            print("sent")
            return 0
        if outcome == "rejected":
            print(f"rejected: {detail}")
            return 1
    OUTBOX.mkdir(parents=True, exist_ok=True)
    path = OUTBOX / f"{datetime.datetime.now(datetime.timezone.utc):%Y%m%dT%H%M%S%fZ}.json"
    path.write_text(json.dumps(body, indent=2))
    print(f"queued {path.name}: Timeline Studio is unreachable; it is sent on the next write or flush")
    return 2


if __name__ == "__main__":
    if sys.argv[1:] == ["send"]:
        sys.exit(send(json.load(sys.stdin)))
    if sys.argv[1:] == ["flush"]:
        sys.exit(0 if flush() else 2)
    if sys.argv[1:] == ["by"]:
        print(by() or "")
        sys.exit(0)
    sys.exit(__doc__)

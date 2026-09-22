#!/usr/bin/env python3
"""Append a snapshot of the account's rate-limit windows to the usage history.

Covers the gap the statusline tee cannot: Claude Code has to be running for the
tee to fire, so any window that opens, burns and resets while it is closed would
otherwise leave no trace. This calls the same endpoint Claude Code calls
(/api/oauth/usage, 60s-cached upstream) and stores the response verbatim.

Two conditions trigger a call, checked against the last API snapshot's own
timestamp (not the log mtime — the tee shares that file and its values lag):

  * more than POLL_INTERVAL since the last write, or
  * a window resets within BOUNDARY_LEAD, where unsampled burn is lost rather
    than deferred (utilisation zeroes at the boundary instead of carrying over)

Everything else is a no-op, so running this on a short tick is cheap.

Note: the OAuth token is refreshed by Claude Code, not by us. If Claude Code has
not run for long enough that the token expires, polling fails with 401 until you
start it again. That is logged, not silent.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

LOG_DIR = os.path.expanduser("~/.agents/state/usage-history/claude-code")
ERR_LOG = os.path.join(LOG_DIR, "poll-errors.log")
KEYCHAIN_SERVICE = "Claude Code-credentials"
API_URL = "https://api.anthropic.com/api/oauth/usage"
API_BETA = "oauth-2025-04-20"   # header Claude Code sends; the endpoint 404s without it

POLL_INTERVAL = 15 * 60   # seconds between routine snapshots
BOUNDARY_LEAD = 6 * 60    # poll when a reset is this close, to catch terminal utilisation
TIMEOUT = 5               # matches Claude Code's own timeout


def log_path():
    return os.path.join(LOG_DIR, datetime.now(timezone.utc).strftime("%Y-%m") + ".jsonl")


def note(msg):
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(ERR_LOG, "a") as fh:
        fh.write(f"{datetime.now().astimezone().isoformat()} {msg}\n")


def read_token():
    """Pull the OAuth access token out of the login keychain.

    Guarded with a hard timeout: a keychain item whose ACL does not yet trust the
    caller pops an approval dialog, which blocks forever when nobody is looking.
    """
    try:
        raw = subprocess.run(
            ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, timeout=10,
        )
    except subprocess.TimeoutExpired:
        note("keychain read timed out (approval prompt?)")
        return None
    if raw.returncode != 0:
        note(f"keychain read failed rc={raw.returncode}")
        return None
    try:
        oauth = json.loads(raw.stdout)["claudeAiOauth"]
    except (ValueError, KeyError) as exc:
        note(f"credential blob unparseable: {exc}")
        return None
    expires = oauth.get("expiresAt")
    if expires and expires / 1000 < time.time():
        note("access token expired; run Claude Code to refresh it")
    return oauth.get("accessToken")


def last_api_age():
    """Seconds since the last *API* snapshot.

    Deliberately not the file mtime. The statusline tee shares this log, and its
    values are whatever Claude Code last happened to refetch — measured lagging
    by ~25 minutes. Letting tee writes suppress the poll would substitute stale,
    mis-timestamped data for the only accurately-dated source we have.
    """
    newest = 0.0
    try:
        with open(log_path(), "rb") as fh:
            fh.seek(0, os.SEEK_END)
            fh.seek(max(0, fh.tell() - 65536))
            tail = fh.read().decode(errors="replace").splitlines()
    except OSError:
        return float("inf")
    for line in tail:
        # Parse rather than substring-match on '"src":"api"': that only matches
        # compact separators, so any record written with default json spacing
        # would be invisible and the poller would think it had never run.
        try:
            record = json.loads(line)
            if record.get("src") != "api":
                continue
            stamp = datetime.fromisoformat(record["t"]).timestamp()
        except (ValueError, KeyError, TypeError):
            continue
        newest = max(newest, stamp)
    return time.time() - newest if newest else float("inf")


def boundary_near():
    """True when any window in the newest record resets within BOUNDARY_LEAD."""
    try:
        with open(log_path(), "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - 8192))
            tail = fh.read().decode(errors="replace").strip().splitlines()
        record = json.loads(tail[-1])
    except (OSError, IndexError, ValueError):
        return False

    now = time.time()
    # Both shapes appear in the log: the tee stores epoch seconds, the API an
    # ISO string. Normalising happens at read time, so handle both here.
    buckets = (record.get("usage") or record.get("rate_limits") or {}).values()
    for bucket in buckets:
        if not isinstance(bucket, dict):
            continue
        resets = bucket.get("resets_at")
        if isinstance(resets, (int, float)):
            due = resets
        elif isinstance(resets, str):
            try:
                due = datetime.fromisoformat(resets).timestamp()
            except ValueError:
                continue
        else:
            continue
        if 0 < due - now <= BOUNDARY_LEAD:
            return True
    return False


def fetch(token):
    req = urllib.request.Request(
        API_URL, headers={"Authorization": f"Bearer {token}", "anthropic-beta": API_BETA}
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode())


def main():
    forced = "--force" in sys.argv
    if not forced and last_api_age() < POLL_INTERVAL and not boundary_near():
        return 0

    token = read_token()
    if not token:
        return 1

    try:
        usage = fetch(token)
    except urllib.error.HTTPError as exc:
        # The endpoint rate-limits itself; respect Retry-After rather than retrying.
        note(f"HTTP {exc.code} {exc.reason} retry-after={exc.headers.get('retry-after')}")
        return 1
    except Exception as exc:
        note(f"{type(exc).__name__}: {exc}")
        return 1

    record = {
        "t": datetime.now().astimezone().isoformat(timespec="seconds"),
        "src": "api",
        "usage": usage,   # verbatim: the schema carries codenamed buckets that go live without notice
    }
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(log_path(), "a") as fh:
        fh.write(json.dumps(record, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())

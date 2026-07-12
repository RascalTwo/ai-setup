#!/usr/bin/env python3
"""Call an Atlassian MCP tool directly via HTTP, bypassing Claude's tool-call channel.

Auth: reads the Atlassian OAuth bearer token from Claude Code's keychain entry.
Body: the tool arguments come from a JSON file on disk, so the payload never
flows through any LLM output.

Usage:
    mcp_call.py <tool-name> <args-json-file>

Example:
    mcp_call.py updateConfluencePage /tmp/tool-args.json
"""
import json
import subprocess
import sys
import urllib.request

MCP_URL = "https://mcp.atlassian.com/v1/mcp"
KEYCHAIN_SERVICE = "Claude Code-credentials"
ATLASSIAN_KEY_PREFIX = "atlassian|"


def get_token() -> str:
    raw = subprocess.check_output(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        text=True,
    ).strip()
    creds = json.loads(raw)
    atl = creds.get("mcpOAuth", {})
    for k, v in atl.items():
        if k.startswith(ATLASSIAN_KEY_PREFIX):
            return v["accessToken"]
    raise SystemExit("No atlassian MCP token in keychain")


def post_json(url: str, headers: dict, payload: dict) -> tuple:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return resp.status, dict(resp.headers), resp.read().decode()


def parse_sse(text: str) -> dict:
    """Atlassian returns SSE framing. Pull out the first `data: ` line."""
    for line in text.splitlines():
        if line.startswith("data: "):
            return json.loads(line[6:])
    # Also handle raw JSON fallback
    return json.loads(text)


def main():
    tool_name = sys.argv[1]
    args_path = sys.argv[2]
    with open(args_path) as f:
        tool_args = json.load(f)

    token = get_token()
    headers_common = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "mcp-direct/0.1",
    }

    # 1. initialize → pick up session id
    status, headers, body = post_json(
        MCP_URL,
        headers_common,
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "jm-mcp-direct", "version": "0.1"},
            },
        },
    )
    session_id = headers.get("Mcp-Session-Id") or headers.get("mcp-session-id")
    if not session_id:
        sys.stderr.write("No session id returned. Status %d\nHeaders: %s\nBody: %s\n" % (status, headers, body))
        sys.exit(1)
    sys.stderr.write(f"session: {session_id}\n")

    session_headers = {**headers_common, "Mcp-Session-Id": session_id}

    # 2. notifications/initialized — complete handshake
    # Notifications have no id and no response expected.
    req = urllib.request.Request(
        MCP_URL,
        data=json.dumps(
            {"jsonrpc": "2.0", "method": "notifications/initialized"}
        ).encode(),
        headers=session_headers,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            resp.read()  # drain
    except urllib.error.HTTPError as e:
        if e.code not in (200, 202):
            sys.stderr.write(f"initialized notif failed: {e.code} {e.read().decode()}\n")

    # 3. tools/call
    status, headers, body = post_json(
        MCP_URL,
        session_headers,
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {"name": tool_name, "arguments": tool_args},
        },
    )
    parsed = parse_sse(body)
    print(json.dumps(parsed, indent=2))


if __name__ == "__main__":
    main()

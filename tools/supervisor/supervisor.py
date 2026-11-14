#!/usr/bin/env python3
"""supervisor: Claude Code PreToolUse hook that stops a tool call doing something bad.
These rules are deterministic and deny outright. Stdin: the hook payload. Stdout: a deny, or nothing.
Test: python3 tools/supervisor/supervisor.test.py   Replay over real transcripts: python3 tools/supervisor/replay.py"""
import json, os, re, sys, time, urllib.parse

HOME = os.path.expanduser("~")
STATE = os.environ.get("SUPERVISOR_STATE", f"{HOME}/.agents/state/supervisor")
EXTRA_EMAILS = os.environ.get("SUPERVISOR_EMAILS", f"{HOME}/.config/supervisor/emails.txt")


def my_emails():
    """Every address that is the user's: the google accounts, git identity, the Claude login, and an extra list."""
    found = set()
    for path in (f"{HOME}/.agents/ai-setup/skills/google/accounts.json", f"{HOME}/.gitconfig", EXTRA_EMAILS):
        try:
            found.update(re.findall(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+", open(path, errors="ignore").read()))
        except OSError:
            pass
    try:
        found.add(json.load(open(f"{HOME}/.claude.json"))["oauthAccount"]["emailAddress"])
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return {e.lower() for e in found if "noreply" not in e and not e.startswith("git@")}  # git@host is an SSH remote, not a person


# What puts bytes on the network from a shell or a script run inline. shortcut: a script run by name
# (python x.py) is invisible here; a model judge would be the layer for that.
NET = r"(?:^|[;&|(\n`]|\$\()\s*(?:\w+=\S*\s+)*(curl|wget|https?|nc|ncat|ssh|scp|sftp|rsync|ftp|telnet|gh|aws|gcloud|az|gws|npm\s+publish|twine)\b|\bopen\s+['\"]?https?:|\bgit\s+(push|clone|fetch|pull|ls-remote)\b|\brequests\.|\burllib|\bhttp\.client|\bfetch\(|\bhttpx\b|\baxios\b|\bsocket\.|XMLHttpRequest|sendBeacon|WebSocket"
GENERIC_CLIENTS = r"\b(curl|wget|https?|nc|ncat|ftp|telnet)\b|\brequests\.|\burllib|\bhttp\.client|\bfetch\(|\bhttpx\b|\baxios\b|\bsocket\."
LOCAL_MCP = re.compile(r"^mcp__(basic-memory|app-panel|voicemode|plugin-authoring|qr)__")
LOCAL_URL = re.compile(r"^https?://(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)", re.I)
# Where the user's own address (or a token) is expected: the services that hold those accounts.
IDENTITY_HOSTS = re.compile(r"(^|\.)(google\.com|googleapis\.com|gmail\.com|tel\.meet|atlassian\.net|atlassian\.com|github\.com|githubusercontent\.com|amazonaws\.com|on\.aws|microsoft\.com|microsoftonline\.com|office\.com|live\.com|azure\.com|sourceallies\.com|sourceallies\.app\.n8n\.cloud|rascaltwo\.com|claude\.ai|anthropic\.com|slack\.com|localhost|127\.0\.0\.1)$", re.I)
IDENTITY_TOOLS = re.compile(r"^mcp__(claude_ai_Google|claude_ai_Gmail|atlassian|azure-devops|claude_ai_SAI_Unified_Graph|[\w-]*unified-graph|graph-apollo)", re.I)
# A header that announces who is calling: the address has no business there (anthropics/claude-code#107757).
CONTACT_HEADER = r"user[-_ ]?agent|\bcurl\b[^|;&\n]*\s-A\s|\bwget\b[^|;&\n]*\s-U\s"
SECRET_PATH = r"['\"]?(?:~|\$HOME|\$\{HOME\}|" + re.escape(HOME) + r")/\.(?:ssh/[\w.-]+|aws/credentials|gnupg/\S+|netrc)['\"]?|\S*\.env(?:\.\w+)?\b|\S+\.(?:pem|p12|key)\b"
# Each token shape and the only hosts that may receive it: a live token anywhere else is exfiltration.
TOKENS = [(r"\bgh[pousr]_[A-Za-z0-9]{36}\b|\bgithub_pat_\w{60,}", r"github\.com|githubusercontent\.com"),
          (r"\bglpat-[\w-]{20}", r"gitlab\.\S+"),
          (r"\bsk-ant-[\w-]{40,}", r"anthropic\.com|claude\.ai"),
          (r"\bsk-proj-[\w-]{40,}", r"openai\.com"),
          (r"\bxox[abpr]-\d{8,}-[\w-]{10,}", r"slack\.com"),
          (r"\bAKIA[0-9A-Z]{16}\b", r"amazonaws\.com"),
          (r"\bAIza[0-9A-Za-z_-]{35}\b", r"googleapis\.com|google\.com")]
AT_COMMAND = r"(?:^|[;&|(\n`]|\$\()\s*(?:sudo\s+|command\s+|exec\s+)?"
PROSE_TOOLS = ("Skill", "Agent", "SendMessage", "TodoWrite")  # words to a model, never run
BROWSER_LOCAL_KEYS = {"action_summary", "query", "tabId", "ref", "coordinate"}


SHELL = r"(^|[\s|;&(])(ba|z|da)?sh(\s|$)"
INTERPRETER = SHELL + r"|(^|[\s|;&(])(python3?|node|bun|deno|ruby|perl|osascript)(\s|$)"


def as_run(cmd, reader=INTERPRETER):
    """The shell text that runs: a heredoc body counts only when `reader` (a shell, or any interpreter) reads it."""
    return re.sub(r"([^\n]*?)<<-?\s*['\"]?(\w+)['\"]?([^\n]*)\n.*?\n\s*\2[ \t]*(?=\n|$)",
                  lambda m: m.group(0) if re.search(reader, m.group(1) + m.group(3)) else m.group(1) + "<<" + m.group(2) + m.group(3),
                  cmd, flags=re.S)


def shell_only(cmd):
    """Commands as the shell runs them: no interpreter heredocs, and no multi-word quoted strings except `sh -c`'s."""
    cmd = as_run(cmd, SHELL)
    return re.sub(r"(?<!-c )('[^'\n]*\s[^'\n]*'|\"[^\"\n]*\s[^\"\n]*\")", "''", cmd)


def outbound(tool, inp):
    """The part of the input that leaves this machine, as text, or None if none of it does."""
    if tool in ("WebFetch", "WebSearch"):
        return None if LOCAL_URL.match(inp.get("url") or "x") else json.dumps(inp)
    if tool.startswith("mcp__claude-in-chrome__") or tool.startswith("mcp__computer-use__"):
        # A page sees what is typed, navigated to, or fetched by page script; a find query or a summary stays here.
        text = json.dumps({k: v for k, v in inp.items() if k not in BROWSER_LOCAL_KEYS})
        if tool.endswith("javascript_tool") and not re.search(r"fetch\(|XMLHttpRequest|sendBeacon|WebSocket|location\s*=|\.submit\(", text):
            return None
        return text
    if tool.startswith("mcp__"):
        return None if LOCAL_MCP.match(tool) else json.dumps(inp)
    if tool in ("Bash", "Monitor"):
        cmd = as_run(inp.get("command", ""))
        urls = re.findall(r"https?://[^\s'\"]+", cmd)
        if urls and all(LOCAL_URL.match(u) for u in urls) and not re.search(r"\b(ssh|scp|rsync|gh|aws|gcloud|az|gws)\b", cmd):
            return None
        return cmd if re.search(NET, cmd) else None
    return None


def hosts(text):
    return {h.lower().rstrip(".") for h in re.findall(r"https?://(?:[^/\s@\"']*@)?([\w.-]+)", text)}


def check(tool, inp, emails):
    """The rule that refuses this call, as (rule, reason), or None."""
    if tool in PROSE_TOOLS:
        return None
    cmd = as_run(inp.get("command", "")) if tool in ("Bash", "Monitor") else ""
    sh = shell_only(inp.get("command", "")) if cmd else ""
    out = outbound(tool, inp)

    # Anywhere, written or sent: a script that names the address beside a User-Agent leaks it when it runs.
    raw = json.dumps(inp, ensure_ascii=False)
    raw = raw + "\n" + urllib.parse.unquote(raw)
    for e in emails:
        if re.search(r"(" + CONTACT_HEADER + r")[^\n]{0,160}?" + re.escape(e), raw, re.I):
            return "my-email", f"it puts the user's address {e} in a User-Agent, which announces it to whatever server it reaches"

    if out is not None:
        text = out + "\n" + urllib.parse.unquote(out)  # one pass of percent-decoding, as the built-in privacy mod does
        dests = {h for h in hosts(text) if not IDENTITY_HOSTS.search(h)}
        # The account's own service may see the account's address or its token; anywhere else may not.
        browser = tool.startswith(("mcp__claude-in-chrome__", "mcp__computer-use__"))
        if tool == "WebSearch" or (tool.startswith("mcp__") and not browser):
            own = bool(IDENTITY_TOOLS.match(tool))  # a search engine or an MCP server is a destination of its own
        else:
            # shortcut: text typed into a browser page whose URL isn't in the input counts as own (logins); a judge could see the page
            own = not dests and not (cmd and re.search(GENERIC_CLIENTS, cmd) and not hosts(text))
        hit = next((e for e in emails if e in text.lower()), None)
        if hit and re.search(CONTACT_HEADER, text, re.I):
            return "my-email", f"it puts the user's address {hit} in a User-Agent, which announces it to whatever server it reaches"
        if hit and not own:
            return "my-email", f"it would send the user's address {hit} to {', '.join(sorted(dests)) or 'a service that does not hold that account'}"
        for token, issuer in TOKENS:
            if re.search(token, text):
                others = {h for h in hosts(text) if not re.search(r"(^|\.)(" + issuer + r")$", h) and not LOCAL_URL.match("http://" + h)}
                if others or (not hosts(text) and not own):
                    return "secret-out", f"it would send what looks like a live API token to {', '.join(sorted(others)) or 'a service that did not issue it'}"
        if cmd and re.search(r"(?:-d|--data(?:-binary|-raw)?|-F|--form|-T|--upload-file)\s+['\"]?\w*=?@(?:" + SECRET_PATH + r")|\bscp\s+(?:-\S+\s+)*(?:" + SECRET_PATH + r")\s+\S+:|\bcat\s+(?:" + SECRET_PATH + r")\s*\|\s*(?:curl|nc|ssh)\b", cmd):
            return "secret-out", "it would upload a key or credentials file"

    if sh:
        if re.search(AT_COMMAND + r"(curl|wget)\b[^|;&\n]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|" + AT_COMMAND + r"(ba|z)?sh\s+<\(\s*(curl|wget)\b", sh):
            return "remote-code", "it pipes a download straight into a shell"
        home = r"(~|\$HOME|\$\{HOME\}|" + re.escape(HOME) + r")"
        if re.search(AT_COMMAND + r"rm\s+(-\w*\s+)*-\w*[rR]\w*\s+(-\S+\s+)*[\"']?(/|" + home + r"(/(Desktop|Documents|Downloads|Library|Pictures|Movies|Music|\.claude|\.agents|\.config|\.ssh))?/?|/(Users|System|Library|Applications|usr|etc|var|bin|opt)/?)[\"']?(\s|$|\*|;|&|\))", sh):
            return "destroy", "it would recursively delete the home folder, a top-level folder or a system folder"
        if re.search(AT_COMMAND + r"(mkfs(\.\w+)?|diskutil\s+(erase\w*|zeroDisk|secureErase|partitionDisk))\b|" + AT_COMMAND + r"dd\b[^|;&\n]*\bof=/dev/", sh):
            return "destroy", "it would erase a disk"
        if re.search(AT_COMMAND + r"git\b[^|;&\n]*\bpush\b[^|;&\n]*((--force\b|--force-with-lease\b|\s-f\b)[^|;&\n]*\b(main|master|trunk)\b|\b(main|master|trunk)\b[^|;&\n]*(--force\b|\s-f\b)|\s\+(main|master|trunk)\b|--mirror\b)", sh):
            return "history", "it would force-push over a shared default branch"
    return None


def main():
    try:
        e = json.load(sys.stdin)
        verdict = check(e.get("tool_name", ""), e.get("tool_input") or {}, my_emails())
    except Exception as err:  # a crash must not wedge every tool call; log it and let the call through
        os.makedirs(STATE, exist_ok=True)
        open(f"{STATE}/errors.log", "a").write(f"{time.strftime('%F %T')} {err!r}\n")
        return
    if verdict:
        rule, reason = verdict
        os.makedirs(STATE, exist_ok=True)
        open(f"{STATE}/log", "a").write(json.dumps({"rule": rule, "tool": e.get("tool_name"), "session": e.get("session_id"), "mode": e.get("permission_mode"), "input": json.dumps(e.get("tool_input"))[:400]}) + "\n")
        print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
              "permissionDecisionReason": f"supervisor ({rule}) refused this call: {reason}. Don't retry it in another form. If the user asked for exactly this, tell them it was refused and why; they can run it themselves."}}))


if __name__ == "__main__":
    main()

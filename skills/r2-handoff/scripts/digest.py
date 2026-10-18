#!/usr/bin/env python3
"""Compact a Claude Code transcript (JSONL) into a small digest. No LLM.
Keeps every user message, assistant text (clipped), each tool call as one line,
tool errors, and the last TAIL turns near-verbatim. Drops tool-result bodies,
thinking and metadata. A 8.6 MB transcript becomes roughly 30k tokens."""
import json, re, sys

TAIL = 8
SR = re.compile(r"<system-reminder>.*?</system-reminder>|<task-notification>.*?</task-notification>", re.S)
SKIP_PREFIX = ("Base directory for this skill", "Caveat:", "<command-", "[Request interrupted")

def clip(s, n):
    s = s.strip()
    return s if len(s) <= n else s[: n // 2] + " …[clipped]… " + s[-n // 2 :]

def text_of(c):
    return c if isinstance(c, str) else "\n".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")

def tool_line(x):
    i, n = x.get("input", {}), x.get("name", "?")
    key = i.get("file_path") or i.get("command") or i.get("pattern") or i.get("prompt") or i.get("description") or json.dumps(i)
    return f"{n}: {clip(str(key).replace(chr(10), ' ⏎ '), 110)}"

turns, errors, first, last = [], [], None, None
for line in open(sys.argv[1]):
    try:
        d = json.loads(line)
    except ValueError:  # a half-written last line
        continue
    ts = d.get("timestamp")
    if ts:
        first, last = first or ts, ts
    m = d.get("message")
    if not isinstance(m, dict):
        continue
    c = m.get("content")
    if d.get("type") == "user":
        if isinstance(c, list):
            for x in c:
                if x.get("type") == "tool_result" and x.get("is_error"):
                    errors.append((ts, clip(text_of(x.get("content") or ""), 240)))
        txt = SR.sub("", text_of(c)).strip()
        if txt and not d.get("isMeta") and not txt.startswith(SKIP_PREFIX):
            turns.append((ts, "USER", txt))
    elif d.get("type") == "assistant" and isinstance(c, list):
        txt = text_of(c).strip()
        tools = [tool_line(x) for x in c if x.get("type") == "tool_use"]
        if txt:
            turns.append((ts, "ASSISTANT", txt))
        if tools:
            turns.append((ts, "TOOLS", "\n".join(tools)))

print(f"# Digest of {sys.argv[1]}\nfirst event {first}\nlast event  {last}\n{len(turns)} turns, {len(errors)} tool errors\n")
cut = len(turns) - TAIL
for k, (ts, role, txt) in enumerate(turns):
    lim = 3500 if k >= cut else 700 if txt.startswith("Another Claude session") else 1200 if role == "USER" else 450
    print(f"[{(ts or '')[5:16]}] {role}: {clip(txt, lim)}\n")
print("## Tool errors (clipped)")
for ts, e in errors[-25:]:
    print(f"[{(ts or '')[5:16]}] {e}")

"""Reading a Claude Code transcript (JSONL), shared by digest.py (rescue mode) and extract.py
(auto handoff's Extracted state). No LLM."""
import json, re

SR = re.compile(r"<system-reminder>.*?</system-reminder>|<task-notification>.*?</task-notification>", re.S)
SKIP_PREFIX = ("Base directory for this skill", "Caveat:", "<command-", "[Request interrupted")


def clip(s, n):
    s = s.strip()
    return s if len(s) <= n else s[: n // 2] + " …[clipped]… " + s[-n // 2 :]


def text_of(c):
    return c if isinstance(c, str) else "\n".join(x.get("text", "") for x in c if isinstance(x, dict) and x.get("type") == "text")


def tool_line(x, n=110):
    """One line for a tool_use block: its name and its most telling input."""
    i, name = x.get("input") or {}, x.get("name", "?")
    key = (i.get("file_path") or i.get("notebook_path") or i.get("command") or i.get("pattern") or i.get("prompt")
           or i.get("description") or json.dumps(i))
    return f"{name}: {clip(str(key).replace(chr(10), ' ⏎ '), n)}"


def user_text(d):
    """A user event's own words, without system reminders; '' for tool results, meta and skill bodies."""
    m = d.get("message")
    if d.get("type") != "user" or not isinstance(m, dict) or d.get("isMeta"):
        return ""
    txt = SR.sub("", text_of(m.get("content") or "")).strip()
    return "" if txt.startswith(SKIP_PREFIX) else txt


def events(path):
    """Each parsed event, in order: (timestamp or None, event dict, message content or None)."""
    for line in open(path):
        try:
            d = json.loads(line)
        except ValueError:  # a half-written last line
            continue
        if not isinstance(d, dict):
            continue
        m = d.get("message")
        yield d.get("timestamp"), d, (m.get("content") if isinstance(m, dict) else None)

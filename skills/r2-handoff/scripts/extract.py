#!/usr/bin/env python3
"""The "Extracted state" section auto handoff appends to a handoff: exact details pulled from the
session's transcript with no LLM. Files edited and read, failed tool calls with their first error
line, the last tool calls, open todos, and identifiers (commit SHAs, PR/issue numbers, URLs).

  extract.py TRANSCRIPT [--until HANDOFF_PATH] [--cap TOKENS]

Reads the transcript only up to the `AUTO HANDOFF` instruction (the one naming HANDOFF_PATH, else the
last one), so the agent's own handoff-writing steps don't crowd the lists. Capped at --cap tokens
(chars / 4, default 3000): the oldest entries of each list go first, and a line says how many."""
import os, re, sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from transcript import clip, events, text_of, tool_line, user_text

HEADING = "## Extracted state (mechanical, from the transcript)"
CAP = 3000
EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")
# Per-list ceilings before the token cap; newest kept.
LIMITS = {"edited": 40, "read": 30, "failed": 12, "calls": 15, "todos": 30, "ids": 40}
SHA = re.compile(r"(?<![\w./-])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}(?![\w-])")
URL = re.compile(r"https?://[^\s\"'<>`(){}\[\]|]+")
ISSUE = re.compile(r"(?:[\w.-]+/[\w.-]+#\d+|\b(?:PR|MR|issue|pull request)\s*#?\d+\b|(?<![\w&/])#\d{2,6}\b)", re.I)


def is_request(text):
    """auto-handoff's instruction. It may arrive as 'Stop hook feedback:\nAUTO HANDOFF (...', or, from the idle
    trigger, appended to a half-typed user message, so it is matched anywhere."""
    return "AUTO HANDOFF (" in text and "write the handoff to" in text


def cut_index(rows, until):
    """Index of the AUTO HANDOFF instruction to stop at: the one naming `until`, else the last one, else the end."""
    said = lambda i: text_of(rows[i][2] or "") if rows[i][1].get("type") == "user" else ""  # isMeta included: the hook's block is meta
    asks = [i for i in range(len(rows)) if not rows[i][1].get("isSidechain") and is_request(said(i))]
    named = [i for i in asks if until and until in said(i)]
    return (named or asks or [len(rows)])[-1]


def first_error_line(content):
    """The first line that says something: skips blanks, tags and a bare 'Exit code N'."""
    lines = [re.sub(r"</?[\w_-]+>", "", l).strip() for l in text_of(content or "").splitlines()]
    lines = [l for l in lines if l]
    code = lines[0] if lines and re.fullmatch(r"Exit code \d+", lines[0]) else ""
    rest = [l for l in lines if l != code]
    line = (f"{code}: " if code else "") + (rest[0] if rest else "")
    return clip(line or code or "(no message)", 200)


def ids_in(text, out):
    for rx in (URL, ISSUE, SHA):
        for m in rx.findall(text or ""):
            out.append(m.rstrip(".,;:"))


def extract(path, until=None):
    """Each list newest first."""
    rows = [r for r in events(path) if not r[1].get("isSidechain")]
    rows = rows[: cut_index(rows, until)]
    calls, edited, read, failed, ids = {}, [], [], [], []
    order, todo_list, tasks, pending_task = [], None, {}, {}
    for _, d, c in rows:
        if d.get("type") == "assistant" and isinstance(c, list):
            for x in c:
                if x.get("type") == "text":
                    ids_in(x.get("text"), ids)
                if x.get("type") != "tool_use":
                    continue
                name, i = x.get("name", "?"), x.get("input") or {}
                calls[x.get("id")] = tool_line(x)
                order.append(tool_line(x))
                f = i.get("file_path") or i.get("notebook_path")
                if f and name in EDIT_TOOLS:
                    edited.append(f)
                elif f and name == "Read":
                    read.append(f)
                if name == "TodoWrite":
                    todo_list = i.get("todos") or []
                elif name == "TaskCreate":
                    pending_task[x.get("id")] = i.get("subject") or i.get("description") or "?"
                elif name == "TaskUpdate" and i.get("taskId") is not None:
                    tasks.setdefault(str(i["taskId"]), {"subject": i.get("subject") or "?"})
                    tasks[str(i["taskId"])].update({k: i[k] for k in ("status", "subject") if i.get(k)})
                cmd = i.get("command") or ""
                ids_in(cmd if "git" in cmd or "gh " in cmd else "", ids)
                ids_in(" ".join(str(v) for k, v in i.items() if k in ("url", "prompt", "query")), ids)
        elif d.get("type") == "user":
            ids_in(user_text(d), ids)
            for x in c if isinstance(c, list) else []:
                if not isinstance(x, dict) or x.get("type") != "tool_result":
                    continue
                tid = x.get("tool_use_id")
                if x.get("is_error"):
                    failed.append(f"{calls.get(tid, '?')} → {first_error_line(x.get('content'))}")
                elif tid in pending_task:
                    m = re.search(r"#(\d+)", text_of(x.get("content") or ""))
                    if m:
                        tasks[m.group(1)] = {"subject": pending_task[tid], "status": "pending"}
                if tid in calls and re.match(r"Bash: .*\b(git|gh)\b", calls[tid]):
                    ids_in(text_of(x.get("content") or ""), ids)
    if todo_list is not None:
        todos = [f"[{t.get('status', '?')}] {t.get('content') or t.get('subject') or '?'}"
                 for t in todo_list if t.get("status") != "completed"]
    else:
        todos = [f"[{t.get('status', '?')}] #{k} {t['subject']}" for k, t in tasks.items()
                 if t.get("status") not in ("completed", "deleted")]
    newest = lambda xs: list(dict.fromkeys(reversed(xs)))
    edited_n = newest(edited)
    return {"edited": edited_n, "read": [f for f in newest(read) if f not in edited_n],
            "failed": failed[::-1], "calls": order[::-1], "todos": todos, "ids": newest(ids)}


TITLES = {"edited": "Files edited (newest first)", "read": "Files read, not edited (newest first)",
          "failed": "Failed tool calls (newest first)", "calls": "Last tool calls (oldest first)",
          "todos": "Todos still open", "ids": "Identifiers seen: SHAs, PRs/issues, URLs (newest first)"}


def render(lists, cap=CAP):
    """Markdown for the lists, oldest entries dropped first until it fits in `cap` tokens (chars / 4)."""
    total = {k: len(v) for k, v in lists.items()}
    keep = {k: list(v[: LIMITS[k]]) for k, v in lists.items()}

    def text():
        out = [HEADING, "",
               "Copied by a script from the session transcript up to the handoff request; no LLM wrote this. "
               "Exact values, but no judgement about which matter.", ""]
        for k, title in TITLES.items():
            if not total[k]:
                continue
            out.append(f"**{title}**")
            items = keep[k][::-1] if k == "calls" else keep[k]
            out += [f"- `{x}`" if k in ("edited", "read") else f"- {x}" for x in items]
            if total[k] > len(keep[k]):
                out.append(f"- …and {total[k] - len(keep[k])} older")
            out.append("")
        return "\n".join(out)

    s = text()
    while len(s) / 4 > cap and any(keep.values()):
        k = max(keep, key=lambda k: sum(len(x) for x in keep[k]))  # trim the list taking the most room
        keep[k].pop()
        s = text()
    return s


def section(path, until=None, cap=CAP):
    return render(extract(path, until), cap)


if __name__ == "__main__":
    a = sys.argv[1:]
    opt = lambda f, d: a[a.index(f) + 1] if f in a else d
    print(section(a[0], opt("--until", None), int(opt("--cap", CAP))))

#!/usr/bin/env python3
"""Compact a Claude Code transcript (JSONL) into a small digest. No LLM.
Keeps every user message, assistant text (clipped), each tool call as one line,
tool errors, and the last TAIL turns near-verbatim. Drops tool-result bodies,
thinking and metadata. A 8.6 MB transcript becomes roughly 30k tokens."""
import os, sys

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
from transcript import clip, events, text_of, tool_line, user_text

TAIL = 8

turns, errors, first, last = [], [], None, None
for ts, d, c in events(sys.argv[1]):
    if ts:
        first, last = first or ts, ts
    if c is None:
        continue
    if d.get("type") == "user":
        if isinstance(c, list):
            for x in c:
                if x.get("type") == "tool_result" and x.get("is_error"):
                    errors.append((ts, clip(text_of(x.get("content") or ""), 240)))
        txt = user_text(d)
        if txt:
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

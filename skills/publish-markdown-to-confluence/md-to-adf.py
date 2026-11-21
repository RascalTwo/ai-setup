#!/usr/bin/env python3
"""Convert a markdown file to Confluence ADF (Atlassian Document Format) JSON.

Scope
-----
Handles the markdown shapes commonly found in hand-written / journal-style
documents:

- YAML frontmatter at the top (stripped from output).
- ATX headings (`#`, `##`, ..., `######`).
- Paragraphs (one line per paragraph — no soft-wrap handling).
- GitHub-style pipe tables (first row is header, separator row `|---|---|`
  is discarded).
- Blockquotes (consecutive `>` lines; a bare `>` separates paragraphs; lists
  and fences inside are parsed; wrapped lines within a quote are joined).
- Bullet (`-`/`*`) and numbered (`1.`) lists, nested by indentation, with
  indented continuation lines joined into the item.
- Fenced code blocks (```lang), emitted verbatim.
- Horizontal rules (`---` on its own line, outside frontmatter).
- Inline `[label](url)` / `[label](<url with spaces>)` links, `` `code` ``,
  `**bold**` and `_italic_` emphasis.

This is NOT a full-fidelity markdown renderer — no nested tables, no loose
(blank-line-separated) list items, no fences inside list items. Outside
blockquotes, each line is its own paragraph (no soft-wrap joining).

Features
--------
- `--drop-row NAME` (repeatable): drop any table row whose first cell
  equals NAME. Useful for stripping provenance/metadata rows that only
  matter in the source file.
- `--max-entries N`: stop emitting output after N `###` headings. Useful
  for previews on large files.
- `--no-date-pills`: disable auto-conversion of bare `YYYY-MM-DD` tokens
  in table cells to ADF `date` nodes. Default is on — in practice, dates
  inside tables are almost always meant as structured dates.

Usage
-----
    python3 md-to-adf.py path/to/file.md > out.json
    python3 md-to-adf.py path/to/file.md --max-entries 3 > preview.json
    python3 md-to-adf.py path/to/file.md --drop-row "Consolidated From" > out.json

Output
------
Single-line JSON ADF document on stdout. Redirect it to a file and push it
from disk with `mcp-http-call.py` (see SKILL.md step 4) — never paste it inline
into an `updateConfluencePage` tool call; large payloads corrupt in transit.
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone

DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
LINK_RE = re.compile(r"\[([^\]]+)\]\((?:<([^>]+)>|([^)]+))\)")
CODE_RE = re.compile(r"`([^`]+)`")
LIST_RE = re.compile(r"^( *)([-*]|\d+\.) +(.*)$")
ITALIC_RE = re.compile(r"_(.+?)_")
BOLD_RE = re.compile(r"\*\*(.+?)\*\*")


def to_epoch_ms(y: int, m: int, d: int) -> str:
    return str(int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000))


def parse_inline(text: str, plain=None) -> list:
    """Turn a string into ADF inline nodes: links, `code`, bold, italic.

    Links are extracted first so labels and URLs stay intact; code spans
    next, so underscores inside them never become italic. `plain` handles
    the remaining spans (default: bold/italic).
    """
    plain = plain or _emphasis_split
    nodes = []
    pos = 0
    for m in LINK_RE.finditer(text):
        nodes.extend(_code_split(text[pos : m.start()], plain))
        link = {"type": "link", "attrs": {"href": m.group(2) or m.group(3)}}
        for n in _code_split(m.group(1), lambda t: [{"type": "text", "text": t}]):
            n["marks"] = n.get("marks", []) + [link]
            nodes.append(n)
        pos = m.end()
    nodes.extend(_code_split(text[pos:], plain))
    return [n for n in nodes if n.get("text", True)]


def _code_split(text: str, plain) -> list:
    nodes = []
    pos = 0
    for m in CODE_RE.finditer(text):
        nodes.extend(plain(text[pos : m.start()]))
        nodes.append({"type": "text", "text": m.group(1), "marks": [{"type": "code"}]})
        pos = m.end()
    return nodes + plain(text[pos:])


def _emphasis_split(text: str) -> list:
    """Handle `**bold**` first, then `_italic_` within the non-bold spans.

    Bold uses `*` and italic uses `_`, so the two never overlap; a bold span
    that also contains italic keeps both marks.
    """
    nodes = []
    pos = 0
    for m in BOLD_RE.finditer(text):
        if m.start() > pos:
            nodes.extend(_italic_split(text[pos : m.start()]))
        for n in _italic_split(m.group(1)):
            n["marks"] = n.get("marks", []) + [{"type": "strong"}]
            nodes.append(n)
        pos = m.end()
    if pos < len(text):
        nodes.extend(_italic_split(text[pos:]))
    return [n for n in nodes if n["text"]]


def _italic_split(text: str) -> list:
    nodes = []
    pos = 0
    for m in ITALIC_RE.finditer(text):
        if m.start() > pos:
            nodes.append({"type": "text", "text": text[pos : m.start()]})
        nodes.append({"type": "text", "text": m.group(1), "marks": [{"type": "em"}]})
        pos = m.end()
    if pos < len(text):
        nodes.append({"type": "text", "text": text[pos:]})
    return [n for n in nodes if n["text"]]


def parse_date_cell(text: str) -> list:
    """Replace YYYY-MM-DD occurrences with ADF date nodes, preserving surrounding text."""
    nodes = []
    pos = 0
    for m in DATE_RE.finditer(text):
        if m.start() > pos:
            nodes.append({"type": "text", "text": text[pos : m.start()]})
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        nodes.append({"type": "date", "attrs": {"timestamp": to_epoch_ms(y, mo, d)}})
        pos = m.end()
    if pos < len(text):
        nodes.append({"type": "text", "text": text[pos:]})
    return [n for n in nodes if n.get("type") != "text" or n.get("text")]


def cell_content(value: str, date_pills: bool) -> list:
    """Return ADF paragraph content list for one table cell value.

    Links are extracted first so their labels and URLs stay intact: a date
    inside a link label must not turn into a date pill, and an underscore
    inside a URL must not turn into italic emphasis. Non-link spans then
    get date-pill substitution (when enabled) and italic handling.
    """
    inline = parse_inline(value, lambda t: _inline_dates_and_italic(t, date_pills))
    if not inline:
        inline = [{"type": "text", "text": " "}]  # Confluence dislikes empty cells
    return [{"type": "paragraph", "content": inline}]


def _inline_dates_and_italic(text: str, date_pills: bool) -> list:
    """Walk a non-link span: emit date pills (if enabled) and italic text."""
    if not date_pills or not DATE_RE.search(text):
        return _emphasis_split(text)
    nodes = []
    pos = 0
    for m in DATE_RE.finditer(text):
        if m.start() > pos:
            nodes.extend(_emphasis_split(text[pos : m.start()]))
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        nodes.append({"type": "date", "attrs": {"timestamp": to_epoch_ms(y, mo, d)}})
        pos = m.end()
    if pos < len(text):
        nodes.extend(_emphasis_split(text[pos:]))
    return nodes


def split_table_row(line: str) -> list:
    inner = line.strip().strip("|")
    # Split on unescaped pipes only, then unescape `\|` back to a literal pipe.
    # Without this, a cell like `DSPy Part3 \| Technically Speaking` splits into
    # two cells and every downstream row gains a phantom column.
    cells = re.split(r"(?<!\\)\|", inner)
    return [c.strip().replace("\\|", "|") for c in cells]


def build_table(rows: list, drop_rows: set, date_pills: bool) -> dict:
    """rows is list of cell-lists; first is header."""
    table_rows = []
    header_cells = rows[0]
    table_rows.append(
        {
            "type": "tableRow",
            "content": [
                {
                    "type": "tableHeader",
                    "attrs": {"colspan": 1, "rowspan": 1},
                    "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": c or " "}]}
                    ],
                }
                for c in header_cells
            ],
        }
    )
    for row in rows[1:]:
        if len(row) < 2:
            continue
        first = row[0].strip()
        if first in drop_rows:
            continue
        cells = []
        for c in row:
            content = cell_content(c, date_pills)
            cells.append(
                {
                    "type": "tableCell",
                    "attrs": {"colspan": 1, "rowspan": 1},
                    "content": content,
                }
            )
        table_rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "attrs": {"layout": "default"}, "content": table_rows}


def _starts_block(line: str) -> bool:
    s = line.strip()
    return bool(
        s.startswith(("```", ">", "|", "#")) or s == "---" or LIST_RE.match(line)
    )


def parse_list(lines: list, i: int):
    """Parse a (possibly nested) list starting at lines[i]; return (node, next i).

    Deeper-indented items nest under the previous item; indented non-item
    lines are continuations of the previous item's text.
    """
    m = LIST_RE.match(lines[i])
    indent, ordered = len(m.group(1)), m.group(2)[0].isdigit()
    node = {"type": "orderedList" if ordered else "bulletList", "content": []}
    if ordered and int(m.group(2)[:-1]) != 1:
        node["attrs"] = {"order": int(m.group(2)[:-1])}
    while i < len(lines):
        m = LIST_RE.match(lines[i])
        if not m or len(m.group(1)) < indent:
            break
        if len(m.group(1)) > indent:
            sub, i = parse_list(lines, i)
            node["content"][-1]["content"].append(sub)
            continue
        if m.group(2)[0].isdigit() != ordered:
            break  # list type changed at the same level: start a new list
        text = m.group(3)
        i += 1
        while i < len(lines) and lines[i].startswith(" ") and lines[i].strip() and not LIST_RE.match(lines[i]):
            text += " " + lines[i].strip()
            i += 1
        node["content"].append(
            {"type": "listItem", "content": [{"type": "paragraph", "content": parse_inline(text)}]}
        )
    return node, i


def convert(raw: str, drop_rows: set, max_entries: int, date_pills: bool, join_wrapped: bool = False) -> dict:
    # Strip YAML frontmatter.
    if raw.startswith("---\n"):
        end = raw.find("\n---\n", 4)
        if end != -1:
            raw = raw[end + 5 :]

    entry_count = 0

    def blocks(lines: list, join: bool = False) -> list:
        """Parse block nodes. `join` merges wrapped lines into one paragraph."""
        nonlocal entry_count
        content = []
        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            if stripped.startswith("```"):
                lang = stripped[3:].strip()
                code = []
                i += 1
                while i < len(lines) and not lines[i].strip().startswith("```"):
                    code.append(lines[i])
                    i += 1
                i += 1  # closing fence
                node = {"type": "codeBlock"}
                if lang:
                    node["attrs"] = {"language": lang}
                if code:
                    node["content"] = [{"type": "text", "text": "\n".join(code)}]
                content.append(node)
                continue

            if stripped == "---":
                content.append({"type": "rule"})
                i += 1
                continue

            m = re.match(r"^(#{1,6})\s+(.+)$", stripped)
            if m:
                level = len(m.group(1))
                title = m.group(2)
                if level == 3:
                    entry_count += 1
                    if max_entries and entry_count > max_entries:
                        break
                content.append(
                    {
                        "type": "heading",
                        "attrs": {"level": level},
                        "content": parse_inline(title),
                    }
                )
                i += 1
                continue

            if stripped.startswith(">"):
                quoted = []
                while i < len(lines) and lines[i].strip().startswith(">"):
                    quoted.append(re.sub(r"^\s*> ?", "", lines[i]))
                    i += 1
                content.append({"type": "blockquote", "content": blocks(quoted, join=True)})
                continue

            if stripped.startswith("|"):
                table_lines = []
                while i < len(lines) and lines[i].strip().startswith("|"):
                    table_lines.append(lines[i])
                    i += 1
                parsed = [split_table_row(l) for l in table_lines]
                # Drop separator row (|---|---|)
                parsed = [
                    r for r in parsed if not all(set(c) <= set("-: ") for c in r)
                ]
                if parsed:
                    content.append(build_table(parsed, drop_rows, date_pills))
                continue

            if LIST_RE.match(line):
                node, i = parse_list(lines, i)
                content.append(node)
                continue

            if not stripped:
                i += 1
                continue

            i += 1
            while join and i < len(lines) and lines[i].strip() and not _starts_block(lines[i]):
                stripped += " " + lines[i].strip()
                i += 1
            content.append({"type": "paragraph", "content": parse_inline(stripped)})

        return content

    lines = raw.split("\n")
    return {"type": "doc", "version": 1, "content": blocks(lines, join=join_wrapped)}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("source", help="Path to markdown file.")
    ap.add_argument(
        "--drop-row",
        action="append",
        default=[],
        metavar="NAME",
        help="Drop any table row whose first cell equals NAME. Repeatable.",
    )
    ap.add_argument(
        "--max-entries",
        type=int,
        default=0,
        metavar="N",
        help="Stop after N level-3 headings. 0 = no limit.",
    )
    ap.add_argument(
        "--no-date-pills",
        action="store_true",
        help="Disable auto-conversion of YYYY-MM-DD in table cells to ADF date nodes.",
    )
    ap.add_argument(
        "--join-wrapped",
        action="store_true",
        help="Merge hard-wrapped lines into one paragraph (for sources wrapped at a fixed width).",
    )
    args = ap.parse_args()

    with open(args.source) as f:
        raw = f.read()

    doc = convert(
        raw,
        drop_rows=set(args.drop_row),
        max_entries=args.max_entries,
        date_pills=not args.no_date_pills,
        join_wrapped=args.join_wrapped,
    )
    json.dump(doc, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

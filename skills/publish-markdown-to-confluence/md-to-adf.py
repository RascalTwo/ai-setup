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
- Single-line blockquotes (`> text`).
- Horizontal rules (`---` on its own line, outside frontmatter).
- Inline `[label](url)` links and `_italic_` emphasis.

This is NOT a full-fidelity markdown renderer — it does not handle bullet
lists, numbered lists, fenced code, multi-paragraph blockquotes, nested
tables, or inline `**bold**`. Extend as needed; the structure is small.

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
Single-line JSON ADF document on stdout. Feed directly to the
`mcp__atlassian__updateConfluencePage` tool's `body` parameter with
`contentFormat: "adf"`.
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone

DATE_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
ITALIC_RE = re.compile(r"_(.+?)_")


def to_epoch_ms(y: int, m: int, d: int) -> str:
    return str(int(datetime(y, m, d, tzinfo=timezone.utc).timestamp() * 1000))


def parse_inline(text: str) -> list:
    """Turn a string into ADF inline nodes: text + links + italic."""
    nodes = []
    pos = 0
    for m in LINK_RE.finditer(text):
        if m.start() > pos:
            nodes.extend(_italic_split(text[pos : m.start()]))
        nodes.append(
            {
                "type": "text",
                "text": m.group(1),
                "marks": [{"type": "link", "attrs": {"href": m.group(2)}}],
            }
        )
        pos = m.end()
    if pos < len(text):
        nodes.extend(_italic_split(text[pos:]))
    return nodes


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
    inline = []
    pos = 0
    for m in LINK_RE.finditer(value):
        if m.start() > pos:
            inline.extend(_inline_dates_and_italic(value[pos : m.start()], date_pills))
        inline.append(
            {
                "type": "text",
                "text": m.group(1),
                "marks": [{"type": "link", "attrs": {"href": m.group(2)}}],
            }
        )
        pos = m.end()
    if pos < len(value):
        inline.extend(_inline_dates_and_italic(value[pos:], date_pills))
    if not inline:
        inline = [{"type": "text", "text": " "}]  # Confluence dislikes empty cells
    return [{"type": "paragraph", "content": inline}]


def _inline_dates_and_italic(text: str, date_pills: bool) -> list:
    """Walk a non-link span: emit date pills (if enabled) and italic text."""
    if not date_pills or not DATE_RE.search(text):
        return _italic_split(text)
    nodes = []
    pos = 0
    for m in DATE_RE.finditer(text):
        if m.start() > pos:
            nodes.extend(_italic_split(text[pos : m.start()]))
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        nodes.append({"type": "date", "attrs": {"timestamp": to_epoch_ms(y, mo, d)}})
        pos = m.end()
    if pos < len(text):
        nodes.extend(_italic_split(text[pos:]))
    return nodes


def split_table_row(line: str) -> list:
    inner = line.strip().strip("|")
    return [c.strip() for c in inner.split("|")]


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
                        {"type": "paragraph", "content": [{"type": "text", "text": c}]}
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


def convert(raw: str, drop_rows: set, max_entries: int, date_pills: bool) -> dict:
    # Strip YAML frontmatter.
    if raw.startswith("---\n"):
        end = raw.find("\n---\n", 4)
        if end != -1:
            raw = raw[end + 5 :]

    lines = raw.split("\n")
    content = []
    i = 0
    entry_count = 0

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

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

        if stripped.startswith("> "):
            content.append(
                {
                    "type": "blockquote",
                    "content": [
                        {"type": "paragraph", "content": parse_inline(stripped[2:])}
                    ],
                }
            )
            i += 1
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

        if not stripped:
            i += 1
            continue

        content.append({"type": "paragraph", "content": parse_inline(stripped)})
        i += 1

    return {"type": "doc", "version": 1, "content": content}


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
    args = ap.parse_args()

    with open(args.source) as f:
        raw = f.read()

    doc = convert(
        raw,
        drop_rows=set(args.drop_row),
        max_entries=args.max_entries,
        date_pills=not args.no_date_pills,
    )
    json.dump(doc, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

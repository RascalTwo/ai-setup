#!/usr/bin/env python3
"""Preserve Confluence-native nodes across a republish.

Problem: republishing a page from source markdown regenerates the full
ADF body. Any Confluence-specific elements the user added on the wiki
side — Table of Contents macro, info/warning panels, Jira embeds, Smart
Links — get wiped because the source markdown can't represent them.

Fix: before pushing, read the current page's ADF, extract each top-level
node whose type isn't expressible in markdown, and re-splice those nodes
into the newly-generated ADF at the same relative position (anchored to
the nearest preceding heading so they land in roughly the right place
even if the doc structure shifted).

Usage:
    preserve-extensions.py <current-page.json> <new-adf.json>

    # `current-page.json` is either a raw ADF doc ({"type":"doc",...}) or
    # the mcp-http-call getConfluencePage response (the script handles both).
    # `new-adf.json` is the ADF produced by md-to-adf.py.

Output: merged ADF on stdout. Warnings about any unanchorable nodes go
to stderr.
"""
import json
import sys

# Top-level ADF node types that are Confluence-native and not emitted by
# md-to-adf.py. Extend when new macros show up in the wild.
PRESERVE_TYPES = {
    "extension",        # most Confluence macros (ToC, info panel without body)
    "bodiedExtension",  # macros with body content (expand, info with text)
    "inlineCard",       # Smart Links inline
    "blockCard",        # Smart Links as full-width blocks
    "embedCard",        # embedded previews (e.g., Figma, Loom)
}


def heading_text(node: dict) -> str:
    return "".join(c.get("text", "") for c in node.get("content", []))


def extract_preserves(doc: dict) -> list:
    """Return [{node, anchor, offset}] for every preservable top-level node.

    `anchor` is {level, text} of the nearest preceding heading (or None if
    the node is before the first heading). `offset` is how many content
    nodes after that heading the preserved node sits at — used to keep
    relative position within a section when multiple preserves share an
    anchor.
    """
    preserves = []
    current_anchor = None
    offset = 0
    for node in doc.get("content", []):
        if node.get("type") == "heading":
            current_anchor = {
                "level": node["attrs"]["level"],
                "text": heading_text(node),
            }
            offset = 0
            continue
        offset += 1
        if node.get("type") in PRESERVE_TYPES:
            preserves.append(
                {"node": node, "anchor": current_anchor, "offset": offset}
            )
    return preserves


def splice(new_doc: dict, preserves: list) -> dict:
    """Insert each preserved node into new_doc at its anchor's position.

    If the anchor heading exists in new_doc, insert `offset` nodes past it
    (not crossing into the next heading). If the anchor doesn't exist,
    fall back to "at the top, just after any leading H1" and warn.
    """
    content = list(new_doc.get("content", []))
    for p in preserves:
        anchor = p["anchor"]
        offset = p["offset"]
        target = None
        if anchor is not None:
            for i, n in enumerate(content):
                if (
                    n.get("type") == "heading"
                    and n.get("attrs", {}).get("level") == anchor["level"]
                    and heading_text(n) == anchor["text"]
                ):
                    target = i
                    break

        if target is None:
            insert_at = 1 if content and content[0].get("type") == "heading" else 0
            sys.stderr.write(
                f"preserve-extensions: no anchor match for {anchor!r}; "
                f"inserting at position {insert_at}\n"
            )
            content.insert(insert_at, p["node"])
            continue

        idx = target + 1
        walked = 0
        while (
            idx < len(content)
            and walked < offset
            and content[idx].get("type") != "heading"
        ):
            idx += 1
            walked += 1
        content.insert(idx, p["node"])

    new_doc["content"] = content
    return new_doc


def unwrap_current(raw: dict) -> dict:
    """Accept either a raw ADF doc or an mcp-http-call getConfluencePage response."""
    if raw.get("type") == "doc":
        return raw
    # MCP response: {"result":{"content":[{"type":"text","text":"<json string>"}],...}}
    try:
        text = raw["result"]["content"][0]["text"]
        page = json.loads(text)
        return page["body"]
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        sys.exit(f"preserve-extensions: couldn't locate ADF body in input ({e})")


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: preserve-extensions.py <current-page.json> <new-adf.json>")
    current = unwrap_current(json.load(open(sys.argv[1])))
    new = json.load(open(sys.argv[2]))
    preserves = extract_preserves(current)
    if not preserves:
        sys.stderr.write("preserve-extensions: no Confluence-native nodes to preserve\n")
        json.dump(new, sys.stdout, ensure_ascii=False, separators=(",", ":"))
        sys.stdout.write("\n")
        return
    sys.stderr.write(
        f"preserve-extensions: preserving {len(preserves)} "
        f"Confluence-native node(s)\n"
    )
    merged = splice(new, preserves)
    json.dump(merged, sys.stdout, ensure_ascii=False, separators=(",", ":"))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()

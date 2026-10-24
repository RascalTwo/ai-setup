#!/usr/bin/env python3
"""Check owned skills against the mechanical rules of Anthropic's skill best-practices page
(platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices). Warns; exit 0 unless --strict.

  skills-check.py [--strict] [SKILL_DIR ...]

No SKILL_DIR = every owned skill: the symlinks in ~/.agents/skills (the rest are `npx skills` copies).
Rules: name/description valid and free of <tags>; SKILL.md body under 500 lines; every .md the skill
ships is linked directly from SKILL.md (one level deep), and nothing under reference/ is an orphan; a reference over 100 lines has a Contents
heading in its first 100 lines; the description starts third person, not imperative (a verb-list heuristic).
"""
import re, sys
from pathlib import Path

BASE_VERBS = set("""run use go get make find check build write read add set show take turn render save transcribe
extract create open launch hand spawn end drive list send publish deploy trigger wait review analyze diagnose
investigate understand offload give pull push fetch query manage convert install port reorder plan merge edit
search ask grill pressure-test stress-test force""".split())
SKIP = {"node_modules", ".git", "tests", "viz-pages", ".mcpb-dist", ".gem-dist"}


def frontmatter(text):
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not m:
        return None, text
    fm, cur = {}, None
    for line in m.group(1).splitlines():
        km = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if km and not line.startswith(" "):
            cur = km.group(1)
            fm[cur] = km.group(2).strip()
        elif cur and line.startswith(" "):
            fm[cur] += " " + line.strip()
    return fm, text[m.end():]


def unquote(s):
    return s[1:-1].replace('\\"', '"') if len(s) > 1 and s[0] in "\"'" and s[-1] == s[0] else s


def md_links(text, root, here):
    """Markdown files in this skill that `text` names, as a link or any path-like token."""
    out = set()
    for m in re.finditer(r"(?<![\w./~-])((?:\.{0,2}/)?[\w][\w./-]*\.md)\b", text):
        p = m.group(1)
        if re.match(r"^(https?:|mailto:|~|/)", p) or not p.endswith(".md"):
            continue
        for base in (here, root):  # relative to the linking file, or to the skill root
            f = (base / p).resolve()
            if f.is_file() and root.resolve() in f.parents:
                out.add(f.relative_to(root.resolve()))
                break
    return out


def check(root):
    root = root.resolve()
    text = (root / "SKILL.md").read_text(errors="replace")
    fm, body = frontmatter(text)
    if fm is None:
        return ["SKILL.md has no frontmatter"]
    out = []
    name, desc = unquote(fm.get("name", "")), unquote(fm.get("description", ""))
    if not name or len(name) > 64 or not re.fullmatch(r"[a-z0-9-]+", name):
        out.append(f"name {name!r}: must be 1-64 chars of lowercase letters, digits, hyphens")
    if re.search(r"anthropic|claude", name):
        out.append(f"name {name!r} contains a reserved word")
    if not desc:
        out.append("description is empty")
    if len(desc) > 1024:
        out.append(f"description is {len(desc)} chars (max 1024)")
    if re.search(r"<[a-zA-Z/][^>]*>", name + desc):
        out.append("name/description contains an XML-looking <tag> (use {braces} for placeholders)")
    if desc:
        first = re.sub(r"[^A-Za-z-]", "", desc.split()[0]).lower()
        if first in BASE_VERBS:
            out.append(f"description starts imperative ({first.capitalize()}...); the page wants third person ({first.capitalize()}s...)")
    n = len(body.splitlines())
    if n > 500:
        out.append(f"SKILL.md body is {n} lines (max 500)")
    direct = md_links(body, root, root)
    for f in sorted(root.rglob("*.md")):
        rel = f.relative_to(root)
        if rel.name == "SKILL.md" or SKIP & set(rel.parts):
            continue
        if rel not in direct:
            via = [str(r) for r in direct if rel in md_links((root / r).read_text(errors="replace"), root, (root / r).parent)]
            if via:
                out.append(f"{rel} is only linked from {', '.join(sorted(via))}; link it from SKILL.md (one level deep)")
            elif rel.parts[0] in ("reference", "references"):
                out.append(f"{rel} is not linked from SKILL.md or any other file")
        lines = f.read_text(errors="replace").splitlines()
        if rel in direct and len(lines) > 100 and not any(re.match(r"^#{1,4}\s*(table of )?contents\b", l, re.I) for l in lines[:100]):
            out.append(f"{rel} is {len(lines)} lines with no Contents heading in its first 100")
    return out


def main(argv):
    strict = "--strict" in argv
    dirs = [Path(a) for a in argv if not a.startswith("--")]
    if not dirs:
        home = Path.home() / ".agents" / "skills"
        dirs = [p for p in sorted(home.iterdir()) if p.is_symlink() and (p / "SKILL.md").is_file()]
    bad = 0
    for d in dirs:
        if not (d / "SKILL.md").is_file():
            continue
        found = check(d)
        bad += bool(found)
        for msg in found:
            print(f"{d.name}: {msg}")
    print(f"skills-check: {bad} of {len(dirs)} skills have findings", file=sys.stderr)
    return 1 if strict and bad else 0


sys.exit(main(sys.argv[1:]))

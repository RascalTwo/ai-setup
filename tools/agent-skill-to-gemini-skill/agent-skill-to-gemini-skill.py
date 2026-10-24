#!/usr/bin/env python3
"""agent-skill-to-gemini-skill: turn any Agent Skill folder into one the Gemini app accepts and can load.

Usage: agent-skill-to-gemini-skill.py SKILL_DIR [--out DIR] [--exclude GLOB ...]
Writes DIR/<name>/ and DIR/<name>.zip (default DIR: ./dist/gemini). Exits 1 if the result breaks a rule.
In a git repo only tracked files count. A `.geminiignore` in the skill adds gitignore-style globs
(`!` re-includes, last match wins); its presence is also how a repo marks a skill for conversion.

The rules (measured 2026-10-23, see README.md):
- The Gemini app fails to load a skill holding any text file besides SKILL.md, so every other
  text file is inlined into SKILL.md. Images (and PDFs) stay as files.
- Upload: at most 100 files and 100 MiB, every extension in ALLOWED, folder name == `name`.
Stdlib only, so it can be vendored and run anywhere python3 is.
"""
import argparse
import fnmatch
import re
import subprocess
import sys
import zipfile
from pathlib import Path

# The upload dialog's allowlist, read from Gemini's code (build 20261022.15).
ALLOWED = set(
    ".bmp .c .cc .cpp .css .csv .cxx .docx .gif .go .h .heic .heif .hh .hpp .htm .html .hxx .ico .ipynb .java"
    " .jpeg .jpg .js .json .md .odp .ods .odt .pdf .png .pptx .py .rs .rtf .sh .svg .tif .tiff .tsv .txt .webp"
    " .xlsx .xml .yaml .yml".split()
)
# Kept as separate files: Gemini loads these. shortcut: .pdf is untested at load time, inline-or-drop if it breaks.
KEEP = {".bmp", ".gif", ".heic", ".heif", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".tif", ".tiff", ".webp"}
JUNK = {".ds_store", "thumbs.db", "desktop.ini"}
MAX_FILES, MAX_BYTES = 100, 104857600
NAME_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
FIXED_TIME = (2026, 1, 1, 0, 0, 0)  # zip timestamps, so an unchanged skill gives a byte-identical zip

PREAMBLE = (
    "> This skill's other files are included at the end of this file, each under a heading "
    "`FILE: <path>`. Where these instructions say to read or open one of those paths, read that section instead."
)


def is_junk(rel: Path) -> bool:
    return rel.name.lower() in JUNK or rel.name.startswith("._") or any(p.lower() == "__macosx" for p in rel.parts)


def source_files(src: Path) -> list[Path]:
    """Tracked files when src is in a git repo (skips node_modules, logs, builds), else everything."""
    r = subprocess.run(["git", "-C", str(src), "ls-files", "-z", "--", "."], capture_output=True)
    if r.returncode == 0:
        return sorted(src / p for p in r.stdout.decode().split("\0") if p and (src / p).is_file())
    return sorted(p for p in src.rglob("*") if p.is_file())


def ignored(rel: str, rules: list[str]) -> bool:
    hit = False
    for r in rules:
        neg = r.startswith("!")
        pat = r[1:] if neg else r
        if pat.endswith("/"):  # a folder: everything under it
            pat += "*"
        if fnmatch.fnmatch(rel, pat) or ("/" not in pat and fnmatch.fnmatch(rel.rsplit("/", 1)[-1], pat)):
            hit = not neg
    return hit


def split_frontmatter(text: str) -> tuple[str, str]:
    m = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n?", text, re.S)
    if not m:
        sys.exit("SKILL.md has no frontmatter (--- block at the top)")
    return m.group(1), text[m.end():]


def fence(text: str) -> str:
    # A fence longer than any backtick run inside, so embedded code blocks can't close it.
    longest = max((len(r) for r in re.findall(r"`+", text)), default=0)
    return "`" * max(3, longest + 1)


def convert(src: Path, out: Path, excludes: list[str]) -> list[str]:
    """Write out/<name>/ and out/<name>.zip. Returns the rule violations (empty = uploadable)."""
    skill_md = src / "SKILL.md"
    if not skill_md.is_file():
        sys.exit(f"{src}: no SKILL.md")
    front, body = split_frontmatter(skill_md.read_text(encoding="utf-8"))
    name_m = re.search(r"^name:\s*['\"]?([^'\"\n]+?)['\"]?\s*$", front, re.M)
    name = name_m.group(1) if name_m else src.name
    problems = [] if NAME_RE.fullmatch(name) else [f"name {name!r} is not lowercase-with-hyphens"]

    ignore_file = src / ".geminiignore"
    rules = [l.strip() for l in ignore_file.read_text().splitlines()] if ignore_file.is_file() else []
    rules = [l for l in rules if l and not l.startswith("#")] + excludes

    kept, inlined, dropped = [], [], []
    for f in source_files(src):
        rel = f.relative_to(src)
        if rel in (Path("SKILL.md"), Path(".geminiignore")) or is_junk(rel) or ignored(rel.as_posix(), rules):
            continue
        if f.suffix.lower() in KEEP:
            kept.append(rel)
            continue
        try:
            inlined.append((rel, f.read_text(encoding="utf-8")))
        except UnicodeDecodeError:
            dropped.append(rel)

    sections = [f"## FILE: {rel.as_posix()}\n\n{fence(t)}\n{t.rstrip()}\n{fence(t)}" for rel, t in inlined]
    new_body = body.lstrip("\n")
    if sections:
        new_body = f"{PREAMBLE}\n\n{new_body.rstrip()}\n\n# Included files\n\n" + "\n\n".join(sections) + "\n"
    new_skill = f"---\n{front}\n---\n\n{new_body}"

    files = {"SKILL.md": new_skill.encode("utf-8")}
    files.update({rel.as_posix(): (src / rel).read_bytes() for rel in kept})
    if len(files) > MAX_FILES:
        problems.append(f"{len(files)} files, over Gemini's {MAX_FILES} (images count; --exclude some or host them)")
    total = sum(len(b) for b in files.values())
    if total > MAX_BYTES:
        problems.append(f"{total} bytes, over Gemini's {MAX_BYTES}")
    for p in files:
        if Path(p).suffix.lower() not in ALLOWED:
            problems.append(f"{p}: extension not accepted by Gemini")

    dest = out / name
    if dest.exists():
        for old in sorted(dest.rglob("*"), reverse=True):
            old.unlink() if old.is_file() else old.rmdir()
    for p, data in files.items():
        (dest / p).parent.mkdir(parents=True, exist_ok=True)
        (dest / p).write_bytes(data)
    with zipfile.ZipFile(out / f"{name}.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(files):
            info = zipfile.ZipInfo(f"{name}/{p}", FIXED_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, files[p])

    print(f"{name}: {len(inlined)} inlined, {len(kept)} kept, SKILL.md {len(new_skill)} chars -> {out / name}.zip")
    for rel in dropped:
        print(f"  dropped binary {rel} (Gemini can't load it; link it from the web instead)", file=sys.stderr)
    return problems


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("skill_dir", type=Path)
    ap.add_argument("--out", type=Path, default=Path("dist/gemini"))
    ap.add_argument("--exclude", action="append", default=[], metavar="GLOB", help="skip paths matching GLOB (repeatable)")
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    problems = convert(a.skill_dir.resolve(), a.out, a.exclude)
    for p in problems:
        print(f"  ✗ {p}", file=sys.stderr)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()

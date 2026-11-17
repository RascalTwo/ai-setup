#!/usr/bin/env python3
"""agent-skill-to-gemini-skill: turn any Agent Skill folder into one the Gemini app accepts and can load.

Usage: agent-skill-to-gemini-skill.py SKILL_DIR [--out DIR] [--exclude GLOB ...] [--image-urls MAP.json] [--strip-urls]
Writes two outputs (default DIR: ./dist/gemini), exits 1 if the skill breaks a rule:
- DIR/<name>/ and DIR/<name>.zip, the skill upload. Pictures are shrunk with ImageMagick and written into
  SKILL.md as data URIs; a picture still over MAX_PICTURE bytes is left out with a warning. Text holding a
  web address is refused (Gemini answers empty) unless --strip-urls, which removes the addresses.
- DIR/<name>.megaprompt.md, the same instructions to paste into a chat, with pictures as the links
  --image-urls maps them to (path -> URL, e.g. Drive lh3 links). Web addresses are fine there.
In a git repo only tracked files count. A `.geminiignore` in the skill adds gitignore-style globs
(`!` re-includes, last match wins); its presence is also how a repo marks a skill for conversion.
A `.gemini-preamble.md` in the skill goes at the very top of both outputs (Gemini-only wording).

The rules (measured 2026-10-23 and 2026-10-31, see README.md):
- The Gemini app fails to load a skill holding any text file besides SKILL.md, so every other
  text file is inlined into SKILL.md.
- Canvas pages can't show a skill's bundled images, and any http(s) URL in a skill empties the answer.
- Upload: at most 100 files and 100 MiB, every extension in ALLOWED, folder name == `name`.
Python stdlib plus the `magick` command, so it can be vendored and run anywhere python3 is.
"""
import argparse
import fnmatch
import json
import base64
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

# The upload dialog's allowlist, read from Gemini's code (build 20261022.15).
ALLOWED = set(
    ".bmp .c .cc .cpp .css .csv .cxx .docx .gif .go .h .heic .heif .hh .hpp .htm .html .hxx .ico .ipynb .java"
    " .jpeg .jpg .js .json .md .odp .ods .odt .pdf .png .pptx .py .rs .rtf .sh .svg .tif .tiff .tsv .txt .webp"
    " .xlsx .xml .yaml .yml".split()
)
# Pictures: shrunk and written into SKILL.md. PDFs stay files. shortcut: .pdf is untested at load time, inline-or-drop if it breaks.
PICTURES = {".bmp", ".gif", ".heic", ".heif", ".ico", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
KEEP = PICTURES | {".pdf"}
# Largest shrunk picture a Canvas page copied right (2.9 KB) and under the 6.4 KB that failed, measured 2026-10-31.
MAX_PICTURE = 3072
URL_RE = re.compile(r"https?://[^\s)\]>\"'`]*")
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


CATALOG = (
    "# IMAGE CATALOG\n\nThese images are hosted at the links below. Use each link exactly as written; "
    "never write the image's file path (such as `assets/...`), invent a link or id, or use base64."
)
INLINE_CATALOG = (
    "# Pictures\n\nThis skill's pictures are written into these instructions as data URIs (`data:image/png;base64,...`) "
    "where their file path used to be. Use a data URI exactly as written, copying every character, as the `<img src>`; "
    "never write the picture's file path or a link instead."
)


PICTURE_WARNING = """
  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  !! WARNING: as of 2026-10-31, Gemini skills garble pictures ({n} in this skill).
  !! The skill upload is at your own risk. Use {mega} instead.
  !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
"""


def shrink(path: Path, tmp: Path) -> bytes:
    """A palette PNG with metadata stripped: 4-11 KB icons come out at 1-3 KB with no visible loss (2026-10-31)."""
    out = tmp / "shrunk.png"
    r = subprocess.run(["magick", str(path), "-strip", "-colors", "256", f"PNG8:{out}"], capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"magick could not shrink {path}: {r.stderr.strip()}")
    return out.read_bytes()


def find_urls(label: str, text: str, first_line: int = 1) -> list[str]:
    return [f"{label}:{n}: {u}" for n, line in enumerate(text.splitlines(), first_line) for u in URL_RE.findall(line)]


def assemble(body: str, inlined: list[tuple[Path, str]], swap: dict[str, str]) -> str:
    """The body with the inlined files appended, every path in `swap` replaced by its value."""
    def sub(t: str) -> str:
        for path in sorted(swap, key=len, reverse=True):  # longest first, so no path eats another's prefix
            t = t.replace(path, swap[path])
        return t
    sections = [f"## FILE: {rel.as_posix()}\n\n{fence(t)}\n{t.rstrip()}\n{fence(t)}" for rel, t in ((r, sub(t)) for r, t in inlined)]
    out = sub(body.lstrip("\n"))
    if sections:
        out = f"{PREAMBLE}\n\n{out.rstrip()}\n\n# Included files\n\n" + "\n\n".join(sections) + "\n"
    return out


def convert(src: Path, out: Path, excludes: list[str], image_urls: dict[str, str], strip_urls: bool) -> list[str]:
    """Write the megaprompt, then out/<name>/ and out/<name>.zip. Returns the rule violations (empty = uploadable)."""
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
        if rel in (Path("SKILL.md"), Path(".geminiignore"), Path(".gemini-preamble.md")) or is_junk(rel) or ignored(rel.as_posix(), rules):
            continue
        if f.suffix.lower() in KEEP:
            kept.append(rel)
            continue
        try:
            inlined.append((rel, f.read_text(encoding="utf-8")))
        except UnicodeDecodeError:
            dropped.append(rel)
    pictures = [rel for rel in kept if rel.suffix.lower() in PICTURES]
    kept = [rel for rel in kept if rel not in pictures]

    unknown = sorted(set(image_urls) - {rel.as_posix() for rel in pictures})
    if unknown:
        sys.exit(f"--image-urls: not an image in the skill: {', '.join(unknown)}")
    wording_file = src / ".gemini-preamble.md"
    wording = wording_file.read_text(encoding="utf-8").strip() if wording_file.is_file() else ""

    # The megaprompt: pasted into a chat, where Drive links work and web addresses are fine (2026-10-31).
    mega = assemble(body, inlined, image_urls)
    if image_urls:
        rows = "\n".join(f"- `{p}`: {image_urls[p]}" for p in sorted(image_urls))
        mega = f"{mega.rstrip()}\n\n{CATALOG}\n\n{rows}\n"
    mega = f"---\n{front}\n---\n\n{mega}"
    (out / f"{name}.megaprompt.md").write_text(f"{wording}\n\n{mega}" if wording else mega, encoding="utf-8")
    unlinked = [rel for rel in pictures if rel.as_posix() not in image_urls]
    if unlinked and not image_urls:
        print(f"  megaprompt: left out all {len(unlinked)} pictures (no --image-urls)", file=sys.stderr)
    elif unlinked:
        for rel in unlinked:
            print(f"  megaprompt: left out {rel} (no --image-urls entry)", file=sys.stderr)

    # The skill: no web addresses, pictures shrunk and written in.
    front_line = 2  # SKILL.md line 1 is the opening ---
    body_line = front_line + front.count("\n") + 2
    urls = find_urls("SKILL.md", front, front_line) + find_urls("SKILL.md", body, body_line) + find_urls(".gemini-preamble.md", wording)
    for rel, t in inlined:
        urls += find_urls(rel.as_posix(), t)
    if urls and not strip_urls:
        print("  ✗ skill not written: web addresses make a Gemini skill answer empty (2026-10-31)", file=sys.stderr)
        for u in urls:
            print(f"    {u}", file=sys.stderr)
        print("    re-run with --strip-urls to leave them out; the megaprompt keeps them", file=sys.stderr)
        return problems + [f"{len(urls)} web address(es) in the skill"]
    if urls:
        print(f"  --strip-urls removed {len(urls)} web address(es):", file=sys.stderr)
        for u in urls:
            print(f"    {u}", file=sys.stderr)
        front, body, wording = (URL_RE.sub("", t) for t in (front, body, wording))
        inlined = [(rel, URL_RE.sub("", t)) for rel, t in inlined]

    data_uris = {}
    if pictures:
        if not shutil.which("magick"):
            sys.exit("the skill output needs ImageMagick to shrink pictures: brew install imagemagick (or apt install imagemagick)")
        with tempfile.TemporaryDirectory() as tmp:
            for rel in pictures:
                png = shrink(src / rel, Path(tmp))
                if len(png) > MAX_PICTURE:
                    print(f"  left out {rel}: {len(png)} bytes after shrinking, over {MAX_PICTURE} (use the megaprompt)", file=sys.stderr)
                    continue
                data_uris[rel.as_posix()] = "data:image/png;base64," + base64.b64encode(png).decode()
    new_body = assemble(body, inlined, data_uris)
    unmentioned = [p for p in sorted(data_uris) if data_uris[p] not in new_body]
    if data_uris:  # pictures no text names still get a row, so Gemini can use them
        rows = "".join(f"\n\n- `{p}`: {data_uris[p]}" for p in unmentioned)
        new_body = f"{new_body.rstrip()}\n\n{INLINE_CATALOG}{rows}\n"
    if wording:  # the skill's own Gemini-facing wording goes first
        new_body = f"{wording}\n\n{new_body}"
    new_skill = f"---\n{front}\n---\n\n{new_body}"

    files = {"SKILL.md": new_skill.encode("utf-8")}
    files.update({rel.as_posix(): (src / rel).read_bytes() for rel in kept})
    if len(files) > MAX_FILES:
        problems.append(f"{len(files)} files, over Gemini's {MAX_FILES} (--exclude some)")
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

    print(f"{name}: {len(inlined)} inlined, {len(data_uris)} pictures written in, {len(kept)} kept, SKILL.md {len(new_skill)} chars -> {out / name}.zip, {name}.megaprompt.md")
    for rel in dropped:
        print(f"  dropped binary {rel} (Gemini can't load it; link it from the web instead)", file=sys.stderr)
    if pictures:  # last, so it isn't scrolled away
        print(PICTURE_WARNING.format(n=len(pictures), mega=f"{name}.megaprompt.md"), file=sys.stderr)
    return problems


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("skill_dir", type=Path)
    ap.add_argument("--out", type=Path, default=Path("dist/gemini"))
    ap.add_argument("--exclude", action="append", default=[], metavar="GLOB", help="skip paths matching GLOB (repeatable)")
    ap.add_argument("--image-urls", type=Path, metavar="MAP.json", help='{"assets/x.png": "https://..."}: picture links for the megaprompt')
    ap.add_argument("--strip-urls", action="store_true", help="write the skill without its web addresses instead of refusing it")
    a = ap.parse_args()
    image_urls = json.loads(a.image_urls.read_text()) if a.image_urls else {}
    if not (isinstance(image_urls, dict) and all(isinstance(v, str) for v in image_urls.values())):
        sys.exit("--image-urls: expected a JSON object of path -> URL")
    a.out.mkdir(parents=True, exist_ok=True)
    problems = convert(a.skill_dir.resolve(), a.out, a.exclude, image_urls, a.strip_urls)
    for p in problems:
        print(f"  ✗ {p}", file=sys.stderr)
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()

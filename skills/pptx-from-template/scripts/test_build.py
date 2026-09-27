#!/usr/bin/env python3
"""Self-check for build.py against every template pack. Run after touching build.py or a pack.

    python3 test_build.py PACK_FOLDER...

The checks here know nothing about any one template: they drive each pack through
its own map (the --proof deck uses every pattern and every field). A pack can add
its own regression checks in <pack>/test_pack.py, exposing run(build).
"""

import importlib.util
import json
import re
import sys
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402

A = build.A


def text_of(pptx, n):
    root = ET.fromstring(zipfile.ZipFile(pptx).read(f"ppt/slides/slide{n}.xml"))
    return [t.text for t in root.iter(f"{A}t") if t.text and t.text.strip() and t.text.strip() != "‹#›"]


def expect_error(spec, why, name):
    try:
        build.build(spec, Path(tempfile.mkdtemp()) / "bad.pptx", template=name)
    except build.DeckError:
        return
    raise AssertionError(f"{name}: expected a DeckError for {why}")


def check_pack(name):
    template, patterns_path = build.pack(name)
    assert build.check_template(name) == 0, f"{name}: --check-template found problems (see BROKEN lines)"
    patterns = {k: v for k, v in json.loads(patterns_path.read_text()).items() if not k.startswith("_")}

    # Every pattern, every field: the proof deck.
    work = Path(tempfile.mkdtemp())
    spec = build.proof_spec(name, work)
    path, count = build.build(spec, work / "proof.pptx", work)
    assert count == len(patterns), (count, len(patterns))
    z = zipfile.ZipFile(path)
    names = set(z.namelist())

    # Every part is well-formed and no relationship dangles.
    for part in names:
        if part.endswith((".xml", ".rels")):
            ET.fromstring(z.read(part))
        if not part.endswith(".rels"):
            continue
        base = re.sub(r"_rels/[^/]+$", "", part)
        for target in re.findall(rb'Target="([^"]+)"', z.read(part)):
            target = target.decode()
            if target.startswith(("http://", "https://")):
                continue
            resolved = re.sub(r"[^/]+/\.\./", "", base + target).lstrip("/")
            assert resolved in names, f"{name}: {part} points at missing {resolved}"

    # OPC readers match element names literally - ns0: prefixes make the file unopenable.
    for part in ("[Content_Types].xml", "ppt/slides/_rels/slide1.xml.rels"):
        assert b"<ns0:" not in z.read(part), f"{name}: {part} serialized with a generated prefix"

    # Each text field's own name shows up on its slide: the map sends text where it claims.
    for n, entry in enumerate(spec["slides"], start=1):
        text = " ".join(text_of(path, n))
        for field, value in entry["fields"].items():
            first = value[0] if isinstance(value, list) else value
            if isinstance(first, str) and first.startswith("["):
                assert first in text, f"{name}/{entry['pattern']}: {first} missing from its slide"
        if "ppt/notesSlides/notesSlide1.xml" in zipfile.ZipFile(template).namelist():
            assert f"ppt/notesSlides/notesSlide{n}.xml" in names, f"{name}: slide {n} lost its speaker notes"

    # Unused artwork is pruned rather than shipping the whole template's media.
    media = [n for n in names if n.startswith("ppt/media/")]
    template_media = [n for n in zipfile.ZipFile(template).namelist() if n.startswith("ppt/media/")]
    assert len(media) <= len(template_media), (len(media), len(template_media))

    # Bad input fails loudly instead of producing a quietly wrong deck.
    expect_error({"slides": [{"pattern": "no-such-pattern", "fields": {}}]}, "unknown pattern", name)
    for pname, pattern in patterns.items():
        required = [f for f, s in pattern["fields"].items() if "paras" in s and not s.get("optional")]
        single = [f for f in required if not pattern["fields"][f].get("list")]
        if not single:
            continue
        expect_error({"slides": [{"pattern": pname, "fields": {}}]}, "missing required field", name)
        fields = {f: ["x"] if pattern["fields"][f].get("list") else "x" for f in required}
        fields[single[0]] = ["two", "lines"]
        expect_error({"slides": [{"pattern": pname, "fields": fields}]}, "list into a single-line field", name)
        break

    # A text box whose colors fail WCAG AA stops the build.
    slide = ET.fromstring(zipfile.ZipFile(template).read("ppt/slides/slide1.xml"))
    try:
        build.textbox(slide, {"x": 0, "y": 0, "w": 1, "h": 1, "on": "FFFFFF", "color": "EEEEEE", "size": 30},
                      "x", "t")
    except build.DeckError:
        pass
    else:
        raise AssertionError("near-white on white should fail contrast")

    extra = Path(name).expanduser() / "test_pack.py"
    if extra.is_file():
        loaded = importlib.util.spec_from_file_location("test_pack", extra)
        module = importlib.util.module_from_spec(loaded)
        loaded.loader.exec_module(module)
        module.run(build)
    print(f"ok - {name}: {count} patterns proved, {len(media)} media parts, "
          f"{path.stat().st_size // 1024} KB{' + pack checks' if extra.is_file() else ''}")


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: test_build.py PACK_FOLDER...")
    for name in sys.argv[1:]:
        check_pack(name)


if __name__ == "__main__":
    main()

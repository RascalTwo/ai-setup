#!/usr/bin/env python3
"""pr-viz add-on: every PDF the change adds or edits, rendered, with its real link annotations.

    uv run --no-project --with pypdf --with pillow python pdf_fixtures.py <repo> <range> <out-dir>

Writes fixtures.json and fixtures/<name>-<page>.png. Each page lists its link annotations
(rect in PDF points, URI) and the entries that are malformed (null, dangling, not a dict) — the
things a reader can't see in the file but a PDF-link change has to survive.
"""
import hashlib
import json
import subprocess
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps
from pypdf import PdfReader
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject, NullObject

repo, rng, out = sys.argv[1], sys.argv[2], Path(sys.argv[3])
head = rng.split("...")[-1].split("..")[-1]
DPI = 216  # rendered big on a 1080p film; 144 read soft


def git(*args, binary=False):
    return subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True, text=not binary).stdout


pdfs = [p for p in git("diff", "--name-only", "--diff-filter=AM", rng).splitlines() if p.lower().endswith(".pdf")]
(out / "fixtures").mkdir(exist_ok=True)
fixtures = {}
for p in pdfs:
    data = git("show", f"{head}:{p}", binary=True)
    name = Path(p).name
    fx = fixtures.setdefault(name, {"name": name, "copies": [], "pages": None})
    fx["copies"].append({"path": p, "sha256": hashlib.sha256(data).hexdigest()})
    if fx["pages"] is not None:
        continue  # same file name seen already; identical copies are one fixture
    stem = name.rsplit(".", 1)[0]
    tmp = out / "fixtures" / f"{stem}.pdf"
    tmp.write_bytes(data)
    subprocess.run(["pdftoppm", "-png", "-r", str(DPI), str(tmp), str(out / "fixtures" / stem)], check=True)
    tmp.unlink()
    pngs = sorted((out / "fixtures").glob(f"{stem}-*.png"))
    pages = []
    for i, page in enumerate(PdfReader(BytesIO(data)).pages):
        raw = page.get("/Annots")
        raw = raw.get_object() if raw is not None else None
        annots, malformed = [], []
        for j, item in enumerate(raw if isinstance(raw, ArrayObject) else []):
            if isinstance(item, NullObject):
                malformed.append({"index": j, "kind": "null entry"}); continue
            if isinstance(item, IndirectObject):
                target = item.get_object()
                if target is None or isinstance(target, NullObject):
                    malformed.append({"index": j, "kind": "dangling reference", "detail": f"{item.idnum} {item.generation} R"}); continue
                item = target
            if not isinstance(item, DictionaryObject):
                malformed.append({"index": j, "kind": type(item).__name__}); continue
            action = item.get("/A")
            action = action.get_object() if action is not None else None
            uri = str(action.get("/URI", "")) if isinstance(action, DictionaryObject) else ""
            annots.append({"index": j, "rect": [float(v) for v in item.get("/Rect", [])], "uri": uri})
        img = Image.open(pngs[i]).convert("L")
        bbox = ImageOps.invert(img).getbbox() or (0, 0, *img.size)  # crop to the ink, padded
        pad = 24
        crop = [max(bbox[0] - pad, 0), max(bbox[1] - pad, 0), min(bbox[2] + pad, img.size[0]), min(bbox[3] + pad, img.size[1])]
        pages.append({"png": f"fixtures/{pngs[i].name}", "mediabox": [float(v) for v in page.mediabox], "dpi": DPI,
                      "size": list(img.size), "crop": crop, "annots": annots, "malformed": malformed})
    fx["pages"] = pages
for fx in fixtures.values():
    fx["identical"] = len({c["sha256"] for c in fx["copies"]}) == 1
(out / "fixtures.json").write_text(json.dumps({"head": head, "fixtures": fixtures}, indent=1))
for fx in fixtures.values():
    print(f"fixture {fx['name']} ×{len(fx['copies'])}: " + ", ".join(f"p{i + 1} {len(pg['annots'])} links, {len(pg['malformed'])} malformed" for i, pg in enumerate(fx["pages"])))

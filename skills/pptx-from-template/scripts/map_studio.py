#!/usr/bin/env python3
"""Map Studio - review and fix a template's map in the browser.

    python3 map_studio.py PACK_FOLDER...   # then open http://127.0.0.1:8765

Lists the given template packs, drafts a map for an unmapped one, and for each pattern
shows the template slide with its mapped boxes drawn on top, an editor for the map
entry, a one-click proof render, and a Reviewed switch. Standard library only;
slide pictures need LibreOffice (soffice) and poppler (pdftoppm) - without them
the stage falls back to an outline drawing of the shapes.
"""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402
import map_template  # noqa: E402

A, P, EMU = build.A, build.P, build.EMU
PAGE = Path(__file__).with_name("map_studio.html")
CACHE = Path(tempfile.gettempdir()) / "pptx-from-template-renders"
CAN_RENDER = bool(shutil.which("soffice") and shutil.which("pdftoppm"))


PACKS = {}  # folder name -> folder, from the command line


def pack_paths(name):
    if name not in PACKS:
        raise build.DeckError(f"no template pack '{name}'")
    return PACKS[name] / "template.pptx", PACKS[name] / "patterns.json"


def all_packs():
    return sorted(PACKS)


def pack_summary(name):
    template, patterns = pack_paths(name)
    if not patterns.is_file():
        return {"name": name, "mapped": False}
    raw = json.loads(patterns.read_text())
    entries = [v for k, v in raw.items() if not k.startswith("_")]
    return {"name": name, "mapped": True, "patterns": len(entries),
            "reviewed": sum(1 for v in entries if v.get("reviewed"))}


def slide_size(z):
    size = build.parse(z.read("ppt/presentation.xml")).find(f"{P}sldSz")
    return int(size.get("cx")) / EMU, int(size.get("cy")) / EMU


def shapes_on(z, n):
    """Every shape on a slide with its box in slide inches (group transforms applied)."""
    slide = build.parse(z.read(f"ppt/slides/slide{n}.xml"))
    inherited = map_template.inherited_boxes(z, n)
    out = []

    def walk(parent, transform):
        for child in parent:
            kind = child.tag.replace(P, "")
            if kind not in build.SHAPES:
                continue
            nv = child.find(f"./*/{P}cNvPr")
            xfrm = child.find(f"./{P}spPr/{A}xfrm") if kind != "grpSp" else child.find(f"./{P}grpSpPr/{A}xfrm")
            if kind == "graphicFrame":
                xfrm = child.find(f"./{P}xfrm")
            box = None
            if xfrm is not None and xfrm.find(f"{A}off") is not None:
                off, ext = xfrm.find(f"{A}off"), xfrm.find(f"{A}ext")
                x, y = transform(int(off.get("x")), int(off.get("y")))
                x2, y2 = transform(int(off.get("x")) + int(ext.get("cx")), int(off.get("y")) + int(ext.get("cy")))
                box = [x / EMU, y / EMU, (x2 - x) / EMU, (y2 - y) / EMU]
            if kind == "grpSp" and xfrm is not None and xfrm.find(f"{A}chOff") is not None:
                off, ext = xfrm.find(f"{A}off"), xfrm.find(f"{A}ext")
                ch_off, ch_ext = xfrm.find(f"{A}chOff"), xfrm.find(f"{A}chExt")
                sx = int(ext.get("cx")) / max(int(ch_ext.get("cx")), 1)
                sy = int(ext.get("cy")) / max(int(ch_ext.get("cy")), 1)

                def inner(px, py, o=off, c=ch_off, sx=sx, sy=sy, outer=transform):
                    return outer(int(o.get("x")) + (px - int(c.get("x"))) * sx,
                                 int(o.get("y")) + (py - int(c.get("y"))) * sy)
                walk(child, inner)
                continue
            ph = child.find(f"./{P}nvSpPr/{P}nvPr/{P}ph")
            if box is None and ph is not None:  # an empty placeholder sits where its layout says
                box = inherited.get(("idx", ph.get("idx"))) or inherited.get(("type", ph.get("type", "obj")))
            paras = ["".join(t.text or "" for t in p.iter(f"{A}t")) for p in child.iter(f"{A}p")]
            if ph is not None and not any(t.strip() for t in paras):
                paras = paras or [""]
            if kind == "graphicFrame" and child.find(f".//{A}tbl") is not None:
                kind = "table"
            is_number = child.find(f".//{A}fld") is not None
            if box and nv is not None and not is_number:
                out.append({"id": int(nv.get("id")), "kind": kind, "box": box, "paras": paras[:40],
                            "placeholder": ph.get("type", "obj") if ph is not None else None})

    walk(slide.find(f"{P}cSld/{P}spTree"), lambda x, y: (x, y))
    return out


def render_template(name):
    """PNG per template slide, cached by the template's content hash."""
    template, _ = pack_paths(name)
    digest = hashlib.sha1(template.read_bytes()).hexdigest()[:12]
    folder = CACHE / f"{name}-{digest}"
    if not (folder / "done").exists():
        folder.mkdir(parents=True, exist_ok=True)
        to_png(template, folder, "slide")
        (folder / "done").write_text("ok")
    return folder


def to_png(pptx, folder, prefix):
    subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(folder), str(pptx)],
                   check=True, capture_output=True, timeout=300)
    pdf = folder / (Path(pptx).stem + ".pdf")
    subprocess.run(["pdftoppm", "-r", "96", "-png", str(pdf), str(folder / prefix)], check=True, timeout=300)


def slide_png(folder, prefix, n):
    matches = sorted(folder.glob(f"{prefix}-*.png"))
    for m in matches:
        if int(re.search(r"-(\d+)\.png$", m.name).group(1)) == n:
            return m
    return None


PROOFS = {}  # (pack, template hash, pattern as saved, palette) -> png bytes


def proof(name, pattern_name):
    """Build and render a one-slide proof of a pattern from the saved map, reusing an identical earlier one."""
    template, patterns = pack_paths(name)
    raw = json.loads(patterns.read_text())
    key = (name, hashlib.sha1(template.read_bytes()).hexdigest(),
           json.dumps(raw.get(pattern_name), sort_keys=True), json.dumps(raw.get("_palette"), sort_keys=True))
    if key not in PROOFS:
        PROOFS[key] = render_proof(name, pattern_name).read_bytes()
    return PROOFS[key]


def render_proof(name, pattern_name):
    work = Path(tempfile.mkdtemp())
    spec = build.proof_spec(str(PACKS[name]), work)
    spec["slides"] = [s for s in spec["slides"] if s["pattern"] == pattern_name]
    if not spec["slides"]:
        raise build.DeckError(f"no pattern '{pattern_name}' in the saved map - save first")
    build.build(spec, work / "proof.pptx", work)
    to_png(work / "proof.pptx", work, "proof")
    return slide_png(work, "proof", 1)


def save(name, raw):
    template, patterns = pack_paths(name)
    backup = patterns.with_name("patterns.before-studio.json")
    if patterns.is_file() and not backup.exists():
        shutil.copy2(patterns, backup)  # one untouched copy from before the first studio save
    problems = build.template_problems(template, raw)
    patterns.write_text(json.dumps(raw, indent=2) + "\n")
    return problems


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, status, body, kind="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def body(self):
        return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")

    def route(self, method):
        parts = [unquote(p) for p in urlparse(self.path).path.strip("/").split("/") if p]
        if method == "GET" and not parts:
            return self.send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        if parts[:2] != ["api", "packs"]:
            return self.send(404, {"error": "not found"})
        if len(parts) == 2:
            return self.send(200, {"packs": [pack_summary(n) for n in all_packs()], "render": CAN_RENDER})
        name = parts[2]
        template, patterns = pack_paths(name)
        rest = parts[3:]
        if method == "GET" and not rest:
            z = zipfile.ZipFile(template)
            raw = json.loads(patterns.read_text()) if patterns.is_file() else None
            count = len([n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)])
            return self.send(200, {"name": name, "map": raw, "slides": count, "size": slide_size(z),
                                   "problems": build.template_problems(template, raw) if raw else []})
        if method == "GET" and rest[0] == "shapes":
            return self.send(200, shapes_on(zipfile.ZipFile(template), int(rest[1])))
        if method == "GET" and rest[0] == "slide" and CAN_RENDER:
            png = slide_png(render_template(name), "slide", int(rest[1]))
            return self.send(200, png.read_bytes(), "image/png") if png else self.send(404, {"error": "no slide"})
        if method == "POST" and rest[0] == "draft":
            if patterns.is_file():
                return self.send(409, {"error": "This template already has a map. Delete patterns.json to redraft."})
            patterns.write_text(json.dumps(map_template.draft(template), indent=2) + "\n")
            return self.send(200, {"ok": True})
        if method == "PUT" and rest[0] == "map":
            return self.send(200, {"problems": save(name, self.body())})
        if method == "GET" and rest[0] == "proof" and CAN_RENDER:
            return self.send(200, proof(name, rest[1]), "image/png")
        return self.send(404, {"error": "not found"})

    def handle_one(self, method):
        try:
            self.route(method)
        except build.DeckError as e:
            self.send(400, {"error": str(e)})
        except subprocess.CalledProcessError as e:
            self.send(500, {"error": f"render failed: {e.cmd[0]} exited {e.returncode}"})

    def do_GET(self):
        self.handle_one("GET")

    def do_POST(self):
        self.handle_one("POST")

    def do_PUT(self):
        self.handle_one("PUT")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("packs", nargs="+", help="template pack folders (each holds template.pptx)")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    PACKS.update((Path(p).expanduser().resolve().name, Path(p).expanduser().resolve()) for p in args.packs)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)  # local only
    print(f"Map Studio on http://127.0.0.1:{args.port}  (Ctrl+C to stop)")
    if not CAN_RENDER:
        print("  soffice/pdftoppm not found: slides show as outlines, proofs are off")
    server.serve_forever()


if __name__ == "__main__":
    sys.exit(main())

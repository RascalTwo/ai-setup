#!/usr/bin/env python3
"""Build a new .pptx from a PowerPoint template and a deck spec.

A deck is assembled by copying whole template slides and replacing the content
inside them, which keeps the fonts, colors and artwork exactly as designed - it
works whether or not the template uses real master layouts. Each template lives
in templates/<name>/ as template.pptx plus patterns.json, the map of which box
on which slide each field fills.

    python3 build.py deck.json --out deck.pptx     # template from deck.json, or the only one
    python3 build.py --check-template [--template NAME]
    python3 build.py --proof --out proof.pptx [--template NAME]
"""

import argparse
import copy
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from pathlib import Path


A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
P = "{http://schemas.openxmlformats.org/presentationml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PR = "{http://schemas.openxmlformats.org/package/2006/relationships}"
CT = "{http://schemas.openxmlformats.org/package/2006/content-types}"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
SLIDE_CT = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
NOTES_CT = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"


class DeckError(Exception):
    """A problem with the spec or the template that the caller must fix."""


def pack(folder):
    """(template.pptx, patterns.json) in a template pack folder."""
    if not folder:
        raise DeckError('give the template pack folder: --template PATH or "template" in deck.json')
    folder = Path(folder).expanduser()
    if not (folder / "template.pptx").is_file():
        raise DeckError(f"no template.pptx in {folder}")
    return folder / "template.pptx", folder / "patterns.json"


def parse(raw):
    """Parse a part, keeping every namespace prefix the source declared.

    ElementTree invents ns0/ns1 prefixes for anything it wasn't told about.
    That XML is namespace-equivalent and still parses, but OPC readers match
    element names literally - `<ns0:Types>` in [Content_Types].xml is enough to
    make LibreOffice and PowerPoint refuse the whole file. The default
    namespace (`xmlns=`) matters most: that's the one the rels and
    content-types parts use.
    """
    head = raw[:4000]
    for prefix, uri in re.findall(rb'xmlns:([a-zA-Z0-9]+)="([^"]+)"', head):
        ET.register_namespace(prefix.decode(), uri.decode())
    default = re.search(rb'xmlns="([^"]+)"', head)
    if default:
        ET.register_namespace("", default.group(1).decode())
    return ET.fromstring(raw)


def serialize(el):
    return ET.tostring(el, encoding="UTF-8", xml_declaration=True)


SHAPES = ("sp", "pic", "grpSp", "cxnSp", "graphicFrame")
EMU = 914400


def shape_by_id(slide, shape_id, kinds=("sp",)):
    for kind in kinds:
        for sp in slide.iter(f"{P}{kind}"):
            nv = sp.find(f"./*/{P}cNvPr")
            if nv is not None and nv.get("id") == str(shape_id):
                return sp
    return None


def remove_shapes(slide, ids):
    """Delete shapes by id wherever they sit in the tree."""
    parents = {child: parent for parent in slide.iter() for child in parent}
    for shape_id in ids:
        sp = shape_by_id(slide, shape_id, SHAPES)
        if sp is not None:
            parents[sp].remove(sp)


def luminance(hex_color):
    def channel(c):
        c = int(c, 16) / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(hex_color[i:i + 2]) for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg):
    hi, lo = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def check_contrast(fg, bg, size, bold, where):
    """WCAG AA: 4.5:1, or 3:1 for large text (18pt+, or 14pt+ bold)."""
    need = 3.0 if size >= 18 or (bold and size >= 14) else 4.5
    ratio = contrast(fg, bg)
    if ratio < need:
        raise DeckError(f"{where}: #{fg} on #{bg} at {size}pt is {ratio:.1f}:1, AA needs {need}:1")
    return ratio


def textbox(slide, box, text, where):
    """Add a text box at a pattern-defined spot. Geometry is in inches."""
    size, color = box.get("size", 14), box.get("color", "061A40")
    bold = box.get("bold", False)
    check_contrast(color, box.get("fill") or box["on"], size, bold, where)
    tree = slide.find(f"{P}cSld/{P}spTree")
    new_id = 9000 + len(tree)
    fill = f'<a:solidFill><a:srgbClr val="{box["fill"]}"/></a:solidFill>' if box.get("fill") else "<a:noFill/>"
    paras = "".join(
        f'<a:p><a:pPr algn="{box.get("align", "ctr")}"/><a:r><a:rPr lang="en" sz="{int(size * 100)}" b="{int(bold)}">'
        f'<a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:latin typeface="Lato"/></a:rPr>'
        f"<a:t>{escape(line)}</a:t></a:r></a:p>"
        for line in text.split("\n"))
    x, y, w, h = (int(box[k] * EMU) for k in ("x", "y", "w", "h"))
    pad = int(box.get("inset", 0.05) * EMU)
    tree.append(ET.fromstring(
        f'<p:sp xmlns:p="{P[1:-1]}" xmlns:a="{A[1:-1]}"><p:nvSpPr><p:cNvPr id="{new_id}" name="Label {new_id}"/>'
        f'<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{w}" cy="{h}"/>'
        f'</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>{fill}</p:spPr><p:txBody>'
        f'<a:bodyPr wrap="square" anchor="{box.get("anchor", "ctr")}" lIns="{pad}" rIns="{pad}" tIns="{pad}" bIns="{pad}">'
        f"<a:noAutofit/></a:bodyPr><a:lstStyle/>{paras}</p:txBody></p:sp>"))


def place(sp, x, y, w, h):
    xfrm = sp.find(f"./{P}spPr/{A}xfrm")
    xfrm.find(f"{A}off").attrib.update(x=str(int(x * EMU)), y=str(int(y * EMU)))
    xfrm.find(f"{A}ext").attrib.update(cx=str(int(w * EMU)), cy=str(int(h * EMU)))


def size_of(sp):
    ext = sp.find(f"./{P}spPr/{A}xfrm/{A}ext")
    return int(ext.get("cx")) / EMU, int(ext.get("cy")) / EMU


def icon_row(slide, pattern, icons, where):
    """Keep only the chosen icons and lay them out in one captioned row."""
    row = pattern["icon_row"]
    keep = {str(i) for i, _ in icons} | {str(i) for i in pattern.get("keep", [])}
    drop = [nv.get("id") for pic in slide.iter(f"{P}pic") for nv in pic.iter(f"{P}cNvPr")
            if nv.get("id") not in keep]
    remove_shapes(slide, drop)
    slot = 9.0 / len(icons)
    for n, (shape_id, label) in enumerate(icons):
        sp = shape_by_id(slide, shape_id, ("pic",))
        if sp is None:
            raise DeckError(f"{where}: no icon with id {shape_id} on template slide {pattern['slide']}")
        w, h = size_of(sp)
        scale = row["size"] / max(w, h)
        w, h = w * scale, h * scale
        cx = 0.5 + slot * (n + 0.5)
        place(sp, cx - w / 2, row["y"] + (row["size"] - h) / 2, w, h)
        textbox(slide, dict(row["label"], x=cx - slot / 2, y=row["y"] + row["size"] + 0.1, w=slot, h=0.6),
                label, where)


def contrast_grid(slide, palette, where):
    """One row per background, one cell per text color the brand allows on it."""
    rows = palette["pairs"]
    top, height = 1.02, 4.0 / len(rows)
    for r, (bg, any_size, large_only) in enumerate(rows):
        y = top + r * height
        textbox(slide, {"x": 0.3, "y": y, "w": 1.2, "h": height - 0.06, "on": "FFFFFF", "size": 10,
                        "bold": True, "align": "l"}, f"{palette['names'][bg]}\n#{bg}", where)
        cells = [(fg, 11, False) for fg in any_size] + [(fg, 14, True) for fg in large_only]
        width = 8.15 / len(cells)
        for c, (fg, size, bold) in enumerate(cells):
            ratio = contrast(fg, bg)
            textbox(slide, {"x": 1.55 + c * width, "y": y, "w": width - 0.05, "h": height - 0.06, "fill": bg,
                            "color": fg, "size": size, "bold": bold, "inset": 0},
                    f"{palette['names'][fg]}\n{ratio:.1f}:1", where)


def set_paragraph_text(para, text):
    """Put `text` in the paragraph, keeping the first run's formatting.

    A paragraph the template styles as two runs ("Bold: Normal") keeps both styles,
    split after the first colon of `text`.
    """
    runs = para.findall(f"{A}r")
    if not runs:
        # An empty placeholder: build a run from the paragraph's end-of-paragraph style.
        run = ET.Element(f"{A}r")
        end = para.find(f"{A}endParaRPr")
        rpr = copy.deepcopy(end) if end is not None else ET.Element(f"{A}rPr")
        rpr.tag = f"{A}rPr"
        run.append(rpr)
        ET.SubElement(run, f"{A}t")
        para.insert(list(para).index(end) if end is not None else len(para), run)
        runs = [run]
    head, colon, tail = text.partition(":")
    pieces = [head + colon, tail] if len(runs) > 1 and colon and tail.strip() else [text]
    for extra in runs[len(pieces):]:
        para.remove(extra)
    for run, piece in zip(runs, pieces):
        t = run.find(f"{A}t")
        t.text = piece
        # Google's export marks whitespace-significant runs; keep that honest.
        if piece != piece.strip():
            t.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    return para


def set_table(frame, rows, where):
    """Fill a table, growing or shrinking it to the rows given."""
    tbl = frame.find(f".//{A}tbl")
    trs = tbl.findall(f"{A}tr")
    for tr in trs:
        tbl.remove(tr)
    for row in rows:
        tr = copy.deepcopy(trs[0])
        cells = tr.findall(f"{A}tc")
        if len(row) != len(cells):
            raise DeckError(f"{where}: table rows need {len(cells)} cells, got {row!r}")
        for tc, text in zip(cells, row):
            set_paragraph_text(tc.find(f".//{A}p"), str(text))
        tbl.append(tr)


def recolor(para, color):
    for fill in para.iter(f"{A}solidFill"):
        for clr in list(fill):
            fill.remove(clr)
        ET.SubElement(fill, f"{A}srgbClr", val=color)


def apply_fields(slide, pattern, values, where, media, art=None):
    """Rewrite each mapped paragraph range with the caller's values."""
    edits, colors = {}, {}
    remove_shapes(slide, pattern.get("drop", []))
    for name, spec in pattern["fields"].items():
        if name not in values or values[name] is None:
            if spec.get("optional"):
                if spec.get("keep_if_missing"):
                    continue  # the template's own text or picture stays
                if spec.get("drop_if_missing") or spec.get("image"):
                    remove_shapes(slide, [spec["shape"], *spec.get("drop_if_missing", [])])
                elif "paras" in spec:
                    edits.setdefault(spec["shape"], []).append((spec["paras"], []))
                continue
            raise DeckError(f"{where}: pattern '{values.get('_pattern')}' needs field '{name}'")
        value = values[name]
        if spec.get("art"):
            art.append((name, spec, value))
            continue
        if spec.get("image"):
            media.append((spec["shape"], value))
            continue
        if spec.get("table"):
            set_table(shape_by_id(slide, spec["shape"], ("graphicFrame",)), value, where)
            continue
        if spec.get("color"):
            colors[spec["shape"]] = spec["color"]
        items = value if isinstance(value, list) else [value]
        if spec.get("list") is not True and len(items) > 1:
            raise DeckError(f"{where}: field '{name}' takes a single line, got {len(items)}")
        edits.setdefault(spec["shape"], []).append((spec["paras"], [str(i) for i in items]))

    for shape_id, shape_edits in edits.items():
        sp = shape_by_id(slide, shape_id)
        if sp is None and not any(items for _, items in shape_edits):
            continue  # an omitted optional field already dropped this shape
        if sp is None:
            raise DeckError(f"{where}: shape {shape_id} is missing from the template")
        body = sp.find(f"{P}txBody")
        if body is None:  # a placeholder that inherits everything from its layout
            body = ET.fromstring(f'<p:txBody xmlns:p="{P[1:-1]}" xmlns:a="{A[1:-1]}">'
                                 f"<a:bodyPr/><a:lstStyle/><a:p/></p:txBody>")
            sp.append(body)
        paras = body.findall(f"{A}p")
        last = len(paras) - 1
        ranges = []
        for (start, end), items in shape_edits:
            end = last if end == -1 else end
            if start > last:
                raise DeckError(f"{where}: shape {shape_id} has no paragraph {start}")
            ranges.append((start, min(end, last), items))
        ranges.sort()

        rebuilt, i = [], 0
        for start, end, items in ranges:
            rebuilt.extend(paras[i:start])
            for item in items:
                rebuilt.append(set_paragraph_text(copy.deepcopy(paras[start]), item))
            i = end + 1
        rebuilt.extend(paras[i:])

        for para in paras:
            body.remove(para)
        for para in rebuilt:
            if shape_id in colors:
                recolor(para, colors[shape_id])
            body.append(para)

    for box, text in zip(pattern.get("labels", []), values.get("labels", [])):
        textbox(slide, box, text, where)
    if len(values.get("labels", [])) != len(pattern.get("labels", [])):
        raise DeckError(f"{where}: pattern '{values.get('_pattern')}' takes "
                        f"{len(pattern.get('labels', []))} labels, got {len(values.get('labels', []))}")
    for shape_id, geometry in pattern.get("place", {}).items():
        place(shape_by_id(slide, shape_id, SHAPES), *geometry)


def art_source(zin, ref, where, name):
    """The picture an icon slot points at: 'slide:shape' on some template slide."""
    m = re.fullmatch(r"(\d+):(\d+)", str(ref))
    if not m:
        raise DeckError(f"{where}: '{name}' takes 'slide:shape' (see the pack's icon sheet), got {ref!r}")
    n, shape = m.groups()
    try:
        slide = parse(zin.read(f"ppt/slides/slide{n}.xml"))
    except KeyError:
        raise DeckError(f"{where}: '{name}': the template has no slide {n}") from None
    pic = shape_by_id(slide, shape, ("pic",))
    if pic is None:
        raise DeckError(f"{where}: '{name}': slide {n} has no picture {shape}")
    return n, pic


def place_art(slide, rels, zin, art, where):
    """Copy each chosen icon from its asset slide into the pattern's slot, keeping its shape."""
    tree = slide.find(f"{P}cSld/{P}spTree")
    for i, (name, spec, ref) in enumerate(art):
        n, pic = art_source(zin, ref, where, name)
        targets = {r.get("Id"): r.get("Target") for r in parse(zin.read(f"ppt/slides/_rels/slide{n}.xml.rels"))}
        pic = copy.deepcopy(pic)
        for k, el in enumerate(e for e in pic.iter() if e.get(f"{R}embed") or e.get(f"{R}link")):
            for attr in (f"{R}embed", f"{R}link"):
                if el.get(attr):
                    rid = f"rIdArt{i}_{k}"
                    ET.SubElement(rels, f"{PR}Relationship",
                                  {"Id": rid, "Type": f"{REL}/image", "Target": targets[el.get(attr)]})
                    el.set(attr, rid)
        pic.find(f"./*/{P}cNvPr").set("id", str(9500 + i))
        w, h = size_of(pic)
        scale = spec["size"] / max(w, h)
        place(pic, spec["x"] + (spec["size"] - w * scale) / 2, spec["y"] + (spec["size"] - h * scale) / 2,
              w * scale, h * scale)
        tree.append(pic)


def swap_images(slide, rels, media, n, base, where):
    """Point each image field's picture at the caller's file."""
    parts = {}
    for i, (shape_id, path) in enumerate(media):
        src = (base / path)
        if not src.is_file():
            raise DeckError(f"{where}: image {path} not found")
        pic = shape_by_id(slide, shape_id, ("pic",))
        rid = f"rIdImg{i}"
        name = f"deck{n}_{i}{src.suffix.lower()}"
        pic.find(f".//{A}blip").set(f"{R}embed", rid)
        fill = pic.find(f"{P}blipFill")
        for crop in fill.findall(f"{A}srcRect"):  # the template's crop was for its own picture
            fill.remove(crop)
        ET.SubElement(rels, f"{PR}Relationship", {"Id": rid, "Type": f"{REL}/image", "Target": f"../media/{name}"})
        parts[f"ppt/media/{name}"] = src.read_bytes()
    return parts


def notes_part(skeleton, text):
    """Clone the template's notes slide and put `text` in its body."""
    notes = parse(skeleton)
    for sp in notes.iter(f"{P}sp"):
        ph = sp.find(f".//{P}ph")
        if ph is None or ph.get("type") not in (None, "body"):
            continue
        body = sp.find(f"{P}txBody")
        paras = body.findall(f"{A}p")
        keep = copy.deepcopy(paras[0])
        for para in paras:
            body.remove(para)
        for line in text.split("\n"):
            para = copy.deepcopy(keep)
            runs = para.findall(f"{A}r")
            if runs:
                set_paragraph_text(para, line)
            body.append(para)
        return serialize(notes)
    raise DeckError("template notes slide has no body placeholder")


def build(spec, out_path, base=Path("."), template=None):
    template_path, patterns_path = pack(template or spec.get("template"))
    raw = json.loads(patterns_path.read_text())
    patterns = {k: v for k, v in raw.items() if not k.startswith("_")}
    zin = zipfile.ZipFile(template_path)
    names = set(zin.namelist())
    notes_skeleton = zin.read("ppt/notesSlides/notesSlide1.xml") if "ppt/notesSlides/notesSlide1.xml" in names else None

    slides, parts = [], {}
    for n, entry in enumerate(spec["slides"], start=1):
        where = f"slide {n}"
        name = entry.get("pattern")
        if name not in patterns:
            raise DeckError(f"{where}: unknown pattern '{name}'. Known: {', '.join(sorted(patterns))}")
        pattern = patterns[name]
        src = pattern["slide"]

        slide = parse(zin.read(f"ppt/slides/slide{src}.xml"))
        fields = dict(entry.get("fields") or {})
        fields["_pattern"] = name
        media, art = [], []
        apply_fields(slide, pattern, fields, where, media, art)
        if "icon_row" in pattern:
            icon_row(slide, pattern, fields.get("icons") or [], where)
        if pattern.get("generate") == "contrast_grid":
            contrast_grid(slide, raw["_palette"], where)

        rels = parse(zin.read(f"ppt/slides/_rels/slide{src}.xml.rels"))
        parts.update(swap_images(slide, rels, media, n, Path(base), where))
        place_art(slide, rels, zin, art, where)
        xml = serialize(slide)
        parts[f"ppt/slides/slide{n}.xml"] = xml
        for rel in list(rels):
            # Notes are rebuilt below; images for dropped pictures must go, or their media ships anyway.
            dead_image = rel.get("Type", "").endswith("/image") and f'"{rel.get("Id")}"'.encode() not in xml
            if rel.get("Type", "").endswith("/notesSlide") or dead_image:
                rels.remove(rel)
        notes = entry.get("notes")
        if notes and notes_skeleton:
            parts[f"ppt/notesSlides/notesSlide{n}.xml"] = notes_part(notes_skeleton, notes)
            nrels = parse(zin.read("ppt/notesSlides/_rels/notesSlide1.xml.rels"))
            for rel in nrels:
                if rel.get("Type", "").endswith("/slide"):
                    rel.set("Target", f"../slides/slide{n}.xml")
            parts[f"ppt/notesSlides/_rels/notesSlide{n}.xml.rels"] = serialize(nrels)
            ET.SubElement(rels, f"{PR}Relationship", {
                "Id": "rIdNotes",
                "Type": f"{REL}/notesSlide",
                "Target": f"../notesSlides/notesSlide{n}.xml",
            })
        parts[f"ppt/slides/_rels/slide{n}.xml.rels"] = serialize(rels)
        slides.append(n)

    # presentation.xml: point the slide list at exactly the slides we emitted.
    pres = parse(zin.read("ppt/presentation.xml"))
    pres_rels = parse(zin.read("ppt/_rels/presentation.xml.rels"))
    for rel in list(pres_rels):
        if rel.get("Type", "").endswith("/slide"):
            pres_rels.remove(rel)
    sld_lst = pres.find(f"{P}sldIdLst")
    for child in list(sld_lst):
        sld_lst.remove(child)
    for n in slides:
        rid = f"rIdSlide{n}"
        ET.SubElement(pres_rels, f"{PR}Relationship", {
            "Id": rid,
            "Type": f"{REL}/slide",
            "Target": f"slides/slide{n}.xml",
        })
        ET.SubElement(sld_lst, f"{P}sldId", {"id": str(255 + n), f"{R}id": rid})
    parts["ppt/presentation.xml"] = serialize(pres)
    parts["ppt/_rels/presentation.xml.rels"] = serialize(pres_rels)

    carried = [
        n for n in zin.namelist()
        if not re.match(r"ppt/(slides|notesSlides)/", n)
        and n not in ("[Content_Types].xml", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels")
    ]

    # Drop media no surviving part references - otherwise every deck ships all 205.
    referenced = set()
    for name in carried + list(parts):
        if not name.endswith(".rels"):
            continue
        raw = parts[name] if name in parts else zin.read(name)
        base = re.sub(r"_rels/[^/]+$", "", name)
        for target in re.findall(rb'Target="([^"]+)"', raw):
            target = target.decode()
            if target.startswith(("http://", "https://")):
                continue
            path = re.sub(r"[^/]+/\.\./", "", base + target)
            referenced.add(path.lstrip("/"))
    carried = [n for n in carried if not n.startswith("ppt/media/") or n in referenced]

    types = parse(zin.read("[Content_Types].xml"))
    have = {d.get("Extension") for d in types if d.get("Extension")}
    for ext, ctype in (("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg")):
        if ext not in have:
            ET.SubElement(types, f"{CT}Default", {"Extension": ext, "ContentType": ctype})
    for override in list(types):
        if re.match(r"/ppt/(slides|notesSlides)/", override.get("PartName") or ""):
            types.remove(override)
    keep = set(carried) | set(parts)
    for override in list(types):
        part = (override.get("PartName") or "").lstrip("/")
        if part and part not in keep and part not in ("ppt/presentation.xml",):
            types.remove(override)
    for n in slides:
        ET.SubElement(types, f"{CT}Override",
                      {"PartName": f"/ppt/slides/slide{n}.xml", "ContentType": SLIDE_CT})
        if f"ppt/notesSlides/notesSlide{n}.xml" in parts:
            ET.SubElement(types, f"{CT}Override",
                          {"PartName": f"/ppt/notesSlides/notesSlide{n}.xml", "ContentType": NOTES_CT})

    lost = [n for n, entry in enumerate(spec["slides"], start=1) if entry.get("notes") and not notes_skeleton]
    if lost:
        print(f"warning: this template has no notes pages, so speaker notes on {len(lost)} slide(s) were not "
              f"written. Add any speaker note to one slide of the template and re-export it.", file=sys.stderr)

    out_path = Path(out_path)
    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zout:
        zout.writestr("[Content_Types].xml", serialize(types))
        for name in carried:
            zout.writestr(name, zin.read(name))
        for name, data in parts.items():
            zout.writestr(name, data)
    return out_path, len(slides)


def proof_spec(template, workdir):
    """Every pattern, every field filled with its own name - so a person can check the map by eye."""
    import struct
    import zlib
    img = workdir / "proof.png"  # one magenta pixel, stretched: "an image field goes here"
    row = b"\x00\xff\x00\xff"
    chunk = lambda kind, data: (struct.pack(">I", len(data)) + kind + data
                                + struct.pack(">I", zlib.crc32(kind + data)))
    img.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
                    + chunk(b"IDAT", zlib.compress(row)) + chunk(b"IEND", b""))
    template_path, patterns_path = pack(template)
    raw = json.loads(patterns_path.read_text())
    zin = zipfile.ZipFile(template_path)
    slides = []
    for name, pattern in raw.items():
        if name.startswith("_"):
            continue
        fields, lines = {}, []
        for field, spec in pattern["fields"].items():
            if spec.get("art"):
                fields[field] = spec["sample"]
                lines.append(f"{field}: icon slot, sample {spec['sample']}")
            elif spec.get("image"):
                fields[field] = img.name
                lines.append(f"{field}: picture {spec['shape']} (magenta)")
            elif spec.get("table"):
                fields[field] = [[f"[{field} {r} term]", f"[{field} {r} definition]"] for r in (1, 2)]
                lines.append(f"{field}: table {spec['shape']}")
            else:
                fields[field] = [f"[{field} {i}]" for i in (1, 2, 3)] if spec.get("list") else f"[{field}]"
                lines.append(f"{field}: box {spec['shape']}, paragraphs {spec['paras']}")
        if pattern.get("labels"):
            fields["labels"] = [f"[label {i + 1}]" for i in range(len(pattern["labels"]))]
            lines.append(f"labels: {len(pattern['labels'])} added boxes")
        if "icon_row" in pattern:
            slide = parse(zin.read(f"ppt/slides/slide{pattern['slide']}.xml"))
            keep = {str(k) for k in pattern.get("keep", [])} | {str(k) for k in pattern.get("drop", [])}
            ids = [nv.get("id") for pic in slide.iter(f"{P}pic") for nv in pic.iter(f"{P}cNvPr")
                   if nv.get("id") not in keep][:3]
            fields["icons"] = [[i, f"[icon {i}]"] for i in ids]
        if pattern.get("drop"):
            lines.append(f"dropped from template: {pattern['drop']}")
        slides.append({"pattern": name, "fields": fields,
                       "notes": f"PROOF of '{name}' (template slide {pattern['slide']})\n" + "\n".join(lines)})
    return {"template": template, "slides": slides}


def check_template(template=None):
    """Every pattern must still point at shapes that exist. Run after a refresh."""
    template_path, patterns_path = pack(template)
    raw = json.loads(patterns_path.read_text())
    problems = template_problems(template_path, raw)
    for problem in problems:
        print(f"  BROKEN  {problem}")
    print(f"{len([k for k in raw if not k.startswith('_')])} patterns checked, {len(problems)} broken")
    return 1 if problems else 0


def template_problems(template_path, raw):
    """Map problems as a list: shapes that don't exist, paragraph ranges out of bounds, overlaps."""
    patterns = {k: v for k, v in raw.items() if not k.startswith("_")}
    zin = zipfile.ZipFile(template_path)
    slide_count = len([n for n in zin.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)])
    problems = []
    for name, pattern in patterns.items():
        if not 1 <= int(pattern.get("slide", 0)) <= slide_count:
            problems.append(f"{name}: template has no slide {pattern.get('slide')}")
            continue
        slide = parse(zin.read(f"ppt/slides/slide{pattern['slide']}.xml"))
        for shape_id in pattern.get("drop", []) + list(pattern.get("place", {})):
            if shape_by_id(slide, shape_id, SHAPES) is None:
                problems.append(f"{name}: shape {shape_id} not on slide {pattern['slide']}")
        claimed = {}
        for field, spec in pattern["fields"].items():
            if spec.get("art"):
                try:
                    art_source(zin, spec.get("sample"), name, field)
                except DeckError as e:
                    problems.append(f"{name}.{field}: sample icon - {e}")
                continue
            sp = shape_by_id(slide, spec["shape"], SHAPES)
            if sp is None:
                problems.append(f"{name}.{field}: shape {spec['shape']} not on slide {pattern['slide']}")
                continue
            if "paras" not in spec:
                continue
            paras = sp.findall(f".//{A}p")
            start, end = spec["paras"]
            # Two fields writing the same paragraph both "succeed" - only the map can catch it.
            span = set(range(start, (len(paras) - 1 if end == -1 else end) + 1))
            for other, taken in claimed.get(spec["shape"], []):
                if span & taken:
                    problems.append(f"{name}: fields '{other}' and '{field}' both fill shape {spec['shape']} "
                                    f"paragraphs {sorted(span & taken)}")
            claimed.setdefault(spec["shape"], []).append((field, span))
            if start >= len(paras) or (end != -1 and end >= len(paras)):
                problems.append(
                    f"{name}.{field}: wants paragraphs {start}..{end} but shape {spec['shape']} has {len(paras)}")
    return problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec", nargs="?", help="deck.json")
    ap.add_argument("--out", default="deck.pptx")
    ap.add_argument("--template", help="template pack folder (holds template.pptx and patterns.json)")
    ap.add_argument("--check-template", action="store_true")
    ap.add_argument("--proof", action="store_true",
                    help="build one slide per pattern with every field showing its own name")
    args = ap.parse_args()

    try:
        if args.check_template:
            return check_template(args.template)
        if args.proof:
            import tempfile
            work = Path(tempfile.mkdtemp())
            path, count = build(proof_spec(args.template, work), args.out, work)
            print(f"{path} - proof of {count} patterns. Every box should show its own [field name].")
            return 0
        if not args.spec:
            ap.error("give a deck.json, or --check-template / --proof")
        path, count = build(json.loads(Path(args.spec).read_text()), args.out, Path(args.spec).parent, args.template)
    except DeckError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"{path} - {count} slides, {path.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Draft a pattern map for a template, deterministically. No AI, same input -> same output.

    python3 map_template.py new.pptx --out draft.json
    python3 map_template.py --compare --template PACK_FOLDER   # score a fresh draft against a reviewed map

What a script can decide, it decides: which boxes hold text, how their paragraphs group
into single-line and list fields, which pictures are one-off content (a headshot, a
screenshot) rather than shared artwork (the logo), which shapes are tables. What it
can't - what a slide is *for*, good field names, content that only looks like
decoration, the template's own contrast mistakes - is left for a reviewer, who then
proves the map with `build.py --proof`.
"""

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build import A, P, SHAPES, EMU, pack, parse  # noqa: E402

REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
# Placeholder type (from the layout) -> field name. No type means a general content box.
PLACEHOLDER_NAMES = {"title": "title", "ctrTitle": "title", "subTitle": "subtitle", "body": "body",
                     "obj": "content"}


def inherited_boxes(z, n):
    """Placeholder boxes from the slide's layout, then its master: {('idx', i) or ('type', t): box}."""
    boxes = {}
    part = f"ppt/slides/slide{n}.xml"
    for _ in range(2):  # slide -> layout -> master
        folder, file = part.rsplit("/", 1)
        rels = z.read(f"{folder}/_rels/{file}.rels").decode()
        m = re.search(r'Target="\.\./(slideLayouts|slideMasters)/([^"]+)"', rels)
        if not m:
            break
        part = f"ppt/{m.group(1)}/{m.group(2)}"
        for sp in parse(z.read(part)).iter(f"{P}sp"):
            ph, off = sp.find(f".//{P}ph"), sp.find(f"./{P}spPr/{A}xfrm/{A}off")
            if ph is None or off is None:
                continue
            ext = sp.find(f"./{P}spPr/{A}xfrm/{A}ext")
            box = [int(off.get("x")) / EMU, int(off.get("y")) / EMU, int(ext.get("cx")) / EMU, int(ext.get("cy")) / EMU]
            for key in (("idx", ph.get("idx")), ("type", ph.get("type", "obj"))):
                if key[1] is not None:
                    boxes.setdefault(key, box)
    return boxes


def placeholder_box(inherited, ph):
    return inherited.get(("idx", ph.get("idx"))) or inherited.get(("type", ph.get("type", "obj")))


def slide_names(z):
    return sorted((n for n in z.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", n)),
                  key=lambda n: int(re.search(r"(\d+)", n.rsplit("/", 1)[1]).group(1)))


def shape_id(sp):
    return int(sp.find(f"./*/{P}cNvPr").get("id"))


def geometry(sp):
    off = sp.find(f"./{P}spPr/{A}xfrm/{A}off")
    ext = sp.find(f"./{P}spPr/{A}xfrm/{A}ext")
    if off is None or ext is None:
        return 0, 0, 0, 0
    return (int(off.get("x")) / EMU, int(off.get("y")) / EMU,
            int(ext.get("cx")) / EMU, int(ext.get("cy")) / EMU)


def signature(p):
    """What makes a paragraph look like its neighbours: indent, bullet, bold, size, font."""
    ppr = p.find(f"{A}pPr")
    lvl = ppr.get("lvl", "0") if ppr is not None else "0"
    bullet = ppr is not None and (ppr.find(f"{A}buChar") is not None or ppr.find(f"{A}buAutoNum") is not None)
    run = p.find(f"{A}r/{A}rPr")
    if run is None:
        return lvl, bullet, False, None, None
    font = run.find(f"{A}latin")
    return lvl, bullet, run.get("b") == "1", run.get("sz"), font.get("typeface") if font is not None else None


def text_fields(sp, name):
    """Group a box's paragraphs into fields: a run of look-alike paragraphs is a list."""
    paras = sp.findall(f"./{P}txBody/{A}p")
    fields, i = {}, 0
    while i < len(paras):
        if not "".join(t.text or "" for t in paras[i].iter(f"{A}t")).strip():
            i += 1  # blank paragraphs are spacing, not fields
            continue
        j = i
        while (j + 1 < len(paras) and signature(paras[j + 1]) == signature(paras[i])
               and "".join(t.text or "" for t in paras[j + 1].iter(f"{A}t")).strip()):
            j += 1
        key = name if not fields else f"{name}_p{i}"
        fields[key] = {"shape": shape_id(sp), "paras": [i, j]}
        if j > i:
            fields[key]["list"] = True
        i = j + 1
    return fields


def draft(template):
    z = zipfile.ZipFile(template)
    slides = slide_names(z)
    # Artwork used on several slides (the logo, footer bullets) is chrome, not content.
    use = {}
    for n in slides:
        rels = z.read(n.replace("slides/", "slides/_rels/") + ".rels").decode()
        for target in set(re.findall(r'Target="\.\./media/([^"]+)"', rels)):
            use[target] = use.get(target, 0) + 1

    out = {"_comment": "DRAFT from map_template.py. Review names and purpose, then prove with build.py --proof."}
    for n in slides:
        num = int(re.search(r"(\d+)\.xml$", n).group(1))
        slide = parse(z.read(n))
        rels = dict(re.findall(r'Id="([^"]+)"[^>]*Target="\.\./media/([^"]+)"',
                               z.read(n.replace("slides/", "slides/_rels/") + ".rels").decode()))
        fields, texts, placeholders = {}, [], []
        inherited = inherited_boxes(z, num)
        for kind in SHAPES:
            for sp in slide.iter(f"{P}{kind}"):
                if kind == "graphicFrame" and sp.find(f".//{A}tbl") is not None:
                    fields[f"table_{shape_id(sp)}"] = {"shape": shape_id(sp), "table": True}
                if kind == "pic":
                    blip = sp.find(f".//{A}blip")
                    media = rels.get(blip.get(f"{{{REL_NS}}}embed")) if blip is not None else None
                    x, y, w, h = geometry(sp)
                    if media and use.get(media) == 1 and w * h >= 1.0:
                        fields[f"image_{shape_id(sp)}"] = {"shape": shape_id(sp), "image": True}
                if kind == "sp" and sp.find(f".//{A}fld") is None:
                    ph = sp.find(f"./{P}nvSpPr/{P}nvPr/{P}ph")
                    has_text = "".join(t.text or "" for t in sp.iter(f"{A}t")).strip()
                    if ph is not None and not has_text:
                        placeholders.append((sp, ph))
                    elif has_text:
                        texts.append((sp, ph))
        # Placeholders say what they are; plain text boxes are named by position.
        taken = set()

        def unique(base):
            name, k = base, 2
            while name in taken or name in fields:
                name, k = f"{base}_{k}", k + 1
            taken.add(name)
            return name

        for sp, ph in placeholders:
            kind = PLACEHOLDER_NAMES.get(ph.get("type", "obj"))
            if kind is None:
                continue  # date/footer/slide number, or a picture placeholder (not supported yet)
            spec = {"shape": shape_id(sp), "paras": [0, -1]}
            box = geometry(sp) if sp.find(f"./{P}spPr/{A}xfrm") is not None else placeholder_box(inherited, ph)
            if kind in ("body", "content") and (box is None or box[3] >= 1.2):
                spec["list"] = True  # a tall content box holds bullets; a short one is a one-line header
            fields[unique(kind)] = spec
        texts.sort(key=lambda t: (geometry(t[0])[1], geometry(t[0])[0]))
        for k, (sp, ph) in enumerate(texts):
            if ph is not None and PLACEHOLDER_NAMES.get(ph.get("type", "obj")):
                name = unique(PLACEHOLDER_NAMES[ph.get("type", "obj")])
            else:
                # Topmost text box that sits in the header band is the title.
                name = "title" if k == 0 and geometry(sp)[1] < 1.0 and "title" not in fields else f"text_{shape_id(sp)}"
            fields.update(text_fields(sp, name))
        out[f"slide-{num}"] = {"slide": num, "fields": fields}
    return out


def spans(fields, last):
    """(shape, first, last) for every text field, with -1 resolved; images/tables as (shape, kind)."""
    out = set()
    for spec in fields.values():
        if spec.get("art"):
            continue
        if "paras" in spec:
            a, b = spec["paras"]
            b = last.get(spec["shape"], b) if b == -1 else b
            out.add((spec["shape"], a, max(a, min(b, last.get(spec["shape"], b)))))
        else:
            out.add((spec["shape"], "image" if spec.get("image") else "table"))
    return out


def compare(name=None):
    """How much of a reviewed map would the script have produced on its own?"""
    template, patterns = pack(name)
    hand = {k: v for k, v in json.loads(patterns.read_text()).items() if not k.startswith("_")}
    made = {v["slide"]: v for k, v in draft(template).items() if not k.startswith("_")}
    z = zipfile.ZipFile(template)
    total = hit = 0
    for num in sorted({v["slide"] for v in hand.values()}):
        slide = parse(z.read(f"ppt/slides/slide{num}.xml"))
        # Last non-blank paragraph: a range that also covers trailing spacing is the same field.
        last = {}
        for sp in slide.iter(f"{P}sp"):
            filled = [i for i, p in enumerate(sp.findall(f"./{P}txBody/{A}p"))
                      if "".join(t.text or "" for t in p.iter(f"{A}t")).strip()]
            last[shape_id(sp)] = filled[-1] if filled else 0
        want = set().union(*(spans(v["fields"], last) for v in hand.values() if v["slide"] == num))
        got = spans(made[num]["fields"], last)
        names = ", ".join(k for k, v in hand.items() if v["slide"] == num)
        total += len(want)
        hit += len(want & got)
        status = "match" if want <= got else "DIFF"
        print(f"slide {num:>2} {status:5} {len(want & got)}/{len(want)}  ({names})")
        for miss in sorted(want - got, key=str):
            print(f"           hand has   {miss}")
        for extra in sorted(got - want, key=str):
            print(f"           draft adds {extra}")
    print(f"\n{hit}/{total} hand-mapped fields found by the script ({hit / max(total, 1):.0%})")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pptx", nargs="?", help="template to draft a map for")
    ap.add_argument("--out")
    ap.add_argument("--compare", action="store_true", help="score a draft against a pack's reviewed map")
    ap.add_argument("--template", help="pack folder for --compare")
    args = ap.parse_args()
    if args.compare:
        return compare(args.template)
    if not args.pptx:
        ap.error("give a .pptx to map, or --compare")
    result = json.dumps(draft(args.pptx), indent=2)
    if args.out:
        Path(args.out).write_text(result)
    else:
        print(result)


if __name__ == "__main__":
    sys.exit(main())

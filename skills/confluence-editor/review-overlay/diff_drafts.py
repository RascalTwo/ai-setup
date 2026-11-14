"""Diff each page's unpublished draft against its published version, block by block.

Usage: python3 diff_drafts.py --site allies --email you@x.com --token-file ~/.atlassian-token ID [ID ...] > changes.json

Output: {pageId: [{kind: added|changed|deleted, text, before, wdiff, btype}]}. Annotate items with
`edit` ({id, title, pick, pickLabel, said, why}) and `note` (a deviation to check) before building
the overlay; both are optional.
"""
import argparse, base64, difflib, json, os, re, sys, urllib.request

a = argparse.ArgumentParser()
a.add_argument("--site", required=True)
a.add_argument("--email", required=True)
a.add_argument("--token-file", required=True)
a.add_argument("ids", nargs="+")
args = a.parse_args()
auth = "Basic " + base64.b64encode(f"{args.email}:{open(os.path.expanduser(args.token_file)).read().strip()}".encode()).decode()

def adf(id, draft):
    u = f"https://{args.site}.atlassian.net/wiki/api/v2/pages/{id}?body-format=atlas_doc_format" + ("&get-draft=true" if draft else "")
    body = json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"Authorization": auth})).read())
    return json.loads(body["body"]["atlas_doc_format"]["value"])

def text(n):
    t = n.get("type")
    if t == "text": return n.get("text", "")
    if t == "date": return "[date]"  # the overlay matches around date chips
    if t == "mention": return n.get("attrs", {}).get("text", "@")
    if t == "hardBreak": return " "
    return "".join(text(c) for c in n.get("content", []) or [])

def blocks(n, out):
    t = n.get("type")
    if t in ("expand", "nestedExpand"): out.append(("expandTitle", n.get("attrs", {}).get("title", "")))
    if t == "tableRow": out.append((t, " | ".join(text(c) for c in n.get("content", [])))); return out
    if t in ("paragraph", "heading", "decisionItem", "taskItem", "codeBlock"): out.append((t, text(n))); return out
    for c in n.get("content", []) or []: blocks(c, out)
    return out

norm = lambda s: re.sub(r"\s+", " ", s).strip()

def wdiff(a, b):
    a, b, w = a.split(), b.split(), []
    for op, a1, a2, b1, b2 in difflib.SequenceMatcher(None, a, b).get_opcodes():
        if op == "equal": w.append(["=", " ".join(a[a1:a2])]); continue
        if a2 > a1: w.append(["-", " ".join(a[a1:a2])])
        if b2 > b1: w.append(["+", " ".join(b[b1:b2])])
    return w

res = {}
for id in args.ids:
    P, D = blocks(adf(id, False), []), blocks(adf(id, True), [])
    pt, dt = [norm(t) for _, t in P], [norm(t) for _, t in D]
    items = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, pt, dt, autojunk=False).get_opcodes():
        if op == "equal": continue
        before = [t for t in pt[i1:i2] if t]
        after = [j for j in range(j1, j2) if dt[j]]
        for k, j in enumerate(after):
            b = before[k] if op == "replace" and k < len(before) and difflib.SequenceMatcher(None, before[k], dt[j]).ratio() > 0.4 else None
            it = {"kind": "changed" if b else "added", "text": dt[j], "btype": D[j][0]}
            if b: it["wdiff"] = wdiff(b, dt[j])
            items.append(it)
        if len(before) > len(after): items.append({"kind": "deleted", "before": before[len(after):]})
    res[id] = items
    print(id, len(items), file=sys.stderr)
json.dump(res, sys.stdout, ensure_ascii=False)

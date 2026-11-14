#!/usr/bin/env python3
"""Seeded generator for the read-image-locally benchmark.

Renders synthetic HTML/SVG to PNG with headless Chrome so every answer is known exactly.
  python3 gen.py --out DIR [--seed 1] [--per-level 3]
Writes DIR/images/*.png and DIR/manifest.json (list of items; see run.py for grading kinds).
Item kinds: exact (case-sensitive), ci (case-insensitive), num (tol), json (field-level, `expected` is a dict).
Levels 1..3 = easy..hard (font size, density, contrast, length). Needs Google Chrome + Pillow.
"""
import argparse, html, json, os, random, string, subprocess, tempfile
from PIL import Image

CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
MONO = 'Menlo, "DejaVu Sans Mono", monospace'
SANS = '-apple-system, "Helvetica Neue", Arial, sans-serif'
ONLY = " Reply with only the answer value, nothing else."
ABSENT = " If it is not present in the image, reply exactly NOT_PRESENT."
R = random.Random()
OUT = ""
ITEMS = []


def render(html_doc, w, h, name, post=None):
    d = os.path.join(OUT, "html"); os.makedirs(d, exist_ok=True)
    os.makedirs(os.path.join(OUT, "images"), exist_ok=True)
    hp, png = os.path.join(d, name + ".html"), os.path.join(OUT, "images", name + ".png")
    open(hp, "w").write(html_doc)
    with tempfile.TemporaryDirectory() as prof:
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--user-data-dir={prof}",
                        "--force-device-scale-factor=1", f"--window-size={w},{h}", f"--screenshot={png}",
                        "file://" + hp], check=True, capture_output=True, timeout=60)
    if post:
        im = Image.open(png).convert("RGB"); post(im).save(png)
    return png


def add(cat, lvl, name, png, prompt, kind, expected, tol=0, absent=False, json_keys=False):
    ITEMS.append(dict(id=f"{cat}-L{lvl}-{name}", category=cat, level=lvl, image=os.path.relpath(png, OUT),
                      prompt=prompt, kind=kind, expected=expected, tol=tol, absent=absent, json=json_keys))


def page(body, bg="#fff", fg="#111", w=1000, pad=24, font=SANS):
    return (f"<!doctype html><meta charset=utf-8><body style='margin:0;background:{bg};color:{fg};font-family:{font};"
            f"width:{w}px;padding:{pad}px;box-sizing:border-box'>{body}")


def rid(n, alpha=string.ascii_uppercase + string.digits): return "".join(R.choice(alpha) for _ in range(n))
WORDS = "Acme Borealis Cobalt Delta Ember Fjord Garnet Helix Iris Juniper Kestrel Lumen Meridian Nimbus Orchid Pioneer Quartz Raven Sable Tundra Umber Vertex Willow Xenon Yarrow Zephyr".split()
REGIONS = ["us-east-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-south-1", "ap-northeast-1"]
STATUS = ["SHIPPED", "PENDING", "FAILED", "RETURNED", "HOLD", "TIMEOUT"]


# ---------- 1. dense tables ----------
def gen_table(lvl, i):
    n, fs, ncols = {1: (20, 14, 6), 2: (40, 11, 8), 3: (60, 9, 10)}[lvl]
    cols = ["Order ID", "Customer", "Region", "Qty Ordered", "Qty Shipped", "Unit Price", "Total", "Status", "Carrier", "Ref Code"][:ncols]
    ids = R.sample(range(10000, 99999), n)
    rows = []
    for k in range(n):
        q = R.randint(1, 400); p = round(R.uniform(2, 900), 2)
        rows.append({"Order ID": f"ORD-{ids[k]}", "Customer": R.choice(WORDS) + " " + R.choice(["Ltd", "Inc", "GmbH", "Co"]),
                     "Region": R.choice(REGIONS), "Qty Ordered": str(q), "Qty Shipped": str(max(0, q - R.randint(0, 9))),
                     "Unit Price": f"{p:.2f}", "Total": f"{p*q:.2f}", "Status": R.choice(STATUS),
                     "Carrier": R.choice(["UPS", "DHL", "FedEx", "USPS"]), "Ref Code": rid(6)})
    row = R.choice(rows[n // 4:]); col = R.choice(cols[1:])
    fg, bg = ("#111", "#fff") if lvl < 3 else ("#8c9199", "#fff")
    th = "".join(f"<th style='text-align:left;padding:2px 8px;border-bottom:1px solid #bbb'>{c}</th>" for c in cols)
    trs = "".join("<tr>" + "".join(f"<td style='padding:1px 8px'>{r[c]}</td>" for c in cols) + "</tr>" for r in rows)
    w = 130 * ncols + 48
    h = int(40 + (n + 2) * fs * 1.7)
    doc = page(f"<table style='border-collapse:collapse;font-size:{fs}px'><tr>{th}</tr>{trs}</table>", bg, fg, w, 24)
    png = render(doc, w, h, f"table-L{lvl}-{i}")
    num = row[col].replace(".", "", 1).isdigit()
    add("table", lvl, str(i), png, f"In this table, find the row whose Order ID is {row['Order ID']}. What is its value in the column '{col}'?" + ONLY,
        "num" if num else "ci", float(row[col]) if num else row[col])


# ---------- 2. long-token transcription ----------
CONF = "0OoIl1|rnmvwVWuU5S8B2Z"
def mutate(s):
    k = R.randrange(len(s)); alts = [c for c in CONF if c != s[k]]
    return s[:k] + R.choice(alts) + s[k + 1:]

def gen_tokens(lvl, i):
    kind = R.choice({1: ["uuid", "ip", "semver"], 2: ["hash", "path", "uuid"], 3: ["conf", "hash", "path"]}[lvl])
    hx = string.hexdigits[:16]
    mk = {"uuid": lambda: "-".join(rid(n, hx) for n in (8, 4, 4, 4, 12)),
          "ip": lambda: ".".join(str(R.randint(1, 254)) for _ in range(4)),
          "semver": lambda: f"v{R.randint(0,29)}.{R.randint(0,99)}.{R.randint(0,99)}-rc.{R.randint(1,9)}+build.{R.randint(100,9999)}",
          "hash": lambda: rid(64, hx),
          "path": lambda: "/" + "/".join(rid(R.randint(3, 6), "lI1O0rnmo_.").lower() + R.choice(["", "_cache", ".d"]) for _ in range(4)) + "/rnm_l1.log",
          "conf": lambda: rid(26, CONF)}[kind]
    fs, bg, fg = {1: (22, "#fff", "#111"), 2: (15, "#fff", "#222"), 3: (11, "#fff", "#8c9199")}[lvl]
    labels = R.sample(["Primary", "Backup", "Staging", "Canary", "Mirror"], 4 if lvl == 3 else 3 if lvl == 2 else 2)
    target = mk(); vals = [target]
    for _ in labels[1:]:
        vals.append(mutate(target) if lvl == 3 else mk())
    pairs = list(zip(labels, vals)); R.shuffle(pairs)
    body = "".join(f"<div style='margin:{fs*0.7}px 0;font-size:{fs}px'><span style='font-family:{SANS};display:inline-block;width:{fs*6}px'>{l}</span>"
                   f"<span style='font-family:{MONO}'>{html.escape(v)}</span></div>" for l, v in pairs)
    w = max(700, int(fs * 0.62 * len(target) + fs * 10)); h = int(60 + len(pairs) * fs * 2.2)
    png = render(page(body, bg, fg, w), w, h, f"tokens-L{lvl}-{i}")
    add("tokens", lvl, str(i), png, f"Transcribe exactly, character for character (case matters), the {kind if kind != 'conf' else 'token'} shown next to the label '{labels[0]}'." + ONLY, "exact", target)


# ---------- 3. terminal / logs ----------
def gen_terminal(lvl, i):
    n, fs = {1: (18, 14), 2: (40, 11), 3: (80, 9)}[lvl]
    t = R.randint(8 * 3600, 20 * 3600); lines = []; err_at = R.randint(n // 3, n - 4)
    svc = ["api", "db", "cache", "auth", "queue", "worker"]
    msgs = ["request handled in %dms", "connection pool size=%d", "cache hit ratio 0.%d", "job %d scheduled", "heartbeat ok seq=%d"]
    C = {"INFO": "#3fb950", "WARN": "#d29922", "ERROR": "#ff5555"}
    for k in range(n):
        t += R.randint(0, 3) if lvl == 3 else R.randint(1, 40)
        ts = f"2026-03-14T{t//3600:02d}:{t%3600//60:02d}:{t%60:02d}.{R.randint(0,999):03d}Z"
        lv, msg = "INFO", R.choice(msgs) % R.randint(1, 999)
        if lvl >= 2 and R.random() < .15: msg = f"retry handler: errors={R.randint(0,3)} failed=0"
        if lvl == 3 and R.random() < .2: lv, msg = "WARN", f"slow response, ERR_TIMEOUT_SOFT threshold={R.randint(100,900)}ms"
        if k == err_at:
            lv, msg, err_ts = "ERROR", f"E{R.randint(1000,9999)} unhandled exception in {R.choice(svc)}: connection reset", ts
        col = C[lv] if lv != "WARN" or lvl < 3 else "#ff5555"  # L3: WARN lines are red too
        lines.append(f"<div><span style='color:#6e7681'>{ts}</span> <span style='color:{col};font-weight:{700 if lv=='ERROR' else 400}'>[{lv}]</span> "
                     f"<span style='color:#58a6ff'>{R.choice(svc)}</span>: {msg}</div>")
    code = R.randint(2, 255)
    lines.append(f"<div style='color:#8b949e;margin-top:6px'>Process finished with exit code {code}</div>")
    w = 1100; h = int(40 + (n + 2) * fs * 1.45)
    png = render(page("".join(lines), "#0d1117", "#c9d1d9", w, 16, MONO).replace("<body ", f"<body ", 1).replace("padding:16px", f"padding:16px;font-size:{fs}px"), w, h, f"terminal-L{lvl}-{i}")
    add("terminal", lvl, f"{i}a", png, "This is a terminal log. What is the timestamp (copy exactly) of the line whose level is ERROR?" + ONLY, "exact", err_ts)
    add("terminal", lvl, f"{i}b", png, "What exit code does the process finish with? Reply with the number only.", "num", code)


# ---------- 4. charts ----------
CATS = ["Alpha", "Bravo", "Cedar", "Delta", "Echo", "Foxtrot", "Gamma", "Harbor"]
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()

def svg_axes(w, h, ymax, step):
    s = ""
    for v in range(0, ymax + 1, step):
        y = h - 60 - v * (h - 100) / ymax
        s += f"<line x1=70 x2={w-20} y1={y:.1f} y2={y:.1f} stroke='#ddd'/><text x=62 y={y+4:.1f} font-size=12 text-anchor=end fill='#555'>{v}</text>"
    return s

def gen_chart(lvl, i):
    w, h, ymax = 900, 520, 100
    name = f"chart-L{lvl}-{i}"
    if lvl == 1:
        vals = R.sample(range(10, 98), 6); cats = CATS[:6]; bw = (w - 110) / 6
        s = svg_axes(w, h, ymax, 20)
        for k, (c, v) in enumerate(zip(cats, vals)):
            x = 80 + k * bw; y = h - 60 - v * (h - 100) / ymax
            s += f"<rect x={x:.1f} y={y:.1f} width={bw-24:.1f} height={h-60-y:.1f} fill='#3b82f6'/><text x={x+(bw-24)/2:.1f} y={y-6:.1f} text-anchor=middle font-size=14>{v}</text><text x={x+(bw-24)/2:.1f} y={h-38} text-anchor=middle font-size=14>{c}</text>"
        png = render(page(f"<svg width={w} height={h}>{s}</svg>", w=w, pad=0), w, h, name)
        add("chart", lvl, str(i), png, "Which bar has the highest value? Reply with its category name." + ONLY, "ci", cats[vals.index(max(vals))])
    elif lvl == 2 and R.random() < .5:
        vals = R.sample(range(8, 96), 8); cats = CATS; bw = (w - 110) / 8; k = R.randrange(8)
        s = svg_axes(w, h, ymax, 10)
        for j, (c, v) in enumerate(zip(cats, vals)):
            x = 80 + j * bw; y = h - 60 - v * (h - 100) / ymax
            s += f"<rect x={x:.1f} y={y:.1f} width={bw-20:.1f} height={h-60-y:.1f} fill='#10b981'/><text x={x+(bw-20)/2:.1f} y={h-38} text-anchor=middle font-size=13>{c}</text>"
        png = render(page(f"<svg width={w} height={h}>{s}</svg>", w=w, pad=0), w, h, name)
        add("chart", lvl, str(i), png, f"Estimate the value of the '{cats[k]}' bar using the y axis (the bars have no value labels). Reply with a number only.", "num", vals[k], tol=4)
    elif lvl == 2:
        a = R.sample(range(20, 90), 4); b = [x + R.choice([-1, 1]) * R.randint(8, 25) for x in a]; k = R.randrange(4)
        s = svg_axes(w, h, 120, 20); bw = (w - 110) / 4
        for j in range(4):
            x = 80 + j * bw
            for off, v, col in ((0, a[j], "#6366f1"), (bw / 2 - 10, b[j], "#f59e0b")):
                y = h - 60 - v * (h - 100) / 120
                s += f"<rect x={x+off:.1f} y={y:.1f} width={bw/2-14:.1f} height={h-60-y:.1f} fill='{col}'/>"
            s += f"<text x={x+bw/2-10:.1f} y={h-38} text-anchor=middle font-size=14>Q{j+1}</text>"
        s += "<rect x=700 y=20 width=14 height=14 fill='#6366f1'/><text x=720 y=32 font-size=14>2024</text><rect x=780 y=20 width=14 height=14 fill='#f59e0b'/><text x=800 y=32 font-size=14>2025</text>"
        png = render(page(f"<svg width={w} height={h}>{s}</svg>", w=w, pad=0), w, h, name)
        add("chart", lvl, str(i), png, f"In the grouped bar chart, which year has the higher bar in Q{k+1}? Reply with the year only.", "exact", "2024" if a[k] > b[k] else "2025")
    elif lvl == 3:
        while True:
            a = [R.randint(30, 80) for _ in range(12)]; b = [R.randint(30, 80) for _ in range(12)]
            top = sorted(b, reverse=True)
            if top[0] - top[1] >= 6: break
        s = svg_axes(w, h, 100, 10); dx = (w - 110) / 11
        for ser, col in ((a, "#2563eb"), (b, "#0d9488")):
            pts = " ".join(f"{80+j*dx:.1f},{h-60-v*(h-100)/100:.1f}" for j, v in enumerate(ser))
            s += f"<polyline points='{pts}' fill=none stroke='{col}' stroke-width=2.5 />"
        s += "".join(f"<text x={80+j*dx:.1f} y={h-38} text-anchor=middle font-size=12>{m}</text>" for j, m in enumerate(MONTHS))
        s += "<line x1=600 x2=624 y1=26 y2=26 stroke='#2563eb' stroke-width=3 /><text x=630 y=31 font-size=14>Series A</text><line x1=730 x2=754 y1=26 y2=26 stroke='#0d9488' stroke-width=3 /><text x=760 y=31 font-size=14>Series B</text>"
        png = render(page(f"<svg width={w} height={h}>{s}</svg>", w=w, pad=0), w, h, name)
        if i % 2 == 0:
            add("chart", lvl, str(i), png, "In which month does Series B reach its highest value? Reply with the 3-letter month only.", "ci", MONTHS[b.index(max(b))])
        else:
            k = R.choice([j for j in range(12) if abs(a[j] - b[j]) >= 8])
            add("chart", lvl, str(i), png, f"In {MONTHS[k]}, which series is higher: Series A or Series B? Reply 'Series A' or 'Series B' only.", "ci", "Series A" if a[k] > b[k] else "Series B")
    else:  # L4: three close series, 24 points, read one value
        k = R.randrange(24); sers = [[R.randint(40, 70) for _ in range(24)] for _ in range(3)]
        s = svg_axes(w, h, 100, 10); dx = (w - 110) / 23; cols = ["#2563eb", "#0d9488", "#7c3aed"]
        for ser, col in zip(sers, cols):
            s += f"<polyline points='{' '.join(f'{80+j*dx:.1f},{h-60-v*(h-100)/100:.1f}' for j, v in enumerate(ser))}' fill=none stroke='{col}' stroke-width=1.5 />"
        s += "".join(f"<text x={80+j*dx:.1f} y={h-38} text-anchor=middle font-size=9>{j+1}</text>" for j in range(24))
        s += "".join(f"<line x1={560+n*110} x2={584+n*110} y1=26 y2=26 stroke='{c}' stroke-width=3 /><text x={590+n*110} y=31 font-size=13>Series {'ABC'[n]}</text>" for n, c in enumerate(cols))
        png = render(page(f"<svg width={w} height={h}>{s}</svg>", w=w, pad=0), w, h, name)
        add("chart", lvl, str(i), png, f"On the x axis the points are numbered 1 to 24. What is the value of Series B at point {k+1}? Estimate from the y axis and reply with a number only.", "num", sers[1][k], tol=4)


# ---------- 5. dashboards & forms (JSON) ----------
FIELD_POOL = [("active_users", "Active Users", lambda: str(R.randint(100, 99999))), ("active_sessions", "Active Sessions", lambda: str(R.randint(100, 99999))),
              ("error_rate", "Error Rate", lambda: f"{R.uniform(0,9):.2f}%"), ("error_budget", "Error Budget Left", lambda: f"{R.uniform(10,99):.1f}%"),
              ("region", "Region", lambda: R.choice(REGIONS)), ("p95_latency_ms", "p95 Latency (ms)", lambda: str(R.randint(20, 900))),
              ("p99_latency_ms", "p99 Latency (ms)", lambda: str(R.randint(900, 4000))), ("revenue_usd", "Revenue (USD)", lambda: f"${R.randint(1000,999999):,}"),
              ("refunds_usd", "Refunds (USD)", lambda: f"${R.randint(10,9999):,}"), ("billing_zip", "Billing ZIP", lambda: str(R.randint(10000, 99999))),
              ("shipping_zip", "Shipping ZIP", lambda: str(R.randint(10000, 99999))), ("build", "Build", lambda: f"#{R.randint(1000,9999)}"),
              ("owner", "Owner", lambda: R.choice(WORDS) + "." + R.choice(WORDS).lower()), ("uptime_pct", "Uptime", lambda: f"{R.uniform(97,100):.3f}%"),
              ("queue_depth", "Queue Depth", lambda: str(R.randint(0, 5000))), ("cpu_pct", "CPU", lambda: f"{R.randint(1,99)}%"),
              ("au_7d", "Active Users (7d)", lambda: str(R.randint(1000, 99999))), ("au_30d", "Active Users (30d)", lambda: str(R.randint(1000, 99999))),
              ("err_5xx", "Error Rate (5xx)", lambda: f"{R.uniform(0,2):.2f}%"), ("err_4xx", "Error Rate (4xx)", lambda: f"{R.uniform(0,9):.2f}%"),
              ("dlq_depth", "Queue Depth (DLQ)", lambda: str(R.randint(0, 900))), ("cpu_peak", "CPU (peak)", lambda: f"{R.randint(50,99)}%"),
              ("mem_gb", "Memory (GB)", lambda: f"{R.uniform(1,64):.1f}"), ("disk_gb", "Disk (GB)", lambda: str(R.randint(10, 999)))]
def pick_fields(n):
    # keep similar-label pairs together at higher n so they are real traps
    pairs = [(0, 1), (2, 3), (5, 6), (7, 8), (9, 10), (16, 17), (18, 19), (20, 21)]
    chosen = set()
    for p in R.sample(pairs, 1 if n <= 8 else 3 if n <= 14 else 5): chosen.update(p)
    rest = [k for k in range(len(FIELD_POOL)) if k not in chosen]; R.shuffle(rest)
    while len(chosen) < n: chosen.add(rest.pop())
    return [FIELD_POOL[k] for k in sorted(chosen)][:n] if n >= 6 else [FIELD_POOL[k] for k in R.sample(sorted(chosen), n)]

def gen_json(lvl, i):
    n, fs = {1: (4, 20), 2: (8, 15), 3: (14, 11), 4: (24, 9)}[lvl]
    fields = pick_fields(n); R.shuffle(fields)
    exp = {k: g() for k, _, g in fields}
    form = R.random() < .5
    fg, bg = ("#111", "#f5f6f8") if lvl < 3 else ("#8a8f98", "#fafafa")
    cols = 6 if lvl == 4 else 4
    if form:
        body = "".join(f"<div style='display:flex;margin:{fs*.5}px 0;font-size:{fs}px;align-items:center'><label style='width:{fs*12}px'>{lab}</label>"
                       f"<div style='border:1px solid #bbb;background:#fff;padding:3px 8px;min-width:{fs*10}px'>{html.escape(exp[k])}</div></div>" for k, lab, _ in fields)
        w, h = fs * 28 + 48, int(60 + n * fs * 2.4)
    else:
        cards = "".join(f"<div style='background:#fff;border:1px solid #e1e4e8;border-radius:6px;padding:8px 12px;width:{fs*11}px'><div style='font-size:{fs*.6:.0f}px;color:{'#888' if lvl<3 else '#a5a9b0'}'>{lab}</div>"
                        f"<div style='font-size:{fs*1.3:.0f}px;font-weight:600;color:{fg}'>{html.escape(exp[k])}</div></div>" for k, lab, _ in fields)
        body = f"<div style='display:grid;grid-template-columns:repeat({cols},1fr);gap:10px'>{cards}</div>"
        w, h = fs * 11 * cols + 120, int(60 + ((n + cols - 1) // cols) * fs * 4.5)
    png = render(page(body, bg, fg, w), w, h, f"json-L{lvl}-{i}")
    keys = ", ".join(f'"{k}" (label "{lab}")' for k, lab, _ in fields)
    add("json", lvl, str(i), png, f"Read this {'form' if form else 'dashboard'}. Return one JSON object with exactly these keys and the value shown for each, copied as displayed: {keys}.", "json", exp, json_keys=True)


# ---------- 6. absence & hallucination ----------
def gen_absent(lvl, i):
    absent = i % 2 == 0  # alternate absent / present control so "always NOT_PRESENT" cannot win
    name = f"absent-L{lvl}-{i}"
    if lvl == 1:
        fields = R.sample(FIELD_POOL, 6); exp = {k: g() for k, _, g in fields}
        body = "".join(f"<div style='margin:10px 0;font-size:20px'><b style='display:inline-block;width:260px'>{lab}</b>{html.escape(exp[k])}</div>" for k, lab, _ in fields)
        png = render(page(body, w=760), 760, 400, name)
        rest = [f for f in FIELD_POOL if f[0] not in exp and f[0] not in ("shipping_zip", "billing_zip", "active_sessions", "error_budget", "p99_latency_ms", "refunds_usd")]
        if absent: add("absent", lvl, str(i), png, f"What is the value of the field '{R.choice(rest)[1]}'?" + ABSENT + ONLY, "exact", "NOT_PRESENT", absent=True)
        else:
            k, lab, _ = R.choice(fields); add("absent", lvl, str(i), png, f"What is the value of the field '{lab}'?" + ABSENT + ONLY, "ci", exp[k])
    elif lvl == 2:
        if i % 4 < 2:  # near-miss label: only the billing twin exists
            z1, z2 = str(R.randint(10000, 99999)), str(R.randint(10000, 99999))
            body = f"<div style='font-size:18px;line-height:2'><b>Name</b> {R.choice(WORDS)}<br><b>Billing ZIP</b> {z1}<br><b>Billing City</b> {R.choice(WORDS)}ville<br><b>Phone</b> 555-{R.randint(1000,9999)}</div>"
            png = render(page(body, w=600), 600, 260, name)
            if absent: add("absent", lvl, str(i), png, "What is the value of the field 'Shipping ZIP'?" + ABSENT + ONLY, "exact", "NOT_PRESENT", absent=True)
            else: add("absent", lvl, str(i), png, "What is the value of the field 'Billing ZIP'?" + ABSENT + ONLY, "exact", z1)
        else:  # clean log: no ERROR line
            t = 36000; ls = []
            for _ in range(14):
                t += R.randint(1, 30)
                ls.append(f"<div><span style='color:#6e7681'>2026-03-14T{t//3600:02d}:{t%3600//60:02d}:{t%60:02d}Z</span> <span style='color:#3fb950'>[INFO]</span> {R.choice(['errors=0 failed=0','request ok','retry budget full','cache warm'])}</div>")
            err = R.choice(range(14)) if not absent else None
            if err is not None:
                ls[err] = ls[err].replace("[INFO]", "[ERROR]").replace("3fb950", "ff5555")
            ts = ls[err].split(">")[2].split("<")[0] if err is not None else None
            png = render(page("".join(ls), "#0d1117", "#c9d1d9", 900, 16, MONO).replace("padding:16px", "padding:16px;font-size:13px"), 900, 330, name)
            add("absent", lvl, str(i), png, "What is the timestamp of the line whose level is ERROR?" + ABSENT + ONLY, "exact", ts or "NOT_PRESENT", absent=absent)
    else:  # counting (L4: 60 rows at 9px, FAILED lookalikes)
        n = 30 if lvl == 3 else 60; zero = absent
        rows = []
        st = ["SHIPPED", "PENDING", "RETURNED", "HOLD", "TIMEOUT"] + (["FAILED_RETRY", "FAIL-SAFE"] if lvl == 4 else [])
        stats = [R.choice(st) for _ in range(n)]
        cnt = 0 if zero else R.randint(1, 4) + (2 if lvl == 4 else 0)
        for k in R.sample(range(n), cnt): stats[k] = "FAILED"
        col = {"SHIPPED": "#16a34a", "PENDING": "#ca8a04", "RETURNED": "#7c3aed", "HOLD": "#ea580c", "TIMEOUT": "#dc2626", "FAILED": "#b91c1c", "FAILED_RETRY": "#b91c1c", "FAIL-SAFE": "#b91c1c"}
        trs = "".join(f"<tr><td style='padding:1px 8px'>ORD-{R.randint(10000,99999)}</td><td style='padding:1px 8px'>{R.choice(WORDS)}</td><td style='padding:1px 8px;color:{col[s]};font-weight:600'>{s}</td></tr>" for s in stats)
        png = render(page(f"<table style='font-size:{11 if lvl == 3 else 9}px;border-collapse:collapse'><tr><th>Order</th><th>Customer</th><th>Status</th></tr>{trs}</table>", w=420), 420, int(60 + n * (19 if lvl == 3 else 15)), name)
        add("absent", lvl, str(i), png, "Count the rows whose Status is exactly FAILED. Reply with a single integer (0 if none)." , "num", cnt, absent=zero)


# ---------- 7. layout traps ----------
def gen_layout(lvl, i):
    name = f"layout-L{lvl}-{i}"
    if lvl == 2:
        w, h = 1920, 1080; commit = rid(7, string.hexdigits[:16]).lower(); build = f"2026.10.{R.randint(1000,9999)}"
        bars = "".join(f"<div style='background:#e5e7eb;height:{R.randint(40,300)}px;width:60px;display:inline-block;margin:6px'></div>" for _ in range(14))
        body = (f"<div style='display:flex;height:1000px'><div style='width:220px;background:#1f2937;color:#d1d5db;padding:16px;font-size:18px'>Dashboard<br>Reports<br>Settings</div>"
                f"<div style='flex:1;padding:30px;font-size:40px'>Weekly Overview<div style='margin-top:30px'>{bars}</div></div></div>"
                f"<div style='position:absolute;right:10px;bottom:6px;font:9px {MONO};color:#9ca3af'>build {build} | commit {commit}</div>")
        png = render(page(body, w=w, pad=0), w, h, name)
        add("layout", lvl, str(i), png, "A small footer text in a corner of this screenshot shows a build number and commit hash. What is the commit hash?" + ONLY, "exact", commit)
        return
    fs = {1: 22, 3: 12, 4: 12}[lvl]
    rows = [("Latency p50", f"{R.randint(5,40)} ms"), ("Latency p95", f"{R.randint(60,200)} ms"), ("Latency p99", f"{R.randint(300,900)} ms"),
            ("Total Users", f"{R.randint(1000,9999)}"), ("Total Active Users", f"{R.randint(100,999)}"), ("Total Active Users (7d)", f"{R.randint(500,2999)}")] + ([("Latency p90", f"{R.randint(40,150)} ms"), ("Latency p999", f"{R.randint(900,4000)} ms"), ("Total Active Users (30d)", f"{R.randint(3000,9999)}")] if lvl == 4 else [])
    R.shuffle(rows); lab, val = R.choice(rows)
    body = "".join(f"<div style='display:flex;justify-content:space-between;font-size:{fs}px;padding:{fs*.3}px 0;border-bottom:1px solid #ddd'><span>{l}</span><b>{v}</b></div>" for l, v in rows)
    w = fs * 22; h = int(40 + len(rows) * fs * 2.1)
    post = None; hint = ""
    if lvl >= 3:
        t = R.choice(["r90", "r180", "tilt", "small"])
        post = {"r90": lambda im: im.rotate(-90, expand=True, fillcolor="white"), "r180": lambda im: im.rotate(180, expand=True, fillcolor="white"),
                "tilt": lambda im: im.rotate(9, expand=True, fillcolor="white", resample=Image.BICUBIC),
                "small": lambda im: im.resize((im.width * 3 // 4, im.height * 3 // 4), Image.BILINEAR)}[t]
        if lvl == 4: base = post; post = lambda im: base(im).resize((base(im).width * 17 // 20, base(im).height * 17 // 20), Image.BILINEAR)
    png = render(page(body, w=w, pad=20), w, h, name, post)
    add("layout", lvl, str(i), png, f"What is the value shown for the row labelled exactly '{lab}'?" + ONLY, "ci", val)


GENS = [gen_table, gen_tokens, gen_terminal, gen_chart, gen_json, gen_absent, gen_layout]

def main():
    global OUT
    ap = argparse.ArgumentParser(); ap.add_argument("--out", required=True); ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--per-level", type=int, default=3); ap.add_argument("--only", default=""); ap.add_argument("--levels", default="1,2,3", help="e.g. 4 for the extra-hard set")
    a = ap.parse_args(); OUT = os.path.abspath(a.out); R.seed(a.seed)
    for g in GENS:
        if a.only and a.only not in g.__name__: continue
        for lvl in [int(x) for x in a.levels.split(',')]:
            if lvl == 4 and g.__name__ not in ('gen_json', 'gen_absent', 'gen_layout', 'gen_chart'): continue
            for i in range(a.per_level): g(lvl, i)
    json.dump(dict(seed=a.seed, items=ITEMS), open(os.path.join(OUT, "manifest.json"), "w"), indent=1)
    print(f"{len(ITEMS)} items -> {OUT}/manifest.json")

if __name__ == "__main__": main()

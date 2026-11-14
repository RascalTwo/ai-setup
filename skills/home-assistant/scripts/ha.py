#!/usr/bin/env python3
"""Call a Home Assistant instance's REST API. Stdlib only, so it runs anywhere Python does."""
import argparse, getpass, json, os, re, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

CONFIG = Path.home() / ".config" / "home-assistant"
URL = CONFIG / "url"
TOKEN = CONFIG / "token"
CONFIRM_SECONDS = float(os.environ.get("HA_CONFIRM_SECONDS", 10))
SETUP_HELP = "follow setup.md in the home-assistant skill"

# states is every entity; area, device and labels are registry data, reachable over REST only through a template.
FIND_TEMPLATE = """{% set ns = namespace(rows=[]) %}{% for s in states %}{% set ns.rows = ns.rows + [{
"entity_id": s.entity_id, "name": s.name, "state": s.state, "area": area_name(s.entity_id),
"device": device_attr(s.entity_id, 'name_by_user') or device_attr(s.entity_id, 'name'),
"labels": labels(s.entity_id)}] %}{% endfor %}{{ ns.rows | to_json }}"""


def die(message):
    sys.exit(f"ha: {message}")


def request(path, body=None, method=None, url=None, token=None):
    if token is None:
        if not (URL.exists() and TOKEN.exists()):
            die(f"not set up, {URL} or {TOKEN} is missing: {SETUP_HELP}")
        url, token = URL.read_text().strip(), TOKEN.read_text().strip()
    req = urllib.request.Request(
        url + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.read().decode()
    except urllib.error.HTTPError as e:
        if e.code == 401:
            die(f"Home Assistant rejected the token: {SETUP_HELP}")
        die(f"HTTP {e.code} on {path}: {e.read().decode(errors='replace')[:300]}")
    except OSError as e:
        die(f"cannot reach {url}: {e}")


def get_state(entity_id):
    return json.loads(request(f"/api/states/{entity_id}"))


def checked_id(entity_id):
    # Also keeps out HA's special target "all", which would hit every entity in a domain.
    if not re.fullmatch(r"[a-z0-9_]+\.[a-z0-9_]+", entity_id):
        die(f"'{entity_id}' is not an entity id. Use find to get one")
    return entity_id


def setup(args):
    url = args.url.rstrip("/")
    if not re.fullmatch(r"https?://[^/\s]+", url):
        die("the URL should look like http://homeassistant.local:8123")
    token = getpass.getpass("Paste the token (hidden): ") if sys.stdin.isatty() else sys.stdin.read()
    token = token.strip()
    if not token or re.search(r"\s", token):
        die("that is not a token: it is empty or contains spaces")
    request("/api/", url=url, token=token)  # dies on a rejected token, so a bad paste never replaces a good file
    CONFIG.mkdir(parents=True, exist_ok=True)
    URL.write_text(url + "\n")
    TOKEN.touch()
    # Lock the file while it is still empty.
    if os.name == "nt":
        subprocess.run(["icacls", str(TOKEN), "/inheritance:r", "/grant:r", f"{os.environ['USERNAME']}:F"], check=True, capture_output=True)
    else:
        TOKEN.chmod(0o600)
    TOKEN.write_text(token + "\n")
    print(f"Token works. Saved to {TOKEN}, for {url}")


def api(args):
    # The path is appended to the URL, so anything else could send the token to another host.
    if not args.path.startswith("/api/"):
        die("the path must start with /api/")
    try:
        body = None if args.json is None else json.loads(args.json)
    except ValueError as e:
        die(f"the body is not valid JSON: {e}")
    print(request(args.path, body, args.method))


def find(args):
    words = [w.lower() for w in args.words]
    rows = json.loads(request("/api/template", {"template": FIND_TEMPLATE}))
    matches = []
    for r in rows:
        text = " ".join([r["entity_id"], r["name"] or "", r["area"] or "", r["device"] or "", *r["labels"]]).lower()
        if all(w in text for w in words) and (not args.domain or r["entity_id"].startswith(args.domain + ".")):
            matches.append(r)
    for r in sorted(matches, key=lambda r: r["entity_id"]):
        print(f"{r['entity_id']} = {r['state']} | name: {r['name']} | area: {r['area']} | device: {r['device']}")
    if not matches:
        die("no entity matches every word. Try fewer words")


def switch(args):
    want_on = args.command == "on"
    ids = [checked_id(e) for e in args.entity_ids]
    failed = False
    for entity_id in ids:
        domain = entity_id.split(".")[0]
        request(f"/api/services/{domain}/turn_{args.command}", {"entity_id": entity_id})
        deadline = time.monotonic() + CONFIRM_SECONDS
        while True:
            current = get_state(entity_id)["state"]
            # "On" is not always the word "on": a climate entity reports its mode, such as "cool".
            ok = current not in ("off", "unavailable", "unknown") if want_on else current == "off"
            if ok or time.monotonic() >= deadline:
                break
            time.sleep(0.5)
        print(f"{entity_id} = {current} ({'confirmed' if ok else 'NOT confirmed: asked for ' + args.command})")
        failed = failed or not ok
    sys.exit(1 if failed else 0)


def main():
    sys.stdout.reconfigure(errors="replace")  # Windows consoles can't print every device name
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("setup", help="check a URL and token, then store them (hidden prompt, or token on stdin)")
    p.add_argument("url")
    p.set_defaults(run=setup)
    p = sub.add_parser("api", help="call any REST endpoint and print the response")
    p.add_argument("method", choices=["GET", "POST", "DELETE"])
    p.add_argument("path", help="such as /api/states")
    p.add_argument("json", nargs="?", help="request body")
    p.set_defaults(run=api)
    p = sub.add_parser("find", help="list entities whose id, name, area, device or labels contain every word")
    p.add_argument("words", nargs="+")
    p.add_argument("--domain", help="only this domain, such as switch")
    p.set_defaults(run=find)
    for name in ("on", "off"):
        p = sub.add_parser(name, help=f"turn entities {name}, then wait until Home Assistant reports it")
        p.add_argument("entity_ids", nargs="+")
        p.set_defaults(run=switch)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()

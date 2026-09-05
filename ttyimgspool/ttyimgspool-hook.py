#!/usr/bin/env python3
"""Park every image this session touches in its spool, for ttyimgspool (prefix+i).

Two entry points, one script:
  PostToolUse      - any tool call that produced or acted on an image
  UserPromptSubmit - images you pasted into the prompt

Runs on EVERY tool call, so the first thing it does is a substring scan of the
raw payload and bail if nothing looks image-shaped. That keeps the cost of the
common case to interpreter startup rather than a full JSON parse.

Never fails loudly: a hook that errors is noise in the middle of real work.
"""
import base64, json, os, re, shutil, subprocess, sys, time

SPOOL = os.path.expanduser("~/.claude/ttyimgspool")
CACHE = os.path.expanduser("~/.claude/image-cache")
LOG = os.path.join(SPOOL, ".hook.log")
EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
MAX_PER_CALL = 5          # a gif_creator run can emit a lot; don't flood
MIN_BYTES = 2048          # skip icons/spacers not worth a gallery slot

# cheap pre-filter; must stay in sync with EXTS
SNIFF = re.compile(r'\.(png|jpe?g|gif|webp|bmp)\b|"type"\s*:\s*"image"', re.I)
# path-like token ending in an image extension, possibly embedded in a sentence
PATH_RE = re.compile(r'(?:file://)?[\w./~@+\-]+\.(?:png|jpe?g|gif|webp|bmp)\b', re.I)


def session_name(payload):
    """Folder name for this session.

    Prefer the pane's agent_session over the payload's session_id: ttyimgspool
    resolves the folder the same way, so both ends agree even when they differ.
    They do differ - a session running as a background job reports the job id
    here while herdr still knows it by the id from when the pane started.
    """
    pane = os.environ.get("HERDR_PANE_ID")
    if pane:
        try:
            out = subprocess.run(["herdr", "pane", "get", pane],
                                 capture_output=True, text=True, timeout=3).stdout
            m = re.search(r'"agent_session":\{[^}]*"value":"([^"]+)"', out)
            if m:
                return m.group(1)
        except Exception:
            pass
    return payload.get("session_id") or "unknown"


def spool_dir(session):
    d = os.path.join(SPOOL, session)
    os.makedirs(d, exist_ok=True)
    return d


def collect_b64(node, out):
    """Anthropic image content blocks, at any nesting depth."""
    if isinstance(node, dict):
        src = node.get("source")
        if node.get("type") == "image" and isinstance(src, dict) and src.get("data"):
            out.append((src.get("media_type", "image/png"), src["data"]))
        for v in node.values():
            collect_b64(v, out)
    elif isinstance(node, list):
        for v in node:
            collect_b64(v, out)


def collect_paths(node, out):
    """Image paths the tool was ASKED to act on.

    Deliberately only ever called on tool_input. Walking tool_response too would
    scoop up every image path a Grep or ls happened to print.
    """
    if isinstance(node, dict):
        for v in node.values():
            collect_paths(v, out)
    elif isinstance(node, list):
        for v in node:
            collect_paths(v, out)
    elif isinstance(node, str) and len(node) < 4096:
        # scan WITHIN the string: an image path is often embedded in a larger
        # value, e.g. a Bash command "open /tmp/shot.png"
        for tok in PATH_RE.findall(node):
            p = os.path.expanduser(tok[7:] if tok.startswith("file://") else tok)
            if os.path.isfile(p) and p not in out:
                out.append(p)


def already_spooled(out, base, size):
    """Same basename + same byte count = same image, whatever the timestamp.

    Without this, every `ls` or `open` mentioning a file re-copies it, and the
    gallery fills with duplicates of one screenshot.
    """
    for name in os.listdir(out):
        if name.endswith("-" + base) or name == base:
            try:
                if os.path.getsize(os.path.join(out, name)) == size:
                    return True
            except OSError:
                pass
    return False


def save_bytes(dest, raw):
    if len(raw) < MIN_BYTES or os.path.exists(dest):
        return 0
    with open(dest, "wb") as f:
        f.write(raw)
    return 1


def do_tool(payload):
    session = session_name(payload)
    tool = payload.get("tool_name", "tool").replace("/", "_")

    b64, paths = [], []
    collect_b64(payload.get("tool_response"), b64)
    collect_b64(payload.get("tool_input"), b64)
    collect_paths(payload.get("tool_input"), paths)
    if not b64 and not paths:
        return 0, tool, session

    out = spool_dir(session)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    n = 0
    for i, (media_type, data) in enumerate(b64[:MAX_PER_CALL], 1):
        ext = "." + media_type.rsplit("/", 1)[-1].replace("jpeg", "jpg")
        n += save_bytes(os.path.join(out, f"{stamp}-{tool}-{i}{ext}"),
                        base64.b64decode(data))
    for p in paths[:MAX_PER_CALL]:
        if os.path.dirname(os.path.abspath(p)) == out:
            continue          # already ours; don't copy it back onto itself
        base, size = os.path.basename(p), os.path.getsize(p)
        if size < MIN_BYTES or already_spooled(out, base, size):
            continue
        shutil.copyfile(p, os.path.join(out, f"{stamp}-{tool}-{base}"))
        n += 1
    return n, tool, session


def do_prompt(payload):
    """Pasted images: Claude Code writes them to image-cache/<session>/N.png.

    Names are deterministic (paste-N.png) so re-running each turn re-copies
    nothing - existence is the dedup.
    """
    session = session_name(payload)
    src = os.path.join(CACHE, session)
    if not os.path.isdir(src):
        return 0, "paste", session
    out = spool_dir(session)
    n = 0
    for name in sorted(os.listdir(src)):
        p = os.path.join(src, name)
        if not os.path.isfile(p) or os.path.splitext(name)[1].lower() not in EXTS:
            continue
        dest = os.path.join(out, f"paste-{name}")
        if os.path.exists(dest) or os.path.getsize(p) < MIN_BYTES:
            continue
        shutil.copyfile(p, dest)
        n += 1
    return n, "paste", session


def main():
    raw = sys.stdin.read()
    event = ""
    m = re.search(r'"hook_event_name"\s*:\s*"([^"]+)"', raw)
    if m:
        event = m.group(1)
    # fast path: tool calls that can't involve an image never get parsed
    if event != "UserPromptSubmit" and not SNIFF.search(raw):
        return
    payload = json.loads(raw)
    n, tool, session = do_prompt(payload) if event == "UserPromptSubmit" else do_tool(payload)
    if n:
        with open(LOG, "a") as f:
            f.write(f"{time.strftime('%Y%m%d-%H%M%S')} {tool} "
                    f"session={session[:8]} saved={n}\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - never break the tool call
        try:
            os.makedirs(SPOOL, exist_ok=True)
            with open(LOG, "a") as f:
                f.write(f"{time.strftime('%Y%m%d-%H%M%S')} ERROR {e!r}\n")
        except Exception:
            pass

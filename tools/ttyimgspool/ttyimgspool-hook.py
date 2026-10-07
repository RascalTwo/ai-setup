#!/usr/bin/env python3
"""Park every image this session touches in its spool, for ttyimgspool (prefix+i),
and draw the ones Claude actually looked at inline in the transcript.

Two entry points, one script:
  PostToolUse      - any tool call that produced or acted on an image
  UserPromptSubmit - images you pasted into the prompt

Runs on EVERY tool call, so the first thing it does is a substring scan of the
raw payload and bail if nothing looks image-shaped. That keeps the cost of the
common case to interpreter startup rather than a full JSON parse.

Inline drawing uses kitty Unicode placeholders: the image is uploaded straight to
Claude Code's tty, and the hook's systemMessage carries placeholder cells whose
24-bit foreground colour IS the image id. Claude Code passes that ANSI through
untouched, so the terminal draws the picture in the transcript. Each image and
its caption are OSC 8 links to the spooled file; herdr routes Ctrl+click on them
to the ttyimgspool plugin, which opens it full-pane.

Never fails loudly: a hook that errors is noise in the middle of real work.
"""
import base64, fcntl, json, os, random, re, shutil, struct, subprocess, sys, termios, time
from urllib.parse import quote

SPOOL = os.path.expanduser("~/.agents/state/ttyimgspool")
CACHE = os.path.expanduser("~/.claude/image-cache")
LOG = os.path.join(SPOOL, ".hook.log")
EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
MAX_PER_CALL = 5          # a gif_creator run can emit a lot; don't flood
MIN_BYTES = 2048          # skip icons/spacers not worth a gallery slot
MAX_ROWS, MAX_COLS = 12, 40    # a thumbnail; Ctrl+click opens the full-res original

# cheap pre-filter; must stay in sync with EXTS
SNIFF = re.compile(r'\.(png|jpe?g|gif|webp|bmp)\b|"type"\s*:\s*"image"', re.I)
# path-like token ending in an image extension, possibly embedded in a sentence
PATH_RE = re.compile(r'(?:file://)?[\w./~@+\-]+\.(?:png|jpe?g|gif|webp|bmp)\b', re.I)
# the show-image command's one line of output
SHOW_RE = re.compile(r'^show-image: (/.+)$', re.M)

# kitty's row/column diacritics, in order: the Nth one encodes row (or column) N
DIACRITICS = [0x0305, 0x030D, 0x030E, 0x0310, 0x0312, 0x033D, 0x033E, 0x033F, 0x0346, 0x034A,
              0x034B, 0x034C, 0x0350, 0x0351, 0x0352, 0x0357, 0x035B, 0x0363, 0x0364, 0x0365,
              0x0366, 0x0367, 0x0368, 0x0369, 0x036A, 0x036B, 0x036C, 0x036D, 0x036E, 0x036F,
              0x0483, 0x0484, 0x0485, 0x0486, 0x0487, 0x0592, 0x0593, 0x0594, 0x0595, 0x0597,
              0x0598, 0x0599, 0x059C, 0x059D, 0x059E, 0x059F, 0x05A0, 0x05A1, 0x05A8, 0x05A9]


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
    """The spooled copy of this image, if any: same basename + same byte count.

    Without this, every `ls` or `open` mentioning a file re-copies it, and the
    gallery fills with duplicates of one screenshot.
    """
    for name in os.listdir(out):
        if name.endswith("-" + base) or name == base:
            try:
                if os.path.getsize(os.path.join(out, name)) == size:
                    return os.path.join(out, name)
            except OSError:
                pass
    return None


def save_bytes(dest, raw):
    """Spool raw bytes; returns the path to show, or None if too small to bother."""
    if len(raw) < MIN_BYTES:
        return None
    if not os.path.exists(dest):
        with open(dest, "wb") as f:
            f.write(raw)
    return dest


def spool_path(out, stamp, tool, p):
    """Spool a file by path; returns (path to show, whether it was newly copied)."""
    if os.path.dirname(os.path.abspath(p)) == out:
        return p, False       # already ours; don't copy it back onto itself
    base, size = os.path.basename(p), os.path.getsize(p)
    if size < MIN_BYTES:
        return None, False
    have = already_spooled(out, base, size)
    if have:
        return have, False
    dest = os.path.join(out, f"{stamp}-{tool}-{base}")
    shutil.copyfile(p, dest)
    return dest, True


def response_text(node):
    """All the strings in a tool response, joined: where show-image's line lands."""
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        return "\n".join(response_text(v) for v in node.values())
    if isinstance(node, list):
        return "\n".join(response_text(v) for v in node)
    return ""


def do_tool(payload):
    """Returns (saved count, tool, session, paths to draw inline)."""
    session = session_name(payload)
    tool = payload.get("tool_name", "tool").replace("/", "_")

    b64, paths = [], []
    collect_b64(payload.get("tool_response"), b64)
    collect_b64(payload.get("tool_input"), b64)
    collect_paths(payload.get("tool_input"), paths)
    shown = SHOW_RE.findall(response_text(payload.get("tool_response")))
    if not b64 and not paths and not shown:
        return 0, tool, session, []

    out = spool_dir(session)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    n, inline = 0, []
    for i, (media_type, data) in enumerate(b64[:MAX_PER_CALL], 1):
        ext = "." + media_type.rsplit("/", 1)[-1].replace("jpeg", "jpg")
        dest = os.path.join(out, f"{stamp}-{tool}-{i}{ext}")
        fresh = not os.path.exists(dest)
        p = save_bytes(dest, base64.b64decode(data))
        if p:
            n += fresh
            inline.append(p)          # base64 in a response = an image Claude saw
    # Paths: only a Read is "looking at" the file, and it usually came back as
    # base64 above too. Everything else (cp, open, ls) is gallery-only.
    for p in paths[:MAX_PER_CALL]:
        dest, fresh = spool_path(out, stamp, tool, p)
        n += fresh
        if dest and tool == "Read" and not b64:
            inline.append(dest)
    for p in shown[:MAX_PER_CALL]:
        if os.path.isfile(p):
            dest, fresh = spool_path(out, stamp, "show-image", p)
            n += fresh
            if dest:
                inline.append(dest)
    return n, tool, session, inline


def paste_dir(session, payload):
    """Where Claude Code wrote this session's pasted images.

    Older versions: ~/.claude/image-cache/<session>/. By 2.1.283:
    /tmp/claude-<uid>/<launch dir, / as ->/<session>/images/. The launch dir is
    NOT payload["cwd"] (that follows cd), so match on the session id alone,
    which is unique; TMPDIR is searched too in case the root moves there.
    """
    import glob
    sid = payload.get("session_id") or session
    roots = {"/private/tmp", os.environ.get("TMPDIR", "/tmp").rstrip("/")}
    for root in roots:
        hits = glob.glob(os.path.join(root, "claude-*", "*", sid, "images"))
        if hits:
            return hits[0]
    d = os.path.join(CACHE, session)
    return d if os.path.isdir(d) else None


def do_prompt(payload):
    """Pasted images, copied in as paste-N.png.

    Names are deterministic so re-running each turn re-copies nothing -
    existence is the dedup. Only NEW pastes are drawn inline.
    """
    session = session_name(payload)
    src = paste_dir(session, payload)
    if not src:
        return 0, "paste", session, []
    out = spool_dir(session)
    new = []
    for name in sorted(os.listdir(src)):
        p = os.path.join(src, name)
        if not os.path.isfile(p) or os.path.splitext(name)[1].lower() not in EXTS:
            continue
        dest = os.path.join(out, f"paste-{name}")
        if os.path.exists(dest) or os.path.getsize(p) < MIN_BYTES:
            continue
        shutil.copyfile(p, dest)
        new.append(dest)
    return len(new), "paste", session, new


# ---- inline drawing -------------------------------------------------------

def can_draw():
    """Only where kitty graphics are known to work; everywhere else, silence.

    ponytail: a phone attached to herdr inherits the pane's Ghostty env, so this
    can't see it; placeholders show as junk there. herdr exposes no client info.
    """
    term = os.environ.get("TERM_PROGRAM", "")
    if term not in ("ghostty", "WezTerm") and "kitty" not in os.environ.get("TERM", ""):
        return False
    if os.environ.get("HERDR_ENV"):
        try:
            cfg = open(os.path.expanduser("~/.config/herdr/config.toml")).read()
        except OSError:
            return False
        return re.search(r'^\s*kitty_graphics\s*=\s*true', cfg, re.M) is not None
    return True


def claude_tty():
    """The tty of the first ancestor that has one: Claude Code's terminal."""
    pid = os.getppid()
    while pid > 1:
        out = subprocess.run(["ps", "-o", "tty=,ppid=", "-p", str(pid)],
                             capture_output=True, text=True).stdout.split()
        if len(out) != 2:
            return None
        if out[0] not in ("??", "?"):
            return "/dev/" + out[0]
        pid = int(out[1])
    return None


def as_png(path):
    """PNG bytes plus pixel size. sips is built in; kitty only takes PNG (f=100).
    Big images are capped at 1600px to keep the upload small; small ones are
    never upscaled (the terminal scales, and a bigger file buys nothing)."""
    tmp = f"/tmp/ttyimgspool-{os.getpid()}.png"
    sips = lambda *a: subprocess.run(["sips", *a], capture_output=True, timeout=8, check=True)
    sips("-s", "format", "png", path, "--out", tmp)
    with open(tmp, "rb") as f:
        png = f.read()
    w, h = struct.unpack(">II", png[16:24])     # IHDR
    if max(w, h) > 1600:
        sips("-Z", "1600", tmp)
        with open(tmp, "rb") as f:
            png = f.read()
        w, h = struct.unpack(">II", png[16:24])
    os.unlink(tmp)
    return png, w, h


def grid(fd, w, h):
    """Cells for a thumbnail that keeps its aspect ratio in this pane."""
    rows, cols, xpx, ypx = struct.unpack("HHHH", fcntl.ioctl(fd, termios.TIOCGWINSZ, b"\0" * 8))
    # ponytail: cells assumed 2:1 tall when the terminal reports no pixel size
    cell = (ypx / rows) / (xpx / cols) if xpx and ypx else 2.0
    c = min(MAX_COLS, cols - 8)
    if xpx:                    # small images: at most 2x their natural size
        c = min(c, max(1, round(2 * w / (xpx / cols))))
    r = max(1, round(c * h / w / cell))
    lim = min(MAX_ROWS, rows - 8, len(DIACRITICS))
    if r > lim:
        r, c = lim, max(1, round(lim * cell * w / h))
    return c, r


def link_url(path):
    """file:// by default (Ctrl+click only). After `ttyimgspool-link <scheme>`, a
    <scheme>://ttyimg/ URL, so a plain click reaches the viewer too."""
    try:
        scheme = open(os.path.join(SPOOL, ".link-scheme")).read().strip()
    except OSError:
        scheme = ""
    return f"{scheme}://ttyimg{quote(path)}" if scheme else f"file://{path}"


def draw(fd, path, label):
    """Upload one image and return the systemMessage lines that display it."""
    png, w, h = as_png(path)
    cols, rows = grid(fd, w, h)
    iid = random.randrange(1, 1 << 24)
    data = base64.b64encode(png)
    chunks = [data[i:i + 3072] for i in range(0, len(data), 3072)] or [b""]
    for k, chunk in enumerate(chunks):
        # Every chunk is a complete APC, so Claude Code's own writes can land
        # between chunks but never inside one. q=2: no replies into the prompt.
        more = int(k < len(chunks) - 1)
        ctrl = f"a=t,f=100,i={iid},q=2,m={more}" if k == 0 else f"q=2,m={more}"
        os.write(fd, b"\x1b_G" + ctrl.encode() + b";" + chunk + b"\x1b\\")
    os.write(fd, f"\x1b_Ga=p,U=1,i={iid},c={cols},r={rows},q=2\x1b\\".encode())

    link = f"\x1b]8;;{link_url(path)}\x1b\\"
    end = "\x1b]8;;\x1b\\"
    fg = f"\x1b[38;2;{iid >> 16};{(iid >> 8) & 255};{iid & 255}m"
    first = chr(DIACRITICS[0])
    # Only the first cell of a row needs row+column marks; the rest inherit.
    lines = [link + fg + "\U0010EEEE" + chr(DIACRITICS[y]) + first +
             "\U0010EEEE" * (cols - 1) + "\x1b[39m" + end for y in range(rows)]
    caption = f"{link}{label} · {w}×{h} · ctrl+click to enlarge{end}"
    return [caption] + lines


def show_inline(paths, label):
    if not paths or not can_draw():
        return
    tty = claude_tty()
    if not tty:
        return
    fd = os.open(tty, os.O_WRONLY | os.O_NOCTTY)
    try:
        lines = []
        for p in paths[:MAX_PER_CALL]:
            try:
                lines += draw(fd, p, label)
            except Exception as e:  # noqa: BLE001 - one bad image shouldn't hide the rest
                log(f"DRAW-ERROR {os.path.basename(p)} {e!r}")
    finally:
        os.close(fd)
    if lines:
        print(json.dumps({"systemMessage": "\n".join(lines)}))


def log(msg):
    os.makedirs(SPOOL, exist_ok=True)
    with open(LOG, "a") as f:
        f.write(f"{time.strftime('%Y%m%d-%H%M%S')} {msg}\n")


def main():
    raw = sys.stdin.read()
    event = ""
    m = re.search(r'"hook_event_name"\s*:\s*"([^"]+)"', raw)
    if m:
        event = m.group(1)
    # fast path: tool calls that can't involve an image never get parsed
    if event != "UserPromptSubmit" and not SNIFF.search(raw) and "show-image: " not in raw:
        return
    payload = json.loads(raw)
    n, tool, session, inline = (do_prompt(payload) if event == "UserPromptSubmit"
                                else do_tool(payload))
    if n:
        log(f"{tool} session={session[:8]} saved={n}")
    label = "show-image" if "show-image: " in raw else tool.split("__")[-1]   # mcp__x__computer -> computer
    show_inline(inline, label)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001 - never break the tool call
        try:
            log(f"ERROR {e!r}")
        except Exception:
            pass

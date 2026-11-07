"""python3 tools/watch-for/test_watch_for.py  (the model tests need Ollama with d1:2b; --fast skips them)"""
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from importlib.machinery import SourceFileLoader

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, "watch-for")
spec = importlib.util.spec_from_loader("wf", SourceFileLoader("wf", CLI))
wf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wf)
FONT = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 44)


def test_expressions():
    tree, conds = wf.parse('("Deploy succeeded" in top or "error" in box(0.5, 0.5, 0.5, 0.5)) and not "spinner"')
    assert set(c[0] for c in conds.values()) == {"Deploy succeeded", "error", "spinner"}
    k = {c[0]: key for key, c in conds.items()}
    t = {k["Deploy succeeded"]: True, k["error"]: False, k["spinner"]: False}
    assert wf.evaluate(tree, t) is True
    assert wf.evaluate(tree, {**t, k["spinner"]: True}) is False
    assert wf.evaluate(tree, {**t, k["Deploy succeeded"]: False}) is False
    # a named region is an alias for the same fractional box, so it shares a d1 call
    _, c2 = wf.parse('"a" in bottom_right and "b" in box(0.5, 0.5, 0.5, 0.5)')
    assert len({r for _, r in c2.values()}) == 1
    assert wf.parse('"x" in px(10, 20, 300, 40)')[1]['x @ px[10, 20, 300, 40]'][1] == ("px", 10, 20, 300, 40)
    for bad in ['__import__("os")', '"a" + "b"', '"a" in nowhere', '"a" in box(0, 0, 2, 1)', '"a" in px(0, 0, 0, 5)',
                '1', '"a" and', '"a" in box(0, 0, x, 1)', '""']:
        try:
            wf.parse(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad!r}")


def test_crop():
    im = Image.new("RGB", (1000, 500))
    assert wf.crop(im, ("frac", .5, .5, .5, .5)).size == (500, 250)
    assert wf.crop(im, ("px", 10, 20, 300, 40)).size == (300, 40)


def test_unchanged():
    a, b = Image.new("RGB", (1280, 800), "white"), Image.new("RGB", (1280, 800), "white")
    assert wf.unchanged(a, b)
    ImageDraw.Draw(b).text((40, 40), "Deploy succeeded", fill="black", font=FONT)  # one line on a blank frame
    assert not wf.unchanged(a, b)


def frame(path, lines, where=(40, 40)):
    im = Image.new("RGB", (1280, 800), (245, 245, 245))
    d = ImageDraw.Draw(im)
    for i, ln in enumerate(lines):
        d.text((where[0], where[1] + 60 * i), ln, fill=(20, 20, 20), font=FONT)
    im.save(path)


def cli(*args, stdin=None):
    r = subprocess.run([CLI, *args], capture_output=True, text=True, input=stdin, timeout=600)
    out = [json.loads(ln) for ln in r.stdout.splitlines() if ln.strip()]
    return r.returncode, out, r.stderr


def test_with_model():
    d = tempfile.mkdtemp()
    for i, lines in enumerate([["Deploying...", "Please wait"]] * 3 + [["Deploy succeeded", "All checks passed"]] * 2):
        frame(f"{d}/{i:02d}.png", lines)
    code, out, err = cli('"Deploy succeeded"', "--in", f"dir:{d}")
    assert code == 0 and out[0]["matched"] and out[0]["t"] == 4.0, (code, out, err)  # 2nd success frame
    assert os.path.exists(out[0]["frame"])

    code, out, _ = cli('"Deploy failed"', "--in", f"dir:{d}")
    assert code == 1 and out == [{"matched": False, "waited": out[0]["waited"], "p": out[0]["p"]}], out

    # --gone: the wait text disappears at frame 3, confirmed at 4
    code, out, _ = cli('"Please wait"', "--gone", "--in", f"dir:{d}")
    assert code == 0 and out[0]["t"] == 4.0, out

    # regions: the text is only in the bottom-right quarter
    r = tempfile.mkdtemp()
    for i in range(2):
        frame(f"{r}/{i}.png", ["ERROR 503"], where=(800, 600))
    assert cli('"ERROR 503" in bottom_right', "--in", f"dir:{r}")[0] == 0
    assert cli('"ERROR 503" in top_left', "--in", f"dir:{r}")[0] == 1

    # a video file through ffmpeg, every match with --all, and stdin paths
    v = os.path.join(d, "clip.mp4")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-framerate", "1", "-pattern_type", "glob", "-i", f"{d}/*.png",
                    "-pix_fmt", "yuv420p", v], check=True)
    code, out, err = cli('"Deploy succeeded"', "--in", v, "--all")
    assert code == 0 and out[0]["t"] == 4.0, (code, out, err)
    paths = "\n".join(sorted(f"{d}/{f}" for f in os.listdir(d) if f.endswith(".png")))
    assert cli('"Deploy succeeded"', "--in", "-", stdin=paths)[0] == 0

    assert cli('"x" in nowhere')[0] == 2
    assert cli('"x"', "--in", "/no/such/file.mp4")[0] == 2


if __name__ == "__main__":
    test_expressions()
    test_crop()
    test_unchanged()
    print("parser ok")
    if "--fast" not in sys.argv:
        test_with_model()
        print("model ok")

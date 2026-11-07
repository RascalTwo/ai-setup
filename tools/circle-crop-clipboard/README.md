---
rascaltwo-ai-setup:
  kind: tool
  state: false
  requires:
    commands: [python3]
  platforms: macOS (AppKit clipboard)
---

# circle-crop-clipboard

Takes the image on the macOS clipboard, finds the round profile photo sitting on a solid (usually black) square, makes the corners transparent, and puts the result back on the clipboard as a PNG.

## Use

Copy an image, then:

```sh
python3 ~/.agents/ai-setup/tools/circle-crop-clipboard/circle-crop-clipboard.py
```

Paste the transparent-cornered PNG wherever it goes. If the background isn't detected cleanly, tune `BG_THRESHOLD` at the top of the script.

## Deps

```sh
pip install Pillow pyobjc
```

Pillow does the image work; pyobjc (`AppKit`, `Foundation`) reads and writes the clipboard, so this runs on macOS only.

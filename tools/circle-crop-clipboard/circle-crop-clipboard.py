#!/usr/bin/env python3
"""Read an image from the macOS clipboard, isolate the circular profile photo
sitting on a solid (usually black) square background, make the corners
transparent, and put the result back on the clipboard as a PNG.

Usage:  python3 circle-crop-clipboard.py
        (have an image copied to the clipboard first)
"""

import io
import sys

from PIL import Image, ImageDraw
from AppKit import NSPasteboard, NSPasteboardTypePNG, NSPasteboardTypeTIFF
from Foundation import NSData

# How different from the background a pixel must be to count as "photo".
BG_THRESHOLD = 28


def read_clipboard_image() -> Image.Image:
    pb = NSPasteboard.generalPasteboard()
    for ns_type in (NSPasteboardTypePNG, NSPasteboardTypeTIFF):
        data = pb.dataForType_(ns_type)
        if data is not None:
            raw = bytes(data)
            return Image.open(io.BytesIO(raw)).convert("RGBA")
    raise SystemExit("No image found on the clipboard. Copy an image first (Cmd+C / screenshot).")


def write_clipboard_image(img: Image.Image) -> None:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    data = NSData.dataWithBytes_length_(buf.getvalue(), len(buf.getvalue()))
    pb = NSPasteboard.generalPasteboard()
    pb.clearContents()
    pb.setData_forType_(data, NSPasteboardTypePNG)


def detect_circle_bbox(img: Image.Image):
    """Find the bounding box of the non-background content by sampling the four
    corners for the background color, then locating pixels that differ from it."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))

    # Build a mask of pixels far enough from the background, then get its bbox.
    mask = Image.new("L", (w, h), 0)
    mpx = mask.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > BG_THRESHOLD:
                mpx[x, y] = 255
    return mask.getbbox()


def circle_crop(img: Image.Image) -> Image.Image:
    bbox = detect_circle_bbox(img)
    if bbox is None:
        # Nothing distinct from background found; fall back to inscribed circle.
        bbox = (0, 0, img.width, img.height)

    left, top, right, bottom = bbox
    cx = (left + right) / 2
    cy = (top + bottom) / 2
    radius = max(right - left, bottom - top) / 2

    # Crop to a tight square around the detected circle.
    sq_left = int(round(cx - radius))
    sq_top = int(round(cy - radius))
    size = int(round(radius * 2))
    cropped = img.crop((sq_left, sq_top, sq_left + size, sq_top + size))

    # Supersample the mask for smooth (anti-aliased) circle edges.
    scale = 4
    big = Image.new("L", (size * scale, size * scale), 0)
    ImageDraw.Draw(big).ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    mask = big.resize((size, size), Image.LANCZOS)

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(cropped, (0, 0))
    out.putalpha(mask)
    return out


def main() -> None:
    img = read_clipboard_image()
    out = circle_crop(img)
    write_clipboard_image(out)
    print(f"Done: {img.size[0]}x{img.size[1]} -> circular {out.size[0]}x{out.size[1]} PNG back on clipboard.")


if __name__ == "__main__":
    main()
